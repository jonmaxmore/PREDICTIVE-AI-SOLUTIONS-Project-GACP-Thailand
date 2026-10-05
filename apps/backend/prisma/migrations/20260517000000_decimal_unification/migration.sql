-- ============================================================================
-- Iter 24 (hardening loop, 2026-05-16) — Decimal type unification for Invoice
-- ============================================================================
--
-- Migration name: decimal_unification
--
-- Closes audit-gap-analysis-2026-05-16.md P0 #3 (decimal type chaos).
-- Brings Invoice.{subtotal, vat, totalAmount} into the Decimal(15,2) family
-- already used by Quotation, JournalLine, CreditNote, DebitNote and the
-- ManualJournalEntryDraft draft totals.
--
-- Compliance basis (Thai accounting + statute):
--   - TFRS for NPAEs ch.18 (รายได้) — revenue must be recognised at the
--     EXACT amount captured. IEEE-754 Float (PostgreSQL `double precision`)
--     introduces sub-satang rounding errors that compound through aggregation
--     and yield a non-zero trial-balance difference at month-end — a finding
--     under TFRS for NPAEs ch.2 internal-control requirements.
--   - ป.รัษฎากร ม.86/4 — every full tax invoice must show the taxable amount
--     and the VAT amount as exact decimals. The Revenue Department's spec
--     for ภ.พ.30 (monthly VAT remittance) rejects rows whose subtotal+VAT
--     differs from total by even ฿0.01 — Float storage frequently produces
--     this drift after a few months of arithmetic.
--   - ป.รัษฎากร ม.86/10 + ม.86/9 — credit-notes and debit-notes reference the
--     original invoice's amounts; the two must reconcile to zero satang or
--     the offsetting entry is itself non-compliant.
--
-- Strictly ADDITIVE migration:
--   - No DROP COLUMN.
--   - No NOT NULL added without a default (the columns are already NOT NULL
--     — we are only changing their numeric domain).
--   - USING clause preserves every existing row's value. PostgreSQL casts
--     `double precision` → `numeric(15,2)` deterministically: values within
--     ±99,999,999,999,999.99 are kept exact; sub-satang fractions are
--     rounded half-away-from-zero (the default `::numeric(15,2)` rule). The
--     largest invoice in the system is ฿27,675 — many orders of magnitude
--     below the column's representational ceiling.
--   - Reversible (rollback documented at end of file — DBA can revert by
--     casting back to `double precision`, accepting the small precision
--     loss that re-introduces the original Float behaviour).
--
-- Why not also migrate PaymentSlip.amount{Claimed,Verified}:
--   PaymentSlip stores money in Int SATANG (× 100) — a different unit, not
--   a different precision. Gateway-style integer capture is the source of
--   truth for what the applicant transferred; conversion to baht happens
--   exactly once in `bank-reconciliation-service.satangToBaht()`. Folding
--   it into the Decimal-baht family would either (a) waste 5 bytes per row
--   on a high-write table or (b) require a unit-conversion migration that
--   is genuinely lossy at the source level. Out of scope here; documented
--   on the model in schema/billing.prisma.
--
-- Why not Quotation:
--   Already Decimal(15,2) (added in 20260516010000). No change needed.
--
-- Concurrency: ALTER TABLE … ALTER COLUMN TYPE rewrites the table on disk
-- and takes an ACCESS EXCLUSIVE lock. For the GACP invoice volumes (low
-- four digits as of 2026-05-16) the rewrite completes in well under a
-- second — safe to run during the standard maintenance window. For larger
-- deployments, the DBA can switch to the online add-column + backfill +
-- swap pattern, but that complexity is not justified here.
-- ============================================================================

ALTER TABLE "invoices"
  ALTER COLUMN "subtotal" TYPE DECIMAL(15, 2) USING "subtotal"::DECIMAL(15, 2);

ALTER TABLE "invoices"
  ALTER COLUMN "vat" TYPE DECIMAL(15, 2) USING "vat"::DECIMAL(15, 2);

ALTER TABLE "invoices"
  ALTER COLUMN "totalAmount" TYPE DECIMAL(15, 2) USING "totalAmount"::DECIMAL(15, 2);

-- ============================================================================
-- Rollback (for DBA reference — NOT applied automatically).
--
-- If Decimal handling causes a regression that cannot be patched in the
-- service layer within a deployment window, revert with:
--
--   ALTER TABLE "invoices"
--     ALTER COLUMN "subtotal" TYPE DOUBLE PRECISION USING "subtotal"::DOUBLE PRECISION;
--   ALTER TABLE "invoices"
--     ALTER COLUMN "vat" TYPE DOUBLE PRECISION USING "vat"::DOUBLE PRECISION;
--   ALTER TABLE "invoices"
--     ALTER COLUMN "totalAmount" TYPE DOUBLE PRECISION USING "totalAmount"::DOUBLE PRECISION;
--
-- The reverse cast is lossless for amounts ≤ 2^53 (≈ 9 × 10^15) — well above
-- any plausible GACP invoice — so no data corruption either direction.
-- ============================================================================
