-- =============================================================================
-- Quotation acceptance snapshot + charge binding (F-G4-64) — expand only.
-- Spec: design note 2026-08-28-quotation-acceptance-under-checkout-design §3.2
-- =============================================================================
--
-- WHY. Today the quotations table can prove that a row exists and that money
-- arrived, but not that a human agreed to a specific set of figures before it
-- did: acceptedAt is null on every row in the register (reports/research/
-- 2026-08-28-f-g4-64/register.md §B), and neither the API nor the PDF renders
-- the stored figures — both recompute at the current rate. These columns hold
-- the exact document the applicant saw at the second they pressed accept, the
-- sha256 over its canonical form, and the per-instalment invoiced stamps that
-- let INVOICED mean "every instalment on this quotation has been billed"
-- instead of "one of them has".
--
-- checkout_orders gains the other half of the binding: which quotation this
-- charge collects against, which snapshot the amount was checked against, and
-- the payment-terms disclosure version and instant (Q4, owner ruling
-- 2026-07-08) which until now existed on the slip rail only.
--
-- EXPAND ONLY. Nine ADDED nullable columns and one index. Nothing is dropped,
-- renamed, retyped or backfilled: every existing row keeps meaning what it
-- meant (NULL = this happened before the gate existed, which is the truth).
-- ADD COLUMN with no default takes no table rewrite on PostgreSQL 11+.
--
-- The repair of the two pre-gate rows is deliberately NOT here: it is a data
-- decision with an operator-run script (apps/backend/scripts/
-- close-quotations-settled-before-gate.js --apply --expect=2), not DDL.
--
-- This SQL ships in the same change as prisma/schema/billing.prisma because
-- CI's migration-drift-check diffs the migration chain against the schema;
-- either half landing alone turns that required gate red.
-- -----------------------------------------------------------------------------

ALTER TABLE "quotations" ADD COLUMN "acceptedSnapshot" JSONB;
ALTER TABLE "quotations" ADD COLUMN "acceptedSnapshotHash" TEXT;
ALTER TABLE "quotations" ADD COLUMN "acceptedBy" TEXT;
ALTER TABLE "quotations" ADD COLUMN "phase1InvoicedAt" TIMESTAMP(3);
ALTER TABLE "quotations" ADD COLUMN "phase2InvoicedAt" TIMESTAMP(3);

ALTER TABLE "checkout_orders" ADD COLUMN "quotation_id" UUID;
ALTER TABLE "checkout_orders" ADD COLUMN "quotation_snapshot_hash" TEXT;
ALTER TABLE "checkout_orders" ADD COLUMN "payment_terms_version" TEXT;
ALTER TABLE "checkout_orders" ADD COLUMN "payment_terms_accepted_at" TIMESTAMP(3);

-- Settlement looks the quotation up by this column (recordPhaseInvoiced), and
-- the closure probe scans SETTLED orders by it. UUID, not TEXT: quotations.id
-- is uuid, and a text column cannot be joined against it.
CREATE INDEX "checkout_orders_quotation_id_idx" ON "checkout_orders"("quotation_id");

-- -----------------------------------------------------------------------------
-- Idempotency of issuance, enforced by the database (F-G4-64 fix round 1).
--
-- The design says "issuing a quotation is idempotent on (applicationId,
-- issuerType)". Until this line it was only ever a findMany followed by a
-- create in two separate implicit transactions:
-- @@index([applicationId, issuerType]) is a PLAIN index and the only unique
-- constraint on the table is quotationNumber. Two concurrent callers therefore
-- both read zero rows and both inserted — two PENDING quotations for one
-- application and two numbers burned off the QT-PRD legal sequence, with
-- findQuotationsByApplicationId (orderBy createdAt asc) showing only the older
-- one, so the second is invisible to the API and to the gate but fully present
-- in every accounting query.
--
-- That was survivable while the only callers were the once-per-lifecycle submit
-- doors. The controlled self-heal puts the same write behind GET
-- /api/applications/:id/quotations, which the payments page, the quotation slot
-- and the refresh button all hit.
--
-- PARTIAL, on WHERE "isDeleted" = false, for two reasons: a soft-deleted
-- quotation must never block a legitimate re-issue, and pre-W14 applications
-- legitimately carry a PAIR of live rows (one DTAM + one PLATFORM) which this
-- shape admits because they differ in "issuerType".
--
-- Prisma's schema language cannot express a partial unique index, so this is
-- the only place it exists; prisma/schema/billing.prisma carries a comment on
-- the Quotation model pointing here.
--
-- BEFORE `prisma migrate deploy` — this statement FAILS LOUDLY if the table
-- already holds a duplicate produced by the race it closes. That is the correct
-- outcome (a duplicate priced document is a decision, not a rounding error), so
-- check first and let the operator decide which row survives:
--   SELECT "applicationId", "issuerType", count(*)
--     FROM "quotations" WHERE "isDeleted" = false
--    GROUP BY 1, 2 HAVING count(*) > 1;
CREATE UNIQUE INDEX "quotations_application_issuer_live_uq"
    ON "quotations" ("applicationId", "issuerType")
    WHERE "isDeleted" = false;
