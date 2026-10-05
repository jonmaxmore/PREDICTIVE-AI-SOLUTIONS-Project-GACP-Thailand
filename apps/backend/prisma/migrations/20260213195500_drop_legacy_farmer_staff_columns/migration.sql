-- Migration: Drop legacy farmerId/staffId columns after Health/Provider identity migration
-- Context: Ministry-aligned identity model (healthId/providerId only)
--
-- Rollback (manual):
--   1) Re-add required legacy columns on affected tables (if absolutely needed)
--      e.g. ALTER TABLE "applications" ADD COLUMN "farmerId" TEXT;
--   2) Backfill from canonical identities (healthId/providerId) using users table mapping.
--   3) Recreate legacy indexes/constraints only for temporary compatibility.

BEGIN;

-- Drop legacy identity columns wherever they still exist (camelCase + snake_case).
DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('farmerId', 'staffId', 'farmer_id', 'staff_id')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP COLUMN IF EXISTS %I CASCADE',
      rec.table_schema,
      rec.table_name,
      rec.column_name
    );
  END LOOP;
END $$;

-- Remove known legacy indexes related to farmer/staff identity naming.
DROP INDEX IF EXISTS "applications_farmerId_idx";
DROP INDEX IF EXISTS "invoices_farmerId_idx";
DROP INDEX IF EXISTS "idx_applications_farmer_status";
DROP INDEX IF EXISTS "idx_invoices_farmer";
DROP INDEX IF EXISTS "idx_invoices_farmer_status";

COMMIT;
