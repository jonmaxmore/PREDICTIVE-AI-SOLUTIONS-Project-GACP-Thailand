-- Prisma wraps this migration in a transaction automatically.

CREATE TABLE IF NOT EXISTS "planting_cycle_plots" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cycleId" TEXT NOT NULL,
  "plotId" TEXT NOT NULL,
  "allocatedAreaSqm" DOUBLE PRECISION NOT NULL,
  "plannedPlantCount" INTEGER NOT NULL,
  CONSTRAINT "planting_cycle_plots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "planting_cycle_plots_cycleId_plotId_key"
  ON "planting_cycle_plots"("cycleId", "plotId");
CREATE INDEX IF NOT EXISTS "planting_cycle_plots_cycleId_idx"
  ON "planting_cycle_plots"("cycleId");
CREATE INDEX IF NOT EXISTS "planting_cycle_plots_plotId_idx"
  ON "planting_cycle_plots"("plotId");

ALTER TABLE "planting_cycle_plots"
  ADD CONSTRAINT "planting_cycle_plots_cycleId_fkey"
  FOREIGN KEY ("cycleId") REFERENCES "planting_cycles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "planting_cycle_plots"
  ADD CONSTRAINT "planting_cycle_plots_plotId_fkey"
  FOREIGN KEY ("plotId") REFERENCES "plots"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Ensure prerequisite tables exist (may have been missed by earlier migrations)
CREATE TABLE IF NOT EXISTS "plant_units" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cycleId" TEXT NOT NULL,
  "cyclePlotId" TEXT,
  "batchId" TEXT,
  "code" TEXT NOT NULL,
  "variety" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "qrCode" TEXT,
  "qrUrl" TEXT,
  "printedAt" TIMESTAMP(3),
  "printCount" INTEGER NOT NULL DEFAULT 0,
  "confirmedAt" TIMESTAMP(3),
  "plantedAt" TIMESTAMP(3),
  "harvestedAt" TIMESTAMP(3),
  "soldAt" TIMESTAMP(3),
  "dataLockedAt" TIMESTAMP(3),
  "soldTo" TEXT,
  "soldToName" TEXT,
  "salePrice" DOUBLE PRECISION,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "notes" TEXT,
  "editCount" INTEGER NOT NULL DEFAULT 0,
  "lastEditAt" TIMESTAMP(3),
  "lastEditBy" TEXT,
  CONSTRAINT "plant_units_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "plant_units_qrCode_key" ON "plant_units"("qrCode");
CREATE INDEX IF NOT EXISTS "plant_units_cycleId_idx" ON "plant_units"("cycleId");
CREATE INDEX IF NOT EXISTS "plant_units_cyclePlotId_idx" ON "plant_units"("cyclePlotId");
CREATE INDEX IF NOT EXISTS "plant_units_batchId_idx" ON "plant_units"("batchId");
CREATE INDEX IF NOT EXISTS "plant_units_qrCode_idx" ON "plant_units"("qrCode");
CREATE INDEX IF NOT EXISTS "plant_units_status_idx" ON "plant_units"("status");
CREATE INDEX IF NOT EXISTS "plant_units_variety_idx" ON "plant_units"("variety");

CREATE TABLE IF NOT EXISTS "cultivation_logs" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cycleId" TEXT NOT NULL,
  "logDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "logType" TEXT NOT NULL,
  "productName" TEXT,
  "quantity" DOUBLE PRECISION,
  "unit" TEXT,
  "method" TEXT,
  "area" DOUBLE PRECISION,
  "temperature" DOUBLE PRECISION,
  "humidity" DOUBLE PRECISION,
  "weather" TEXT,
  "notes" TEXT,
  "photoUrl" TEXT,
  "recordedBy" TEXT,
  "scope" TEXT NOT NULL DEFAULT 'CYCLE',
  "plotId" TEXT,
  "plantUnitId" TEXT,
  "attachmentIds" JSONB,
  CONSTRAINT "cultivation_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cultivation_logs_cycleId_idx" ON "cultivation_logs"("cycleId");
CREATE INDEX IF NOT EXISTS "cultivation_logs_logDate_idx" ON "cultivation_logs"("logDate");
CREATE INDEX IF NOT EXISTS "cultivation_logs_logType_idx" ON "cultivation_logs"("logType");

-- Now add scope/plotId/plantUnitId columns if table existed before (idempotent)
ALTER TABLE "cultivation_logs"
  ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'CYCLE',
  ADD COLUMN IF NOT EXISTS "plotId" TEXT,
  ADD COLUMN IF NOT EXISTS "plantUnitId" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentIds" JSONB;

CREATE INDEX IF NOT EXISTS "cultivation_logs_scope_idx" ON "cultivation_logs"("scope");
CREATE INDEX IF NOT EXISTS "cultivation_logs_plotId_idx" ON "cultivation_logs"("plotId");
CREATE INDEX IF NOT EXISTS "cultivation_logs_plantUnitId_idx" ON "cultivation_logs"("plantUnitId");

ALTER TABLE "cultivation_logs"
  ADD CONSTRAINT "cultivation_logs_plotId_fkey"
  FOREIGN KEY ("plotId") REFERENCES "plots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cultivation_logs"
  ADD CONSTRAINT "cultivation_logs_plantUnitId_fkey"
  FOREIGN KEY ("plantUnitId") REFERENCES "plant_units"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill cycle-plot rows SKIPPED — legacy columns (estimatedPlantCount, plotArea, areaUnit)
-- were removed by prior migrations. This backfill only applies to DBs that still have those columns.
-- If this is a fresh deployment, no backfill is needed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'planting_cycles' AND column_name = 'estimatedPlantCount'
  ) THEN
    INSERT INTO "planting_cycle_plots" ("id", "cycleId", "plotId", "allocatedAreaSqm", "plannedPlantCount", "createdAt", "updatedAt")
    SELECT
      gen_random_uuid()::text,
      c."id",
      c."plotId",
      CASE
        WHEN lower(coalesce(c."areaUnit", 'sqm')) = 'rai' THEN coalesce(c."plotArea", 0) * 1600
        WHEN lower(coalesce(c."areaUnit", 'sqm')) = 'ngan' THEN coalesce(c."plotArea", 0) * 400
        WHEN lower(coalesce(c."areaUnit", 'sqm')) IN ('sqwa', 'square_wa', 'wa2') THEN coalesce(c."plotArea", 0) * 4
        ELSE coalesce(c."plotArea", 0)
      END,
      GREATEST(coalesce(c."estimatedPlantCount", 0), 0),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM "planting_cycles" c
    LEFT JOIN "planting_cycle_plots" cp
      ON cp."cycleId" = c."id" AND cp."plotId" = c."plotId"
    WHERE c."plotId" IS NOT NULL
      AND cp."id" IS NULL;
  END IF;
END $$;

-- End of migration.
