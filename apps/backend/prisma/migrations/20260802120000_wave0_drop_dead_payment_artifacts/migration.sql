-- Wave 0 purge (docs/payment-refactor/legacy-payment-audit.md).
--
-- Drops the payment artifacts the audit confirmed dead with adversarial
-- verification — every one has ZERO production reads:
--
--   payment_audits          raw gateway-webhook payload store. No webhook
--                           route has been mounted since the 2026-04-29
--                           slip-flow cutover, so nothing ever wrote or read
--                           a row through the app (only the tenant-extension
--                           registration and a reset script referenced the
--                           model, never a query).
--   payment_reconciliations never written, never read, Float money columns
--                           (predates the Decimal(15,2) unification). NOT a
--                           base for the single-checkout remittance model —
--                           that arrives as new schema in Wave 1.
--   issuer_bank_accounts    seed-only writes, zero reads. The applicant
--                           "where do I transfer" surface reads the
--                           BankAccount model instead.
--
--   applications.phase1PaymentUrl / phase2PaymentUrl
--                           gateway-redirect URLs, DEPRECATED in-schema since
--                           the slip-flow cutover; zero code references.
--   applications.officialReceiptNumber
--                           orphan of a pre-slip-flow receipt design; real
--                           receipt numbers live on invoices.receiptNumber.
--
-- IF EXISTS guards make the migration idempotent and safe on shadow DBs.

DROP TABLE IF EXISTS "payment_audits";

DROP TABLE IF EXISTS "payment_reconciliations";

DROP TABLE IF EXISTS "issuer_bank_accounts";

ALTER TABLE "applications" DROP COLUMN IF EXISTS "phase1PaymentUrl";

ALTER TABLE "applications" DROP COLUMN IF EXISTS "phase2PaymentUrl";

ALTER TABLE "applications" DROP COLUMN IF EXISTS "officialReceiptNumber";
