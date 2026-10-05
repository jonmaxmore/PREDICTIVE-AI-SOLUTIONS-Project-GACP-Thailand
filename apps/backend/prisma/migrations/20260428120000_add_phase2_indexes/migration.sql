-- ============================================================================
-- Phase 2 #2.8 — add indexes on common query paths.
--
-- Two columns are read on the request path but were unindexed:
--
--   applications.rejectCount
--     Read by the provider list endpoint
--     (apps/backend/routes/api/provider/applications.js:160) to render
--     the "Submission #N" badge. With several thousand applications and
--     a non-trivial reject distribution, the unindexed scan was already
--     visible in pg_stat_statements.
--
--   invoices.paymentTransactionId
--     Joined with payment_transactions on every webhook hit
--     (apps/backend/services/payment-service-webhook-flow.js, the
--     reconciliation jobs in apps/backend/jobs/sla-*). The FK column was
--     not indexed at all — every webhook caused a sequential scan on the
--     invoices table.
--
-- CONCURRENTLY would be ideal but Prisma's migrate runner wraps each
-- migration in a transaction, which forbids CREATE INDEX CONCURRENTLY.
-- Both indexes are small (single column) and the tables involved are
-- modest in size; a brief lock on `applications` and `invoices` during
-- deploy is acceptable. If either table grows past ~1M rows, the
-- recommendation is to drop the index then recreate it CONCURRENTLY in a
-- separate maintenance window.
-- ============================================================================

CREATE INDEX IF NOT EXISTS "applications_rejectCount_idx"
    ON "applications"("rejectCount");

CREATE INDEX IF NOT EXISTS "invoices_paymentTransactionId_idx"
    ON "invoices"("paymentTransactionId");
