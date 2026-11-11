/** @file WMS-402 над общим Docker business gate: настоящий collector/metrics/alerts/OTLP и локальные faults. */
const assert = require('node:assert/strict');
const { appendFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
/** Контекст общего driver владеет credentials/проектом/HTTP fixtures; helper не открывает рабочую .env. */
exports.createObservabilityGate = function ({ project, envFile, run, compose, sql, http }) {
  const obsProject = `${project}-obs`;
  const base = [
    'compose',
    '--project-name',
    obsProject,
    '--env-file',
    envFile,
    '-f',
    'infra/observability/compose.yaml',
  ];
  const stack = (args) => run([...base, ...args], `observability ${args[0]} failed`, 240000);
  const urls = {};
  /** Ожидание состояния ограничено; отказ чтения не заменяется успехом, есть только повтор до deadline. */
  async function wait(read, predicate, seconds = 100) {
    const deadline = performance.now() + seconds * 1000;
    let error;
    do {
      try {
        const value = await read();
        if (predicate(value)) return value;
      } catch (e) {
        error = e;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (performance.now() < deadline);
    throw new Error(`Observability condition timed out${error ? ': ' + error.message : ''}`);
  }
  async function json(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    return response.json();
  }
  const query = async (expr) =>
    (await json(urls.prometheus + '/api/v1/query?query=' + encodeURIComponent(expr))).data.result;
  const logs = async (selector) =>
    (
      await json(
        urls.loki + '/loki/api/v1/query_range?limit=1000&query=' + encodeURIComponent(selector),
      )
    ).data.result;
  const alerts = () => json(urls.receiver + '/notifications');
  const notified = (notifications, name, status) =>
    notifications.some((n) =>
      n.alerts.some((a) => a.labels.alertname === name && a.status === status),
    );
  /** Создаёт новый документ через те же production HTTP owners, без прямых складских SQL writes. */
  async function publish(fixture) {
    const draft = await http(
      '/api/v1/receipts',
      'POST',
      {
        warehouseId: fixture.warehouseId,
        receivingLocationId: fixture.receivingLocationId,
        lines: [{ productId: fixture.productId, quantity: 2 }],
      },
      randomUUID(),
    );
    assert.equal(draft.status, 201);
    const posted = await http(`/api/v1/receipts/${draft.body.id}/post`, 'POST', {}, randomUUID());
    assert.equal(posted.status, 200);
    return posted.body;
  }
  /** Не ограничиваемся HTTP status: каждый outage receipt имеет один movement/event/task/marker. */
  async function expectDelivered(receipt) {
    const state = await wait(
      () =>
        sql(
          `select d.status, r.status as receipt,
      (select count(*)::int from outbox_events where aggregate_type='receipt' and aggregate_id=r.id) events,
      (select count(*)::int from putaway_tasks where source_receipt_id=r.id) tasks,
      (select count(*)::int from processed_events where event_id=r.posted_event_id) markers,
      (select count(*)::int from stock_movements where operation_id in(select id from receipt_lines where receipt_id=r.id)) movements
      from receipts r join outbox_deliveries d on d.event_id=r.posted_event_id where r.id=$1`,
          [receipt.id],
        ),
      (rows) => rows[0]?.status === 'completed',
    );
    assert.deepEqual(state[0], {
      status: 'completed',
      receipt: 'posted',
      events: 1,
      tasks: 1,
      markers: 1,
      movements: 1,
    });
  }
  return {
    async start() {
      await appendFile(
        envFile,
        `\nWMS_APP_PROJECT=${project}\nWMS_OBSERVABILITY_PROJECT=${obsProject}\nDATABASE_URL=postgresql://warehouse:${(await require('node:fs/promises').readFile(envFile, 'utf8')).match(/POSTGRES_PASSWORD=(.*)/)[1]}@127.0.0.1:5432/warehouse\n` +
          ['PROMETHEUS', 'LOKI', 'TEMPO', 'GRAFANA', 'OTLP', 'RECEIVER', 'ALERTMANAGER']
            .map((n) => `WMS_${n}_PORT=0`)
            .join('\n') +
          '\n',
      );
      await stack(['up', '-d', '--wait']);
      for (const [name, port, path] of [
        ['prometheus', 9090, '/-/ready'],
        ['loki', 3100, '/ready'],
        ['tempo', 3200, '/ready'],
        ['grafana', 3000, '/api/health'],
        ['receiver', 8080, '/notifications'],
      ]) {
        urls[name] = 'http://' + (await stack(['port', name, String(port)])).trim();
        await wait(
          async () => {
            const r = await fetch(urls[name] + path, { signal: AbortSignal.timeout(3000) });
            return r.status;
          },
          (code) => code === 200,
        );
      }
      console.log('PASS observability actual readiness');
    },
    async recover(receiptId) {
      console.log('CHECK oldest pending age firing');
      // Пока worker остановлен общим gate, реальный возраст pending достигает dev threshold.
      await wait(alerts, (value) => notified(value, 'WmsOldestDelivery', 'firing'), 120);
      console.log('PASS oldest pending age firing');
      await sql(
        `create function wms402_fault() returns trigger language plpgsql as $$ begin raise exception 'synthetic observability fault' using errcode='23514'; end $$`,
      );
      await sql(
        'create trigger wms402_fault before insert on putaway_tasks for each row execute function wms402_fault()',
      );
      const eventId = (
        await sql('select posted_event_id from receipts where id=$1', [receiptId])
      )[0].posted_event_id;
      try {
        await compose(['up', '-d', '--no-build', '--no-deps', 'worker']);
        await wait(
          () => sql('select status from outbox_deliveries where event_id=$1', [eventId]),
          (rows) => rows[0].status === 'dead',
        );
        await wait(
          alerts,
          (value) =>
            notified(value, 'WmsDeadDelivery', 'firing') &&
            notified(value, 'WmsProcessingErrors', 'firing'),
        );
      } finally {
        await sql('drop trigger wms402_fault on putaway_tasks');
        await sql('drop function wms402_fault()');
      }
      console.log('PASS dead and processing firing');
      // CLI имеет собственный Docker IP для discovery. Его loopback TCP tunnel направлен только
      // в PostgreSQL этого UUID project; local opt-in и DB admin role остаются обязательными.
      const cli = async (args, fallback = false) => {
        const name = project + '-cli-' + randomUUID();
        const wrapper = `const net=require('node:net'),fs=require('node:fs'),{spawn}=require('node:child_process');
          const proxy=net.createServer((socket)=>{const upstream=net.connect(5432,'postgres');socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());socket.pipe(upstream).pipe(socket);});
          proxy.listen(5432,'127.0.0.1',()=>{
            ${fallback ? `process.stdout.write(JSON.stringify({result:'WMS402_CLI_RESULT_CANARY'})+'\\n');` : ''}
            const child=spawn(process.execPath,${JSON.stringify(args)},{stdio:'inherit',env:{...process.env,NODE_ENV:${fallback ? "'bad'" : "'development'"},OUTBOX_ADMIN_ENABLED:'true'}});
            child.on('exit',(code)=>fs.writeFileSync('/tmp/cli-result',String(code??1)));
          });`;
        try {
          await run(
            [
              'run',
              '-d',
              '--name',
              name,
              '--network',
              project + '_default',
              '--env-file',
              envFile,
              '--label',
              'com.docker.compose.project=' + project,
              '--label',
              'wms.logs=true',
              '--entrypoint',
              'node',
              'warehouse-backend:local',
              '-e',
              wrapper,
            ],
            'CLI start failed',
            30000,
          );
          const status = await wait(
            () =>
              run(
                [
                  'exec',
                  name,
                  'node',
                  '-e',
                  "const fs=require('node:fs');process.stdout.write(fs.existsSync('/tmp/cli-result')?fs.readFileSync('/tmp/cli-result','utf8'):'pending')",
                ],
                'CLI completion read failed',
              ),
            (value) => value !== 'pending',
          );
          assert.equal(Number(status), fallback ? 1 : 0);
          // Реальный collector acknowledgement вместо sleep: child уже завершил commit независимо от Loki.
          await wait(
            () =>
              logs('{service="warehouse-backend",process="cli"} | container=~".*' + name + '.*"'),
            (rows) => rows.length > 0,
          );
        } finally {
          // Ошибка удаления собственных CLI containers должна провалить gate, а не скрыть утечку ресурса.
          await run(['rm', '-f', name], 'CLI cleanup failed');
        }
      };
      await cli([
        'dist/infrastructure/outbox/outbox-admin.js',
        'retry',
        '--event',
        eventId,
        '--consumer',
        'inventory.putaway',
        '--operator',
        randomUUID(),
        '--reason',
        'observability-restored',
      ]);
      await cli(['dist/infrastructure/database/check.js'], true);
      await wait(
        () => sql('select status from outbox_deliveries where event_id=$1', [eventId]),
        (rows) => rows[0].status === 'completed',
      );
      await wait(
        alerts,
        (value) =>
          ['WmsDeadDelivery', 'WmsOldestDelivery', 'WmsProcessingErrors'].every((name) =>
            notified(value, name, 'resolved'),
          ),
        150,
      );
      console.log(
        'PASS oldest/dead/processing alert firing + local receiver resolution; real CLI recovery',
      );
    },
    async verify(receiptId, fixture) {
      const selector = `{service="warehouse-backend"} | json | aggregateId="${receiptId}"`;
      const found = await wait(
        () => logs(selector),
        (rows) =>
          rows.some(
            (r) =>
              r.stream.process === 'api' &&
              r.values.some((v) => JSON.parse(v[1]).event === 'receiving.posted'),
          ) &&
          rows.some(
            (r) =>
              r.stream.process === 'worker' &&
              r.values.some((v) => JSON.parse(v[1]).event === 'delivery.completed'),
          ),
      );
      // Query-time |json labels не являются Loki index labels; проверяем именно series API.
      const storedSeries = (
        await json(
          urls.loki +
            '/loki/api/v1/series?match[]=' +
            encodeURIComponent('{service="warehouse-backend"}'),
        )
      ).data;
      for (const series of storedSeries)
        assert.deepEqual(Object.keys(series).sort(), [
          'environment',
          'module',
          'process',
          'service',
        ]);
      for (const stream of found) {
        for (const entry of stream.values) JSON.parse(entry[1]);
      }
      const entries = found.flatMap((s) => s.values.map((v) => JSON.parse(v[1])));
      const posted = entries.find((e) => e.event === 'receiving.posted');
      assert.ok(posted?.correlationId && posted.eventId && posted.traceId);
      for (const field of ['correlationId', 'eventId', 'aggregateId']) {
        const matches = await logs(
          `{service="warehouse-backend"} | json | ${field}="${posted[field]}"`,
        );
        assert.ok(matches.length);
      }
      assert.ok(
        (
          await logs(
            `{service="warehouse-backend"} | json | eventId="${posted.eventId}" | errorCode="DATABASE_REJECTED"`,
          )
        ).length,
      );
      assert.ok(
        (await logs('{service="warehouse-backend",process="cli"}')).length,
        'CLI operational records missing',
      );
      await wait(
        () =>
          logs(
            '{service="warehouse-backend",environment="unknown"} | json | errorCode="CONFIG_INVALID"',
          ),
        (rows) => rows.length > 0,
      );
      assert.equal(
        (await logs('{service="warehouse-backend"} |= "WMS402_CLI_RESULT_CANARY"')).length,
        0,
      );
      const trace = await wait(
        () => json(urls.tempo + '/api/traces/' + posted.traceId),
        (data) => JSON.stringify(data).includes('warehouse-backend'),
      );
      assert.ok(JSON.stringify(trace).includes('transaction'));
      const workerEvent = entries.find((e) => e.event === 'delivery.completed');
      const workerTrace = await json(urls.tempo + '/api/traces/' + workerEvent.traceId);
      // Tempo OTLP JSON представляет IDs base64; link проверяется наличием links, exact IDs — integration WMS-401.
      assert.ok(JSON.stringify(workerTrace).includes('links'));
      for (const uid of ['operation', 'queue', 'workers', 'infrastructure']) {
        const result = await json(urls.grafana + '/api/dashboards/uid/wms-' + uid);
        assert.ok(result.dashboard.panels.length >= 3);
      }
      const lokiSource = await json(urls.grafana + '/api/datasources/uid/loki');
      const tempoSource = await json(urls.grafana + '/api/datasources/uid/tempo');
      assert.equal(lokiSource.jsonData.derivedFields[0].datasourceUid, 'tempo');
      assert.equal(lokiSource.jsonData.derivedFields[0].url, '${__value.raw}');
      assert.ok(tempoSource.jsonData.tracesToLogsV2.query.includes('${__span.traceId}'));
      assert.ok((await query('wms_http_duration_seconds_count')).length);
      assert.ok((await query('wms_db_pool_connections')).length);
      console.log(
        'PASS API/worker/CLI log search, exactly four Loki labels, Tempo producer/consumer traces and four provisioned dashboards',
      );
      await stack(['stop', 'loki']);
      const during = await publish(fixture);
      await expectDelivered(during);
      await wait(
        () => stack(['logs', '--no-color', 'collector']),
        (text) => text.includes('dropping') || text.includes('retries left'),
        30,
      );
      await stack(['start', 'loki']);
      // Docker port=0 может получить новый host port после stop/start; container DNS остаётся прежним.
      urls.loki = 'http://' + (await stack(['port', 'loki', '3100'])).trim();
      await wait(
        async () => (await fetch(urls.loki + '/ready')).status,
        (code) => code === 200,
      );
      await stack(['stop', 'collector']);
      const stopped = await publish(fixture);
      await expectDelivered(stopped);
      await stack(['start', 'collector']);
      const restored = await publish(fixture);
      await expectDelivered(restored);
      await wait(
        () => logs(`{service="warehouse-backend"} | json | eventId="${restored.postedEventId}"`),
        (rows) => rows.some((r) => r.stream.process === 'worker'),
      );
      console.log(
        'PASS business commits during Loki outage and collector stop; collection resumes after restart; bounded retry loss diagnosed',
      );
    },
    async close() {
      await Promise.allSettled([
        json(urls.prometheus + '/api/v1/alerts').then((data) =>
          console.log('OBS alerts ' + JSON.stringify(data)),
        ),
        query('wms_outbox_deliveries').then((data) =>
          console.log('OBS queue ' + JSON.stringify(data)),
        ),
      ]);
      await stack(['down', '--volumes', '--remove-orphans']);
    },
  };
};
