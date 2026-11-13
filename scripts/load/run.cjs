/** @file WMS-403: владелец disposable Compose/monitoring/k6, фаз, измерений, сверки и cleanup.
 * Рабочая .env и существующие volumes недоступны через интерфейс driver. Секреты живут только в памяти/0600.
 */
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile, rm, readdir } = require('node:fs/promises');
const os = require('node:os');
const { resolve, join, relative } = require('node:path');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Pool } = require('../../apps/backend/node_modules/pg');
const { run } = require('../docker-gate.cjs');
const { budget, K6_IMAGE, selectScenarios, assertLocalDockerEndpoint } = require('./config.cjs');
const { createHttp, createDataset, expectStatus } = require('./dataset.cjs');
const { snapshot, startObserver, waitFor, summarizeSamples } = require('./observe.cjs');
const { reconcile, readFacts } = require('./reconcile.cjs');
const { validateSummary, assertPublicEvidence } = require('./results.cjs');
const root = resolve(__dirname, '../..');
let phase = 'arguments';

/** Выводит только известное имя шага. Прогресс не содержит raw Docker diagnostics или credentials. */
function step(name) {
  phase = name;
  console.log(`WMS-403 ${name}`);
}
const { writeAtomicJson: writeJson } = require('../evidence/atomic-json.cjs');
const { createCancellation } = require('./cancellation.cjs');
/** Выполняет все адресные cleanup actions даже при отказе предыдущего. Уже известная ошибка
 * observer не заменяет первичную причину. Возвращает только безопасные имена неудачных шагов. */
async function cleanupResources(actions, primaryError) {
  const failures = [];
  for (const [label, action] of actions) {
    try {
      await action();
    } catch (error) {
      if (error !== primaryError) failures.push(label);
    }
  }
  return failures;
}
/** Digest только собственных runtime/harness inputs; отчёт не хеширует сам себя. Git commit отдельно сохраняется. */
async function sourceIdentity() {
  const hash = createHash('sha256');
  async function add(path) {
    const entries = await readdir(join(root, path), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await add(next);
      else {
        hash.update(next);
        hash.update(await readFile(join(root, next)));
      }
    }
  }
  for (const path of [
    'apps/backend/src',
    'apps/backend/drizzle',
    'infra/compose',
    'infra/observability',
    'load/k6',
    'scripts/load',
    'scripts/evidence',
  ])
    await add(path);
  for (const path of [
    '.dockerignore',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'patches/deepmerge@4.3.1.patch',
    'apps/backend/package.json',
    'apps/backend/Dockerfile',
    'apps/backend/tsconfig.json',
    'apps/backend/tsconfig.build.json',
    'apps/backend/nest-cli.json',
    'scripts/docker-gate.cjs',
  ]) {
    hash.update(path);
    hash.update(await readFile(join(root, path)));
  }
  return {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty:
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
        .length > 0,
    runtimeAndHarnessSha256: hash.digest('hex'),
  };
}
/** Только whitelist Docker info. Полный inspect/config может содержать credentials и не сохраняется. */
async function machine() {
  const endpoint =
    process.env.DOCKER_HOST ??
    JSON.parse(
      await run(
        ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
        'docker context',
      ),
    );
  assertLocalDockerEndpoint(endpoint);
  const info = JSON.parse(await run(['info', '--format', '{{json .}}'], 'docker info'));
  return {
    host: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuModel: os.cpus()[0].model,
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      loadAverage: os.loadavg(),
    },
    docker: Object.fromEntries(
      ['ServerVersion', 'NCPU', 'MemTotal', 'OSType', 'Architecture', 'KernelVersion'].map(
        (key) => [key, info[key]],
      ),
    ),
    node: process.version,
    pnpm: execFileSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8' }).trim(),
    k6: await run(['run', '--rm', K6_IMAGE, 'version'], 'k6 version'),
    k6Image: K6_IMAGE,
  };
}
/** Чистый независимый сценарий, включая собственные monitoring volumes. finally удаляет только UUID-проекты. */
async function scenario(name) {
  const temp = await mkdtemp(join(os.tmpdir(), 'wms403-'));
  const project = `wms403-${randomUUID()}`;
  const obsProject = `${project}-obs`;
  const k6Name = `${project}-k6`;
  const envFile = join(temp, 'load.env');
  const output = join(temp, 'output');
  const password = randomBytes(24).toString('hex');
  const secrets = [password];
  let pool;
  let observer;
  let interrupted = false;
  const cancellation = createCancellation();
  let workerRunning = false;
  let primaryError;
  // Ctrl-C прекращает k6, затем тот же finally удаляет проекты. SIGKILL/потеря daemon требуют ручного cleanup.
  const interrupt = () => {
    interrupted = true;
    cancellation.abort();
    void run(['rm', '-f', k6Name], 'interrupt k6', 10000).catch(() => {});
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const base = [
    'compose',
    '--project-name',
    project,
    '--env-file',
    envFile,
    '-f',
    'infra/compose/compose.yaml',
    '-f',
    'infra/compose/compose.app.yaml',
    '-f',
    'infra/observability/compose.application.yaml',
    '-f',
    'infra/compose/compose.gate.yaml',
    '-f',
    'infra/compose/compose.load.yaml',
  ];
  const compose = (args, timeout = 60000, input) =>
    args[0] === 'down'
      ? run([...base, ...args], 'load cleanup', timeout, input)
      : cancellation.run(() => run([...base, ...args], `load compose ${args[0]}`, timeout, input));
  const monitoring = (args) => {
    const operation = () =>
      run(
        [
          'compose',
          '--project-name',
          obsProject,
          '--env-file',
          envFile,
          '-f',
          'infra/observability/compose.yaml',
          ...args,
        ],
        `load monitoring ${args[0]}`,
        240000,
      );
    return args[0] === 'down' ? operation() : cancellation.run(operation);
  };
  /** Проверяет exit=0 после SIGTERM: остановка клиента Compose сама по себе не доказывает drain процесса. */
  async function stopWorker() {
    await compose(['stop', 'worker']);
    const id = await compose(['ps', '-a', '-q', 'worker']);
    const state = JSON.parse(
      await run(['inspect', '--format', '{{json .State}}', id], 'worker state'),
    );
    assert.equal(state.Running, false, 'worker stopped');
    assert.equal(state.ExitCode, 0, 'worker graceful exit');
    workerRunning = false;
  }
  /** Ожидает реальную readiness worker, а не факт создания контейнера. */
  async function startWorker() {
    await compose(['up', '-d', '--no-build', '--no-deps', 'worker']);
    await waitFor(
      () =>
        compose([
          'exec',
          '-T',
          'worker',
          'node',
          '-e',
          "fetch('http://127.0.0.1:9100/health/ready',{signal:AbortSignal.timeout(2000)}).then(r=>console.log(r.status)).catch(()=>console.log(0))",
        ]),
      (code) => code === '200',
      30000,
      'worker readiness deadline',
    );
    workerRunning = true;
  }
  try {
    step(`${name}: infrastructure`);
    await mkdir(output, { mode: 0o700 });
    await writeFile(
      envFile,
      [
        'POSTGRES_USER=warehouse',
        `POSTGRES_PASSWORD=${password}`,
        'POSTGRES_DB=warehouse',
        'POSTGRES_PORT=0',
        'API_PORT=0',
        `CONTAINER_DATABASE_URL=postgresql://warehouse:${password}@postgres:5432/warehouse`,
        'AUTH_SESSION_ABSOLUTE_SECONDS=1200',
        'AUTH_SESSION_IDLE_SECONDS=600',
        `WMS_APP_PROJECT=${project}`,
        `WMS_OBSERVABILITY_PROJECT=${obsProject}`,
        ...['PROMETHEUS', 'LOKI', 'TEMPO', 'GRAFANA', 'OTLP', 'RECEIVER', 'ALERTMANAGER'].map(
          (n) => `WMS_${n}_PORT=0`,
        ),
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    await monitoring(['up', '-d', '--wait']);
    for (const [service, port, path] of [
      ['prometheus', 9090, '/-/ready'],
      ['loki', 3100, '/ready'],
      ['tempo', 3200, '/ready'],
      ['grafana', 3000, '/api/health'],
      ['receiver', 8080, '/notifications'],
    ]) {
      const url = 'http://' + (await monitoring(['port', service, String(port)]));
      await waitFor(
        async () => {
          cancellation.check();
          try {
            return (await fetch(url + path, { signal: AbortSignal.timeout(3000) })).status;
          } catch {
            return 0;
          }
        },
        (code) => code === 200,
        100000,
        `${service} readiness deadline`,
      );
    }
    // Образ строится из текущего checkout, а не подразумевается актуальным по mutable local tag.
    await compose(['up', '-d', '--build', '--wait', 'api', 'worker'], 300000);
    workerRunning = true;
    const http = createHttp(compose);
    expectStatus(await http('/health/ready'), 200, 'API readiness');
    const address = await compose(['port', 'postgres', '5432']);
    assert.match(address, /^127\.0\.0\.1:[0-9]+$/, 'isolated database address');
    pool = new Pool({
      host: '127.0.0.1',
      port: Number(address.split(':').at(-1)),
      user: 'warehouse',
      password,
      database: 'warehouse',
      application_name: 'wms-load-observer',
      max: 3,
      connectionTimeoutMillis: 3000,
      query_timeout: 10000,
    });
    // Idle driver errors не становятся unhandled EventEmitter; следующий SQL/health observation завершит прогон ошибкой.
    let poolFailure = false;
    pool.on('error', () => {
      poolFailure = true;
    });
    step(`${name}: dataset`);
    const data = await createDataset({ compose, http, pool, scenario: name, stopWorker });
    for (const actor of [...data.actors, data.admin]) secrets.push(actor.cookie, actor.csrfToken);
    if (name === 'backlog') await stopWorker();
    const apiId = await compose(['ps', '-q', 'api']);
    const images = {};
    for (const [service, executor] of [
      ...['api', 'worker', 'postgres'].map((s) => [s, compose]),
      ...['prometheus', 'grafana', 'loki', 'tempo', 'collector', 'alertmanager', 'receiver'].map(
        (s) => [s, monitoring],
      ),
    ]) {
      const id = await executor(['ps', '-a', '-q', service]);
      images[service] = JSON.parse(
        await run(
          ['inspect', '--format', '{"reference":{{json .Config.Image}},"id":{{json .Image}}}', id],
          'image identity',
        ),
      );
    }
    const runtime = {
      node: await compose(['exec', '-T', 'api', 'node', '--version']),
      postgres: (await pool.query('SHOW server_version')).rows[0].server_version,
    };
    await writeFile(
      join(temp, 'dataset.json'),
      JSON.stringify({ runId: project, scenario: name, budget, actors: data.actors }),
      { mode: 0o600 },
    );
    step(`${name}: settle`);
    // Daemon/Grafana/Tempo ещё прогреваются после readiness. Фиксированная пауза входит
    // в provenance, но не в latency k6. Она не используется как доказательство конкурентной гонки.
    await cancellation.wait(budget.settleSeconds * 1000);
    const before = await snapshot(pool);
    observer = startObserver(pool, () => run(['rm', '-f', k6Name], 'stop failed load', 10000));
    step(`${name}: k6`);
    let barrier;
    let launch;
    let k6Result;
    let k6Failure;
    let barrierResult;
    const started = performance.now();
    observer.assertHealthy();
    try {
      if (name === 'sku') {
        barrier = await pool.connect();
        await barrier.query('BEGIN');
        const fixture = data.fixtures[0];
        const locked = await barrier.query(
          'SELECT id FROM stock_balances WHERE warehouse_id=$1 AND product_id=$2 AND location_id=$3 FOR UPDATE',
          [fixture.warehouseId, fixture.productId, fixture.storageLocationId],
        );
        assert.equal(locked.rowCount, 1, 'SKU barrier balance');
      }
      cancellation.check();
      launch = run(
        [
          'run',
          '--rm',
          '--name',
          k6Name,
          '--network',
          `container:${apiId}`,
          '--cpus',
          '1',
          '--memory',
          '256m',
          '--user',
          `${process.getuid()}:${process.getgid()}`,
          '-v',
          `${join(root, 'load/k6')}:/scripts:ro`,
          '-v',
          `${join(temp, 'dataset.json')}:/input/dataset.json:ro`,
          '-v',
          `${output}:/output`,
          K6_IMAGE,
          'run',
          '--no-usage-report',
          `/scripts/${name}.js`,
        ],
        `k6 ${name}`,
        100000,
      ).then(
        () => {
          k6Result = true;
        },
        () => {
          k6Failure = true;
        },
      );
      if (barrier) {
        const waitStarted = performance.now();
        const reached = await waitFor(
          async () => {
            observer.assertHealthy();
            if (k6Failure) throw new Error('k6 failed before barrier');
            return snapshot(pool);
          },
          (s) => s.lock_waiters === budget.vus,
          budget.barrierTimeoutMs,
          'concurrent DB wait barrier deadline',
        );
        // Одновременные waiters в PostgreSQL подтверждают пересечение запросов, в отличие от sleep в тесте.
        barrierResult = { waiters: reached.lock_waiters, holdMs: performance.now() - waitStarted };
        await barrier.query('COMMIT');
        barrier.release();
        barrier = undefined;
      }
      await launch;
      observer.assertHealthy();
      assert.ok(k6Result && !k6Failure, 'k6 execution or thresholds failed');
    } finally {
      if (barrier) {
        try {
          await barrier.query('ROLLBACK');
        } finally {
          barrier.release();
        }
      }
      // Timeout run завершает Docker client; именованный k6 container удаляется независимо от результата.
      await run(['rm', '-f', k6Name], 'k6 cleanup', 10000);
      if (launch) await launch;
    }
    assert.equal(interrupted, false, 'load interrupted');
    assert.equal(poolFailure, false, 'observer database failure');
    observer.assertHealthy();
    const measuredMs = performance.now() - started;
    const summary = JSON.parse(await readFile(join(output, 'summary.json'), 'utf8'));
    validateSummary(summary, name);
    const afterLoad = await snapshot(pool);
    let drain;
    let verification;
    step(`${name}: reconciliation`);
    if (name === 'sku') {
      assert.equal(summary.metrics.reserve_successes?.values.count, 1, 'one reservation winner');
      assert.equal(
        summary.metrics.reserve_conflicts?.values.count,
        budget.vus - 1,
        'all losers reject shortage',
      );
      const reserved = await reconcile(pool, {
        receipts: 1,
        movements: 3,
        tasks: 1,
        markers: 1,
        on_hand: 1,
        reserved: 1,
        allocation_active: 1,
        allocation_released: 0,
        allocations: 1,
      });
      const {
        rows: [winner],
      } = await pool.query(
        'SELECT l.order_id FROM stock_allocations a JOIN order_lines l ON l.id=a.line_id WHERE a.active=1',
      );
      const actor = data.actors.find((a) => a.order.id === winner.order_id);
      assert.ok(actor, 'winner belongs to dataset');
      expectStatus(
        await http(`/api/v1/orders/${winner.order_id}/cancel`, 'POST', {}, actor, randomUUID()),
        200,
        'winner cancel',
      );
      const released = await reconcile(pool, {
        receipts: 1,
        movements: 3,
        tasks: 1,
        markers: 1,
        on_hand: 1,
        reserved: 0,
        allocation_active: 0,
        allocation_released: 1,
        allocations: 1,
      });
      verification = { reserved, released };
    } else {
      const receipts = summary.metrics.receipts_posted?.values.count;
      assert.ok(Number.isSafeInteger(receipts) && receipts > 0, 'posted receipts counter');
      if (name === 'backlog') {
        assert.equal(receipts, budget.vus * budget.backlogIterationsPerVu, 'fixed backlog dataset');
        assert.equal(afterLoad.pending, receipts, 'all deliveries pending while worker stopped');
        assert.equal(afterLoad.completed, 0, 'no handler while worker stopped');
        const {
          rows: [effects],
        } = await pool.query(
          'SELECT (SELECT count(*)::int FROM putaway_tasks) tasks,(SELECT count(*)::int FROM processed_events) markers',
        );
        assert.deepEqual(effects, { tasks: 0, markers: 0 }, 'no premature worker effects');
      }
      const drainStarted = performance.now();
      if (!workerRunning) await startWorker();
      await waitFor(
        async () => {
          observer.assertHealthy();
          return snapshot(pool);
        },
        (s) => s.completed === receipts && s.pending + s.processing + s.retry + s.dead === 0,
        budget.drainTimeoutMs,
        'delivery drain deadline',
      );
      const elapsedMs = performance.now() - drainStarted;
      drain = {
        initialBacklog: afterLoad.pending + afterLoad.processing + afterLoad.retry,
        elapsedMs,
        eventsPerSecondIncludingStartup: (receipts - afterLoad.completed) / (elapsedMs / 1000),
      };
      verification = await reconcile(pool, {
        receipts,
        movements: receipts,
        tasks: receipts,
        markers: receipts,
        on_hand: receipts,
        reserved: 0,
        allocation_active: 0,
        allocation_released: 0,
        allocations: 0,
      });
      // Явный replay известного успеха: прежний actor/key/body. Не retry неизвестного результата.
      const {
        rows: [saved],
      } = await pool.query(
        "SELECT key,body FROM http_idempotency WHERE operation='receiving.post' ORDER BY created_at LIMIT 1",
      );
      assert.ok(saved, 'saved posting response');
      const originalActor = data.actors.find(
        (actor) => actor.fixture.warehouseId === saved.body.warehouseId,
      );
      assert.ok(originalActor, 'posting actor belongs to dataset');
      const replayed = expectStatus(
        await http(`/api/v1/receipts/${saved.body.id}/post`, 'POST', {}, originalActor, saved.key),
        200,
        'posting replay',
      );
      assert.deepEqual(replayed, saved.body, 'original HTTP result replay');
      const afterReplay = await reconcile(pool, {
        receipts,
        movements: receipts,
        tasks: receipts,
        markers: receipts,
        on_hand: receipts,
        reserved: 0,
        allocation_active: 0,
        allocation_released: 0,
        allocations: 0,
      });
      assert.deepEqual(afterReplay, verification, 'replay has no additional effects');
    }
    // Последний явный sample фиксирует drained state даже при быстром завершении poll loop.
    const finalSnapshot = await snapshot(pool);
    const samples = await observer.stop();
    observer = undefined;
    const stats = JSON.parse(
      (
        await run(['stats', '--no-stream', '--format', '{{json .}}', apiId], 'API resource sample')
      ).split('\n')[0],
    );
    if (workerRunning) await stopWorker();
    await compose(['stop', 'api']);
    const apiState = JSON.parse(
      await run(['inspect', '--format', '{{json .State}}', apiId], 'API shutdown state'),
    );
    assert.equal(apiState.ExitCode, 0, 'API graceful exit');
    // Завершение соединений flush-ит process stats PostgreSQL. Короткая гонка может не попасть
    // в периодический stats snapshot; итоговые commit/rollback counters сохраняем отдельно.
    const postShutdownSnapshot = await snapshot(pool);
    const evidence = {
      scenario: name,
      images,
      runtime,
      measuredMs,
      budget,
      observability: true,
      gateway: false,
      workerDuringLoad: name === 'throughput',
      dataset: {
        warehouses: data.fixtures.length,
        skus: data.fixtures.length,
        users: budget.vus,
        receiptQuantity: 1,
      },
      k6: summary,
      before,
      afterLoad,
      finalSnapshot,
      postShutdownSnapshot,
      contention: summarizeSamples(samples),
      barrier: barrierResult,
      drain,
      verification,
      samples,
      apiResourceSample: {
        cpu: stats.CPUPerc,
        memory: stats.MemUsage,
        memoryPercent: stats.MemPerc,
      },
    };
    assertPublicEvidence(evidence, secrets);
    return evidence;
  } catch (error) {
    primaryError = error;
    error.loadPhase = phase;
    error.partial = { scenario: name, status: 'failed', budget, samples: observer?.samples ?? [] };
    try {
      error.partial.k6 = JSON.parse(await readFile(join(output, 'summary.json'), 'utf8'));
    } catch {
      /* Убийство k6 до handleSummary не даёт метрик; отсутствие явно остаётся в evidence. */
    }
    if (pool) {
      try {
        error.partial.committedFacts = await readFacts(pool);
      } catch {
        error.partial.committedFactsUnavailable = true;
      }
    }
    try {
      assertPublicEvidence(error.partial, secrets);
    } catch {
      error.partial = undefined;
    }
    throw error;
  } finally {
    step(`${name}: cleanup`);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    const failures = await cleanupResources(
      [
        [
          'observer',
          async () => {
            if (observer) await observer.stop();
          },
        ],
        [
          'database_pool',
          async () => {
            if (pool) await pool.end();
          },
        ],
        ['k6_container', () => run(['rm', '-f', k6Name], 'final k6 cleanup', 10000)],
        ['application_project', () => compose(['down', '--volumes', '--remove-orphans'])],
        ['monitoring_project', () => monitoring(['down', '--volumes', '--remove-orphans'])],
        ['secret_directory', () => rm(temp, { recursive: true, force: true })],
      ],
      primaryError,
    );
    if (failures.length) {
      if (primaryError) primaryError.cleanupFailures = failures;
      else
        throw Object.assign(new Error('load cleanup failed'), {
          loadPhase: phase,
          cleanupFailures: failures,
        });
    }
  }
}
/** Последовательный запуск не смешивает проекты/общее dist; только полный baseline обновляет committed artifact. */
async function main() {
  const selected = selectScenarios(process.argv.slice(2));
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    command: `pnpm load:${process.argv[2]}`,
    source: await sourceIdentity(),
    machine: await machine(),
    scenarios: [],
  };
  try {
    for (const name of selected) report.scenarios.push(await scenario(name));
    report.finishedAt = new Date().toISOString();
    report.status = 'passed';
    await writeJson(join(root, 'artifacts/load', `${process.argv[2]}.json`), report);
    if (process.argv[2] === 'baseline')
      await writeJson(join(root, 'docs/reports/wms-403-baseline.json'), report);
    console.log(
      `PASS WMS-403 ${selected.join(', ')}; report ${relative(root, join(root, 'artifacts/load', `${process.argv[2]}.json`))}`,
    );
  } catch (error) {
    phase = error.loadPhase ?? phase;
    report.status = 'failed';
    report.failedPhase = phase;
    report.failure =
      error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'operation_failed';
    if (error.partial) report.scenarios.push(error.partial);
    if (error.cleanupFailures) report.cleanupFailures = error.cleanupFailures;
    report.finishedAt = new Date().toISOString();
    await writeJson(join(root, 'artifacts/load', `${process.argv[2]}-failed.json`), report);
    throw error;
  }
}
module.exports = { cleanupResources };
if (require.main === module)
  main().catch((error) => {
    // Не печатаем pg/Docker diagnostic: они могут содержать driver errors и настройки соединения.
    console.error(
      `WMS-403 failed at ${phase}: ${error.code === 'ERR_ASSERTION' ? error.message : 'operation failed; see runbook and isolated resources'}`,
    );
    process.exitCode = 1;
  });
