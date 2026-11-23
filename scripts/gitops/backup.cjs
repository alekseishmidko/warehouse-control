/** @file WMS-604: freeze → age-encrypted pg_dump → отдельная DB → сверка → Git/Secret promotion; down migrations нет. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { hash } = require('./tools.cjs');
const { until } = require('./session.cjs');
const { syncApplication } = require('./application.cjs');
/** Снимок raw PostgreSQL JSONB сохраняет microseconds/int64 без преобразования через JS Date/Number. */
function databaseFacts(session, database = 'warehouse', selected) {
  assert.match(database, /^[a-z][a-z0-9_]{0,62}$/);
  const names =
    selected ||
    session
      .sql("select tablename from pg_tables where schemaname='public' order by tablename", database)
      .split('\n')
      .filter(Boolean);
  const tables = names.map((name) => {
    assert.match(name, /^[a-z][a-z0-9_]+$/);
    const rows = session.sql(
      `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text from public."${name}" t`,
      database,
    );
    return {
      name,
      rows: Number(session.sql(`select count(*) from public."${name}"`, database)),
      sha256: hash(rows),
    };
  });
  const journal = session.sql(
    'select jsonb_agg(to_jsonb(t) order by id)::text from drizzle.__drizzle_migrations t',
    database,
  );
  const schema = session.sql(
    "select jsonb_agg(jsonb_build_array(table_schema,table_name,ordinal_position,column_name,data_type,is_nullable,column_default) order by table_schema,table_name,ordinal_position)::text from information_schema.columns where table_schema in ('public','drizzle')",
    database,
  );
  const sequences = session.sql(
    "select jsonb_agg(to_jsonb(t) order by schemaname,sequencename)::text from pg_sequences t where schemaname in ('public','drizzle')",
    database,
  );
  return {
    tables,
    journalSha256: hash(journal),
    schemaSha256: hash(schema),
    sequencesSha256: hash(sequences),
  };
}
/** Pause является учтённым maintenance действием; Argo manual sync не восстановит replicas до явного resume. */
async function freeze(session) {
  const startedAt = new Date().toISOString();
  session.k(['scale', 'deployment/warehouse-api', '--replicas=0']);
  await until(
    () =>
      JSON.parse(session.k(['get', 'pods', '-l', 'app.kubernetes.io/component=api', '-o', 'json']))
        .items.length,
    (count) => count === 0,
  );
  await until(
    () => session.sql("select count(*) from outbox_deliveries where status <> 'completed'"),
    (count) => count === '0',
  );
  session.k(['scale', 'deployment/warehouse-worker', '--replicas=0']);
  await until(
    () =>
      JSON.parse(
        session.k(['get', 'pods', '-l', 'app.kubernetes.io/component=worker', '-o', 'json']),
      ).items.length,
    (count) => count === 0,
  );
  return {
    startedAt,
    frozenAt: new Date().toISOString(),
    inputsStopped: true,
    deliveriesDrained: true,
    workerStopped: true,
  };
}
/** Binary transport не перекодирует custom dump в UTF-8; credential содержимое не пишется на диск или в logs. */
function binaryK(session, args, input) {
  return session.run(
    session.kubectl,
    [
      '--kubeconfig',
      session.kubeconfig,
      '--context',
      session.context,
      '-n',
      session.namespace,
      ...args,
    ],
    input,
    null,
  );
}
/** Восстанавливает encrypted backup без разрушения original DB; promotion сохраняет event IDs/markers и saved HTTP results. */
async function checkBackupRecovery(state, driver, demo, currentValues) {
  const { session, tools, secrets, source } = state;
  const maintenance = await freeze(session);
  const original = databaseFacts(session);
  const dump = binaryK(session, [
    'exec',
    'postgres-0',
    '--',
    'pg_dump',
    '-U',
    'warehouse',
    '-d',
    'warehouse',
    '-Fc',
  ]);
  assert.ok(dump.subarray(0, 5).toString() === 'PGDMP', 'Custom PostgreSQL archive required');
  const encrypted = session.run(tools.age, ['--encrypt', '-r', secrets.recipient], dump, null);
  const backup = path.join(session.directory, 'backup.age');
  fs.writeFileSync(backup, encrypted, { flag: 'wx', mode: 0o600 });
  assert.equal(fs.statSync(backup).mode & 0o077, 0);
  const corrupted = Buffer.from(encrypted);
  corrupted[corrupted.length - 1] ^= 1;
  assert.throws(() => session.run(tools.age, ['--decrypt', '-i', secrets.key], corrupted, null));
  assert.throws(() =>
    session.run(
      tools.age,
      ['--decrypt', '-i', path.join(session.directory, 'wrong.agekey')],
      encrypted,
      null,
    ),
  );
  const restoredBytes = session.run(
    tools.age,
    ['--decrypt', '-i', secrets.key],
    fs.readFileSync(backup),
    null,
  );
  assert.equal(hash(restoredBytes), hash(dump), 'Encrypted backup roundtrip');
  const database = 'warehouse_restore_' + randomBytes(4).toString('hex');
  // Только новая DB: нет DROP/overwrite существующей БД и нет rollback уже опубликованных событий.
  session.sql('CREATE DATABASE ' + database, 'postgres');
  binaryK(
    session,
    [
      'exec',
      '-i',
      'postgres-0',
      '--',
      'pg_restore',
      '-U',
      'warehouse',
      '--dbname',
      database,
      '--exit-on-error',
      '--no-owner',
    ],
    restoredBytes,
  );
  const restored = databaseFacts(session, database);
  assert.deepEqual(
    restored,
    original,
    'Rows/schema/journal/sequences must match the frozen backup',
  );
  assert.equal(
    session.sql(
      'select count(*) from stock_balances where reserved<0 or reserved>on_hand',
      database,
    ),
    '0',
  );
  assert.equal(
    session.sql(
      'select count(*) from stock_balances b where reserved <> coalesce((select sum(active) from stock_allocations a where a.balance_id=b.id),0)',
      database,
    ),
    '0',
  );
  assert.equal(
    session.sql(
      "select has_table_privilege('wms_runtime','public.stock_movements','UPDATE')",
      database,
    ),
    'f',
  );
  assert.throws(() =>
    session.sql('SET ROLE wms_runtime; UPDATE stock_movements SET quantity=quantity;', database),
  );
  // Проверка судьбы внешних сообщений уже завершена отдельным real Kafka drill до freeze.
  assert.ok(
    state.transportProof?.success,
    'External-event recovery policy must be verified before consumers resume',
  );
  const ciphertext = secrets.selectRestoredDatabase(database);
  fs.writeFileSync(path.join(source.root, 'environments/local/secrets.enc.json'), ciphertext, {
    mode: 0o600,
  });
  const commit = source.publish(
    currentValues,
    'Promote verified restored database with encrypted Secret change',
  );
  await syncApplication(session, commit);
  for (const role of ['api', 'worker']) {
    const proof = session.k([
      'exec',
      'deployment/warehouse-' + role,
      '--',
      'node',
      '-e',
      "require('node:assert/strict').equal(new URL(process.env.DATABASE_URL).pathname," +
        JSON.stringify('/' + database) +
        " );console.log('restored-db')",
    ]);
    assert.equal(proof.trim(), 'restored-db');
  }
  assert.deepEqual(
    driver.command('receipts/' + demo.receiptId + '/post', {}, 200, demo.postKey),
    demo.posted,
    'Saved HTTP result must survive restore',
  );
  const immutable = [
    'stock_balances',
    'stock_movements',
    'putaway_tasks',
    'orders',
    'order_lines',
    'stock_allocations',
    'shipments',
    'shipment_lines',
    'shipping_effects',
    'processed_events',
    'outbox_events',
    'outbox_deliveries',
    'delivery_streams',
    'consumer_streams',
  ];
  const after = databaseFacts(session, database, immutable);
  for (const table of after.tables)
    assert.deepEqual(
      table,
      original.tables.find((before) => before.name === table.name),
      'Replayed command must not duplicate business effects',
    );
  return {
    maintenance,
    restoredDatabase: database,
    encrypted: true,
    bytes: encrypted.length,
    backupSha256: hash(encrypted),
    restoredFacts: restored,
    dataMatchesFrozenState: true,
    runtimeMutationRejected: true,
    corruptArchiveRejected: true,
    wrongBackupKeyRejected: true,
    restoredDatabaseSelectedByBothProcesses: true,
    promotedRevision: commit,
    savedHttpResultReplayed: true,
    originalDatabaseRetained: true,
    consumersResumedAfterValidation: true,
    finishedAt: new Date().toISOString(),
  };
}
module.exports = { databaseFacts, freeze, checkBackupRecovery };
