-- R-HOTFIX-PDPA step 2 EXPAND — users.isAnonymized / users.anonymizedAt
-- (operator decision 2026-08-03; evidence/R-HOTFIX-PDPA/notes.md).
--
-- jobs/pdpa-retention-job.js has filtered on `isAnonymized` and written
-- `isAnonymized` / `anonymizedAt` since Sprint 6, against columns that existed in
-- NO schema file and NO migration. The mocked unit suite accepted any field name,
-- so the gap stayed invisible until
-- __tests__/integration/pdpa-retention-legal-hold.test.js reached a real Postgres
-- and the sweep threw. This migration is the missing half.
--
-- The pair is the sweep's completion marker, and the marker is what makes the
-- sweep idempotent: anonymization nulls the identity columns AND their hashes but
-- deliberately never moves `retainUntil` (the legal-hold guard forbids this job
-- writing that column), so without the flag an anonymized row stays a candidate
-- and is re-swept every night with no record that it was ever done.
--
-- EXPAND only (the project rules 3.10): additive, idempotent, nothing altered or dropped.
-- Every existing row becomes isAnonymized = false through the column default,
-- which is the truthful value — none of them has been anonymized. NOT NULL is
-- therefore safe and leaves no NULL state for readers to special-case; a nullable
-- flag would force every query to spell `= false OR IS NULL`, and Prisma rejects a
-- null predicate on a required scalar. anonymizedAt stays nullable: NULL means
-- "never anonymized", and back-filling a timestamp we do not have would be
-- fabricating an audit trail. NO backfill of existing rows is performed.
--
-- On PostgreSQL 11+ ADD COLUMN ... DEFAULT is a catalog-only rewrite-free
-- operation, so this takes a brief ACCESS EXCLUSIVE lock on "users" and no table
-- scan.
--
-- NO INDEX — deliberate; see evidence/R-HOTFIX-PDPA/notes.md for the full
-- reasoning. Short version: the sweep's selective predicate is `retainUntil <=
-- now()`, not this flag. `isAnonymized = false` matches essentially the whole
-- table (production legalHold/at-risk counts are 0 rows and no row has ever been
-- swept), so a plain b-tree on a two-valued column the planner would decline to
-- use is pure write amplification on the platform's hottest table. If the nightly
-- 02:30 cron ever shows up in pg_stat_statements the right answer is a PARTIAL
-- index, `("retainUntil") WHERE "legalHold" = false AND "isAnonymized" = false`,
-- built with CREATE INDEX CONCURRENTLY — which cannot run inside a transaction
-- block and so belongs in its own migration, not this one.
--
-- Rollback (manual):
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "anonymizedAt";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "isAnonymized";

BEGIN;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "isAnonymized" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "anonymizedAt" TIMESTAMP(3);

COMMIT;
