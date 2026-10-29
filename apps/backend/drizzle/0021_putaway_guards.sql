-- WMS-203: source задания остаётся immutable; разрешён один переход pending → completed.
-- Старые applied migrations не редактируются. Delete/truncate retention сохраняет прежнее имя
-- trigger для disposable test cleanup; DBA способен обойти любые эти guards.
DROP TRIGGER putaway_tasks_immutable ON public.putaway_tasks;
CREATE TRIGGER putaway_tasks_immutable BEFORE DELETE OR TRUNCATE ON public.putaway_tasks
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
--> statement-breakpoint
CREATE FUNCTION public.guard_putaway_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'New task must be pending' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' OR NEW.status <> 'completed'
    OR (to_jsonb(NEW) - ARRAY['status','target_location_id','completed_at','completed_event_id','completion_audit_id'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','target_location_id','completed_at','completed_event_id','completion_audit_id']) THEN
    RAISE EXCEPTION 'Task source/state is immutable' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id=NEW.source_location_id AND warehouse_id=NEW.warehouse_id AND kind='receiving')
    OR NOT EXISTS (SELECT 1 FROM public.locations WHERE id=NEW.target_location_id AND warehouse_id=NEW.warehouse_id AND kind='storage') THEN
    RAISE EXCEPTION 'Invalid putaway zones' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.outbox_events e WHERE e.event_id=NEW.completed_event_id
    AND e.aggregate_type='putaway-task' AND e.aggregate_id=NEW.id AND e.aggregate_version=1
    AND e.envelope->>'type'='inventory.putaway-completed'
    AND (e.envelope->>'occurredAt')::timestamptz=NEW.completed_at
    AND e.envelope->'payload' @> jsonb_build_object('taskId',NEW.id,'receiptId',NEW.source_receipt_id,
      'receiptLineId',NEW.source_receipt_line_id,'warehouseId',NEW.warehouse_id,'sourceLocationId',NEW.source_location_id,
      'targetLocationId',NEW.target_location_id,'productId',NEW.product_id,'quantity',NEW.quantity,'transferId',NEW.id))
    OR (SELECT count(*) FROM public.stock_movements m WHERE m.transfer_id=NEW.id
      AND m.warehouse_id=NEW.warehouse_id AND m.product_id=NEW.product_id AND m.quantity=NEW.quantity
      AND m.audit_id=NEW.completion_audit_id AND ((m.kind='transfer-out' AND m.location_id=NEW.source_location_id)
      OR (m.kind='transfer-in' AND m.location_id=NEW.target_location_id))) <> 2 THEN
    RAISE EXCEPTION 'Completion requires event and paired movements' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER putaway_task_state_guard BEFORE INSERT OR UPDATE ON public.putaway_tasks
FOR EACH ROW EXECUTE FUNCTION public.guard_putaway_execution();
--> statement-breakpoint
-- Deferred check не разрешает commit половины пары либо pair без завершённой task.
-- Сервис сначала INSERT pair, затем event и task UPDATE, поэтому immediate check был бы преждевременным.
CREATE FUNCTION public.check_putaway_movement_pair() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transfer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.putaway_tasks t WHERE t.id=NEW.transfer_id AND t.status='completed'
      AND NEW.warehouse_id=t.warehouse_id AND NEW.product_id=t.product_id AND NEW.quantity=t.quantity
      AND NEW.audit_id=t.completion_audit_id
      AND ((NEW.kind='transfer-out' AND NEW.location_id=t.source_location_id)
        OR (NEW.kind='transfer-in' AND NEW.location_id=t.target_location_id))
      AND (SELECT count(*) FROM public.stock_movements WHERE transfer_id=t.id)=2
  ) THEN
    RAISE EXCEPTION 'Transfer pair requires completed task' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER putaway_movement_pair_guard AFTER INSERT ON public.stock_movements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_putaway_movement_pair();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_putaway_execution(), public.check_putaway_movement_pair() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_putaway_execution(), public.check_putaway_movement_pair() TO warehouse_app;
-- Runtime может менять только completion поля. Source и audit создания не переписываются.
GRANT UPDATE(status,target_location_id,completed_at,completed_event_id,completion_audit_id) ON public.putaway_tasks TO warehouse_app;
