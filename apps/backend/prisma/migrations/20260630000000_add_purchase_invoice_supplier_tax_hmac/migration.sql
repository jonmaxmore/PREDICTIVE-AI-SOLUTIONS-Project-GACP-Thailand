-- ============================================================================
-- PDPA close-natid-round2 — PurchaseInvoice.supplierTaxId keyed-HMAC lookup
-- + swap the dedup UNIQUE off the (about-to-be-encrypted) plaintext column.
-- ============================================================================
--
-- Migration name: add_purchase_invoice_supplier_tax_hmac
-- RFC anchor: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md
--             (ROUND-2 gap-close: PurchaseInvoice.supplierTaxId is a plaintext
--              13-digit Thai TIN — the same national-ID class the codebase
--              already encrypts on User.taxId / Entity.juristicId — and it sat
--              dump-readable in `purchase_invoices` with no encrypt hook.)
--
-- ROUND-2 encrypts `purchase_invoices.supplierTaxId` at rest with random-IV
-- AES-256-GCM (via services/prisma-pdpa-extension.js PURCHASE_INVOICE_PII_COLUMNS).
-- A random-IV ciphertext column CANNOT carry a useful UNIQUE (the same TIN
-- encrypts to a different value on every write, so the constraint never trips
-- on a real duplicate) and cannot be raw-WHERE'd for the ม.86/4 double-claim
-- dedup. This migration therefore mirrors the EXACT precedent every other
-- encrypted national-ID column uses (User.*Hmac, Entity.thaiCitizenIdHmac):
--
--   1. ADD a NULLABLE keyed-HMAC lookup column `supplierTaxIdHmac`
--      (computeLookupHmac(supplierTaxId), keyed off ENCRYPTION_KEY).
--   2. ADD the dedup UNIQUE on (supplierTaxIdHmac, invoiceNumber).
--   3. DROP the now-meaningless plaintext UNIQUE (supplierTaxId, invoiceNumber).
--
-- The dedup invariant (a supplier cannot issue duplicate invoice numbers for
-- the same TIN) is preserved — it just keys off the deterministic HMAC now.
--
-- ## Why this is SAFE / INERT until the backfill + flag
--   * `supplierTaxIdHmac` is NULLABLE — no backfill required for the migration
--     to apply, no row is touched, no DEFAULT.
--   * The new UNIQUE is partial-by-nature (Postgres treats multiple NULLs as
--     distinct), so the all-NULL column carries NO uniqueness pressure on
--     un-backfilled rows during the backfill window.
--   * purchase-invoice-service.js writes `supplierTaxIdHmac` on every NEW
--     create from this image onward and dedups by it. The encrypt of the
--     plaintext column is gated by ENABLE_PDPA_FIELD_ENCRYPTION (already ON in
--     prod/staging from STAGE B) — new writes encrypt + HMAC together.
--   * Legacy rows: scripts/pdpa/backfill-encrypt-formdata-pii.js encrypts the
--     plaintext column AND populates supplierTaxIdHmac in the same pass
--     (idempotent, batched, --dry-run first on staging).
--
-- Order matters: ADD the HMAC unique BEFORE dropping the plaintext unique so
-- the dedup invariant is never momentarily unguarded for in-flight writes. Both
-- are IF EXISTS / standard ADD, idempotent + safe to re-run. Dropping a UNIQUE
-- never fails on existing data.
--
-- Additive-safe to apply. Run with `prisma migrate deploy`. The backfill is a
-- SEPARATE, explicitly-run script — NOT part of this migration. First live run
-- MUST be a `--dry-run` on staging (golden rule #2 / #7).
-- ============================================================================

-- 1. Keyed-HMAC lookup column.
ALTER TABLE "purchase_invoices" ADD COLUMN "supplierTaxIdHmac" TEXT;

-- 2. New dedup UNIQUE on the keyed HMAC (added BEFORE the plaintext drop).
CREATE UNIQUE INDEX "purchase_invoices_supplier_tax_hmac_invnum_key"
    ON "purchase_invoices"("supplierTaxIdHmac", "invoiceNumber");

-- 3. Drop the now-meaningless plaintext UNIQUE. The original was created via
--    Prisma `@@unique(..., map: "purchase_invoices_supplier_tax_invnum_key")`,
--    which in Postgres is a UNIQUE *constraint* backed by an index of the same
--    name. DROP CONSTRAINT IF EXISTS first (removes the backing index too),
--    then DROP INDEX IF EXISTS as a fallback for environments where it exists
--    as a bare index. Both IF EXISTS → idempotent + a no-op if already absent.
ALTER TABLE "purchase_invoices" DROP CONSTRAINT IF EXISTS "purchase_invoices_supplier_tax_invnum_key";
DROP INDEX IF EXISTS "purchase_invoices_supplier_tax_invnum_key";
