-- Link plant units to cycle plots so per-plant trace can always resolve to a plot.
ALTER TABLE "plant_units"
  ADD COLUMN IF NOT EXISTS "cyclePlotId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plant_units_cyclePlotId_fkey'
  ) THEN
    ALTER TABLE "plant_units"
      ADD CONSTRAINT "plant_units_cyclePlotId_fkey"
      FOREIGN KEY ("cyclePlotId")
      REFERENCES "planting_cycle_plots"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "plant_units_cyclePlotId_idx"
  ON "plant_units"("cyclePlotId");

-- Backfill existing rows for cycles that only have one plot assignment.
UPDATE "plant_units" pu
SET "cyclePlotId" = only_plot."id"
FROM (
  SELECT pcp."cycleId", MIN(pcp."id") AS "id"
  FROM "planting_cycle_plots" pcp
  GROUP BY pcp."cycleId"
  HAVING COUNT(*) = 1
) AS only_plot
WHERE pu."cycleId" = only_plot."cycleId"
  AND pu."cyclePlotId" IS NULL;