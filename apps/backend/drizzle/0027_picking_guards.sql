-- WMS-205: новые guards без изменения applied migrations. История source allocation сохраняется.
GRANT SELECT,INSERT ON picking_tasks,picking_lines,picking_transfers TO warehouse_app;
GRANT UPDATE(status,assignee_id) ON picking_tasks TO warehouse_app;
GRANT UPDATE(picked_total,cancelled_unpicked) ON picking_lines TO warehouse_app;
GRANT UPDATE(transferred) ON stock_allocations TO warehouse_app;
CREATE UNIQUE INDEX picking_movement_leg ON stock_movements(picking_transfer_id,kind);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.line_id<>OLD.line_id OR NEW.balance_id<>OLD.balance_id OR NEW.allocated<>OLD.allocated
   OR NEW.active>=OLD.active OR NEW.released<OLD.released OR NEW.transferred<OLD.transferred
   OR ((NEW.released>OLD.released)::int+(NEW.transferred>OLD.transferred)::int)<>1) THEN
   RAISE EXCEPTION 'Allocation history is immutable' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' AND (NEW.active<>NEW.allocated OR NEW.released<>0 OR NEW.transferred<>0) THEN
   RAISE EXCEPTION 'New allocation must be active' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM order_lines l JOIN orders o ON o.id=l.order_id
   JOIN stock_balances b ON b.id=NEW.balance_id JOIN locations p ON p.id=b.location_id
   WHERE l.id=NEW.line_id AND b.product_id=l.product_id AND b.warehouse_id=o.warehouse_id
   AND p.kind IN ('storage','shipping') AND o.status='active'
   AND (TG_OP='INSERT' OR p.kind='storage')) THEN
   RAISE EXCEPTION 'Invalid allocation source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.guard_picking_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'ready' OR NEW.assignee_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND status='active') THEN
   RAISE EXCEPTION 'Active order required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW.order_id<>OLD.order_id OR NEW.created_at<>OLD.created_at
   OR OLD.status IN ('completed','cancelled') OR NOT (
     (OLD.status='ready' AND NEW.status IN ('in_progress','cancelled')) OR
     (OLD.status='shortage' AND NEW.status IN ('in_progress','cancelled')) OR
     (OLD.status='in_progress' AND NEW.status IN ('in_progress','shortage','completed','cancelled')))
   OR (OLD.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) THEN
   RAISE EXCEPTION 'Invalid picking transition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER picking_task_guard BEFORE INSERT OR UPDATE ON picking_tasks FOR EACH ROW EXECUTE FUNCTION public.guard_picking_task();
--> statement-breakpoint
CREATE FUNCTION public.guard_picking_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.picked_total<>0 OR NEW.cancelled_unpicked<>0 OR NOT EXISTS(
   SELECT 1 FROM picking_tasks t JOIN stock_allocations a ON a.id=NEW.allocation_id
   JOIN stock_balances b ON b.id=a.balance_id JOIN locations p ON p.id=b.location_id
   JOIN order_lines l ON l.id=a.line_id WHERE t.id=NEW.task_id AND t.status='ready'
   AND l.order_id=t.order_id AND p.kind='storage' AND a.active=NEW.planned) THEN
   RAISE EXCEPTION 'Reserved source required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW.task_id<>OLD.task_id OR NEW.allocation_id<>OLD.allocation_id OR NEW.planned<>OLD.planned
   OR NEW.picked_total<OLD.picked_total OR NEW.cancelled_unpicked<OLD.cancelled_unpicked THEN
   RAISE EXCEPTION 'Picking plan is immutable' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER picking_line_guard BEFORE INSERT OR UPDATE ON picking_lines FOR EACH ROW EXECUTE FUNCTION public.guard_picking_line();
--> statement-breakpoint
-- Перед COMMIT проверяем не только два movements, но и обе стороны allocation, SKU/склад/зоны и факт строки задания.
CREATE FUNCTION public.check_picking_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid uuid; row picking_transfers%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='stock_movements' THEN tid:=NEW.picking_transfer_id; ELSE tid:=NEW.id; END IF;
 IF tid IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO row FROM picking_transfers WHERE id=tid;
 IF NOT FOUND OR NOT EXISTS(
   SELECT 1 FROM stock_allocations a JOIN stock_allocations z ON z.id=row.target_allocation_id
   JOIN stock_balances b ON b.id=a.balance_id JOIN stock_balances d ON d.id=z.balance_id
   JOIN locations s ON s.id=b.location_id JOIN locations t ON t.id=d.location_id
   JOIN picking_lines pl ON pl.id=row.task_line_id
   WHERE a.id=row.source_allocation_id AND pl.allocation_id=a.id AND a.line_id=z.line_id
    AND b.warehouse_id=d.warehouse_id AND b.product_id=d.product_id AND s.kind='storage' AND t.kind='shipping'
    AND z.allocated=row.quantity AND z.active=row.quantity AND z.released=0 AND z.transferred=0
    AND a.transferred=(SELECT coalesce(sum(quantity),0) FROM picking_transfers WHERE source_allocation_id=a.id)
    AND pl.picked_total=(SELECT coalesce(sum(quantity),0) FROM picking_transfers WHERE task_line_id=pl.id)
    AND (SELECT count(*) FROM stock_movements m WHERE m.picking_transfer_id=row.id AND m.quantity=row.quantity
      AND m.audit_id=row.audit_id AND m.warehouse_id=b.warehouse_id AND m.product_id=b.product_id
      AND ((m.kind='transfer-out' AND m.location_id=b.location_id) OR (m.kind='transfer-in' AND m.location_id=d.location_id)))=2
 ) THEN RAISE EXCEPTION 'Picking transfer mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER picking_transfer_reconciled AFTER INSERT ON picking_transfers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_picking_transfer();
CREATE CONSTRAINT TRIGGER picking_movement_reconciled AFTER INSERT ON stock_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_picking_transfer();
--> statement-breakpoint
CREATE FUNCTION public.check_picking_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT transferred FROM stock_allocations WHERE id=NEW.id) IS DISTINCT FROM (SELECT coalesce(sum(quantity),0)::int FROM picking_transfers WHERE source_allocation_id=NEW.id)
  OR (EXISTS(SELECT 1 FROM stock_balances b JOIN locations l ON l.id=b.location_id WHERE b.id=NEW.balance_id AND l.kind='shipping')
      AND NOT EXISTS(SELECT 1 FROM picking_transfers WHERE target_allocation_id=NEW.id)) THEN
  RAISE EXCEPTION 'Allocation transfer history required' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER picking_allocation_reconciled AFTER INSERT OR UPDATE ON stock_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_picking_allocation();
--> statement-breakpoint
CREATE TRIGGER picking_tasks_retained BEFORE DELETE OR TRUNCATE ON picking_tasks FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
CREATE TRIGGER picking_lines_retained BEFORE DELETE OR TRUNCATE ON picking_lines FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
CREATE TRIGGER picking_transfers_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON picking_transfers FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
REVOKE ALL ON FUNCTION public.guard_picking_task(),public.guard_picking_line(),public.check_picking_transfer(),public.check_picking_allocation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_picking_task(),public.guard_picking_line(),public.check_picking_transfer(),public.check_picking_allocation() TO warehouse_app;
--> statement-breakpoint
-- Проверяется конечный снимок: callbacks могут обновить строку, затем состояние задания разными SQL.
CREATE FUNCTION public.check_picking_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid uuid; st text;
BEGIN
 IF TG_TABLE_NAME='picking_tasks' THEN tid:=NEW.id; ELSE tid:=NEW.task_id; END IF;
 SELECT status INTO st FROM picking_tasks WHERE id=tid;
 IF NOT EXISTS(SELECT 1 FROM picking_lines WHERE task_id=tid)
 OR EXISTS(SELECT 1 FROM picking_lines l WHERE l.task_id=tid AND
   (l.picked_total IS DISTINCT FROM (SELECT coalesce(sum(quantity),0)::int FROM picking_transfers WHERE task_line_id=l.id)
    OR (st='completed' AND l.planned<>l.picked_total+l.cancelled_unpicked)
    OR (st='cancelled' AND (l.picked_total<>0 OR l.cancelled_unpicked<>l.planned))
    OR (st IN ('ready','in_progress','shortage') AND
        (SELECT active FROM stock_allocations WHERE id=l.allocation_id)<l.planned-l.picked_total-l.cancelled_unpicked))) THEN
  RAISE EXCEPTION 'Picking plan mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER picking_task_reconciled AFTER INSERT OR UPDATE ON picking_tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_picking_plan();
CREATE CONSTRAINT TRIGGER picking_line_reconciled AFTER INSERT OR UPDATE ON picking_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_picking_plan();
REVOKE ALL ON FUNCTION public.check_picking_plan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_picking_plan() TO warehouse_app;
