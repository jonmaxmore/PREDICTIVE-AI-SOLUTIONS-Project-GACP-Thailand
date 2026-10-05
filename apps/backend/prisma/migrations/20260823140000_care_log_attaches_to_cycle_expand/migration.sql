-- Care records attach to the planting cycle, not to an individual plant.
--
-- Granularity ends at the plot and the cycle (planting spec R8): a plot of 100
-- plants carries one code, not 100. A watering logged against one plant has
-- nowhere to live in that design.
--
-- This is the EXPAND half. The new column is nullable and the old one stays, so
-- the running application keeps working unchanged. A later contract migration
-- drops "plantUnitId" once nothing writes it.
--
-- Two things make this safe to run now:
--   * care_logs holds 0 rows on the live database, so there is nothing to backfill
--     and nothing to lose. That emptiness is itself the finding — the feature was
--     only ever reachable through the per-plant API, so nobody could use it.
--   * every statement is idempotent, so a re-run cannot fail the deploy.

ALTER TABLE "care_logs" ADD COLUMN IF NOT EXISTS "cycleId" TEXT;

CREATE INDEX IF NOT EXISTS "care_logs_cycleId_idx" ON "care_logs" ("cycleId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'care_logs_cycleId_fkey'
    ) THEN
        ALTER TABLE "care_logs"
            ADD CONSTRAINT "care_logs_cycleId_fkey"
            FOREIGN KEY ("cycleId") REFERENCES "planting_cycles" ("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

-- The per-plant link becomes optional so a record can be written against a cycle
-- without inventing a plant row to hang it on.
ALTER TABLE "care_logs" ALTER COLUMN "plantUnitId" DROP NOT NULL;

-- And it stops cascading deletes.
--
-- A care log is the evidence a GACP auditor asks for: what was applied to this
-- crop, and when. Under ON DELETE CASCADE, deleting a plant row silently erased
-- that history. Evidence that disappears when some unrelated row is deleted is
-- not evidence. SET NULL keeps the record and drops only the stale pointer.
ALTER TABLE "care_logs" DROP CONSTRAINT IF EXISTS "care_logs_plantUnitId_fkey";

ALTER TABLE "care_logs"
    ADD CONSTRAINT "care_logs_plantUnitId_fkey"
    FOREIGN KEY ("plantUnitId") REFERENCES "plant_units" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
