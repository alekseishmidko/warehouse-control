-- WMS-108 read-only proof для psql: -v receipt_id=<UUID из HTTP response>.
-- Для точного onHand=10 использовать новый fixture set без других начислений.
-- Не содержит credentials, не меняет stock/status/events и не создаёт putaway task.
BEGIN READ ONLY;
SELECT r.id, r.status, r.posted_at, r.posted_event_id, l.position, l.quantity,
       b.on_hand, b.reserved,
       (SELECT count(*) FROM stock_movements m WHERE m.operation_id=l.id) AS movements_for_line,
       (SELECT count(*) FROM outbox_events e WHERE e.aggregate_type='receipt' AND e.aggregate_id=r.id) AS receipt_events
FROM receipts r JOIN receipt_lines l ON l.receipt_id=r.id
JOIN stock_balances b ON b.warehouse_id=r.warehouse_id AND b.location_id=r.receiving_location_id AND b.product_id=l.product_id
WHERE r.id=:'receipt_id'::uuid ORDER BY l.position;
-- Одна строка: posted, quantity=10, on_hand=10, reserved=0, movements_for_line=1, receipt_events=1.

SELECT e.event_id, e.aggregate_version, e.envelope->>'type' AS event_type,
       d.destination, d.status, d.attempts, s.last_completed_version, s.lease_until
FROM outbox_events e JOIN outbox_deliveries d ON d.event_id=e.event_id
JOIN delivery_streams s ON s.destination=d.destination AND s.aggregate_type=e.aggregate_type AND s.aggregate_id=e.aggregate_id
WHERE e.aggregate_type='receipt' AND e.aggregate_id=:'receipt_id'::uuid;
-- Один ReceivingPosted v1, inventory.putaway, pending, attempts=0, last_completed_version=0, lease_until=null.

SELECT action, entity_type, entity_id, correlation_id, reason_code FROM audit_entries
WHERE (entity_type='receipt' AND entity_id=:'receipt_id'::uuid)
   OR id IN (SELECT audit_id FROM stock_movements WHERE operation_id IN
      (SELECT id FROM receipt_lines WHERE receipt_id=:'receipt_id'::uuid))
ORDER BY occurred_at, id;
-- receipt-created, inventory.stock-received, receipt-posted; создающий и проводящий correlation могут различаться.
SELECT to_regclass('public.putaway_tasks') AS task_table;
-- null: worker/putaway schema ещё не реализованы. Delivery — durable факт ожидания, не задание.
COMMIT;
