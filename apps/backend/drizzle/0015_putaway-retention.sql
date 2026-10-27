-- WMS-110: задачи первого сценария pending и immutable, execution/retention потребуют новых migrations.
REVOKE ALL ON TABLE public.putaway_tasks FROM PUBLIC, warehouse_app;
GRANT SELECT, INSERT ON TABLE public.putaway_tasks TO warehouse_app;
--> statement-breakpoint
-- Переиспользуем existing immutable guard; его сообщение не является публичным API.
CREATE TRIGGER putaway_tasks_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.putaway_tasks
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_outbox_event_mutation();
