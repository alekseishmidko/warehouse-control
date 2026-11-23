/** @file WMS-603: отдельная PostgreSQL platform и least-privilege DB login до Argo application sync. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
/** Применяет существующий dev manifest без изменения рабочего Compose/PVC; secrets уже provisioned через SOPS. */
function provisionDatabase(session, secrets, sourceRoot) {
  session.k(
    ['apply', '-f', '-'],
    fs.readFileSync(path.join(sourceRoot, 'infra/kubernetes/postgres-dev.yaml'), 'utf8'),
  );
  session.k(['rollout', 'status', 'statefulset/postgres', '--timeout=180s']);
  // Пароль — локальный random hex, не пользовательский SQL. Аргументы/logs не содержат credential.
  assert.ok(/^[a-f0-9]{48}$/.test(secrets.runtimePassword), 'Synthetic runtime credential format');
  session.sql(
    `CREATE ROLE warehouse_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT; CREATE ROLE wms_runtime LOGIN INHERIT PASSWORD '${secrets.runtimePassword}'; GRANT warehouse_app TO wms_runtime;`,
  );
}
/** Environment принимает только fresh local build/scan/import digests; historical registry probe не задаёт workload. */
function baselineValues(images) {
  assert.ok(images?.backend?.digest && images?.web?.digest, 'Checked local baseline required');
  const image = (app) => ({
    repository: images[app].repository,
    digest: images[app].digest,
    pullPolicy: images[app].pullPolicy,
  });
  return {
    deployment: { controller: 'argocd' },
    image: image('backend'),
    database: { runtimeSecret: 'warehouse-runtime', migrationSecret: 'warehouse-migration' },
    auth: { origin: 'https://warehouse.local', absoluteSeconds: '600', idleSeconds: '300' },
    web: { enabled: true, image: image('web') },
  };
}
/** Новый desired image не изменяет исходный profile по ссылке: rollback должен сохранить прежний digest/config. */
function withImage(values, image) {
  return {
    ...structuredClone(values),
    image: { repository: image.repository, digest: image.digest, pullPolicy: image.pullPolicy },
  };
}
module.exports = { provisionDatabase, baselineValues, withImage };
