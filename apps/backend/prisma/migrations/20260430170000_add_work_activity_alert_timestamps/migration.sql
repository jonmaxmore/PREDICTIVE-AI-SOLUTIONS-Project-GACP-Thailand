-- ADR-016 Phase 1B — alert dedup columns on work_activities.
--
-- The Phase 1A cron will run hourly to surface activities approaching or
-- past their SLA deadline. To avoid spamming the same notification every
-- hour for a long-overdue row, we track when the warning and breach
-- alerts were last dispatched. The cron then only fires:
--
--   warning  → IF warningAt <= now AND warnedAt IS NULL
--   breach   → IF dueAt <= now AND breachedAt IS NULL
--
-- Once the activity is claimed/done/cancelled, no further alerts fire
-- regardless of these columns.

BEGIN;

ALTER TABLE "work_activities"
    ADD COLUMN IF NOT EXISTS "warnedAt"   TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "breachedAt" TIMESTAMP(3);

COMMIT;
