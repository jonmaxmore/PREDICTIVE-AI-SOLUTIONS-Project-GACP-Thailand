-- ============================================================================
-- ADR-014 Phase E.2 — RLS ENFORCEMENT MECHANISM PROTOTYPE (staging-only drill)
--
--   ████ STAGING-ONLY. DO NOT RUN AGAINST PRODUCTION (gacp_db). ████
--   This script is the SQL half of a *drill* whose only purpose is to PROVE,
--   on gacp_staging, that the CORRECTED bound-query batch pattern actually
--   enforces row-level security WITHOUT pgbouncer. Prod enforcement is
--   owner + org-#2-gated (see ADR-014-phase-e2-rls-decision.md).
--
-- WHY THIS EXISTS
--   ADR-014 Phase E.1 enabled RLS on ~52 tenant tables in OBSERVE-ONLY mode:
--   the policy calls rls_observe_check(table_name, row_org_id) whose live body
--   (migration 20260502060000_rls_quiet_observe_only) is `SELECT TRUE` — it
--   enforces nothing. The app role `gacp` is additionally SUPERUSER + BYPASSRLS,
--   so even a non-permissive policy would be ignored. To prove enforcement we
--   must (a) install an ENFORCING function body and (b) connect as a NON-super,
--   NON-bypassrls role. This script does both, against staging only.
--
-- WHAT THIS SCRIPT DOES (all reversible — see REVERT block at the bottom)
--   1. Creates a least-privilege login role  gacp_app  (NOSUPERUSER NOBYPASSRLS)
--      with a password supplied via the psql variable :apppw (NEVER hardcoded).
--   2. Grants gacp_app exactly SELECT/INSERT/UPDATE/DELETE on every RLS-enabled
--      tenant table + USAGE,SELECT on their sequences + USAGE on schema public,
--      generated dynamically from pg_class WHERE relrowsecurity.
--   3. Replaces rls_observe_check() with an ENFORCING body that returns TRUE
--      only when app.rls_bypass='on' OR row_org_id = current_setting('app.tenant_id').
--      STABLE (not IMMUTABLE) so the planner does not constant-fold the policy.
--   4. FORCEs RLS on the probe table (applications) so even the table OWNER is
--      subject to the policy — an owner-defence test.
--
-- EXACT SHAPES (read from the live migrations — DO NOT change without re-reading):
--   - fn signature   : rls_observe_check(table_name TEXT, row_org_id TEXT) RETURNS BOOLEAN
--                      (20260429100100_rls_phase_e1_observe_only/migration.sql:62)
--   - per-table policy: FOR ALL TO PUBLIC
--                       USING (rls_observe_check('<table>', "organizationId"))
--                       WITH CHECK (rls_observe_check('<table>', "organizationId"))
--                      (same migration, lines 88-92; extended to all tables in
--                       20260430130000_*/migration.sql:91-95)
--   - live prod body : SELECT TRUE  (IMMUTABLE) — 20260502060000_*/migration.sql:39-50
--   - GUC names      : app.tenant_id (tenant) + app.rls_bypass (withoutTenantScope)
--
-- HOW TO RUN (staging container or psql with network access to gacp-postgres):
--   psql "$STAGING_SUPERUSER_DATABASE_URL" \
--        -v apppw="$(openssl rand -hex 24)" \
--        -f apps/backend/scripts/rls/prototype-staging-setup.sql
--   (capture the apppw you passed — the probe needs it in GACP_APP_DATABASE_URL.)
--
-- After the probe matrix passes, run the REVERT block at the bottom of this file
-- to restore the permissive `SELECT TRUE` body, revoke grants, and drop the role.
-- ============================================================================

\set ON_ERROR_STOP on

-- Refuse to run unless a password var was supplied. \set'ing a default to a
-- sentinel and checking it keeps a real secret out of the file and out of git.
\if :{?apppw}
\else
  \echo '*** ABORT: pass the gacp_app password via  -v apppw=...  (e.g. openssl rand -hex 24). Never hardcode it. ***'
  \quit
\endif

-- Defence in depth: never let this drill touch the prod DB by name.
DO $$
BEGIN
    IF current_database() = 'gacp_db' THEN
        RAISE EXCEPTION 'REFUSING TO RUN: current_database() = gacp_db (production). This drill is staging-only.';
    END IF;
END
$$;

BEGIN;

-- ── 1. least-privilege role ─────────────────────────────────────────────────
-- LOGIN so the probe can connect as it. NOSUPERUSER + NOBYPASSRLS is the whole
-- point: the live `gacp` role is SUPERUSER+BYPASSRLS and would ignore every
-- policy, so enforcement can only be demonstrated through a constrained role.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gacp_app') THEN
        -- Password is injected by psql from :apppw; format()'s %L quotes it as a
        -- string literal. The literal is interpolated by psql BEFORE the DO body
        -- is sent, so quote it for the DO string here.
        EXECUTE format('CREATE ROLE gacp_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'apppw');
    ELSE
        EXECUTE format('ALTER ROLE gacp_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', :'apppw');
        RAISE NOTICE 'gacp_app already existed — password reset, flags reasserted.';
    END IF;
END
$$;

-- ── 2. grants on every RLS-enabled tenant table (dynamic) ───────────────────
-- relrowsecurity = true is exactly the set Phase E.1 enabled RLS on (~52 tables).
-- We grant DML + sequence usage + schema usage so the probe can read/insert.
GRANT USAGE ON SCHEMA public TO gacp_app;

DO $$
DECLARE
    r RECORD;
    n INT := 0;
BEGIN
    FOR r IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND c.relrowsecurity = true
          AND ns.nspname = 'public'
        ORDER BY c.relname
    LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO gacp_app', r.relname);
        n := n + 1;
    END LOOP;
    RAISE NOTICE 'Granted DML on % RLS-enabled tenant tables to gacp_app.', n;
END
$$;

-- Sequences backing those tables (serial/identity PKs and any seq-defaulted cols).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gacp_app;

-- gacp_app must also be able to call the policy function (it is SECURITY INVOKER
-- by default; EXECUTE is granted to PUBLIC for SQL functions, but assert it).
GRANT EXECUTE ON FUNCTION rls_observe_check(TEXT, TEXT) TO gacp_app;
GRANT EXECUTE ON FUNCTION current_tenant_id() TO gacp_app;

-- ── 3. ENFORCING function body (the actual flip) ────────────────────────────
-- Same signature + name the live per-table policies already call, so NO policy
-- has to be redefined — CREATE OR REPLACE swaps only the body. Enforcing rule:
--   allow row iff  app.rls_bypass = 'on'  (withoutTenantScope escape hatch)
--                  OR  row_org_id = current_setting('app.tenant_id', true)
-- current_setting(..., true) → NULL when the GUC is unset (no exception), so a
-- session that never set app.tenant_id matches nothing → fail-closed (0 rows).
-- STABLE (not IMMUTABLE): the body reads session GUCs, so it must be re-evaluated
-- per row/session — IMMUTABLE would let the planner constant-fold it and the
-- policy would stop reflecting the live GUC.
CREATE OR REPLACE FUNCTION rls_observe_check(table_name TEXT, row_org_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT
        coalesce(current_setting('app.rls_bypass', true), '') = 'on'
        OR row_org_id = current_setting('app.tenant_id', true);
$$;

COMMENT ON FUNCTION rls_observe_check(TEXT, TEXT) IS
    'PROTOTYPE (staging drill) ENFORCING RLS check: TRUE iff app.rls_bypass=on OR row_org_id = app.tenant_id. STABLE so the planner does not fold it. Revert to SELECT TRUE (20260502060000) after the drill.';

-- ── 4. FORCE RLS on the probe table (owner-defence test) ────────────────────
-- ENABLE RLS exempts the table OWNER; FORCE makes even the owner subject to the
-- policy. The probe connects as gacp_app (not owner) so this is belt-and-braces,
-- but it proves the owner cannot side-step the policy either.
ALTER TABLE public.applications FORCE ROW LEVEL SECURITY;

COMMIT;

DO $$
BEGIN
    RAISE NOTICE '────────────────────────────────────────────────────────────';
    RAISE NOTICE 'PROTOTYPE ENFORCING RLS installed on STAGING.';
    RAISE NOTICE 'Now run the probe as gacp_app:';
    RAISE NOTICE '  GACP_APP_DATABASE_URL=postgres://gacp_app:<apppw>@<host>:5432/%  node prototype-probe.js', current_database();
    RAISE NOTICE 'When done, run the REVERT block at the bottom of this file.';
    RAISE NOTICE '────────────────────────────────────────────────────────────';
END
$$;


-- ============================================================================
-- ████████████████████████████  REVERT BLOCK  ███████████████████████████████
--
-- Run this AFTER the drill to restore the staging DB to its pre-drill state:
--   (1) restore the permissive `SELECT TRUE` IMMUTABLE body (matches live prod —
--       migration 20260502060000_rls_quiet_observe_only/migration.sql:39-50),
--   (2) un-FORCE RLS on applications (back to plain ENABLE, owner-exempt),
--   (3) revoke all grants + drop the gacp_app role.
--
-- To run ONLY the revert (skipping setup): copy everything below this banner
-- into psql, or invoke:  psql "$URL" -f - <<'EOF'  ... EOF
-- The statements are idempotent (IF EXISTS / OR REPLACE).
-- ============================================================================
-- BEGIN;
--
-- -- (1) restore permissive body — verbatim shape of the live prod function.
-- CREATE OR REPLACE FUNCTION rls_observe_check(table_name TEXT, row_org_id TEXT)
-- RETURNS BOOLEAN
-- LANGUAGE sql
-- IMMUTABLE
-- AS $$
--     SELECT TRUE;
-- $$;
-- COMMENT ON FUNCTION rls_observe_check(TEXT, TEXT) IS
--     'Phase E.1.1 silent permissive RLS check. Always returns true.';
--
-- -- (2) un-FORCE the probe table (ENABLE stays; matches Phase E.1 baseline).
-- ALTER TABLE public.applications NO FORCE ROW LEVEL SECURITY;
--
-- -- (3) tear down the drill role + its grants.
-- DO $$
-- DECLARE r RECORD;
-- BEGIN
--     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gacp_app') THEN
--         FOR r IN
--             SELECT c.relname FROM pg_class c
--             JOIN pg_namespace ns ON ns.oid = c.relnamespace
--             WHERE c.relkind='r' AND c.relrowsecurity=true AND ns.nspname='public'
--         LOOP
--             EXECUTE format('REVOKE ALL ON TABLE public.%I FROM gacp_app', r.relname);
--         END LOOP;
--         REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM gacp_app;
--         REVOKE ALL ON SCHEMA public FROM gacp_app;
--         REVOKE EXECUTE ON FUNCTION rls_observe_check(TEXT, TEXT) FROM gacp_app;
--         REVOKE EXECUTE ON FUNCTION current_tenant_id() FROM gacp_app;
--         DROP ROLE gacp_app;
--         RAISE NOTICE 'gacp_app revoked + dropped.';
--     END IF;
-- END
-- $$;
--
-- COMMIT;
-- ============================================================================
