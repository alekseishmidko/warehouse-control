-- WMS-109: processed markers append-only, consumer cursors retained/monotonic.
-- Политика replay ещё не разрешает удаление markers: забытый marker повторит эффект.
REVOKE ALL ON TABLE public.processed_events, public.consumer_streams FROM PUBLIC, warehouse_app;
GRANT SELECT, INSERT ON TABLE public.processed_events TO warehouse_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.consumer_streams TO warehouse_app;
--> statement-breakpoint
CREATE TRIGGER processed_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.processed_events
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
--> statement-breakpoint
CREATE TRIGGER consumer_streams_retained BEFORE DELETE OR TRUNCATE ON public.consumer_streams
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_retention_delete();
--> statement-breakpoint
CREATE FUNCTION public.guard_consumer_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.consumer_name IS DISTINCT FROM OLD.consumer_name OR NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type
    OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id OR NEW.last_processed_version < OLD.last_processed_version THEN
    RAISE EXCEPTION 'Consumer identity/cursor cannot go backwards' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_consumer_cursor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_consumer_cursor() TO warehouse_app;
--> statement-breakpoint
CREATE TRIGGER consumer_streams_monotonic BEFORE UPDATE ON public.consumer_streams
FOR EACH ROW EXECUTE FUNCTION public.guard_consumer_cursor();
