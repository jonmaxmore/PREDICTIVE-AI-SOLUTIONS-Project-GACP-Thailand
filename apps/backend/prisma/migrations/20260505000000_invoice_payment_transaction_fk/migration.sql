-- T-010 / Subtask 1 (a) — promote `invoices.paymentTransactionId` from a loose
-- scalar string into a proper foreign key referencing `payment_transactions.id`.
--
-- Why this matters
-- ----------------
-- Webhook reconciliation in
-- `apps/backend/services/payment-service-webhook-flow.js` joins Invoice ↔
-- PaymentTransaction by `paymentTransactionId`. Phase-2 #2.8
-- (20260428120000_add_phase2_indexes) already indexed the column for the
-- sequential-scan win, but referential integrity was still loose:
-- typos / orphaned ids never raised an error at INSERT time, so the
-- reconciliation job silently dropped rows whose pointer had been
-- orphaned by a transaction purge or a stale write race.
--
-- This migration closes that gap. Adding the FK lets Prisma generate
-- `include: { paymentTransaction: true }` reads (one query instead of
-- two), unblocks ON DELETE SET NULL semantics, and guarantees that any
-- new row's `paymentTransactionId` is either NULL or points to a real
-- transaction.
--
-- Pre-migration check (run on prod before applying — same protocol as
-- 20260306200000_add_unique_constraints_audit_m016_m017):
--
--   SELECT count(*) FROM "invoices" i
--   WHERE i."paymentTransactionId" IS NOT NULL
--     AND NOT EXISTS (
--       SELECT 1 FROM "payment_transactions" pt
--       WHERE pt."id" = i."paymentTransactionId"
--     );
--   → must be 0 before this migration applies (otherwise dedupe first)
--
-- ON DELETE SET NULL is the right call here:
--   - Deleting a payment transaction shouldn't cascade-delete the
--     invoice (legal-retention 7 years, see Invoice.retainUntil).
--   - Clearing the pointer makes the orphaned-link state explicit and
--     queryable instead of silently dangling.
-- ON UPDATE CASCADE follows Prisma's default for FK relations.
--
-- Idempotency note (matches 20260430200000_add_application_role_fks
-- pattern): the column has existed since the original Invoice model;
-- this migration only adds the constraint. We still wrap in a
-- DO $$ ... $$ guard so a re-run on a partially-migrated environment
-- (e.g., a developer who already added the FK by hand) is a no-op
-- instead of a "constraint already exists" error.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'invoices'
          AND constraint_name = 'invoices_paymentTransactionId_fkey'
          AND constraint_type = 'FOREIGN KEY'
    ) THEN
        ALTER TABLE "invoices"
        ADD CONSTRAINT "invoices_paymentTransactionId_fkey"
        FOREIGN KEY ("paymentTransactionId")
        REFERENCES "payment_transactions"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE;
    END IF;
END $$;
