-- До установки guard проверяем уже существующие планы без исправления истории.
-- Locks исключают запись allocation/task/line между проверкой и установкой constraint trigger.
LOCK TABLE public.stock_allocations, public.picking_tasks, public.picking_lines IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM public.picking_lines l JOIN public.picking_tasks t ON t.id=l.task_id
  JOIN public.stock_allocations a ON a.id=l.allocation_id
  WHERE t.status IN ('ready','in_progress','shortage')
    AND a.active < l.planned-l.picked_total-l.cancelled_unpicked
 ) THEN
  RAISE EXCEPTION 'Existing picking plan lacks active reservation' USING ERRCODE='23514';
 END IF;
END $$;
--> statement-breakpoint
-- WMS-205 review: изменение источника тоже должно проверять обеспечение открытого плана.
-- Проверяем конечный снимок, а не NEW.active отдельного UPDATE: сборка и отмена меняют
-- allocation и task/lines разными statements одной транзакции. Applied 0026/0027 не меняются.
CREATE INDEX picking_lines_allocation_idx ON public.picking_lines(allocation_id);
--> statement-breakpoint
CREATE FUNCTION public.check_picking_allocation_backing() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_active integer;
BEGIN
 SELECT active INTO current_active FROM public.stock_allocations WHERE id=NEW.id;
 IF EXISTS (
  SELECT 1 FROM public.picking_lines l JOIN public.picking_tasks t ON t.id=l.task_id
  WHERE l.allocation_id=NEW.id AND t.status IN ('ready','in_progress','shortage')
    AND current_active < l.planned-l.picked_total-l.cancelled_unpicked
 ) THEN
  RAISE EXCEPTION 'Open picking plan requires active reservation' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
-- DEFERRABLE позволяет общей транзакции сначала выполнить release, затем отменить план.
-- При ошибке COMMIT откатываются allocation, reserved и остальные записи вызывающего сценария.
CREATE CONSTRAINT TRIGGER picking_allocation_backing_reconciled
 AFTER INSERT OR UPDATE ON public.stock_allocations DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION public.check_picking_allocation_backing();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.check_picking_allocation_backing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_picking_allocation_backing() TO warehouse_app;
