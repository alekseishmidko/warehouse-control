/** @file WMS-604: бизнес HTTP → compatible image под нагрузкой → image rollback → forward fix → encrypted restore. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createBusinessDriver, demonstrateWarehouse } = require('./business.cjs');
const { duringLoad } = require('./load.cjs');
const { checkBackupRecovery } = require('./backup.cjs');
const { buildFixtureImage } = require('../image-release/fixtures.cjs');
const { syncApplication } = require('./application.cjs');
const { hash } = require('./tools.cjs');
const { withImage } = require('./platform.cjs');
const { checkCommittedSchemaRepair } = require('./forward-fix.cjs');
/** Возвращает новый Ready Pod по desired immutable image, не выбирает произвольный terminating старый Pod. */
function apiPod(session, image) {
  const pods = JSON.parse(
    session.k([
      'get',
      'pods',
      '-l',
      'app.kubernetes.io/instance=warehouse,app.kubernetes.io/component=api',
      '-o',
      'json',
    ]),
  ).items;
  const pod = pods.find(
    (p) =>
      !p.metadata.deletionTimestamp &&
      p.spec.containers.some((c) => c.image === image) &&
      p.status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True'),
  );
  assert.ok(pod, 'Desired API image must be Ready');
  return pod;
}
/** Подтверждает structured Pino HTTP telemetry нового Pod; это не обещание production collector/alert SLO. */
function telemetry(session, pod) {
  const text = session.k(['logs', pod.metadata.name, '--tail=1000']);
  const records = text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const completed = records.filter((record) => record.event === 'http.completed');
  assert.ok(completed.length > 0, 'New API must emit HTTP telemetry');
  assert.ok(
    completed.every(
      (record) => typeof record.correlationId === 'string' && Number.isFinite(record.durationMs),
    ),
  );
  assert.equal(
    records.filter((record) => ['http.failed', 'http.aborted'].includes(record.event)).length,
    0,
  );
  fs.mkdirSync('artifacts/release-drill', { recursive: true });
  fs.writeFileSync('artifacts/release-drill/api.log', text, { mode: 0o600 });
  return {
    pod: pod.metadata.name,
    completedRequests: completed.length,
    correlatedRequests: true,
    noFailedOrAbortedRequests: true,
    rawLogSha256: hash(text),
  };
}
/** Все бизнес-эффекты создаёт API; временные SQL изменяют только technical schema, failed SQL откатывается транзакционно. */
async function checkRelease(state) {
  const { session, source, values, evidence } = state;
  require('./runtime-source.cjs').verifyRuntimeSource(state.baseline.runtimeSources);
  evidence.checkedRuntimeSource = state.baseline.proof;
  assert.ok(state.transportProof?.success, 'Fresh external-event recovery proof required');
  evidence.transportRecovery = state.transportProof;
  // План фиксируется до мутаций release; итоговый checklist ниже требует фактического завершения, а не согласования плана.
  evidence.releasePlan = {
    preparedAt: new Date().toISOString(),
    operator: 'synthetic operator of ' + session.context,
    baselineImage: values.image.repository + '@' + values.image.digest,
    configuration: 'Exact Git revision, operator SOPS reconcile before sync',
    schemaPolicy:
      'Nullable expand, image rollback retains SQL; committed incompatibility needs forward migration',
    eventsPolicy: state.transportProof.eventPolicy,
    backupPlan:
      'Stop inputs, drain deliveries, stop worker; age encrypted dump, validate separate DB before promotion',
    scope: 'Disposable synthetic rehearsal; no production release or published-event rollback',
  };
  console.log('RUN production-auth warehouse demonstration');
  const driver = createBusinessDriver(state);
  const demo = await demonstrateWarehouse(driver);
  evidence.business = demo.proof;
  const baseline = values.image.repository + '@' + values.image.digest;
  const journal = Number(session.sql('select count(*) from drizzle.__drizzle_migrations'));
  console.log('RUN compatible expand fixture');
  const candidate = buildFixtureImage(
    session,
    state.baseline.images.backend.tag,
    'candidate',
    'ALTER TABLE application_metadata ADD COLUMN release_note text;',
  );
  const candidateValues = withImage(values, candidate);
  const oldPod = apiPod(session, baseline);
  evidence.rollingRelease = await duringLoad(driver, async () => {
    const commit = source.publish(
      candidateValues,
      'Roll compatible expand release under HTTP load',
    );
    await syncApplication(session, commit);
    const current = apiPod(session, candidate.repository + '@' + candidate.digest);
    assert.notEqual(current.metadata.uid, oldPod.metadata.uid);
    return {
      revision: commit,
      oldPod: oldPod.metadata.uid,
      newPod: current.metadata.uid,
      image: candidate.repository + '@' + candidate.digest,
    };
  });
  evidence.telemetry = telemetry(
    session,
    apiPod(session, candidate.repository + '@' + candidate.digest),
  );
  assert.equal(
    session.sql('select coalesce(sum(on_hand),0) from stock_balances'),
    String(7 + evidence.rollingRelease.posted),
  );
  assert.equal(
    Number(session.sql('select count(*) from drizzle.__drizzle_migrations')),
    journal + 1,
  );
  console.log('RUN image rollback without down migration');
  const rollback = source.publish(values, 'Rollback image only; retain expanded schema and data');
  await syncApplication(session, rollback);
  assert.equal(
    Number(session.sql('select count(*) from drizzle.__drizzle_migrations')),
    journal + 1,
  );
  assert.equal(
    session.sql(
      "select count(*) from information_schema.columns where table_name='application_metadata' and column_name='release_note'",
    ),
    '1',
  );
  assert.deepEqual(
    driver.command('receipts/' + demo.receiptId + '/post', {}, 200, demo.postKey),
    demo.posted,
  );
  evidence.rollback = {
    revision: rollback,
    image: baseline,
    schemaRetained: true,
    savedResultReplayed: true,
  };
  console.log('RUN failed migration and forward fix');
  const failed = buildFixtureImage(
    session,
    candidate.tag,
    'bad-forward',
    'ALTER TABLE application_metadata ADD COLUMN forward_fix_note text;\nSELECT 1/0;',
  );
  const before = JSON.parse(session.k(['get', 'deployment/warehouse-api', '-o', 'json'])).spec;
  const badRevision = source.publish(
    withImage(values, failed),
    'Reject failed migration before replacing old API',
  );
  await syncApplication(session, badRevision, 'Failed');
  assert.deepEqual(
    JSON.parse(session.k(['get', 'deployment/warehouse-api', '-o', 'json'])).spec,
    before,
  );
  assert.equal(
    session.sql(
      "select count(*) from information_schema.columns where table_name='application_metadata' and column_name='forward_fix_note'",
    ),
    '0',
  );
  const fixed = buildFixtureImage(
    session,
    candidate.tag,
    'forward-fix',
    'ALTER TABLE application_metadata ADD COLUMN forward_fix_note text;',
  );
  const currentValues = withImage(values, fixed);
  const fixedRevision = source.publish(
    currentValues,
    'Apply corrected forward migration; preserve committed expand facts',
  );
  await syncApplication(session, fixedRevision);
  assert.equal(
    Number(session.sql('select count(*) from drizzle.__drizzle_migrations')),
    journal + 2,
  );
  evidence.forwardFix = {
    failedRevision: badRevision,
    fixedRevision,
    oldWorkloadPreserved: true,
    failedSqlRolledBack: true,
    downMigrationNotUsed: true,
  };
  console.log('RUN committed incompatible schema and forward repair');
  const repaired = await checkCommittedSchemaRepair(state, driver, fixed, currentValues);
  evidence.committedSchemaRepair = repaired.proof;
  console.log('RUN encrypted backup and separate database restore/promotion');
  evidence.backupRecovery = await checkBackupRecovery(state, driver, demo, repaired.values);
  evidence.checklist = {
    operator: 'synthetic operator of ' + session.context,
    immutableImage: true,
    configurationInGit: true,
    schemaCompatibilityExercised: true,
    eventsCompatibilityAndRecovery: state.transportProof.success,
    backupRestoredAndPromoted: evidence.backupRecovery.dataMatchesFrozenState,
    actualTimesRecorded: true,
  };
}
module.exports = { checkRelease, apiPod, withImage };
