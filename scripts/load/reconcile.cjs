/** @file Read-only сверка committed фактов. HTTP status и RPS не доказывают сохранность ledger. */
const assert = require('node:assert/strict');

// FULL JOIN обнаруживает также ledger без balance; bigint не переполняется при суммах int4.
const INVARIANTS = `WITH ledger AS (
  SELECT warehouse_id,location_id,product_id,
    sum(CASE WHEN kind IN ('receipt','transfer-in') THEN quantity::bigint ELSE -quantity::bigint END) quantity
    FROM stock_movements GROUP BY warehouse_id,location_id,product_id
), balances AS (
  SELECT b.*,coalesce((SELECT sum(a.active::bigint) FROM stock_allocations a WHERE a.balance_id=b.id),0) allocated_active
    FROM stock_balances b
)
SELECT
  (SELECT count(*)::int FROM balances WHERE reserved<0 OR on_hand<reserved OR reserved<>allocated_active) AS balance_errors,
  (SELECT count(*)::int FROM balances b FULL JOIN ledger l USING(warehouse_id,location_id,product_id)
    WHERE coalesce(b.on_hand::bigint,0)<>coalesce(l.quantity,0)) AS ledger_errors,
  (SELECT count(*)::int FROM stock_allocations WHERE allocated<=0 OR least(active,released,transferred,consumed)<0
    OR allocated::bigint<>active::bigint+released+transferred+consumed) AS allocation_errors,
  (SELECT count(*)::int FROM (SELECT operation_id FROM stock_movements GROUP BY operation_id HAVING count(*)>1) x) AS duplicate_movements,
  (SELECT count(*)::int FROM (SELECT source_receipt_line_id FROM putaway_tasks GROUP BY source_receipt_line_id HAVING count(*)>1) x) AS duplicate_tasks,
  (SELECT count(*)::int FROM (SELECT event_id FROM processed_events GROUP BY event_id HAVING count(*)>1) x) AS duplicate_markers,
  (SELECT count(*)::int FROM receipts r JOIN receipt_lines l ON l.receipt_id=r.id WHERE r.status='posted'
    AND ((SELECT count(*) FROM stock_movements m WHERE m.operation_id=l.id AND m.kind='receipt' AND m.quantity=l.quantity)<>1
      OR (SELECT count(*) FROM outbox_events e WHERE e.aggregate_id=r.id AND e.aggregate_type='receipt')<>1
      OR (SELECT count(*) FROM outbox_deliveries d WHERE d.event_id=r.posted_event_id AND d.status='completed')<>1
      OR (SELECT count(*) FROM putaway_tasks t WHERE t.source_receipt_line_id=l.id AND t.quantity=l.quantity)<>1
      OR (SELECT count(*) FROM processed_events p WHERE p.event_id=r.posted_event_id)<>1)) AS receipt_errors,
  (SELECT count(*)::int FROM receipts WHERE status<>'posted') AS unfinished_receipts,
  (SELECT count(*)::int FROM http_idempotency WHERE completed_at IS NULL) AS unfinished_commands,
  (SELECT count(*)::int FROM receipts) AS receipts,
  (SELECT count(*)::int FROM stock_movements) AS movements,
  (SELECT count(*)::int FROM putaway_tasks) AS tasks,
  (SELECT count(*)::int FROM processed_events) AS markers,
  (SELECT coalesce(sum(on_hand::bigint),0)::float8 FROM stock_balances) AS on_hand,
  (SELECT coalesce(sum(reserved::bigint),0)::float8 FROM stock_balances) AS reserved,
  (SELECT coalesce(sum(active::bigint),0)::float8 FROM stock_allocations) AS allocation_active,
  (SELECT coalesce(sum(released::bigint),0)::float8 FROM stock_allocations) AS allocation_released,
  (SELECT count(*)::int FROM stock_allocations) AS allocations`;

/** Ошибка не чинит остатки SQL и не удаляет evidence: driver помечает весь прогон неуспешным. */
function assertReconciled(row, expected) {
  for (const key of [
    'balance_errors',
    'ledger_errors',
    'allocation_errors',
    'duplicate_movements',
    'duplicate_tasks',
    'duplicate_markers',
    'receipt_errors',
    'unfinished_receipts',
    'unfinished_commands',
  ]) {
    assert.equal(row[key], 0, key);
  }
  for (const [key, value] of Object.entries(expected))
    assert.equal(row[key], value, `expected ${key}`);
  return row;
}
/** Repeatable read фиксирует один снимок для всех подзапросов после drain и завершения HTTP. */
async function readFacts(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {
      rows: [row],
    } = await client.query(INVARIANTS);
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
/** Успех требует всех guards и ожидаемых totals; readFacts также даёт partial failure evidence. */
async function reconcile(pool, expected) {
  return assertReconciled(await readFacts(pool), expected);
}
module.exports = { reconcile, assertReconciled, readFacts };
