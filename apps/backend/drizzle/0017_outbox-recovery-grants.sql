-- WMS-111: отдельная NOLOGIN группа локального оператора; credentials provisioning остаётся вне schema migrations.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='warehouse_outbox_admin') THEN
    CREATE ROLE warehouse_outbox_admin NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO warehouse_outbox_admin;
GRANT SELECT ON public.outbox_events, public.processed_events, public.consumer_streams TO warehouse_outbox_admin;
GRANT SELECT, UPDATE ON public.outbox_deliveries, public.delivery_streams TO warehouse_outbox_admin;
GRANT SELECT, INSERT ON public.audit_entries TO warehouse_outbox_admin;
REVOKE ALL ON public.outbox_recovery_actions FROM PUBLIC, warehouse_app, warehouse_outbox_admin;
GRANT SELECT ON public.outbox_recovery_actions TO warehouse_app;
GRANT SELECT, INSERT ON public.outbox_recovery_actions TO warehouse_outbox_admin;
GRANT EXECUTE ON FUNCTION public.reject_outbox_event_mutation() TO warehouse_outbox_admin;
--> statement-breakpoint
CREATE TRIGGER outbox_recovery_actions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.outbox_recovery_actions
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
--> statement-breakpoint
CREATE FUNCTION public.guard_outbox_retry_budget() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'Delivery attempts cannot decrease' USING ERRCODE='23514';
  END IF;
  IF NEW.retry_attempt_base IS DISTINCT FROM OLD.retry_attempt_base THEN
    IF NOT pg_has_role(current_user,'warehouse_outbox_admin','member') THEN
      RAISE EXCEPTION 'Administrative recovery role required' USING ERRCODE='42501';
    END IF;
    IF OLD.status <> 'dead' OR NEW.status <> 'retry' OR NEW.retry_attempt_base <> OLD.attempts OR NEW.attempts <> OLD.attempts THEN
      RAISE EXCEPTION 'Invalid administrative retry budget transition' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_outbox_retry_budget() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_outbox_retry_budget() TO warehouse_app, warehouse_outbox_admin;
--> statement-breakpoint
CREATE TRIGGER outbox_delivery_retry_budget BEFORE UPDATE ON public.outbox_deliveries
FOR EACH ROW EXECUTE FUNCTION public.guard_outbox_retry_budget();
