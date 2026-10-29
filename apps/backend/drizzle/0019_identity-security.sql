-- WMS-202: runtime и локальный bootstrap имеют разные capabilities; пароли/login не provision-ятся миграцией.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='warehouse_identity_bootstrap') THEN
    CREATE ROLE warehouse_identity_bootstrap NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO warehouse_identity_bootstrap;
GRANT SELECT, INSERT, UPDATE ON users, sessions, auth_login_windows TO warehouse_app;
GRANT SELECT, INSERT, DELETE ON warehouse_roles TO warehouse_app;
GRANT SELECT ON identity_bootstrap TO warehouse_app;
GRANT SELECT, INSERT ON identity_bootstrap, users, audit_entries TO warehouse_identity_bootstrap;
--> statement-breakpoint
-- Маркер никогда не удаляется runtime; DBA может обойти trigger, это не криптографическая защита.
CREATE FUNCTION retain_identity_bootstrap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Identity bootstrap marker is retained' USING ERRCODE='42501'; END $$;
--> statement-breakpoint
CREATE TRIGGER identity_bootstrap_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON identity_bootstrap
FOR EACH STATEMENT EXECUTE FUNCTION retain_identity_bootstrap();
