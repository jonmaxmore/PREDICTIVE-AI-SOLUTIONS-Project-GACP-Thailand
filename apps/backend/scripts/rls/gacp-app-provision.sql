-- gacp_app provisioning — RLS Phase 1 (role decouple). Policy STAYS SELECT TRUE.
-- Run by a SUPERUSER. Idempotent + re-runnable. Grants DML on ALL public base
-- tables (NOT an allow-list) + ALTER DEFAULT PRIVILEGES so future tables/sequences
-- auto-grant. Does NOT install the enforcing policy or FORCE RLS (Phase 2/3).
--
-- WHY ALL TABLES, NOT the RLS-enabled subset: the feasibility audit found the
-- prior prototype grant pattern (scripts/rls/prototype-staging-setup.sql,
-- staging-only) covers only the ~51 RLS-enabled tenant tables, but the app
-- touches ~103 public tables. Booting the app under a role restricted to the
-- RLS-enabled set would break on every non-RLS table it reads/writes. This
-- script grants DML on every public base table, independent of that flag.
--
-- RLS function signatures used below (VERIFIED against the live migrations
-- that define them — do not change without re-reading those files):
--   - rls_observe_check(table_name TEXT, row_org_id TEXT) RETURNS BOOLEAN
--     defined: prisma/migrations/20260429100100_rls_phase_e1_observe_only/migration.sql:62
--     live body (SELECT TRUE, IMMUTABLE): prisma/migrations/20260502060000_rls_quiet_observe_only/migration.sql:39-50
--   - current_tenant_id() RETURNS TEXT  (zero-arg)
--     defined: prisma/migrations/20260429100100_rls_phase_e1_observe_only/migration.sql:41
--   Neither signature has changed in any later migration (checked through
--   20260816161908_onsite_evidence_models, the latest at the time this script
--   was written); later migrations (20260702000000, 20260703000000) only
--   CALL rls_observe_check(table, org) for new tables, they don't redefine it.
--
-- MIGRATION-ROLE CAVEAT: ALTER DEFAULT PRIVILEGES only auto-grants tables
-- created by the role that RAN this script. If `prisma migrate deploy` runs
-- as a DIFFERENT role than the one that runs this provisioning, add
-- `FOR ROLE <migration_role>` to both ALTER DEFAULT PRIVILEGES statements
-- below. The Task-2 probe (gacp-app-coverage-probe.js) is the backstop that
-- catches any table the default-privileges missed. INTENDED to run in CI
-- after every migration — NOT yet wired to CI (Actions off since 2026-08-14);
-- run it by hand for now, per the cutover runbook.
--
-- RUN:  psql "$SUPERUSER_DATABASE_URL" -v apppw="$(openssl rand -hex 24)" \
--            -f apps/backend/scripts/rls/gacp-app-provision.sql
--       (capture apppw → it becomes gacp_app's DATABASE_URL, Task 3.)
\set ON_ERROR_STOP on
\if :{?apppw}
\else
  \echo '*** ABORT: pass the gacp_app password via -v apppw=... (openssl rand -hex 24). Never hardcode. ***'
  \quit
\endif

BEGIN;

-- 1. least-privilege login role (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gacp_app') THEN
    EXECUTE format('CREATE ROLE gacp_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'apppw');
  ELSE
    EXECUTE format('ALTER ROLE gacp_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', :'apppw');
    RAISE NOTICE 'gacp_app already existed — password reset, least-priv flags reasserted.';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO gacp_app;

-- 2. DML on EVERY public base table (NO relrowsecurity filter — the whole fix).
DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE c.relkind = 'r' AND ns.nspname = 'public'
    ORDER BY c.relname
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO gacp_app', r.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Granted DML on % public base tables to gacp_app.', n;
END $$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gacp_app;
GRANT EXECUTE ON FUNCTION rls_observe_check(TEXT, TEXT) TO gacp_app;
GRANT EXECUTE ON FUNCTION current_tenant_id() TO gacp_app;

-- 3. DRIFT-PROOF: future tables/sequences created by THIS (superuser/migration)
--    role auto-grant to gacp_app, so the coverage can never rot again.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gacp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gacp_app;

-- NOTE: the policy body stays SELECT TRUE (migration 20260502060000). NO enforcing
-- flip and no ALTER TABLE ... FORCE clause here — enforcement is Phase 2/3.
COMMIT;

DO $$ BEGIN RAISE NOTICE 'gacp_app provisioned (role + all-table grants + default privileges). Policy unchanged (SELECT TRUE). Now run the coverage probe.'; END $$;
