-- =============================================================================
-- Two columns get the name of the thing they actually hold.
-- =============================================================================
--
-- EXPAND HALF. Both new columns are ADDED and BACKFILLED; both old columns stay
-- in place, stay written, and stay readable. The contract half — dropping them —
-- is a separate migration, listed at the bottom.
--
-- This file ships in the SAME change as the Prisma schema and the reading code.
-- That is not a convenience: .github/workflows/ci.yml lists `migration-drift-check`
-- in build-success `needs:`, and that job runs
--   prisma migrate diff --from-migrations prisma/migrations
--                       --to-schema-datamodel prisma/schema --exit-code
-- A migration whose columns are absent from the schema turns that required gate
-- red the moment it lands and keeps it red until the schema catches up. The
-- repo's own precedent is the same shape: 20260822120000_certificate_signature_public_key_expand
-- and 20260824100000_plot_permanent_code_expand each shipped their schema field
-- with their SQL. Deploy order inside the release is unchanged and is what makes
-- it safe: `prisma migrate deploy` runs before the new app image serves traffic,
-- so no process ever selects a column that does not exist yet.
--
-- -----------------------------------------------------------------------------
-- 1. applications."totalAreaTypes"  ->  "cultivationScopeCount"
-- -----------------------------------------------------------------------------
-- The old name describes a design that no longer exists. `totalAreaTypes` was
-- born beside `batchId` and `areaTypeIndex` (application.prisma:52-54), from a
-- scheme where one submission fanned out into N sibling applications, one per
-- area type, each knowing its index i of n. That scheme is dead: nothing in the
-- product writes `Application.batchId` or `areaTypeIndex` any more.
--
-- What the column holds today is the number of CERTIFICATION SCOPES the
-- application is billed for. Both writers stamp `fees.scopeCount`
-- (application-submission-methods.js:142, application-draft-query-methods.js:72),
-- which comes from feeService.resolveCultivationScopeCount
-- (modules/billing/internal/fee-service.js:105-118) — the count of DISTINCT
-- cultivation methods (OUTDOOR / INDOOR / GREENHOUSE), never a count of "area
-- types". Every reader treats it as the price multiplier and immediately
-- renames it on the way in: `const scopeCount = application.totalAreaTypes || 1`
-- (quotation-service.js:277, invoice-template-service.js:341/816/1023,
-- routes/api/applications/quotations.js:158).
--
-- Why `cultivationScopeCount` and not `cultivationMethodCount`, which is what
-- the resolver literally counts today: the column is allowed to DISAGREE with
-- the current method list, on purpose. When a quotation is accepted its scope
-- count becomes the frozen price-of-record, and the payment path writes that
-- frozen number back over the column even though `formData.cultivationMethods`
-- may since have changed (payment-service-phase-flow.js:128-131,
-- preview.js:146-149; asserted at
-- __tests__/integration/phase-amount-canonical.test.js:293). A column named
-- "methodCount" would then be lying again, in the same way "areaTypes" lies
-- now. "Scope" is also the word the domain uses — ขอบข่ายการรับรอง, the scope of
-- certification — and the word the billing vocabulary already uses end to end:
-- resolveCultivationScopeCount, fees.scopeCount, options.scopeCount,
-- locked.scopeCount, taxScopeCount.
--
-- A straight copy: same type, same meaning, no conversion possible.
--
-- -----------------------------------------------------------------------------
-- 2. plots."area" (+ "areaUnit")  ->  "areaSqm"
-- -----------------------------------------------------------------------------
-- `area` is a bare number whose meaning depends on a sibling column, and this
-- repo has been cut by that twice: once when Farm.areaUnit was never written on
-- the certificate path and Prisma's 'rai' default certified a 1,600 m² farm as
-- 1,600 rai, and once when two modules disagreed about what an ABSENT unit
-- meant, making the same row either 1 m² or 1,600 m² depending on who read it
-- (shared/area-utils.js:1-23). `areaSqm` cannot be misread, because the unit is
-- in the name and cannot be separated from the number.
--
-- This is the column the code already wants. Every reader converts to square
-- metres at the door and calls the result `areaSqm` on the very next line —
-- planting-cycle-detail-loader.js:98, harvest-capacity-operations.js:356,
-- planting-service.js:244/420, and on the web side
-- new-planting-cycle-plot-assignment.tsx:57/103 — and the API contract already
-- publishes `areaSqm` (web-app/src/lib/services/planting-service.types.ts:47).
-- area-utils.js:21-23 names this as the destination in as many words.
--
-- THE BACKFILL CONVERTS; IT DOES NOT COPY. Do not assume every stored row is
-- already square metres:
--
--   * Migration 20260725190000_area_to_sqm converted the rows that existed on
--     the day it ran, but it deliberately skips any row whose unit it does not
--     recognise, so a skipped row can still be sitting there.
--   * prisma/seed-gacp.js wrote `area: 1, areaUnit: 'rai'` on EVERY seed run
--     until 2026-08-26 — after that migration. Any database seeded in between
--     (demo, preview, CI) holds plots that are 1,600 m², not 1 m². That writer
--     is now fixed, which is what makes retiring the unit column reachable at
--     all; it does not retro-fix the rows already written, so this backfill has
--     to.
--
-- A row whose unit nothing can read gets areaSqm = NULL, not a guess. NULL is
-- visible and countable; a guess is a wrong number on a legal certificate. That
-- is the same refusal storedAreaToSqm makes by throwing, and the reason the
-- contract half cannot be scheduled until the NULL count is zero.
-- =============================================================================

-- ── 1. applications.cultivationScopeCount ────────────────────────────────────

-- NULLABLE, and that is the whole point of the expand window.
--
-- The first draft made this NOT NULL DEFAULT 1, reasoning that a writer which
-- knows nothing about the column would "still produce a correct row". It does
-- not. An image serving traffic mid-deploy writes an application with three
-- cultivation scopes: totalAreaTypes becomes 3 and cultivationScopeCount takes
-- the default 1. The reader is storedCultivationScopeCount(), which is
-- `cultivationScopeCount ?? totalAreaTypes` — and `??` does not fire on 1. The
-- row then prices as ONE scope when the applicant declared three, on every
-- quotation, invoice and receipt it touches.
--
-- NULL is the only value that means "this writer did not state a count", which
-- is exactly what the fallback needs to hear. plots.areaSqm below is nullable
-- for the identical reason; this column was the odd one out.
--
-- The contract half makes it NOT NULL, after the NULL count reaches zero and
-- no image that writes only totalAreaTypes is still serving.
ALTER TABLE "applications"
    ADD COLUMN IF NOT EXISTS "cultivationScopeCount" INTEGER;

UPDATE "applications"
SET "cultivationScopeCount" = COALESCE("totalAreaTypes", 1)
WHERE "cultivationScopeCount" IS DISTINCT FROM COALESCE("totalAreaTypes", 1);

-- ── 2. plots.areaSqm ─────────────────────────────────────────────────────────

-- Nullable on purpose. A row whose unit cannot be read must be distinguishable
-- from a row that is genuinely zero square metres; NOT NULL would force this
-- migration to invent a number for exactly the rows nobody understands.
ALTER TABLE "plots"
    ADD COLUMN IF NOT EXISTS "areaSqm" DOUBLE PRECISION;

-- The ratio table is the same one that already exists in three places — the
-- previous migration, shared/area-utils.js:40-53, and web-app/src/lib/area.ts:82-93.
-- They have to agree or the same row reads differently in each. It is joined in
-- as a VALUES list rather than pasted into both the SET and the WHERE, so this
-- file states each ratio exactly once and the guard cannot drift from the sum.
UPDATE "plots" AS p
SET "areaSqm" = (COALESCE(p."area", 0) * r.sqm_per_unit)::double precision
FROM (VALUES
        ('sqm', 1), ('rai', 1600), ('ngan', 400),
        ('sqwa', 4), ('square_wa', 4), ('squarewa', 4), ('sqw', 4), ('wa2', 4),
        ('ไร่', 1600), ('งาน', 400), ('ตารางวา', 4), ('ตารางเมตร', 1)
     ) AS r(unit, sqm_per_unit)
WHERE lower(trim(p."areaUnit")) = r.unit
  AND p."areaSqm" IS DISTINCT FROM (COALESCE(p."area", 0) * r.sqm_per_unit)::double precision;

-- ── 3. Keeping the pair honest during the expand window ──────────────────────
--
-- After this change every plot writer sets `areaSqm` alongside `area`
-- (planting-service.js createPlotForFarm, certificate-service.js plot.create,
-- application-submission-methods.js createMany, prisma/seed-gacp.js), so new
-- rows arrive correct. What these two UPDATEs exist for is the rows already in
-- the table, plus anything written by a process still running the previous
-- image during a rolling deploy. Both are therefore written to be RE-RUN:
--
--   * both are guarded by IS DISTINCT FROM, so a second run touches exactly the
--     rows whose new column disagrees with the old one and nothing else. That
--     includes a row whose `area` was EDITED since the last run, which an
--     `"areaSqm" IS NULL` guard would silently skip forever — the guard this
--     file carried before review and the reason it would have rotted the day a
--     plot-edit path lands;
--   * neither invents a value: a plot whose unit is unreadable stays NULL on
--     every run, however many times it is re-run.
--
-- Re-run them immediately before the contract migration, then take the counts
-- in (b) below. Nothing here installs a trigger to do that automatically: this
-- codebase has no database triggers at all, and a first one — invisible to
-- Prisma, absent from the schema the drift check compares against, and firing
-- on a write path two people are already debugging — buys less than it costs
-- for a window this short at a dataset this size.

-- =============================================================================
-- WHAT THE CONTRACT MIGRATION MUST DO, AND WHAT HAS TO BE TRUE FIRST
--
--   a. This change ships: migration, schema, readers, writers, together.
--      `prisma migrate deploy` runs first; the app image that knows the new
--      columns starts after it. Old columns keep their values throughout, so a
--      rollback to the previous image is still correct.
--   b. Count the damage before trusting anything:
--        SELECT count(*) FROM "plots" WHERE "areaSqm" IS NULL;
--        SELECT DISTINCT "areaUnit" FROM "plots" WHERE "areaSqm" IS NULL;
--      Every row listed there is a plot whose size the platform does not know.
--      Fix them by hand — do not widen the ratio table to make them disappear.
--   c. Let the deployed code drain. Nothing may still be reading `area`,
--      `areaUnit` or `totalAreaTypes`, and no previous image may still be
--      serving.
--   d. Then, and only then, the contract migration:
--        - re-run both backfills above (idempotent, IS DISTINCT FROM);
--        - ALTER TABLE "plots" ALTER COLUMN "areaSqm" SET NOT NULL;
--        - ALTER TABLE "plots" DROP COLUMN "area", DROP COLUMN "areaUnit";
--        - ALTER TABLE "applications" DROP COLUMN "totalAreaTypes";
--      and in the same change, in the code:
--        - delete shared/area-utils.js plotAreaSqm() and its callers' fallback,
--          and shared/application-scope.js storedCultivationScopeCount()'s
--          `?? totalAreaTypes`;
--        - drop `area`/`areaUnit` from every plot `select` — including
--          services/trace-service/resolve-plot-cycle.js:306, which selects both
--          and reads NEITHER (a dead select left untouched here only because
--          that file is under concurrent edit); it is a hard break, not a
--          silent one, so it will surface immediately;
--        - drop `area`/`areaUnit` from the web PlotOption type, and delete
--          web-app/src/lib/area.ts plotAreaSqm();
--        - drop the retired `area` inbound field from POST /farms/:farmId/plots
--          and from plantingService.createPlotForFarm, leaving `areaSqm` alone;
--        - remove `totalAreaTypes` from every writer's data object;
--        - migrations/CHANGELOG.md needs an entry — its rule exempts additive
--          migrations, which is why this file needs none and that one will.
--
-- NOT COVERED HERE, and not fixable by any migration: the wizard's plot JSON
-- inside applications.formData uses its own key names (`areaSize` + `areaUnit`,
-- read at application-submission-methods.js:87). That is document data, not a
-- column. Renaming the columns does not touch it, and it needs its own decision.
-- =============================================================================
