-- =============================================================================
-- GACP Data Migration: certificationPurpose String → certificationPurposes String[]
-- =============================================================================
--
-- ⚠️ Idempotency note (added 2026-04-29 to fix CI red on fresh DBs):
--   This migration was originally written assuming `certificationPurpose`
--   (singular, String) existed at apply-time. After Phase A6 the schema was
--   amended to keep ONLY `certificationPurposes` (plural, String[]), so
--   on a fresh database both the column and any rows are absent and the
--   raw UPDATE below crashes with `column "certificationPurpose" does not
--   exist`.
--
--   Prisma's `_prisma_migrations` ledger tracks `manual/` as already
--   applied on production, so we cannot simply delete the directory
--   without forcing every operator to run `prisma migrate resolve`.
--   The safest fix is to make the migration self-skip when the legacy
--   column is gone (which is the normal end-state after Step 3 has run).
--
--   On a database that still has `certificationPurpose`, the original
--   backfill runs unchanged — same effect as before.
-- =============================================================================

DO $$
BEGIN
  -- Step 1: Populate new certificationPurposes array from old single-value field
  -- Guard with information_schema.columns so this is a no-op once the legacy
  -- column has been dropped (or on fresh databases that never had it).
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'applications'
      AND column_name  = 'certificationPurpose'
  ) THEN
    EXECUTE $sql$
      UPDATE "applications"
      SET "certificationPurposes" = ARRAY["certificationPurpose"]
      WHERE "certificationPurpose" IS NOT NULL
        AND "certificationPurpose" != ''
        AND (array_length("certificationPurposes", 1) IS NULL OR array_length("certificationPurposes", 1) = 0);
    $sql$;
    RAISE NOTICE 'manual: certificationPurpose backfill applied';
  ELSE
    RAISE NOTICE 'manual: certificationPurpose column not present — skipping backfill (already migrated or fresh DB)';
  END IF;
END $$;

-- Step 2: Verify migration (should return 0 rows) — kept as comment, run manually:
-- SELECT id, "certificationPurpose", "certificationPurposes"
-- FROM "applications"
-- WHERE "certificationPurpose" IS NOT NULL
--   AND "certificationPurpose" != ''
--   AND array_length("certificationPurposes", 1) IS NULL;

-- Step 3: AFTER 30 DAYS — Drop legacy column (run manually after observation):
-- ALTER TABLE "applications" DROP COLUMN "certificationPurpose";
