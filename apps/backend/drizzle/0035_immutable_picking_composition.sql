-- Review PICK-IMM: ready — этап исполнения, а не разрешение дополнять сохранённый план.
-- Header и полный состав создаются одним production runner; nested transactions/savepoints
-- через этот port запрещены. Applied 0027/0028 остаются неизменными.
CREATE FUNCTION public.guard_picking_line_creation_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE header_xid xid;
BEGIN
  -- Сравниваем системный xmin с текущей транзакцией, как в guard состава shipment0031.
  -- Runtime не задаёт xmin. Проверка не ждёт task row lock: поздний INSERT отклоняется
  -- до FK wait и не может продолжиться после конкурентного ready → in_progress.
  SELECT xmin INTO header_xid FROM public.picking_tasks WHERE id=NEW.task_id;
  IF FOUND AND header_xid <> pg_current_xact_id()::xid THEN
    RAISE EXCEPTION 'Picking composition is immutable after creation' USING ERRCODE='42501';
  END IF;
  -- Отсутствующий header, wrong order/source/zone/quantity по-прежнему отклоняют
  -- существующие guard_picking_line и FK. Новая проверка их не заменяет.
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Новый trigger сортируется раньше picking_line_guard. UPDATE picked_total/cancelled_unpicked
-- остаются под прежними lifecycle/deferred guards; состав после создания не дополняется.
CREATE TRIGGER picking_line_creation_transaction
BEFORE INSERT ON public.picking_lines FOR EACH ROW
EXECUTE FUNCTION public.guard_picking_line_creation_transaction();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_picking_line_creation_transaction() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_picking_line_creation_transaction() TO warehouse_app;
