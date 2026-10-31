-- Строгая сверка всех balances, без исключения «legacy без allocations».
-- Сначала блокируем изменения обеих сторон ledger, чтобы preflight и замена trigger были атомарны.
LOCK TABLE public.stock_balances, public.stock_allocations IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
-- Расхождения не списываются автоматически: оператор должен восстановить основания/историю.
-- Ошибка откатывает всю migration transaction, journal не помечается выполненным.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.stock_balances b
   LEFT JOIN (SELECT balance_id,sum(active) active FROM public.stock_allocations GROUP BY balance_id) a
   ON a.balance_id=b.id WHERE b.reserved<>coalesce(a.active,0)) THEN
   RAISE EXCEPTION 'Reservation reconciliation required before migration' USING ERRCODE='23514';
 END IF;
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
   AND (SELECT coalesce(sum(active),0) FROM stock_allocations WHERE line_id=l.id)>l.quantity) THEN
  RAISE EXCEPTION 'Order over allocation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER reserved_reconciled ON public.stock_balances;
-- INSERT также может задать ненулевой reserved; проверка всегда отложена до общего COMMIT.
CREATE CONSTRAINT TRIGGER reserved_reconciled AFTER INSERT OR UPDATE ON public.stock_balances
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_reservation_invariant();
