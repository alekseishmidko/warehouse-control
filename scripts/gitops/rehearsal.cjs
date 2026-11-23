/** @file WMS-603/604: общий bootstrap одного isolated GitOps rehearsal; finally очищает только свои resources/keys. */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { ensureTools } = require('./tools.cjs');
const { createSession } = require('./session.cjs');
const { installCore } = require('./core.cjs');
const { prepareSecrets } = require('./secrets.cjs');
const { createSource } = require('./source.cjs');
const { provisionDatabase, baselineValues } = require('./platform.cjs');
const { syncApplication, checkDrift } = require('./application.cjs');
const { buildFixtureImage } = require('../image-release/fixtures.cjs');
const { writeAtomicJson } = require('../evidence/atomic-json.cjs');
/** Проверяет реальный failed SQL hook: rollback DDL и отсутствие rollout нового desired config/image. */
async function checkMigrationFailure(state) {
  const { session, source, values } = state;
  const before = JSON.parse(session.k(['get', 'deployment', 'warehouse-api', '-o', 'json']));
  const journal = session.sql('select count(*) from drizzle.__drizzle_migrations');
  const failed = buildFixtureImage(
    session,
    state.baseline.images.backend.tag,
    'failed-migration',
    'CREATE TABLE gitops_failed_marker(id integer);\nSELECT 1/0;\n',
  );
  const bad = structuredClone(values);
  bad.image = {
    repository: failed.repository,
    digest: failed.digest,
    pullPolicy: failed.pullPolicy,
  };
  bad.auth.absoluteSeconds = '900';
  const commit = source.publish(bad, 'Fail migration before workload update');
  await syncApplication(session, commit, 'Failed');
  const after = JSON.parse(session.k(['get', 'deployment', 'warehouse-api', '-o', 'json']));
  assert.equal(
    after.metadata.generation,
    before.metadata.generation,
    'Failed migration must not update workload',
  );
  assert.deepEqual(after.spec, before.spec);
  assert.equal(session.sql('select count(*) from drizzle.__drizzle_migrations'), journal);
  assert.equal(session.sql("select to_regclass('public.gitops_failed_marker')"), '');
  const fixed = source.publish(values, 'Restore checked release after migration failure');
  await syncApplication(session, fixed);
  return {
    failedRevision: commit,
    correctedRevision: fixed,
    sqlRollbackVerified: true,
    previousWorkloadPreserved: true,
  };
}
/** Оркестрирует проверенные компоненты, а callback добавляет release/recovery поверх того же чистого bootstrap. */
async function runRehearsal(name, work) {
  const started = new Date().toISOString();
  const evidence = {
    status: 'running',
    startedAt: started,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceSnapshot: require('../harness/snapshot.cjs').snapshot(path.resolve('.')).digest,
    architecture: 'arm64',
  };
  assert.match(name, /^[a-z0-9-]+$/);
  await writeAtomicJson(path.resolve('artifacts/' + name + '/evidence.json'), evidence);
  let failure, session;
  try {
    const tools = await ensureTools(
      path.resolve(
        process.env.WMS_GITOPS_TOOLS ||
          'artifacts/gitops-tools/' + process.platform + '-' + process.arch,
      ),
    );
    session = createSession(tools);
    evidence.cluster = session.cluster;
    console.log('RUN owned kind');
    await session.start();
    console.log('RUN pinned Argo Core');
    evidence.core = await installCore(session, tools);
    console.log('RUN SOPS/age roundtrip and key recovery');
    const secrets = prepareSecrets(session, tools);
    evidence.secrets = secrets.proof;
    console.log('RUN checked registry access before migration');
    evidence.registryAccess = require('./registry.cjs').verifyRegistryAccess(session);
    console.log('RUN fresh local baseline build/scan/import without publication');
    const baseline = await require('./baseline.cjs').prepareBaseline(session);
    evidence.localBaseline = baseline.proof;
    const values = baselineValues(baseline.images);
    const web = values.web.image.repository + '@' + values.web.image.digest;
    const source = createSource(session, web, secrets.encrypted);
    const commit = source.publish(values, 'Install checked ARM64 WMS release');
    provisionDatabase(session, secrets, source.root);
    console.log('RUN Git-backed initial sync');
    evidence.initialSync = await syncApplication(session, commit);
    evidence.images = { backend: values.image.repository + '@' + values.image.digest, web };
    const state = { session, tools, secrets, source, values, evidence, baseline };
    console.log('RUN SQL failure and explicit correction');
    evidence.migrationFailure = await checkMigrationFailure(state);
    console.log('RUN observed GitOps drift and correction');
    evidence.drift = await checkDrift(session, evidence.migrationFailure.correctedRevision);
    assert.equal(
      session.canI(
        'get',
        'secrets',
        'system:serviceaccount:warehouse-dev:warehouse-runtime',
        'kube-system',
      ),
      false,
    );
    evidence.runtimeCrossNamespaceDenied = true;
    if (work) await work(state);
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed';
    failure = error;
    try {
      const pods = JSON.parse(session.k(['get', 'pods', '--all-namespaces', '-o', 'json'])).items;
      console.error(
        JSON.stringify(
          pods.map((pod) => ({
            namespace: pod.metadata.namespace,
            name: pod.metadata.name,
            phase: pod.status.phase,
            conditions: pod.status.conditions
              ?.filter((c) => c.status !== 'True')
              .map((c) => ({ type: c.type, reason: c.reason, message: c.message })),
            init: pod.status.initContainerStatuses?.map((c) => ({
              name: c.name,
              state: c.state.waiting?.reason || c.state.terminated?.reason,
            })),
            waiting: pod.status.containerStatuses?.map((c) => c.state.waiting?.reason),
          })),
        ),
      );
    } catch {
      console.error('Private cluster diagnostics unavailable');
    }
    try {
      const app = JSON.parse(
        session.k(['get', 'application', 'warehouse', '-o', 'json'], undefined, 'argocd'),
      );
      console.error(
        JSON.stringify({
          argoConditions: app.status?.conditions,
          argoMessage: app.status?.operationState?.message,
        }),
      );
    } catch {
      console.error('Application status unavailable');
    }
  } finally {
    try {
      if (session) await session.close();
      evidence.cleanup = session ? 'passed' : 'not-created';
    } catch (error) {
      failure ||= error;
      evidence.status = 'failed';
      evidence.cleanup = 'failed';
    }
    evidence.finishedAt = new Date().toISOString();
    await writeAtomicJson(path.resolve('artifacts/' + name + '/evidence.json'), evidence);
  }
  if (failure) throw failure;
  console.log('PASS ' + name + ': live GitOps and owned cleanup');
  return evidence;
}
module.exports = { runRehearsal, checkMigrationFailure };
