-- WMS-106: immutable envelope и отсутствие автоматического удаления до replay/retention policy.
-- warehouse_app — runtime group из WMS-103, не login; admin всё ещё может отключить triggers.
REVOKE ALL ON TABLE public.outbox_events, public.outbox_deliveries,
  public.delivery_streams, public.outbox_aggregate_sequences FROM PUBLIC, warehouse_app;
GRANT SELECT, INSERT ON TABLE public.outbox_events TO warehouse_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.outbox_deliveries,
  public.delivery_streams, public.outbox_aggregate_sequences TO warehouse_app;
--> statement-breakpoint
-- Запрещаем переписывание факта даже владельцу при обычном DML.
CREATE FUNCTION public.reject_outbox_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Outbox events are immutable' USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reject_outbox_event_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_outbox_event_mutation() TO warehouse_app;
--> statement-breakpoint
CREATE TRIGGER outbox_events_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.outbox_events
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
--> statement-breakpoint
-- Доставки, streams и counters также не удаляем: иначе теряются история и порядок.
-- UPDATE оставлен для выделения версии и будущего worker, но не является готовым claim protocol.
CREATE FUNCTION public.reject_outbox_retention_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Outbox retention deletion is not enabled' USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reject_outbox_retention_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_outbox_retention_delete() TO warehouse_app;
--> statement-breakpoint
CREATE TRIGGER outbox_deliveries_retained
BEFORE DELETE OR TRUNCATE ON public.outbox_deliveries
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_retention_delete();
--> statement-breakpoint
CREATE TRIGGER delivery_streams_retained
BEFORE DELETE OR TRUNCATE ON public.delivery_streams
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_retention_delete();
--> statement-breakpoint
CREATE TRIGGER outbox_aggregate_sequences_retained
BEFORE DELETE OR TRUNCATE ON public.outbox_aggregate_sequences
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_retention_delete();
