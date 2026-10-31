-- WMS-204: история заказа/allocations retained; доступ runtime ограничен колонками lifecycle.
GRANT SELECT,INSERT ON orders,order_lines,stock_allocations TO warehouse_app;
GRANT UPDATE(status) ON orders TO warehouse_app;
GRANT UPDATE(active,released) ON stock_allocations TO warehouse_app;
CREATE INDEX allocation_line_idx ON stock_allocations(line_id);
CREATE INDEX allocation_balance_idx ON stock_allocations(balance_id);
--> statement-breakpoint
CREATE FUNCTION public.guard_order_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' THEN RAISE EXCEPTION 'Draft required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW.warehouse_id<>OLD.warehouse_id OR NOT
   ((OLD.status='draft' AND NEW.status IN ('active','cancelled')) OR (OLD.status='active' AND NEW.status='cancelled')) THEN
   RAISE EXCEPTION 'Invalid order transition' USING ERRCODE='42501';
  END IF;
  IF NEW.status='active' AND NOT EXISTS(SELECT 1 FROM order_lines WHERE order_id=NEW.id) THEN
   RAISE EXCEPTION 'Lines required' USING ERRCODE='23514'; END IF;
  IF NEW.status='cancelled' AND EXISTS(SELECT 1 FROM stock_allocations a JOIN order_lines l ON l.id=a.line_id WHERE l.order_id=NEW.id AND a.active>0) THEN
   RAISE EXCEPTION 'Release required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER orders_state_guard BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION public.guard_order_state();
--> statement-breakpoint
CREATE FUNCTION public.guard_order_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
 SELECT status INTO s FROM orders WHERE id=NEW.order_id FOR UPDATE;
 IF s IS DISTINCT FROM 'draft' OR (SELECT count(*) FROM order_lines WHERE order_id=NEW.order_id)>=1000 THEN
 RAISE EXCEPTION 'Draft line limit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_line_insert BEFORE INSERT ON order_lines FOR EACH ROW EXECUTE FUNCTION public.guard_order_line();
CREATE TRIGGER order_line_immutable BEFORE UPDATE ON order_lines FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
--> statement-breakpoint
CREATE FUNCTION public.guard_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.line_id<>OLD.line_id OR NEW.balance_id<>OLD.balance_id OR NEW.allocated<>OLD.allocated OR NEW.active>=OLD.active OR NEW.released<=OLD.released) THEN
  RAISE EXCEPTION 'Allocation history is immutable' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' AND (NEW.active<>NEW.allocated OR NEW.released<>0) THEN
  RAISE EXCEPTION 'New allocation must be active' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM order_lines l JOIN orders o ON o.id=l.order_id
   JOIN stock_balances b ON b.id=NEW.balance_id JOIN locations p ON p.id=b.location_id
   WHERE l.id=NEW.line_id AND b.product_id=l.product_id AND b.warehouse_id=o.warehouse_id
   AND p.kind='storage' AND o.status='active') THEN
  RAISE EXCEPTION 'Invalid allocation source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_state_guard BEFORE INSERT OR UPDATE ON stock_allocations FOR EACH ROW EXECUTE FUNCTION public.guard_allocation();
--> statement-breakpoint
-- Проверка отложена до COMMIT: reserved и active меняются отдельными statements одного context.
CREATE FUNCTION public.check_reservation_invariant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid uuid; actual bigint; expected bigint;
BEGIN
 IF TG_TABLE_NAME='stock_balances' THEN bid:=NEW.id; ELSE bid:=NEW.balance_id; END IF;
 IF TG_TABLE_NAME='stock_allocations' OR EXISTS(SELECT 1 FROM stock_allocations WHERE balance_id=bid) THEN
  SELECT reserved INTO actual FROM stock_balances WHERE id=bid;
  SELECT coalesce(sum(active),0) INTO expected FROM stock_allocations WHERE balance_id=bid;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Reservation mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='stock_allocations' THEN
 IF EXISTS(SELECT 1 FROM order_lines l WHERE l.id=NEW.line_id
   AND (SELECT coalesce(sum(active),0) FROM stock_allocations WHERE line_id=l.id)>l.quantity) THEN
  RAISE EXCEPTION 'Order over allocation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER allocations_reconciled AFTER INSERT OR UPDATE ON stock_allocations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_reservation_invariant();
CREATE CONSTRAINT TRIGGER reserved_reconciled AFTER UPDATE ON stock_balances
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_reservation_invariant();
--> statement-breakpoint
CREATE TRIGGER orders_retained BEFORE DELETE OR TRUNCATE ON orders FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
CREATE TRIGGER order_lines_retained BEFORE DELETE OR TRUNCATE ON order_lines FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
CREATE TRIGGER allocations_retained BEFORE DELETE OR TRUNCATE ON stock_allocations FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
REVOKE ALL ON FUNCTION public.guard_order_state(), public.guard_order_line(), public.guard_allocation(), public.check_reservation_invariant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_order_state(), public.guard_order_line(), public.guard_allocation(), public.check_reservation_invariant() TO warehouse_app;
