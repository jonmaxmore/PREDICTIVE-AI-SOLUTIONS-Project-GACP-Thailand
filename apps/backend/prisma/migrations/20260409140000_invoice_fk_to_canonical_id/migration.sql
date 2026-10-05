-- P1-8: Invoice FK Migration — healthId → canonicalId
-- 
-- Invoice.healthId FK currently references users.healthId (nullable).
-- This migration re-points it to users.canonicalId (non-nullable).
--
-- DATA SAFETY: Since canonicalId = healthId for all HEALTH users
-- (backfilled in migration 20260404080000), the actual column values
-- in invoices.healthId already match users.canonicalId.
-- NO data changes are needed — only the FK constraint is updated.

-- Step 1: Drop old FK constraint (invoices.healthId → users.healthId)
-- The constraint name follows Prisma convention: invoices_healthId_fkey
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'invoices_healthId_fkey' 
        AND table_name = 'invoices'
    ) THEN
        ALTER TABLE "invoices" DROP CONSTRAINT "invoices_healthId_fkey";
    END IF;
END $$;

-- Step 2: Add new FK constraint (invoices.healthId → users.canonicalId)
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_healthId_fkey" 
    FOREIGN KEY ("healthId") REFERENCES "users"("canonicalId") 
    ON DELETE RESTRICT ON UPDATE CASCADE;
