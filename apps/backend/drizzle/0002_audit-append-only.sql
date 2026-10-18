-- WMS-103: append-only audit и runtime permission group. Новая custom migration;
-- нужна migration-роль с CREATEROLE или заранее подготовленная безопасная группа.
-- Администратор/владелец БД может изменить grants/trigger: tamper-proof гарантии нет.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'warehouse_app') THEN
    CREATE ROLE warehouse_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'warehouse_app'
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolcanlogin)
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
    WHERE r.rolname = 'warehouse_app'
  ) THEN
    RAISE EXCEPTION 'warehouse_app must be an unprivileged NOLOGIN permission group';
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON TABLE public.audit_entries FROM PUBLIC, warehouse_app;
GRANT USAGE ON SCHEMA public TO warehouse_app;
GRANT SELECT, INSERT ON TABLE public.audit_entries TO warehouse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.application_metadata TO warehouse_app;
--> statement-breakpoint
CREATE FUNCTION public.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit entries are append-only' USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reject_audit_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_audit_mutation() TO warehouse_app;
--> statement-breakpoint
CREATE TRIGGER audit_entries_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.audit_entries
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
