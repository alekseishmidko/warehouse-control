-- WMS-108: runtime роль создаёт draft/строки и проводит parent, но не переписывает историю.
REVOKE ALL ON TABLE public.receipts, public.receipt_lines FROM PUBLIC, warehouse_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.receipts TO warehouse_app;
GRANT SELECT, INSERT ON TABLE public.receipt_lines TO warehouse_app;
--> statement-breakpoint
CREATE FUNCTION public.guard_receipt_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Receipt must start as draft' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' OR NEW.status <> 'posted'
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
    OR NEW.receiving_location_id IS DISTINCT FROM OLD.receiving_location_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Receipt content/state is immutable' USING ERRCODE = '42501';
  END IF;
  -- Финальное состояние требует хотя бы одну строку и именно свой сохранённый факт.
  IF NOT EXISTS (SELECT 1 FROM public.receipt_lines WHERE receipt_id = NEW.id)
    OR NOT EXISTS (SELECT 1 FROM public.outbox_events WHERE event_id = NEW.posted_event_id
      AND aggregate_type = 'receipt' AND aggregate_id = NEW.id AND aggregate_version = 1
      AND envelope->>'type' = 'receiving.receipt-posted'
      AND (envelope->'payload'->>'receiptId')::uuid = NEW.id) THEN
    RAISE EXCEPTION 'Posted receipt requires lines and its event' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION public.guard_receipt_line_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  -- Тот же parent lock, что у posting: INSERT не может добавить строку после его commit.
  SELECT status INTO parent_status FROM public.receipts WHERE id = NEW.receipt_id FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Lines require draft receipt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION public.reject_receipt_line_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Receipt lines are immutable' USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_receipt_state(), public.guard_receipt_line_insert(), public.reject_receipt_line_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_receipt_state(), public.guard_receipt_line_insert(), public.reject_receipt_line_update() TO warehouse_app;
--> statement-breakpoint
CREATE TRIGGER receipts_state_guard BEFORE INSERT OR UPDATE ON public.receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_state();
--> statement-breakpoint
CREATE TRIGGER receipt_lines_insert_guard BEFORE INSERT ON public.receipt_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_line_insert();
--> statement-breakpoint
CREATE TRIGGER receipt_lines_immutable BEFORE UPDATE ON public.receipt_lines
FOR EACH ROW EXECUTE FUNCTION public.reject_receipt_line_update();
--> statement-breakpoint
-- Общая политика: удаление появится только с retention/replay планом, DBA может обойти guards.
CREATE TRIGGER receipts_retained BEFORE DELETE OR TRUNCATE ON public.receipts
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_retention_delete();
--> statement-breakpoint
CREATE TRIGGER receipt_lines_retained BEFORE DELETE OR TRUNCATE ON public.receipt_lines
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_retention_delete();
