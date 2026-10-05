-- Bug 5.1 (bughunt batch 5, TOCTOU) — duplicate phase invoices.
--
-- `application-phase-invoice-methods.js:_ensurePhaseInvoiceComponent` did a
-- findFirst → (null) → create with no lock/constraint. Two near-concurrent
-- quotation-accepts both observed null and both created a PHASE_1_STATE_FEE /
-- PHASE_1_PLATFORM_FEE row for the same application. Duplicate active invoices
-- corrupt `computePhaseSettlement.phasePaid` (the two-money-flow advance-guard
-- sums invoices per side, so a phantom duplicate can block or mis-advance the
-- phase).
--
-- Fix: a PARTIAL UNIQUE INDEX on (applicationId, serviceType) restricted to
-- non-soft-deleted rows. The partial predicate matters — a soft-deleted/
-- superseded invoice must not block re-issuing the same service type, and the
-- app-fee vs subscription split means applicationId is nullable (subscription
-- invoices set subscriptionId instead). Rows with applicationId IS NULL are
-- excluded so subscription invoices are never constrained by this index; a
-- UNIQUE index treats NULLs as distinct anyway, but we keep the app-scope
-- explicit for clarity.
--
-- The create path in application-phase-invoice-methods.js catches a P2002 whose
-- target is THIS index and re-reads the winner idempotently.
--
-- PRE-MIGRATION DUPE GUARD: CREATE UNIQUE INDEX fails if duplicates already
-- exist. First soft-delete the *superseded* duplicates, keeping the SETTLED row
-- per (applicationId, serviceType).
--
-- SURVIVOR RULE (adversarial-verify MF-1, CRITICAL): the survivor MUST be the
-- PAID / receipt-bearing / slip-pinned row — NOT merely the earliest. Every read
-- path resolves the LATEST/settled invoice (phase-billing-service selectLatestInvoice
-- orderBy createdAt DESC; invoice-service applicant billing orderBy createdAt DESC),
-- so keeping the earliest 'pending' row would soft-delete the real paid invoice →
-- orphan its payment_slip (soft-delete bypasses the Restrict FK), flip a paid phase
-- back to unpaid (computePhaseSettlement.phasePaid), and mismatch the ม.86 receipt.
-- Order paid-status first, then receipt presence, then earliest among equally-unpaid.

BEGIN;

-- SAFETY ABORT: if any (applicationId, serviceType) partition has MORE THAN ONE
-- active row bearing a receiptNumber OR a payment slip, dedup would destroy real
-- money either way — abort the deploy for manual reconciliation.
DO $$
DECLARE
    ambiguous INTEGER;
BEGIN
    SELECT COUNT(*) INTO ambiguous FROM (
        SELECT i."applicationId", i."serviceType"
        FROM "invoices" i
        WHERE i."isDeleted" = false AND i."applicationId" IS NOT NULL
          AND (
              i."receiptNumber" IS NOT NULL
              OR EXISTS (SELECT 1 FROM "payment_slips" ps WHERE ps."invoiceId" = i."id")
          )
        GROUP BY i."applicationId", i."serviceType"
        HAVING COUNT(*) > 1
    ) x;
    IF ambiguous > 0 THEN
        RAISE EXCEPTION 'BUGFIX-5.1 ABORT: % (applicationId, serviceType) partition(s) have multiple paid/receipt/slip-bearing ACTIVE invoices — manual reconciliation required before the uniqueness index can be applied.', ambiguous;
    END IF;
END $$;

-- Soft-delete superseded duplicates, keeping the SETTLED row per (applicationId, serviceType).
UPDATE "invoices" AS dup
SET
    "isDeleted"    = true,
    "deletedAt"    = COALESCE(dup."deletedAt", now()),
    "deleteReason" = COALESCE(dup."deleteReason",
        'BUGFIX-5.1: soft-deleted superseded duplicate phase invoice before uniq index')
FROM (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "applicationId", "serviceType"
            ORDER BY
                (upper("status") IN ('PAID','PAID_PENDING_RECEIPT','RECEIPT_ISSUED')) DESC,
                ("receiptNumber" IS NOT NULL) DESC,
                ("receiptIssuedAt" IS NOT NULL) DESC,
                "createdAt" ASC, "id" ASC
        ) AS rn
    FROM "invoices"
    WHERE "isDeleted" = false
      AND "applicationId" IS NOT NULL
) ranked
WHERE dup."id" = ranked."id"
  AND ranked.rn > 1;

-- Partial unique index: one active invoice per (application, serviceType).
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_invoice_app_service_active"
    ON "invoices" ("applicationId", "serviceType")
    WHERE "isDeleted" = false AND "applicationId" IS NOT NULL;

COMMIT;
