/** @file WMS-302: disposable kind namespace/БД, реальные Helm hooks, least privilege и fault scenarios. Root .env не читается. */
const { execFileSync, spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const { hasMigrationAttempt } = require('./kubernetes-state.cjs');
const temp = mkdtempSync(join(tmpdir(), 'wms302-'));
const cluster = 'wms302-' + randomBytes(4).toString('hex');
const env = { ...process.env, HELM_DRIVER: 'secret', KUBECONFIG: join(temp, 'kubeconfig') };
const namespace = 'warehouse-dev';
const helm = process.env.WMS_HELM ?? 'helm';
const kubectl = process.env.WMS_KUBECTL ?? 'kubectl';
const kind = process.env.WMS_KIND ?? 'kind';
const context = 'kind-' + cluster;
const chart = 'infra/helm/warehouse';
const postgresImage =
  'postgres:17.9-bookworm@sha256:47f917f7409eacd22fc5dfb1dee634e1b55cf0c01d1a7eb701be2227a03e0641';
const password = randomBytes(24).toString('hex');
const runtimePassword = randomBytes(24).toString('hex');
/** Выполняет только сформированные кодом argv/stdin; ошибку выводит безопасной меткой, не stdout/credentials. */
function run(command, args, input, timeout = 180000) {
  try {
    return execFileSync(command, args, {
      env,
      input,
      encoding: 'utf8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const diagnostic = String(error.stderr ?? '')
      .replaceAll(password, '[redacted]')
      .replaceAll(runtimePassword, '[redacted]')
      .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url]');
    if (diagnostic) console.error(diagnostic.slice(-2500));
    throw new Error(
      `${command.split('/').at(-1)} ${args.slice(0, 5).join(' ')} failed${error.code === 'ETIMEDOUT' ? ' (command deadline exceeded)' : ''}`,
    );
  }
}
const k = (args, input) => run(kubectl, ['--context', context, '-n', namespace, ...args], input);
const h = (args) => run(helm, [...args, '-n', namespace, '--kube-context', context]);
const apply = (object) => k(['apply', '-f', '-'], JSON.stringify(object));
/** Credentials идут stdin psql; SQL и password не входят в argv/logs. Только admin disposable БД. */
const sql = (query) =>
  k(
    [
      'exec',
      '-i',
      'postgres-0',
      '--',
      'psql',
      '-U',
      'warehouse',
      '-d',
      'warehouse',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    query,
  );
/** Bounded polling наблюдает состояние Kubernetes, а не подменяет race фиксированным sleep. */
async function until(read, predicate, ms = 120000) {
  const deadline = Date.now() + ms;
  do {
    const value = read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw new Error('Kubernetes observation deadline exceeded');
}
/** Асинхронный Helm нужен для наблюдаемой задержки БД; rejection consumer подключается сразу. */
function installWhileDatabaseStopped(values) {
  const child = spawn(
    helm,
    [
      'install',
      'warehouse',
      chart,
      '-f',
      values,
      '-n',
      namespace,
      '--kube-context',
      context,
      '--wait',
      '--timeout',
      '180s',
    ],
    { env, stdio: 'ignore' },
  );
  const result = new Promise((resolve) => {
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code));
  });
  return { child, result };
}
async function main() {
  let installation;
  let attempted = false;
  try {
    run(
      'docker',
      ['build', '-f', 'apps/backend/Dockerfile', '-t', 'warehouse-backend:wms302', '.'],
      undefined,
      240000,
    );
    let digest = JSON.parse(
      run('docker', ['image', 'inspect', 'warehouse-backend:wms302']),
    )[0].RepoDigests[0].split('@')[1];
    assert.match(digest, /^sha256:[a-f0-9]{64}$/);
    const values = join(temp, 'values.json');
    const config = {
      image: { repository: 'warehouse-backend', digest, pullPolicy: 'Never' },
      database: { runtimeSecret: 'warehouse-runtime', migrationSecret: 'warehouse-migration' },
      auth: { origin: 'https://warehouse.local', absoluteSeconds: '600', idleSeconds: '300' },
    };
    writeFileSync(values, JSON.stringify(config), { mode: 0o600 });
    run(helm, ['lint', chart, '-f', values]);
    const rendered = run(helm, ['template', 'warehouse', chart, '-f', values]);
    assert.ok(!rendered.includes(password) && !rendered.includes(runtimePassword));
    assert.ok(!rendered.includes('kind: Secret'));
    assert.equal((rendered.match(/image: "warehouse-backend@sha256:/g) ?? []).length, 3);
    assert.throws(() => run(helm, ['template', 'warehouse', chart]));
    assert.throws(() =>
      run(helm, ['template', 'warehouse', chart, '-f', values, '--set', 'image.digest=latest']),
    );
    assert.throws(() =>
      run(helm, [
        'template',
        'warehouse',
        chart,
        '-f',
        values,
        '--set',
        'database.migrationSecret=warehouse-runtime',
      ]),
    );
    const longRelease = run(helm, ['template', 'x'.repeat(53), chart, '-f', values]);
    assert.ok(longRelease.match(/name: (.*-migrate-1)/)[1].length <= 63);
    console.log('PASS chart lint/template: one digest, Secret references only');
    run('docker', ['pull', postgresImage], undefined, 240000);
    run('docker', ['tag', postgresImage, 'postgres:17.9-bookworm']);
    attempted = true;
    // Внешний deadline включает подготовку node/CNI/storage плюс внутренние 180s Node Ready.
    // Одинаковый внешний бюджет 180s мог прервать kind до завершения его wait и записи kubeconfig.
    run(
      kind,
      [
        'create',
        'cluster',
        '--name',
        cluster,
        '--image',
        'kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5',
        '--wait',
        '180s',
      ],
      undefined,
      300000,
    );
    run(kind, ['load', 'docker-image', 'warehouse-backend:wms302', '--name', cluster]);
    // Docker Desktop containerd store может не иметь остальных платформ multi-arch index.
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const postgresArchive = join(temp, 'postgres.tar');
    run('docker', [
      'image',
      'save',
      '--platform',
      'linux/' + arch,
      '-o',
      postgresArchive,
      'postgres:17.9-bookworm',
    ]);
    run(kind, ['load', 'image-archive', postgresArchive, '--name', cluster]);
    // Docker save/import может нормализовать manifest: сравниваем config identity и используем CRI digest.
    const node = cluster + '-control-plane';
    digest = require('./kind-image.cjs').canonicalImage(
      run,
      cluster,
      'warehouse-backend:wms302',
      temp,
      'backend',
    );
    config.image.digest = digest;
    writeFileSync(values, JSON.stringify(config));
    const importedPostgres = JSON.parse(
      run('docker', [
        'exec',
        node,
        'crictl',
        'inspecti',
        'docker.io/library/postgres:17.9-bookworm',
      ]),
    ).status;
    const postgresPlatformDigest = importedPostgres.repoDigests[0].split('@')[1];
    run('docker', [
      'exec',
      node,
      'ctr',
      '--namespace=k8s.io',
      'images',
      'tag',
      'docker.io/library/postgres:17.9-bookworm',
      'docker.io/library/postgres@' + postgresPlatformDigest,
    ]);
    k(['create', 'namespace', namespace]);
    const secret = (name, data) =>
      apply({
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name },
        type: 'Opaque',
        stringData: data,
      });
    secret('warehouse-postgres', { POSTGRES_PASSWORD: password });
    secret('warehouse-migration', {
      DATABASE_URL: `postgresql://warehouse:${password}@postgres:5432/warehouse`,
    });
    secret('warehouse-runtime', {
      DATABASE_URL: `postgresql://wms_runtime:${runtimePassword}@postgres:5432/warehouse`,
    });

    secret('warehouse-bad-migration', {
      DATABASE_URL: `postgresql://wms_runtime:${runtimePassword}@postgres:5432/warehouse`,
    });
    assert.match(postgresPlatformDigest, /^sha256:[a-f0-9]{64}$/);
    // В offline archive сохранён только leaf manifest выбранной платформы, не registry index.
    k(
      ['apply', '-f', '-'],
      readFileSync('infra/kubernetes/postgres-dev.yaml', 'utf8').replace(
        postgresImage,
        'postgres@' + postgresPlatformDigest,
      ),
    );
    k(['rollout', 'status', 'statefulset/postgres', '--timeout=120s']);
    sql(
      `CREATE ROLE warehouse_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT; CREATE ROLE wms_runtime LOGIN INHERIT PASSWORD '${runtimePassword}'; GRANT warehouse_app TO wms_runtime;`,
    );
    k(['scale', 'statefulset/postgres', '--replicas=0']);
    k(['wait', '--for=delete', 'pod/postgres-0', '--timeout=60s']);
    installation = installWhileDatabaseStopped(values);
    await until(
      () => JSON.parse(k(['get', 'pods', '-l', 'job-name=warehouse-migrate-1', '-o', 'json'])),
      hasMigrationAttempt,
    );
    assert.equal(JSON.parse(k(['get', 'deployments', '-o', 'json'])).items.length, 0);
    k(['scale', 'statefulset/postgres', '--replicas=1']);
    // Job не делает auto retry: при отказе соединения оператор явно повторяет release после исправления БД.
    const first = await installation.result;
    installation = undefined;
    if (first !== 0) {
      k(['rollout', 'status', 'statefulset/postgres', '--timeout=120s']);
      h(['uninstall', 'warehouse']);
      h(['install', 'warehouse', chart, '-f', values, '--wait', '--timeout', '180s']);
    }
    console.log('PASS delayed DB blocks workload until migration; explicit recovery succeeds');
    const api = JSON.parse(k(['get', 'deployment', 'warehouse-api', '-o', 'json']));
    const worker = JSON.parse(k(['get', 'deployment', 'warehouse-worker', '-o', 'json']));
    for (const deployment of [api, worker]) {
      const spec = deployment.spec.template.spec;
      assert.equal(spec.automountServiceAccountToken, false);
      assert.equal(spec.securityContext.runAsNonRoot, true);
      assert.equal(spec.containers[0].securityContext.readOnlyRootFilesystem, true);
      assert.equal(spec.containers[0].image, 'warehouse-backend@' + digest);
    }
    const apiNode = (code) => k(['exec', 'deployment/warehouse-api', '--', 'node', '-e', code]);
    assert.equal(
      apiNode("fetch('http://127.0.0.1:3000/health').then(r=>console.log(r.status))"),
      '200',
    );
    assert.equal(
      apiNode("fetch('http://127.0.0.1:3000/api/v1/warehouses').then(r=>console.log(r.status))"),
      '401',
    );
    assert.ok(k(['logs', 'deployment/warehouse-worker']).includes('Worker ready'));
    assert.equal(
      apiNode(
        "const {pool}=require('./dist/infrastructure/database/connection').createDatabaseConnection(process.env.DATABASE_URL);pool.query('CREATE TABLE forbidden_probe(id int)').then(()=>console.log('UNEXPECTED')).catch(e=>console.log(e.code)).finally(()=>pool.end())",
      ),
      '42501',
    );
    const journal = sql('select count(*) from drizzle.__drizzle_migrations');
    const oldApi = JSON.parse(
      k(['get', 'pods', '-l', 'app.kubernetes.io/component=api', '-o', 'json']),
    ).items[0].metadata.uid;
    h(['upgrade', 'warehouse', chart, '-f', values, '--wait', '--timeout', '180s']);
    assert.equal(sql('select count(*) from drizzle.__drizzle_migrations'), journal);
    assert.equal(
      JSON.parse(k(['get', 'pods', '-l', 'app.kubernetes.io/component=api', '-o', 'json'])).items[0]
        .metadata.uid,
      oldApi,
    );
    assert.equal(
      JSON.parse(k(['get', 'job', 'warehouse-migrate-2', '-o', 'json'])).status.succeeded,
      1,
    );
    console.log('PASS revision Job/repeat journal with old API/worker; runtime DDL denied');
    // Неуспешная migration-role не меняет прежние Deployments: проверяем pre-upgrade ordering.
    const badMigration = join(temp, 'bad-migration.json');
    writeFileSync(
      badMigration,
      JSON.stringify({
        ...config,
        database: { ...config.database, migrationSecret: 'warehouse-bad-migration' },
      }),
    );
    assert.throws(() =>
      h(['upgrade', 'warehouse', chart, '-f', badMigration, '--wait', '--timeout', '180s']),
    );
    assert.equal(
      JSON.parse(k(['get', 'job', 'warehouse-migrate-3', '-o', 'json'])).status.failed,
      1,
    );
    assert.equal(
      apiNode("fetch('http://127.0.0.1:3000/health').then(r=>console.log(r.status))"),
      '200',
    );
    h(['upgrade', 'warehouse', chart, '-f', values, '--wait', '--timeout', '180s']);
    const badAuth = join(temp, 'bad-auth.json');
    writeFileSync(
      badAuth,
      JSON.stringify({ ...config, auth: { ...config.auth, idleSeconds: '900' } }),
    );
    assert.throws(() =>
      h(['upgrade', 'warehouse', chart, '-f', badAuth, '--wait', '--timeout', '30s']),
    );
    assert.equal(
      JSON.parse(k(['get', 'deployment', 'warehouse-api', '-o', 'json'])).status.availableReplicas,
      1,
    );
    h(['upgrade', 'warehouse', chart, '-f', values, '--wait', '--timeout', '180s']);
    console.log('PASS migration/config failures preserve old API; corrected upgrade succeeds');
    k(['delete', 'pod', 'postgres-0', '--wait=true']);
    k(['rollout', 'status', 'statefulset/postgres', '--timeout=120s']);
    assert.equal(sql('select count(*) from drizzle.__drizzle_migrations'), journal);
    if (process.env.WMS_GATEWAY === '1')
      await require('./gateway-check.cjs').checkGateway({
        run,
        k,
        h,
        sql,
        apply,
        until,
        temp,
        cluster,
        context,
        env,
        namespace,
        config,
        values,
        helm,
        kubectl,
        kind,
      });
    h(['uninstall', 'warehouse']);
    assert.equal(JSON.parse(k(['get', 'pvc', '-o', 'json'])).items.length, 1);
    console.log('PASS PostgreSQL restart and Helm uninstall preserve platform PVC/journal');
  } catch (error) {
    if (attempted) {
      try {
        const pods = JSON.parse(k(['get', 'pods', '-o', 'json']));
        console.error(
          JSON.stringify(
            pods.items.map((p) => ({
              name: p.metadata.name,
              phase: p.status.phase,
              containers: p.status.containerStatuses?.map((c) => ({
                name: c.name,
                image: c.image,
                state: c.state,
              })),
            })),
          ),
        );
      } catch {
        console.error('Pod diagnostics unavailable');
      }
    }
    throw error;
  } finally {
    if (installation) {
      installation.child.kill('SIGTERM');
      await installation.result;
    }
    if (attempted) run(kind, ['delete', 'cluster', '--name', cluster]);
    rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error('Kubernetes gate failed: ' + error.message);
  process.exitCode = 1;
});
