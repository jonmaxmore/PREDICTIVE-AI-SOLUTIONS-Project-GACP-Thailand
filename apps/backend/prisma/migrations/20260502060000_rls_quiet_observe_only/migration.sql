-- ============================================================================
-- ADR-014 Phase E.1.1 — Quiet rls_observe_check (no behavior change)
--
-- Background:
--   Phase E.1 (deployed 2026-04-29 + 2026-04-30 across ~50 tenant tables)
--   installed an RLS policy that always returns TRUE (permissive) and
--   RAISE NOTICEs when `app.tenant_id` is unset or doesn't match the row.
--   The original plan: 7 days of zero notices → flip to RESTRICTIVE in
--   Phase E.2.
--
--   Investigation 2026-05-02: nothing in the application sets
--   `app.tenant_id`. With Postgres connection pooling (Prisma
--   default-pool of 20), neither transaction-local set_config nor
--   session-level set_config can reach "zero notices" without one of:
--     a) wrapping every request in a single $transaction (major refactor),
--     b) pgbouncer in transaction-mode (infra change),
--     c) pinning a connection to a tenant for the request lifetime.
--
--   None of those is in scope for an autonomous PR. Until the team
--   decides which path to take, the observation signal is unactionable
--   noise — every query logs a NOTICE, drowning out anything ops would
--   want to see.
--
-- This migration:
--   Replaces rls_observe_check() with a silent equivalent that returns
--   TRUE without RAISE NOTICE. The RLS infrastructure (ENABLE ROW LEVEL
--   SECURITY + the per-table policies) is left in place so Phase E.2 can
--   build on it once the wiring approach is decided.
--
--   Functional change to data: none. Policy still permissive, queries
--   still pass. The only delta is fewer log lines.
--
-- Rollback (re-enable observation logging):
--   Re-run the function definition from migration
--   20260429100100_rls_phase_e1_observe_only — that file has the noisy
--   PLPGSQL version verbatim.
-- ============================================================================

CREATE OR REPLACE FUNCTION rls_observe_check(table_name TEXT, row_org_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    -- Phase E.1.1: silent permissive. Keep the parameters so existing
    -- per-table policies (defined in 20260429100100_* and 20260430130000_*)
    -- don't have to be redefined; PostgreSQL just skips into the SQL body.
    -- IMMUTABLE is safe here because the body is a constant — the planner
    -- can fold the policy entirely.
    SELECT TRUE;
$$;

COMMENT ON FUNCTION rls_observe_check(TEXT, TEXT) IS
    'Phase E.1.1 silent permissive RLS check. Always returns true. RAISE NOTICE removed pending architectural decision on tenant-id wiring (transaction-per-request / pgbouncer / connection-pinning). When Phase E.2 lands, this function will be replaced with a strict equality check on app.tenant_id and the policies will become enforcing.';
