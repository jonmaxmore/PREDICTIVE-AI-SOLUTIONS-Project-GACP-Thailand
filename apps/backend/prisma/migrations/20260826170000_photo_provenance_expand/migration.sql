-- =============================================================================
-- A photograph records where it was taken, when, and what it looks like.
-- =============================================================================
--
-- WHY. Onsite evidence is counted by DISTINCT fileHash. Every adversarial round
-- so far has found another way to satisfy that count without evidence, and the
-- last one needed no cleverness at all: one real photograph, re-saved by sharp
-- at four qualities plus one byte-flip, produced five distinct SHA-256 digests
-- and satisfied a minimum of five. Re-encoding strips EXIF for free, so the
-- copies arrived cleaner than the original.
--
-- Duplicate detection is not how the industry answers this, because it cannot
-- be: an auditor photographing the same shed twice from the same doorway
-- legitimately produces near-identical frames, so any threshold tight enough to
-- catch reuse also catches honest work. The answer is PROVENANCE — bind the
-- capture to a place, to a time, and to what the frame looks like, then put the
-- three in front of a human. These columns are that record.
--
-- EXPAND ONLY. Every column is ADDED and NULLABLE, with NO DEFAULT. Nothing is
-- dropped, renamed, or backfilled, and no existing column changes meaning. The
-- migration is safe to run against a live table (ADD COLUMN ... NULL takes no
-- table rewrite on PostgreSQL 11+), and safe to run before the new application
-- image serves traffic, which is the deploy order `prisma migrate deploy`
-- already enforces. There is no contract half to schedule: nothing is retired.
--
-- WHY NO DEFAULT, stated because a default here would be the whole bug. A
-- default would write an answer into rows nobody measured. Every row that
-- exists today was uploaded before any of this ran, and the honest value for
-- those rows is "we do not know", which in SQL is NULL. A reader must render
-- NULL as ไม่ได้บันทึก / "not recorded" and never as a blank beside rows that
-- read MEASURED or INSIDE — a blank next to a tick reads as agreement.
-- audit-onsite-service.reviewPhotoProvenance() is the reader that does this,
-- and it maps every NULL to an explicit NOT_RECORDED verdict rather than
-- letting it fall through as "fine".
--
-- NOTHING REFUSES ON THESE. onsite-evidence-gate.js does not read a single one
-- of them and must not start: gating on distance strands the auditor whose farm
-- has wrong coordinates, whose farm is larger than any tolerance, or who is
-- standing inside a greenhouse, while the one person willing to cheat simply
-- edits the coordinates he is sending. Recording makes the fact reviewable,
-- which is what the insurance industry does with an adjuster's photographs.
--
-- This SQL ships in the same change as prisma/schema/audit-onsite-evidence.prisma
-- and the writing code, because .github/workflows/ci.yml lists
-- `migration-drift-check` in build-success `needs:` and that job diffs the
-- migration chain against the schema; either half landing alone turns a
-- required gate red. Same shape as 20260824100000_plot_permanent_code_expand
-- and 20260826090000_area_sqm_and_cultivation_scope_expand.
-- -----------------------------------------------------------------------------

-- Layer A — where. Haversine metres from THIS photograph's coordinates to the
-- farm on the parent Application. farmDistanceStatus says whether the number
-- means anything: MEASURED (a number is present), FARM_LOCATION_UNKNOWN (our
-- records have no coordinates for the farm — a fact about us, not the auditor),
-- UNAVAILABLE (the lookup itself failed; the upload still succeeded, because
-- capturing evidence must never depend on reading metadata about it).
ALTER TABLE "farm_audit_photos" ADD COLUMN IF NOT EXISTS "farmDistanceMeters" DOUBLE PRECISION;
ALTER TABLE "farm_audit_photos" ADD COLUMN IF NOT EXISTS "farmDistanceStatus" TEXT;

-- Layer B — when. captureTimeSource is deliberately weak-worded:
-- CALLER_SUPPLIED_UNVERIFIED means a timestamp arrived with the request and
-- nothing more, because the route substitutes its own clock when the client
-- sends none and no EXIF parser exists in this tree; SERVER_RECEIPT means the
-- stored capturedAt is the moment the bytes landed, which is strictly after the
-- shutter. captureWindowSource records which clock the window came from
-- (INSPECTION_START = the auditor's own check-in row, the only observed event
-- available; SCHEDULED_DATE = the planned visit day in Asia/Bangkok; NONE).
-- captureWindowOffsetSec is signed: negative means the photograph was taken
-- BEFORE the window opened, which is the reading that matters.
ALTER TABLE "farm_audit_photos" ADD COLUMN IF NOT EXISTS "captureTimeSource" TEXT;
ALTER TABLE "farm_audit_photos" ADD COLUMN IF NOT EXISTS "captureWindowSource" TEXT;
ALTER TABLE "farm_audit_photos" ADD COLUMN IF NOT EXISTS "captureWindowStatus" TEXT;
ALTER TABLE "farm_audit_photos" ADD COLUMN IF NOT EXISTS "captureWindowOffsetSec" INTEGER;

-- Layer C — what it looks like. 64-bit dHash as 16 hex characters, from
-- services/crypto/perceptual-hash.js, which documents that its highlighting
-- threshold is PROVISIONAL and could not be calibrated because this repo owns
-- no real farm photographs. perceptualHashAlgo carries the algorithm name so a
-- later recalibration or a different hash cannot be compared against these rows
-- by accident — a Hamming distance between two different algorithms is noise
-- that would read as a number.
ALTER TABLE "farm_audit_photos" ADD COLUMN IF NOT EXISTS "perceptualHash" TEXT;
ALTER TABLE "farm_audit_photos" ADD COLUMN IF NOT EXISTS "perceptualHashAlgo" TEXT;

-- No index. The only reader walks one audit's photographs
-- (reviewPhotoProvenance), and "farm_audit_photos"."auditId" is already indexed;
-- a perceptual hash is not looked up by equality anyway — near-duplicates differ
-- in their bits by definition, which is the entire point of having one.

-- ROLLBACK (only ever needed if the release is pulled before anything reads
-- these; the columns are additive and inert, so leaving them in place is also a
-- valid rollback):
--   ALTER TABLE "farm_audit_photos"
--     DROP COLUMN IF EXISTS "farmDistanceMeters",
--     DROP COLUMN IF EXISTS "farmDistanceStatus",
--     DROP COLUMN IF EXISTS "captureTimeSource",
--     DROP COLUMN IF EXISTS "captureWindowSource",
--     DROP COLUMN IF EXISTS "captureWindowStatus",
--     DROP COLUMN IF EXISTS "captureWindowOffsetSec",
--     DROP COLUMN IF EXISTS "perceptualHash",
--     DROP COLUMN IF EXISTS "perceptualHashAlgo";
