-- DESTRUCTIVE — CONTRACT migration: drops the DTAM remittance schema (PR3).
-- Operator order 2026-09-11 "ถอดออกทั้งระบบ"; ruling 2026-09-29: the company settles
-- with DTAM offline, the platform keeps no DTAM payable and no DTAM split.
-- Expand was 20260802150000_wave1_checkout_engine_expand. PR1 (pipeline) and PR2
-- (accounting layer) removed every writer and reader before this runs.
--
-- Drops:
--   table  dtam_remittance_batches (and its FK from checkout_orders)
--   column checkout_orders.dtam_fee_amount, .dtam_remittance_status, ."remittanceBatchId"
--          (+ their indexes and the dtam_remittance_status CHECK)
-- Rewrites:
--   checkout_orders_total_arithmetic_check   total = platform gross (was dtam + gross)
--   checkout_orders_amounts_nonnegative_check without the dropped column
--
-- REFUSES before touching anything (RAISE → the whole file rolls back) when:
--   - a checkout_orders row carries dtam_fee_amount > 0 and is not CANCELLED
--     (it could still be paid, or it was paid with a DTAM part — an operator decision);
--   - a dtam_remittance_batches row is not OPEN (a record of money that was sent);
--   - any other non-CANCELLED row has total_payable_amount <> platform_fee_gross, or a
--     negative net/VAT — the CHECKs added below would refuse it (a database where the
--     old CHECK was dropped by hand). Named here, with counts, instead of a raw
--     "check constraint ... is violated by some row".
-- Pre-flight, read-only, same counts: apps/backend/scripts/ops/check-dtam-schema-drop-preflight.js
-- A CANCELLED row that carried a DTAM part keeps total_payable_amount as it was
-- (no amount is written); the new CHECK exempts CANCELLED rows for that reason only,
-- and its old DTAM part stays readable as total_payable_amount - platform_fee_gross.
--
-- Rollback (manual — restores the shape; batch rows and remittance statuses do not
-- come back, restore them from the pre-deploy dump if they existed):
--   BEGIN;
--   ALTER TABLE "checkout_orders" DROP CONSTRAINT "checkout_orders_total_arithmetic_check";
--   ALTER TABLE "checkout_orders" DROP CONSTRAINT "checkout_orders_amounts_nonnegative_check";
--   ALTER TABLE "checkout_orders" ADD COLUMN "dtam_fee_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;
--   ALTER TABLE "checkout_orders" ALTER COLUMN "dtam_fee_amount" DROP DEFAULT;
--   UPDATE "checkout_orders" SET "dtam_fee_amount" = "total_payable_amount" - "platform_fee_gross"
--     WHERE "total_payable_amount" <> "platform_fee_gross";
--   ALTER TABLE "checkout_orders" ADD COLUMN "dtam_remittance_status" TEXT;
--   ALTER TABLE "checkout_orders" ADD COLUMN "remittanceBatchId" TEXT;
--   ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_dtam_remittance_status_check" CHECK (
--     "dtam_remittance_status" IS NULL
--     OR "dtam_remittance_status" IN ('PENDING', 'BATCHED', 'REMITTED', 'RECONCILED'));
--   ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_total_arithmetic_check" CHECK (
--     "total_payable_amount" = "dtam_fee_amount" + "platform_fee_gross");
--   ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_amounts_nonnegative_check" CHECK (
--     "dtam_fee_amount" >= 0 AND "platform_fee_net" >= 0 AND "platform_fee_vat" >= 0);
--   CREATE INDEX "checkout_orders_dtam_remittance_status_idx" ON "checkout_orders"("dtam_remittance_status");
--   CREATE INDEX "checkout_orders_remittanceBatchId_idx" ON "checkout_orders"("remittanceBatchId");
--   CREATE TABLE "dtam_remittance_batches" (
--     "id" TEXT NOT NULL,
--     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     "updatedAt" TIMESTAMP(3) NOT NULL,
--     "batchNumber" TEXT NOT NULL,
--     "status" TEXT NOT NULL DEFAULT 'OPEN',
--     "totalAmount" DECIMAL(15,2) NOT NULL,
--     "remittedAt" TIMESTAMP(3),
--     "bankReference" TEXT,
--     "reconciledAt" TIMESTAMP(3),
--     "journalEntryId" TEXT,
--     "organizationId" TEXT NOT NULL,
--     CONSTRAINT "dtam_remittance_batches_pkey" PRIMARY KEY ("id"),
--     CONSTRAINT "dtam_remittance_batches_status_check" CHECK ("status" IN ('OPEN', 'REMITTED', 'RECONCILED')),
--     CONSTRAINT "dtam_remittance_batches_total_nonnegative_check" CHECK ("totalAmount" >= 0));
--   CREATE UNIQUE INDEX "dtam_remittance_batches_batchNumber_key" ON "dtam_remittance_batches"("batchNumber");
--   CREATE INDEX "dtam_remittance_batches_status_idx" ON "dtam_remittance_batches"("status");
--   CREATE INDEX "dtam_remittance_batches_organizationId_idx" ON "dtam_remittance_batches"("organizationId");
--   ALTER TABLE "dtam_remittance_batches" ADD CONSTRAINT "dtam_remittance_batches_organizationId_fkey"
--     FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
--   ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_remittanceBatchId_fkey"
--     FOREIGN KEY ("remittanceBatchId") REFERENCES "dtam_remittance_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260929155037_drop_dtam_remittance_schema';
--   COMMIT;
-- then deploy the previous image (PR2 code reads these columns).
-- Grants are not restored: no migration grants on these tables — re-apply only hand-made grants.
--
-- No explicit BEGIN/COMMIT, on purpose: Prisma sends this file as ONE multi-statement
-- query, which Postgres runs as one implicit transaction — atomic either way — but with
-- an explicit BEGIN the refusal below is reported as "current transaction is aborted"
-- and its message (the counts) never reaches the operator. Proven on Postgres 17 by
-- __tests__/integration/dtam-schema-drop-migration-real-postgres.test.js.

-- ── Refuse before anything is dropped ──────────────────────────────────────
DO $$
DECLARE
  open_orders      BIGINT;
  open_by_status   TEXT;
  kept_batches     BIGINT;
  kept_by_status   TEXT;
  bad_totals       BIGINT;
  bad_by_status    TEXT;
BEGIN
  SELECT COALESCE(SUM(n), 0), COALESCE(string_agg(status || '=' || n, ', ' ORDER BY status), 'none')
    INTO open_orders, open_by_status
    FROM (SELECT "status", count(*) AS n
            FROM "checkout_orders"
           WHERE "dtam_fee_amount" > 0 AND "status" <> 'CANCELLED'
           GROUP BY "status") s;

  SELECT COALESCE(SUM(n), 0), COALESCE(string_agg(status || '=' || n, ', ' ORDER BY status), 'none')
    INTO kept_batches, kept_by_status
    FROM (SELECT "status", count(*) AS n
            FROM "dtam_remittance_batches"
           WHERE "status" <> 'OPEN'
           GROUP BY "status") b;

  -- Rows the new CHECKs would refuse, other than those already counted above.
  SELECT COALESCE(SUM(n), 0), COALESCE(string_agg(status || '=' || n, ', ' ORDER BY status), 'none')
    INTO bad_totals, bad_by_status
    FROM (SELECT "status", count(*) AS n
            FROM "checkout_orders"
           WHERE NOT ("dtam_fee_amount" > 0 AND "status" <> 'CANCELLED')
             AND (("total_payable_amount" <> "platform_fee_gross" AND "status" <> 'CANCELLED')
                  OR "platform_fee_net" < 0 OR "platform_fee_vat" < 0)
           GROUP BY "status") t;

  IF open_orders > 0 OR kept_batches > 0 OR bad_totals > 0 THEN
    RAISE EXCEPTION 'DTAM_SCHEMA_DROP_REFUSED: % checkout_orders row(s) carry dtam_fee_amount > 0 and are not CANCELLED (%); % dtam_remittance_batches row(s) are not OPEN (%); % checkout_orders row(s) would break the new total CHECK (total_payable_amount <> platform_fee_gross and not CANCELLED, or a negative fee) (%). Nothing was dropped. Run apps/backend/scripts/ops/check-dtam-schema-drop-preflight.js for the rows; an open order is retired by one press of its pay button (PR2), anything else is an operator decision.',
      open_orders, open_by_status, kept_batches, kept_by_status, bad_totals, bad_by_status;
  END IF;
END $$;

-- ── checkout_orders: the batch pointer ─────────────────────────────────────
ALTER TABLE "checkout_orders" DROP CONSTRAINT IF EXISTS "checkout_orders_remittanceBatchId_fkey";
DROP INDEX IF EXISTS "checkout_orders_remittanceBatchId_idx";
DROP INDEX IF EXISTS "checkout_orders_dtam_remittance_status_idx";

-- ── checkout_orders: constraints that name a dropped column ────────────────
ALTER TABLE "checkout_orders" DROP CONSTRAINT IF EXISTS "checkout_orders_dtam_remittance_status_check";
ALTER TABLE "checkout_orders" DROP CONSTRAINT IF EXISTS "checkout_orders_total_arithmetic_check";
ALTER TABLE "checkout_orders" DROP CONSTRAINT IF EXISTS "checkout_orders_amounts_nonnegative_check";

-- ── checkout_orders: the columns ───────────────────────────────────────────
ALTER TABLE "checkout_orders" DROP COLUMN "dtam_fee_amount";
ALTER TABLE "checkout_orders" DROP COLUMN "dtam_remittance_status";
ALTER TABLE "checkout_orders" DROP COLUMN "remittanceBatchId";

-- ── checkout_orders: the arithmetic, without a DTAM part ───────────────────
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_total_arithmetic_check" CHECK (
  "total_payable_amount" = "platform_fee_gross" OR "status" = 'CANCELLED'
);
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_amounts_nonnegative_check" CHECK (
  "platform_fee_net" >= 0 AND "platform_fee_vat" >= 0
);

-- ── dtam_remittance_batches ────────────────────────────────────────────────
DROP TABLE "dtam_remittance_batches";
