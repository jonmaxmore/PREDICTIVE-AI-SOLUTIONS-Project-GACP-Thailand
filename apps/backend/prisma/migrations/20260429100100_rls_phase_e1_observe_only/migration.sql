-- ============================================================================
-- ADR-014 Phase E.1 — Postgres Row-Level Security in OBSERVE-ONLY mode
-- (operator decision ค: option (c) soft-rollout 1-week observe → flip)
--
-- This migration:
--   1. Enables RLS on the 5 highest-risk tenant-scoped tables.
--   2. Installs a PERMISSIVE policy that always returns true (does NOT
--      block any query) but RAISES NOTICE when it fires from a session
--      that hasn't set `app.tenant_id`. The notice goes to Postgres logs
--      where ops can grep for it.
--   3. Defers any RESTRICTIVE policy (the actual enforcement) to a
--      follow-up migration once the observation window confirms every
--      query path sets `app.tenant_id` correctly.
--
-- The 5 tables chosen: applications, invoices, certificates,
-- payment_transactions, audit_logs. They cover the cross-tenant blast
-- radius (a leaked invoice or cert is the worst-case for a Thai gov
-- system).
--
-- After deploy, ops watches `/var/log/gacp-deploys/*.log` plus the
-- backend container's stdout for `RLS-OBSERVE` notices. Each notice
-- identifies a query that lacks tenant context. Once the count is zero
-- for 7 days, Phase E.2 swaps PERMISSIVE for RESTRICTIVE and the
-- policies start enforcing.
--
-- Rollback:
--   ALTER TABLE "x" DISABLE ROW LEVEL SECURITY;
--   DROP POLICY "x_observe_tenant" ON "x";
--
-- Idempotency:
--   ENABLE ROW LEVEL SECURITY is idempotent. Policies are CREATEd with
--   the same names so re-running this migration WILL ERROR (Prisma
--   migrate handles that — the migrations table tracks applied state).
--   For manual re-runs, drop the policies first.
-- ============================================================================

-- ── Helper: tenant-context lookup ───────────────────────────────────
-- Reads `current_setting('app.tenant_id', true)`. The `true` second arg
-- means "missing setting returns NULL instead of error" so unset
-- sessions are caught by the policy logic, not by an exception.
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
    SELECT NULLIF(current_setting('app.tenant_id', true), '');
$$;

COMMENT ON FUNCTION current_tenant_id() IS
    'Returns the current session tenant id from app.tenant_id GUC, or NULL if unset. Used by Phase E RLS policies.';

-- ── Observe-only policy template ────────────────────────────────────
-- The policy ALWAYS returns true (permissive). When the session lacks
-- a tenant id, it raises a NOTICE so ops can identify the offending
-- code path during the soft-rollout week. Notices do not interrupt
-- queries.
--
-- Why a function-per-policy: Postgres POLICY USING expressions don't
-- support side effects directly, so we wrap the side effect in a
-- function the policy calls.

CREATE OR REPLACE FUNCTION rls_observe_check(table_name TEXT, row_org_id TEXT)
RETURNS BOOLEAN
LANGUAGE PLPGSQL
STABLE
AS $$
DECLARE
    session_tenant TEXT := current_tenant_id();
BEGIN
    IF session_tenant IS NULL THEN
        RAISE NOTICE 'RLS-OBSERVE: % accessed without app.tenant_id (row.organizationId = %)', table_name, row_org_id;
    ELSIF session_tenant <> row_org_id THEN
        RAISE NOTICE 'RLS-OBSERVE: % cross-tenant access — session=%, row=%', table_name, session_tenant, row_org_id;
    END IF;
    -- Permissive: always allow. Phase E.2 will replace this with strict equality.
    RETURN TRUE;
END
$$;

COMMENT ON FUNCTION rls_observe_check(TEXT, TEXT) IS
    'Phase E.1 observe-only RLS check. Always returns true; raises NOTICE on cross-tenant or missing-context. Replace with strict equality in Phase E.2.';

-- ── Apply RLS + observe-only policy on the 5 highest-risk tables ────

-- 1. applications
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "applications_observe_tenant" ON "applications";
CREATE POLICY "applications_observe_tenant" ON "applications"
    FOR ALL
    TO PUBLIC
    USING (rls_observe_check('applications', "organizationId"))
    WITH CHECK (rls_observe_check('applications', "organizationId"));

-- 2. invoices
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoices_observe_tenant" ON "invoices";
CREATE POLICY "invoices_observe_tenant" ON "invoices"
    FOR ALL
    TO PUBLIC
    USING (rls_observe_check('invoices', "organizationId"))
    WITH CHECK (rls_observe_check('invoices', "organizationId"));

-- 3. certificates
ALTER TABLE "certificates" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "certificates_observe_tenant" ON "certificates";
CREATE POLICY "certificates_observe_tenant" ON "certificates"
    FOR ALL
    TO PUBLIC
    USING (rls_observe_check('certificates', "organizationId"))
    WITH CHECK (rls_observe_check('certificates', "organizationId"));

-- 4. payment_transactions
ALTER TABLE "payment_transactions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_transactions_observe_tenant" ON "payment_transactions";
CREATE POLICY "payment_transactions_observe_tenant" ON "payment_transactions"
    FOR ALL
    TO PUBLIC
    USING (rls_observe_check('payment_transactions', "organizationId"))
    WITH CHECK (rls_observe_check('payment_transactions', "organizationId"));

-- 5. audit_logs
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_logs_observe_tenant" ON "audit_logs";
CREATE POLICY "audit_logs_observe_tenant" ON "audit_logs"
    FOR ALL
    TO PUBLIC
    USING (rls_observe_check('audit_logs', "organizationId"))
    WITH CHECK (rls_observe_check('audit_logs', "organizationId"));

-- ── Operational note ────────────────────────────────────────────────
DO $$
BEGIN
    RAISE NOTICE 'ADR-014 Phase E.1 deployed: RLS in OBSERVE-ONLY mode on 5 critical tables.';
    RAISE NOTICE 'Watch backend stdout / Postgres logs for "RLS-OBSERVE:" notices.';
    RAISE NOTICE 'Phase E.2 (flip permissive → restrictive) requires 7 days of zero notices before flipping.';
END
$$;
