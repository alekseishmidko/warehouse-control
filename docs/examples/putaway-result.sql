-- WMS-110 read-only psql диагностика: -v receipt_id=<UUID проведённой приёмки>.
-- До worker task/marker отсутствуют, delivery pending; после worker task pending и delivery completed.
-- Task pending означает ожидание физического размещения, не неуспешную доставку.
BEGIN READ ONLY;
SELECT r.id AS receipt_id, r.status AS receipt_status, e.event_id, l.id AS receipt_line_id,
       t.id AS task_id, t.status AS task_status, t.quantity AS task_quantity,
       b.on_hand, b.reserved,
       d.status AS delivery_status, d.attempts,
       s.last_completed_version, c.last_processed_version,
       p.processed_at, a.actor_type, a.actor_id, a.correlation_id
FROM receipts r JOIN receipt_lines l ON l.receipt_id=r.id
JOIN outbox_events e ON e.event_id=r.posted_event_id
JOIN stock_balances b ON b.warehouse_id=r.warehouse_id AND b.location_id=r.receiving_location_id AND b.product_id=l.product_id
JOIN outbox_deliveries d ON d.event_id=e.event_id AND d.destination='inventory.putaway'
JOIN delivery_streams s ON s.aggregate_type=e.aggregate_type AND s.aggregate_id=e.aggregate_id AND s.destination=d.destination
LEFT JOIN putaway_tasks t ON t.source_receipt_line_id=l.id AND t.source_event_id=e.event_id
LEFT JOIN processed_events p ON p.event_id=e.event_id AND p.consumer_name=d.destination
LEFT JOIN consumer_streams c ON c.aggregate_type=e.aggregate_type AND c.aggregate_id=e.aggregate_id AND c.consumer_name=d.destination
LEFT JOIN audit_entries a ON a.id=t.audit_id
WHERE r.id=:'receipt_id'::uuid ORDER BY l.position;
-- Новый fixture, одна строка quantity=10: on_hand=10, reserved=0 до и после worker.
-- После worker: один task pending quantity=10, delivery completed, оба cursor=1, processed_at заполнен.

SELECT (SELECT count(*) FROM putaway_tasks WHERE source_receipt_id=:'receipt_id'::uuid) AS tasks,
       (SELECT count(*) FROM stock_movements WHERE operation_id IN
          (SELECT id FROM receipt_lines WHERE receipt_id=:'receipt_id'::uuid)) AS movements,
       (SELECT count(*) FROM outbox_events WHERE aggregate_type='receipt' AND aggregate_id=:'receipt_id'::uuid) AS events;
-- Для одной строки после worker: tasks=1, movements=1, events=1; repeat не увеличивает числа.
COMMIT;
