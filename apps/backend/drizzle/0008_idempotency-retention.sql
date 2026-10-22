-- WMS-107: snapshot результата не переписывается/не удаляется до отдельной retention policy.
REVOKE ALL ON TABLE public.http_idempotency FROM PUBLIC, warehouse_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.http_idempotency TO warehouse_app;
--> statement-breakpoint
CREATE FUNCTION public.guard_http_idempotency_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.completed_at IS NOT NULL OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.operation IS DISTINCT FROM OLD.operation
    OR NEW.key IS DISTINCT FROM OLD.key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash THEN
    RAISE EXCEPTION 'Idempotency identity/result is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_http_idempotency_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_http_idempotency_update() TO warehouse_app;
--> statement-breakpoint
CREATE TRIGGER http_idempotency_result_immutable BEFORE UPDATE ON public.http_idempotency
FOR EACH ROW EXECUTE FUNCTION public.guard_http_idempotency_update();
--> statement-breakpoint
-- Используем уже существующий retention trigger function WMS-106.
CREATE TRIGGER http_idempotency_retained BEFORE DELETE OR TRUNCATE ON public.http_idempotency
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_retention_delete();
