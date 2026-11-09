/** @file WMS-304: настоящие Pod kills/rollout и additive migration в disposable кластере Gateway gate. */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { canonicalImage } = require('./kind-image.cjs');
/** Fault hooks существуют только в disposable PostgreSQL. Приложение не получает test bypass endpoints. */
async function checkLifecycle({
  k,
  h,
  run,
  apply,
  until,
  sql,
  request,
  auth,
  fixture,
  config,
  values,
  temp,
  cluster,
  kind,
  kubectl,
  context,
  namespace,
  env,
}) {
  const pods = (role) =>
    JSON.parse(
      k(['get', 'pods', '-l', 'app.kubernetes.io/component=' + role, '-o', 'json']),
    ).items.filter((p) => !p.metadata.deletionTimestamp);
  const pod = (role) => pods(role)[0].metadata.name;
  const ready = (role) =>
    k(['rollout', 'status', 'deployment/warehouse-' + role, '--timeout=120s']);
  const probe = (role, path) =>
    k([
      'exec',
      'deployment/warehouse-' + role,
      '--',
      'node',
      '-e',
      `fetch('http://127.0.0.1:${role === 'api' ? 3000 : 9100}/health/${path}').then(r=>console.log(r.status))`,
    ]);
  /** Readiness и EndpointSlice/NGF reconcile асинхронны. Ждём реальный API route; POST не повторяем автоматически. */
  async function waitApi() {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try {
        if ((await request('/api/v1/warehouses')).status === 401) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Gateway API route did not recover');
  }
  const command = (path, body = {}, key = randomUUID()) =>
    request('/api/v1/' + path, {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': key },
      body: JSON.stringify(body),
      timeoutMs: 30000,
    });
  const receipt = async () => {
    const r = await command('receipts', {
      warehouseId: fixture.warehouseId,
      receivingLocationId: fixture.receivingLocationId,
      lines: [{ productId: fixture.productId, quantity: 1 }],
    });
    assert.equal(r.status, 201);
    return JSON.parse(r.body);
  };
  const settled = (p) =>
    p.then(
      (value) => ({ value }),
      () => ({ failed: true }),
    );
  let blocker, blockedPid, releasePid;
  /** Отдельная сессия держит advisory barrier; stdout содержит только PID, не DATABASE_URL. */
  async function hold() {
    blocker = spawn(
      kubectl,
      [
        '--context',
        context,
        '-n',
        namespace,
        'exec',
        'gateway-fixture',
        '--',
        'node',
        '-e',
        "const {pool}=require('./dist/infrastructure/database/connection').createDatabaseConnection(process.env.DATABASE_URL);pool.connect().then(async c=>{await c.query('select pg_advisory_lock(304,1)');console.log((await c.query('select pg_backend_pid() pid')).rows[0].pid);});",
      ],
      { env, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    releasePid = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Barrier startup deadline')), 15000);
      blocker.stdout.once('data', (data) => {
        clearTimeout(timer);
        resolve(Number(String(data).trim()));
      });
      blocker.once('error', () => {
        clearTimeout(timer);
        reject(new Error('Barrier spawn failed'));
      });
    });
    assert.ok(Number.isInteger(releasePid) && releasePid > 0);
  }
  async function release() {
    if (releasePid) {
      sql(`select pg_terminate_backend(${releasePid})`);
      releasePid = undefined;
    }
    if (blocker && blocker.exitCode === null) {
      const closed = new Promise((resolve) => blocker.once('exit', resolve));
      blocker.kill('SIGTERM');
      await closed;
    }
    blocker = undefined;
  }
  const waitBlocked = async (table) => {
    blockedPid = Number(
      await until(
        () =>
          sql(
            `select pid from pg_stat_activity where wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0 and position('${table}' in query)>0 limit 1`,
          ),
        Boolean,
        8000,
      ),
    );
    return blockedPid;
  };
  async function killBlocked(role, verifyRollback = () => {}) {
    const old = pod(role);
    k(['delete', 'pod', old, '--force', '--grace-period=0', '--wait=false']);
    await until(
      () => sql(`select count(*) from pg_stat_activity where pid=${blockedPid}`),
      (n) => n === '0',
      15000,
    );
    verifyRollback();
    await release();
    ready(role);
    assert.notEqual(pod(role), old);
    if (role === 'api') await waitApi();
  }
  const taskCount = (id) =>
    sql(`select count(*) from putaway_tasks where source_receipt_id='${id}'`);
  const awaitTask = async (id) =>
    until(
      () => taskCount(id),
      (n) => n === '1',
      90000,
    );
  try {
    for (const role of ['api', 'worker'])
      for (const path of ['startup', 'ready', 'live']) assert.equal(probe(role, path), '200');
    // DB отсутствует, но процессы должны остаться живы; проверяем restartCount до/после outage.
    const restarts = ['api', 'worker'].map(
      (role) => pods(role)[0].status.containerStatuses[0].restartCount,
    );
    k(['scale', 'statefulset/postgres', '--replicas=0']);
    await until(
      () =>
        JSON.parse(k(['get', 'pods', '-l', 'app=warehouse-postgres', '-o', 'json'])).items.length,
      (n) => n === 0,
    );
    for (const role of ['api', 'worker']) {
      assert.equal(probe(role, 'ready'), '503');
      assert.equal(probe(role, 'live'), '200');
      assert.equal(probe(role, 'startup'), '200');
    }
    k(['scale', 'statefulset/postgres', '--replicas=1']);
    k(['rollout', 'status', 'statefulset/postgres', '--timeout=120s']);
    for (const [i, role] of ['api', 'worker'].entries()) {
      await until(
        () => probe(role, 'ready'),
        (code) => code === '200',
      );
      assert.equal(pods(role)[0].status.containerStatuses[0].restartCount, restarts[i]);
    }
    await waitApi();
    console.log('PASS lifecycle probes: DB outage removes readiness without liveness restarts');
    // API уже начислило stock внутри transaction, но ещё не провело receipt/COMMIT.
    const before = await receipt(),
      key = randomUUID();
    sql(`create function wms304_barrier() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(304,1); return NEW; end$$;
      create trigger wms304_api before update on receipts for each row when (NEW.id='${before.id}'::uuid) execute function wms304_barrier();`);
    await hold();
    const posting = settled(command('receipts/' + before.id + '/post', {}, key));
    await waitBlocked('receipts');
    await killBlocked('api');
    await posting;
    assert.equal(sql(`select status from receipts where id='${before.id}'`), 'draft');
    assert.equal(
      sql(`select count(*) from stock_movements where operation_id='${before.lines[0].id}'`),
      '0',
    );
    sql('drop trigger wms304_api on receipts');
    assert.equal((await command('receipts/' + before.id + '/post', {}, key)).status, 200);
    await awaitTask(before.id);
    // Kill после подтверждённого commit: тот же key возвращает исходный snapshot.
    const after = await receipt(),
      afterKey = randomUUID();
    const posted = await command('receipts/' + after.id + '/post', {}, afterKey);
    assert.equal(posted.status, 200);
    const oldApi = pod('api');
    k(['delete', 'pod', oldApi, '--wait=true']);
    ready('api');
    await waitApi();
    const replay = await command('receipts/' + after.id + '/post', {}, afterKey);
    assert.equal(replay.status, 200);
    assert.deepEqual(JSON.parse(replay.body), JSON.parse(posted.body));
    assert.equal(
      sql(`select count(*) from stock_movements where operation_id='${after.lines[0].id}'`),
      '1',
    );
    await awaitTask(after.id);
    console.log(
      'PASS API Pod kill before/after commit: rollback or saved replay, one stock movement',
    );
    // Worker успел создать task внутри transaction; advisory barrier останавливает его до marker/ack.
    const work = await receipt();
    sql(
      `create trigger wms304_worker before insert on putaway_tasks for each row when (NEW.source_receipt_id='${work.id}'::uuid) execute function wms304_barrier();`,
    );
    await hold();
    assert.equal((await command('receipts/' + work.id + '/post')).status, 200);
    await waitBlocked('putaway_tasks');
    await killBlocked('worker', () => assert.equal(taskCount(work.id), '0'));
    sql('drop trigger wms304_worker on putaway_tasks');
    await awaitTask(work.id);
    assert.ok(
      Number(
        sql(
          `select d.attempts from outbox_deliveries d join outbox_events e on e.event_id=d.event_id where e.aggregate_id='${work.id}'`,
        ),
      ) >= 2,
    );
    const proof = () =>
      sql(
        `select count(*) from processed_events p join outbox_events e on e.event_id=p.event_id where e.aggregate_id='${work.id}'`,
      );
    assert.equal(proof(), '1');
    const oldWorker = pod('worker');
    k(['delete', 'pod', oldWorker, '--wait=true']);
    ready('worker');
    assert.equal(taskCount(work.id), '1');
    assert.equal(proof(), '1');
    assert.equal(
      sql(
        `select count(*) from audit_entries a join putaway_tasks t on t.id=a.entity_id where t.source_receipt_id='${work.id}' and a.action='inventory.putaway-task-created'`,
      ),
      '1',
    );
    console.log('PASS worker Pod kill before/after commit: lease reclaimed, one task/audit/marker');
    // Test-only release image: добавочная nullable колонка, без изменения applied файлов репозитория.
    const releaseDir = join(temp, 'release');
    mkdirSync(releaseDir);
    const journal = JSON.parse(readFileSync('apps/backend/drizzle/meta/_journal.json', 'utf8'));
    journal.entries.push({
      idx: 33,
      version: '7',
      when: journal.entries.at(-1).when + 1,
      tag: '0033_wms304_gate_expand',
      breakpoints: true,
    });
    writeFileSync(join(releaseDir, '_journal.json'), JSON.stringify(journal));
    writeFileSync(
      join(releaseDir, '0033_wms304_gate_expand.sql'),
      'ALTER TABLE application_metadata ADD COLUMN lifecycle_release_note text;',
    );
    writeFileSync(
      join(releaseDir, 'Dockerfile'),
      'FROM warehouse-backend:wms302\nCOPY --chown=node:node _journal.json ./drizzle/meta/_journal.json\nCOPY --chown=node:node 0033_wms304_gate_expand.sql ./drizzle/0033_wms304_gate_expand.sql\n',
    );
    run('docker', ['build', '-t', 'warehouse-backend:wms304', releaseDir]);
    run(kind, ['load', 'docker-image', 'warehouse-backend:wms304', '--name', cluster]);
    const digest = canonicalImage(run, cluster, 'warehouse-backend:wms304', temp, 'lifecycle');
    const oldUids = ['api', 'worker'].map((role) => pods(role)[0].metadata.uid);
    apply({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'lifecycle-expand' },
      spec: {
        restartPolicy: 'Never',
        automountServiceAccountToken: false,
        containers: [
          {
            name: 'migration',
            image: config.image.repository + '@' + digest,
            imagePullPolicy: 'Never',
            command: ['node', 'dist/infrastructure/database/migrate.js'],
            env: [
              {
                name: 'DATABASE_URL',
                valueFrom: {
                  secretKeyRef: { name: config.database.migrationSecret, key: 'DATABASE_URL' },
                },
              },
            ],
          },
        ],
      },
    });
    await until(
      () => JSON.parse(k(['get', 'pod', 'lifecycle-expand', '-o', 'json'])).status.phase,
      (phase) => phase === 'Succeeded',
    );
    assert.equal(
      sql(
        "select count(*) from information_schema.columns where table_name='application_metadata' and column_name='lifecycle_release_note'",
      ),
      '1',
    );
    for (const [i, role] of ['api', 'worker'].entries())
      assert.equal(pods(role)[0].metadata.uid, oldUids[i]);
    const oldEvent = await receipt();
    assert.equal((await command('receipts/' + oldEvent.id + '/post')).status, 200);
    await awaitTask(oldEvent.id);
    // Backlog v1 переживает rollout; новый consumer использует прежние schema/marker/cursors.
    k(['scale', 'deployment/warehouse-worker', '--replicas=0']);
    await until(
      () => pods('worker').length,
      (n) => n === 0,
    );
    const backlog = await receipt();
    assert.equal((await command('receipts/' + backlog.id + '/post')).status, 200);
    assert.equal(
      sql(
        `select envelope->>'schemaVersion' from outbox_events where aggregate_id='${backlog.id}'`,
      ),
      '1',
    );
    config.image.digest = digest;
    writeFileSync(values, JSON.stringify(config));
    h([
      'upgrade',
      'warehouse',
      'infra/helm/warehouse',
      '-f',
      values,
      '--wait',
      '--timeout',
      '180s',
    ]);
    for (const role of ['api', 'worker']) ready(role);
    assert.notEqual(pods('api')[0].metadata.uid, oldUids[0]);
    await awaitTask(backlog.id);
    assert.equal(taskCount(oldEvent.id), '1');
    for (const role of ['api', 'worker']) assert.equal(probe(role, 'ready'), '200');
    sql('drop function wms304_barrier()');
    console.log(
      'PASS Gate 3: compatible expand migration with old Pods; rolling release processes v1 backlog once',
    );
  } finally {
    await release();
    // Весь namespace/cluster принадлежит enclosing gate и удаляется его finally даже при отказе.
  }
}
module.exports = { checkLifecycle };
