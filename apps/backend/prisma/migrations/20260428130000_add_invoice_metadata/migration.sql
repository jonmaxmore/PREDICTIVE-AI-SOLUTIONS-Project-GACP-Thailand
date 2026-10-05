-- ============================================================================
-- Add nullable `metadata Json?` column to `invoices`.
--
-- The hold/release endpoints in
-- apps/backend/services/invoice/invoice-finance-ops.js read and write
-- invoice.metadata (JSON) to track holdInfo (previousStatus, reason, heldBy,
-- heldAt). The schema had no such column — POST /api/invoices/:id/hold and
-- POST /api/invoices/:id/release threw P2009 / unknown-column at runtime.
--
-- This migration is purely additive: the column is nullable, so it can land
-- on production without operator intervention beyond `prisma migrate deploy`.
-- No backfill is needed; existing invoices simply have NULL metadata.
--
-- Refs: P0-7 in 2026-04-28 system cohesion audit
-- ============================================================================

ALTER TABLE "invoices" ADD COLUMN "metadata" JSONB;
