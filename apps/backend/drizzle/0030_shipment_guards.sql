-- WMS-206: immutable документы/effects, grants и deferred сверка ledger. Applied SQL не меняется.
GRANT SELECT,INSERT ON shipments,shipment_lines,shipping_effects TO warehouse_app;
GRANT UPDATE(status,posted_at) ON shipments TO warehouse_app;
GRANT UPDATE(consumed) ON stock_allocations TO warehouse_app;
CREATE UNIQUE INDEX shipping_movement_leg ON stock_movements(shipping_effect_id,kind);
CREATE INDEX shipping_effect_allocation_idx ON shipping_effects(allocation_id);
CREATE INDEX shipment_order_idx ON shipments(order_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.line_id<>OLD.line_id OR NEW.balance_id<>OLD.balance_id OR NEW.allocated<>OLD.allocated
  OR NEW.active>=OLD.active OR NEW.released<OLD.released OR NEW.transferred<OLD.transferred OR NEW.consumed<OLD.consumed
  OR ((NEW.released>OLD.released)::int+(NEW.transferred>OLD.transferred)::int+(NEW.consumed>OLD.consumed)::int)<>1) THEN
  RAISE EXCEPTION 'Allocation history is immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' AND (NEW.active<>NEW.allocated OR NEW.released<>0 OR NEW.transferred<>0 OR NEW.consumed<>0) THEN
  RAISE EXCEPTION 'New allocation must be active' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM order_lines l JOIN orders o ON o.id=l.order_id JOIN stock_balances b ON b.id=NEW.balance_id JOIN locations p ON p.id=b.location_id
  WHERE l.id=NEW.line_id AND b.product_id=l.product_id AND b.warehouse_id=o.warehouse_id AND
  ((TG_OP='INSERT' AND o.status='active' AND p.kind IN ('storage','shipping')) OR
   (TG_OP='UPDATE' AND p.kind='storage' AND NEW.consumed=OLD.consumed AND o.status IN ('active','cancel_pending') AND (NEW.transferred=OLD.transferred OR o.status='active')) OR
   (TG_OP='UPDATE' AND p.kind='shipping' AND NEW.transferred=OLD.transferred AND
     ((NEW.consumed>OLD.consumed AND o.status='active') OR (NEW.released>OLD.released AND o.status='cancel_pending'))))) THEN
  RAISE EXCEPTION 'Invalid allocation source or lifecycle' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.check_reservation_invariant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid uuid; actual bigint; expected bigint;
BEGIN
 IF TG_TABLE_NAME='stock_balances' THEN bid:=NEW.id; ELSE bid:=NEW.balance_id; END IF;
 SELECT reserved INTO actual FROM stock_balances WHERE id=bid;
 SELECT coalesce(sum(active),0) INTO expected FROM stock_allocations WHERE balance_id=bid;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Reservation mismatch' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='stock_allocations' THEN
 IF EXISTS(SELECT 1 FROM order_lines l WHERE l.id=NEW.line_id
  AND (SELECT coalesce(sum(active::bigint+consumed),0) FROM stock_allocations WHERE line_id=l.id)>l.quantity) THEN
  RAISE EXCEPTION 'Order over allocation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_order_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_total bigint; shipped_total bigint; ordered_total bigint;
BEGIN
 IF TG_OP='INSERT' THEN IF NEW.status<>'draft' THEN RAISE EXCEPTION 'Draft required' USING ERRCODE='23514'; END IF; RETURN NEW; END IF;
 IF NEW.id<>OLD.id OR NEW.warehouse_id<>OLD.warehouse_id OR NOT (
  (OLD.status='draft' AND NEW.status IN ('active','cancelled')) OR
  (OLD.status='active' AND NEW.status IN ('cancel_pending','cancelled','completed','closed_mixed')) OR
  (OLD.status='cancel_pending' AND NEW.status IN ('cancelled','closed_mixed'))) THEN
  RAISE EXCEPTION 'Invalid order transition' USING ERRCODE='42501'; END IF;
 SELECT coalesce(sum(a.active),0),coalesce(sum(a.consumed),0) INTO active_total,shipped_total
  FROM stock_allocations a JOIN order_lines l ON l.id=a.line_id WHERE l.order_id=NEW.id;
 SELECT coalesce(sum(quantity),0) INTO ordered_total FROM order_lines WHERE order_id=NEW.id;
 IF (NEW.status='active' AND ordered_total=0)
  OR (NEW.status='cancelled' AND (active_total<>0 OR shipped_total<>0))
  OR (NEW.status='completed' AND (active_total<>0 OR ordered_total=0 OR shipped_total<>ordered_total))
  OR (NEW.status='closed_mixed' AND (active_total<>0 OR shipped_total=0 OR shipped_total>=ordered_total))
  OR (NEW.status='cancel_pending' AND NOT EXISTS(SELECT 1 FROM stock_allocations a JOIN order_lines l ON l.id=a.line_id JOIN stock_balances b ON b.id=a.balance_id JOIN locations p ON p.id=b.location_id WHERE l.order_id=NEW.id AND a.active>0 AND p.kind='shipping')) THEN
  RAISE EXCEPTION 'Order quantities do not match lifecycle' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.guard_shipment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND status='active') THEN RAISE EXCEPTION 'Active order required' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status<>'draft' OR NEW.status NOT IN ('posted','cancelled') OR (to_jsonb(NEW)-ARRAY['status','posted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','posted_at']) THEN
  RAISE EXCEPTION 'Shipment is immutable' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shipment_state_guard BEFORE INSERT OR UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION public.guard_shipment();
CREATE FUNCTION public.guard_shipment_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipments s JOIN stock_allocations a ON a.id=NEW.allocation_id JOIN order_lines l ON l.id=a.line_id JOIN stock_balances b ON b.id=a.balance_id JOIN locations p ON p.id=b.location_id
  WHERE s.id=NEW.shipment_id AND s.status='draft' AND s.order_id=l.order_id AND p.kind='shipping' AND NEW.quantity<=a.active)
  OR (SELECT count(*) FROM shipment_lines WHERE shipment_id=NEW.shipment_id)>=1000 THEN
  RAISE EXCEPTION 'Staged allocation required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shipment_line_insert BEFORE INSERT ON shipment_lines FOR EACH ROW EXECUTE FUNCTION public.guard_shipment_line();
CREATE TRIGGER shipment_lines_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON shipment_lines FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
CREATE TRIGGER shipments_retained BEFORE DELETE OR TRUNCATE ON shipments FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
CREATE TRIGGER shipping_effects_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON shipping_effects FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
--> statement-breakpoint
-- Основание shipment уникально по shipment_line_id; возврат не переписывает consumed history.
CREATE FUNCTION public.check_shipping_effect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid; e shipping_effects%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='stock_movements' THEN eid:=NEW.shipping_effect_id; ELSE eid:=NEW.id; END IF;
 IF eid IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO e FROM shipping_effects WHERE id=eid;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM stock_allocations a JOIN order_lines l ON l.id=a.line_id JOIN stock_balances b ON b.id=a.balance_id JOIN locations p ON p.id=b.location_id
  WHERE a.id=e.allocation_id AND l.order_id=e.order_id AND p.kind='shipping'
  AND (SELECT count(*) FROM stock_movements WHERE shipping_effect_id=e.id)=CASE WHEN e.kind='ship' THEN 1 ELSE 2 END
  AND a.consumed=(SELECT coalesce(sum(quantity),0) FROM shipping_effects WHERE allocation_id=a.id AND kind='ship')
  AND a.released=(SELECT coalesce(sum(quantity),0) FROM shipping_effects WHERE allocation_id=a.id AND kind='return')
  AND ((e.kind='ship' AND EXISTS(SELECT 1 FROM shipment_lines sl JOIN shipments s ON s.id=sl.shipment_id WHERE sl.id=e.shipment_line_id AND sl.allocation_id=a.id AND sl.quantity=e.quantity AND s.order_id=e.order_id AND s.status='posted')
    AND (SELECT count(*) FROM stock_movements m WHERE m.shipping_effect_id=e.id AND m.kind='shipment' AND m.quantity=e.quantity AND m.audit_id=e.audit_id AND m.warehouse_id=b.warehouse_id AND m.product_id=b.product_id AND m.location_id=b.location_id)=1)
   OR (e.kind='return' AND EXISTS(SELECT 1 FROM orders WHERE id=e.order_id AND status IN ('cancelled','closed_mixed')) AND EXISTS(SELECT 1 FROM stock_balances d JOIN locations t ON t.id=d.location_id WHERE d.id=e.target_balance_id AND d.warehouse_id=b.warehouse_id AND d.product_id=b.product_id AND t.kind='storage'
     AND (SELECT count(*) FROM stock_movements m WHERE m.shipping_effect_id=e.id AND m.quantity=e.quantity AND m.audit_id=e.audit_id AND m.warehouse_id=b.warehouse_id AND m.product_id=b.product_id AND ((m.kind='transfer-out' AND m.location_id=b.location_id) OR (m.kind='transfer-in' AND m.location_id=d.location_id)))=2)))) THEN
  RAISE EXCEPTION 'Shipping effect mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER shipping_effect_reconciled AFTER INSERT ON shipping_effects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_shipping_effect();
CREATE CONSTRAINT TRIGGER shipping_movement_reconciled AFTER INSERT ON stock_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_shipping_effect();
--> statement-breakpoint
CREATE FUNCTION public.check_consumption_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a stock_allocations%ROWTYPE;
BEGIN
 SELECT * INTO a FROM stock_allocations WHERE id=NEW.id;
 IF a.consumed IS DISTINCT FROM (SELECT coalesce(sum(quantity),0)::int FROM shipping_effects WHERE allocation_id=a.id AND kind='ship')
  OR (EXISTS(SELECT 1 FROM stock_balances b JOIN locations l ON l.id=b.location_id WHERE b.id=a.balance_id AND l.kind='shipping') AND a.released IS DISTINCT FROM (SELECT coalesce(sum(quantity),0)::int FROM shipping_effects WHERE allocation_id=a.id AND kind='return')) THEN
  RAISE EXCEPTION 'Consumption or return requires history' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER consumption_history_reconciled AFTER INSERT OR UPDATE ON stock_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_consumption_history();
CREATE FUNCTION public.check_shipment_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid uuid;
BEGIN
 IF TG_TABLE_NAME='shipments' THEN sid:=NEW.id; ELSE sid:=NEW.shipment_id; END IF;
 IF NOT EXISTS(SELECT 1 FROM shipment_lines WHERE shipment_id=sid) OR EXISTS(SELECT 1 FROM shipments s JOIN shipment_lines l ON l.shipment_id=s.id WHERE s.id=sid AND s.status='posted' AND NOT EXISTS(SELECT 1 FROM shipping_effects e WHERE e.shipment_line_id=l.id AND e.kind='ship' AND e.quantity=l.quantity)) THEN
  RAISE EXCEPTION 'Shipment document mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER shipment_document_reconciled AFTER INSERT OR UPDATE ON shipments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_shipment_document();
CREATE CONSTRAINT TRIGGER shipment_line_reconciled AFTER INSERT ON shipment_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_shipment_document();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_shipment(),public.guard_shipment_line(),public.check_shipping_effect(),public.check_consumption_history(),public.check_shipment_document() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_shipment(),public.guard_shipment_line(),public.check_shipping_effect(),public.check_consumption_history(),public.check_shipment_document() TO warehouse_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.check_picking_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid uuid; st text;
BEGIN
 IF TG_TABLE_NAME='picking_tasks' THEN tid:=NEW.id; ELSE tid:=NEW.task_id; END IF;
 SELECT status INTO st FROM picking_tasks WHERE id=tid;
 IF NOT EXISTS(SELECT 1 FROM picking_lines WHERE task_id=tid)
 OR EXISTS(SELECT 1 FROM picking_lines l WHERE l.task_id=tid AND
   (l.picked_total IS DISTINCT FROM (SELECT coalesce(sum(quantity),0)::int FROM picking_transfers WHERE task_line_id=l.id)
    OR (st='completed' AND l.planned<>l.picked_total+l.cancelled_unpicked)
    OR (st='cancelled' AND l.cancelled_unpicked<>l.planned-l.picked_total)
    OR (st IN ('ready','in_progress','shortage') AND
        (SELECT active FROM stock_allocations WHERE id=l.allocation_id)<l.planned-l.picked_total-l.cancelled_unpicked))) THEN
  RAISE EXCEPTION 'Picking plan mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
