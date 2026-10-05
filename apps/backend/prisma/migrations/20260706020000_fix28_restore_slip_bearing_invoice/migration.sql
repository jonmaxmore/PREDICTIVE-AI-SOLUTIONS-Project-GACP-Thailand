-- FIX-28-CORRECTIVE (carpet-bomb-inversion audit 2026-07-06) — repair any invoice
-- partition mis-deduped by 20260701010000_uniq_invoice_app_servicetype.
--
-- The Bug-5.1 dedup migration ranked the per-(applicationId, serviceType) survivor
-- by PAID-status → receiptNumber → receiptIssuedAt → createdAt ASC, but NEVER by
-- "has a payment slip". So a twin where the LATER invoice carries an un-approved
-- (still-pending, not-yet-PAID) slip could keep the earlier BARE invoice as the
-- active survivor and soft-delete the SLIP-BEARING one — orphaning the payment_slip
-- (soft-delete bypasses the Restrict FK) and showing the survivor as unpaid
-- (double-bill; ม.86 receipt/slip mismatch).
--
-- This corrective SWAPS such partitions: soft-delete the bare active survivor and
-- restore (un-soft-delete) the slip-bearing twin so it becomes the single active
-- row again.
--
-- SAFETY / SCOPE (surgical):
--   * Acts ONLY on a partition whose CORRECT slip-aware survivor is currently
--     soft-deleted AND bears real money (a slip OR PAID-status OR a receipt), AND
--     whose currently-active row is BARE (no slip / not paid / not receipted). If
--     any active row itself bears money it is an ambiguous double-money case →
--     LEFT UNTOUCHED for manual reconciliation (same posture as the original
--     migration's ABORT guard). The corrective therefore NEVER soft-deletes an
--     active slip/paid/receipt-bearing invoice.
--   * Only flips isDeleted / deletedAt / deleteReason. It hard-deletes nothing and
--     never edits amounts, receipt numbers, slips, or GL — no paid/cert data is
--     destroyed.
--
-- IDEMPOTENT / NO-OP WHEN CLEAN:
--   The swap set is computed once (from the pre-mutation state) into a TEMP table.
--   On a clean DB the set is EMPTY → both UPDATEs touch 0 rows. Re-running after a
--   successful swap is also a no-op: the restored survivor is now active, so its
--   partition's rn=1 row has isDeleted=false → excluded by the "survivor is
--   soft-deleted" filter. Verified on staging 2026-07-06: 0 affected partitions
--   (26 app-invoices, 0 BUGFIX-5.1 soft-deletes) → this migration is a no-op there.
--
-- PARTIAL-UNIQUE-INDEX SAFETY:
--   uniq_invoice_app_service_active is UNIQUE on (applicationId, serviceType) WHERE
--   isDeleted=false. Within the transaction we soft-delete the bare active row
--   FIRST (partition → 0 active) THEN restore the survivor (partition → 1 active),
--   so the index never transiently sees two active rows. The swap set is frozen in
--   the temp table before either UPDATE, so soft-deleting the active row cannot
--   shift the ranking used to pick the survivor.

BEGIN;

-- Freeze the swap set from the PRE-mutation state (slip-aware ranking).
CREATE TEMP TABLE _fix28_swap ON COMMIT DROP AS
WITH ranked AS (
    SELECT
        i."id",
        i."applicationId",
        i."serviceType",
        i."isDeleted",
        EXISTS (SELECT 1 FROM "payment_slips" ps WHERE ps."invoiceId" = i."id") AS has_slip,
        (upper(i."status") IN ('PAID','PAID_PENDING_RECEIPT','RECEIPT_ISSUED')) AS is_paid,
        (i."receiptNumber" IS NOT NULL) AS has_receipt,
        ROW_NUMBER() OVER (
            PARTITION BY i."applicationId", i."serviceType"
            ORDER BY
                EXISTS (SELECT 1 FROM "payment_slips" ps WHERE ps."invoiceId" = i."id") DESC,
                (upper(i."status") IN ('PAID','PAID_PENDING_RECEIPT','RECEIPT_ISSUED')) DESC,
                (i."receiptNumber" IS NOT NULL) DESC,
                (i."receiptIssuedAt" IS NOT NULL) DESC,
                i."createdAt" ASC, i."id" ASC
        ) AS rn
    FROM "invoices" i
    WHERE i."applicationId" IS NOT NULL
)
SELECT
    r."applicationId",
    r."serviceType",
    r."id" AS keep_id
FROM ranked r
WHERE r.rn = 1
  AND r."isDeleted" = true                          -- correct survivor is currently soft-deleted
  AND (r.has_slip OR r.is_paid OR r.has_receipt)     -- ...and bears real money
  AND NOT EXISTS (                                    -- ...and NO active row bears money (else manual)
      SELECT 1 FROM ranked a
      WHERE a."applicationId" = r."applicationId"
        AND a."serviceType" = r."serviceType"
        AND a."isDeleted" = false
        AND (a.has_slip OR a.is_paid OR a.has_receipt)
  );

-- Step 1: soft-delete the currently-active BARE survivor in each affected
-- partition (BEFORE restoring — keeps the partial-unique index satisfied).
UPDATE "invoices" AS act
SET "isDeleted" = true,
    "deletedAt" = COALESCE(act."deletedAt", now()),
    "deleteReason" = COALESCE(act."deleteReason",
        'FIX-28-CORRECTIVE: superseded bare twin; slip-bearing invoice restored as the active survivor')
FROM "_fix28_swap" s
WHERE act."applicationId" = s."applicationId"
  AND act."serviceType" = s."serviceType"
  AND act."isDeleted" = false
  AND act."id" <> s.keep_id;

-- Step 2: restore the slip-bearing / paid survivor to active.
UPDATE "invoices" AS keep
SET "isDeleted" = false,
    "deletedAt" = NULL,
    "deleteReason" = NULL
FROM "_fix28_swap" s
WHERE keep."id" = s.keep_id
  AND keep."isDeleted" = true;

COMMIT;
