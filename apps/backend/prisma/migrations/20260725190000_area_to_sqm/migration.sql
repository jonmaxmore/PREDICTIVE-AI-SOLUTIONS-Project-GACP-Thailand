-- =============================================================================
-- GACP Data Migration: every stored area becomes square metres
-- =============================================================================
--
-- The platform collects, stores and displays one area unit. Rows written before
-- that carry `areaUnit = 'rai'` — Prisma's old column default — or 'ngan' or
-- 'sqwa', with the number beside them measured in that unit.
--
-- Application code reads them correctly (apps/backend/shared/area-utils.js,
-- `storedAreaToSqm`), but a read path that has to remember to convert is a read
-- path that can forget, and one already had: `Farm.areaUnit` was never written
-- on the certificate-issuance path, so the column default decided it and a
-- farmer who entered 1,600 ตร.ม. got a certified farm of 1,600 rai.
--
-- This converts the numbers and rewrites the unit. Idempotent by predicate: a
-- row already saying 'sqm' is not matched, so a partial or repeated run is
-- harmless.
--
-- The table names here are the PHYSICAL ones — `farms`, `plots`,
-- `planting_cycles` — not the Prisma model names. The models carry `@@map`, so
-- no relation called "Farm" exists. The first version of this migration
-- addressed the model names and wrapped each statement in
-- `IF to_regclass('public."Farm"') IS NOT NULL`, which is NULL for a relation
-- that does not exist: every branch was false, the migration reported success,
-- and nothing was converted. The guards are deliberately gone. These tables are
-- created by earlier migrations, so if one is missing that is a real problem
-- and this should fail and say so rather than skip and claim success.
--
-- The equivalent with a report first, and per-row diagnostics for units nothing
-- can read, is scripts/maintenance/migrate-area-to-sqm.js.
-- =============================================================================

DO $$
DECLARE
  -- Square metres per legacy unit. 1 rai = 4 ngan = 400 square wa = 1,600 m².
  ratios CONSTANT jsonb := '{"rai": 1600, "ngan": 400, "sqwa": 4, "square_wa": 4,
                             "squarewa": 4, "sqw": 4, "wa2": 4,
                             "ไร่": 1600, "งาน": 400, "ตารางวา": 4, "ตารางเมตร": 1}'::jsonb;
BEGIN
  -- A farm carries two areas under one unit.
  UPDATE "farms"
  SET "totalArea"       = COALESCE("totalArea", 0) * (ratios ->> lower(trim("areaUnit")))::numeric,
      "cultivationArea" = COALESCE("cultivationArea", 0) * (ratios ->> lower(trim("areaUnit")))::numeric,
      "areaUnit"        = 'sqm'
  WHERE ratios ? lower(trim("areaUnit"))
    AND lower(trim("areaUnit")) <> 'sqm'
    AND lower(trim("areaUnit")) <> 'ตารางเมตร';

  UPDATE "plots"
  SET "area"     = COALESCE("area", 0) * (ratios ->> lower(trim("areaUnit")))::numeric,
      "areaUnit" = 'sqm'
  WHERE ratios ? lower(trim("areaUnit"))
    AND lower(trim("areaUnit")) <> 'sqm'
    AND lower(trim("areaUnit")) <> 'ตารางเมตร';

  UPDATE "planting_cycles"
  SET "plotArea" = COALESCE("plotArea", 0) * (ratios ->> lower(trim("areaUnit")))::numeric,
      "areaUnit" = 'sqm'
  WHERE ratios ? lower(trim("areaUnit"))
    AND lower(trim("areaUnit")) <> 'sqm'
    AND lower(trim("areaUnit")) <> 'ตารางเมตร';

  -- There is deliberately no harvest_batches block. The original had one,
  -- setting `plotArea` and `areaUnit`; HarvestBatch has neither column, so
  -- correcting only its table name would have replaced a silent no-op with a
  -- hard failure on a column that does not exist.

  -- A row whose unit is not in `ratios` is left exactly as it was. Converting a
  -- row nobody understands is how a farm silently changes size; the Node script
  -- reports those by id so they can be fixed by hand.
END $$;

-- New rows are square metres. Without this the schema says 'sqm', the database
-- says 'rai', and any insert that omits the unit is silently wrong — which is
-- what CI's Migration Drift Check reported.
ALTER TABLE "farms" ALTER COLUMN "areaUnit" SET DEFAULT 'sqm';
ALTER TABLE "plots" ALTER COLUMN "areaUnit" SET DEFAULT 'sqm';
ALTER TABLE "planting_cycles" ALTER COLUMN "areaUnit" SET DEFAULT 'sqm';
