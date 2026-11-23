/** @file WMS-604: committed несовместимая schema, недостаточность image rollback и новая forward migration без потери данных. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { until } = require('./session.cjs');
const { withImage } = require('./platform.cjs');
const { buildFixtureImage } = require('../image-release/fixtures.cjs');
const { syncApplication } = require('./application.cjs');
/** Переименование test-only column намеренно ломает прежний SQL; исправление — следующая migration, старые факты journal сохраняются. */
async function checkCommittedSchemaRepair(state, driver, currentImage, currentValues) {
  const { session, source, values } = state;
  await until(
    () => session.sql("select count(*) from outbox_deliveries where status <> 'completed'"),
    (count) => count === '0',
  );
  const journal = Number(session.sql('select count(*) from drizzle.__drizzle_migrations'));
  const receipts = session.sql('select count(*) from receipts');
  const stock = session.sql('select coalesce(sum(on_hand),0) from stock_balances');
  const image = buildFixtureImage(
    session,
    currentImage.tag,
    'committed-incompatible',
    'ALTER TABLE receipt_lines RENAME COLUMN quantity TO migration_quantity;',
  );
  const incompatibleRevision = source.publish(
    withImage(currentValues, image),
    'Demonstrate committed incompatible schema on synthetic data',
  );
  await syncApplication(session, incompatibleRevision);
  assert.equal(
    Number(session.sql('select count(*) from drizzle.__drizzle_migrations')),
    journal + 1,
  );
  assert.equal(
    session.sql(
      "select count(*) from information_schema.columns where table_name='receipt_lines' and column_name='quantity'",
    ),
    '0',
  );
  const body = {
    warehouseId: driver.fixture.warehouseId,
    receivingLocationId: driver.fixture.receivingLocationId,
    lines: [{ productId: driver.fixture.productId, quantity: 1 }],
  };
  const key = randomUUID();
  assert.equal(
    driver.request('receipts', 'POST', body, key).status,
    500,
    'Committed incompatible schema must be detected by business command',
  );
  assert.equal(
    session.sql('select count(*) from receipts'),
    receipts,
    'Failed command must not leave draft header',
  );
  const rollbackRevision = source.publish(
    values,
    'Image rollback cannot undo committed incompatible SQL',
  );
  await syncApplication(session, rollbackRevision);
  assert.equal(
    driver.request('receipts', 'POST', body, key).status,
    500,
    'Image rollback alone must not be reported as schema recovery',
  );
  assert.equal(session.sql('select count(*) from receipts'), receipts);
  const fixed = buildFixtureImage(
    session,
    image.tag,
    'compatibility-forward-fix',
    'ALTER TABLE receipt_lines RENAME COLUMN migration_quantity TO quantity;',
  );
  const repairedValues = withImage(currentValues, fixed);
  const fixedRevision = source.publish(
    repairedValues,
    'Forward fix compatibility while retaining all migration journal facts',
  );
  await syncApplication(session, fixedRevision);
  assert.equal(
    Number(session.sql('select count(*) from drizzle.__drizzle_migrations')),
    journal + 2,
  );
  // Явный повтор известного failed command с тем же key после исправления; нет auto retry неизвестного результата.
  driver.command('receipts', body, 201, key);
  assert.equal(Number(session.sql('select count(*) from receipts')), Number(receipts) + 1);
  assert.equal(
    session.sql('select coalesce(sum(on_hand),0) from stock_balances'),
    stock,
    'Draft must not credit stock',
  );
  return {
    values: repairedValues,
    proof: {
      incompatibleRevision,
      rollbackRevision,
      fixedRevision,
      committedIncompatibilityObserved: true,
      imageRollbackInsufficient: true,
      newForwardMigrationRetainedBothJournalFacts: true,
      failedCommandAtomic: true,
      explicitSameKeyRetrySucceeded: true,
    },
  };
}
module.exports = { checkCommittedSchemaRepair };
