-- ✅ System deep-dive fix DBA F-04 (2026-05-15):
-- Compound + GIN indexes for the dominant query patterns surfaced by the
-- DBA review.
--
-- NOTE (CI fix): These indexes were originally written as
-- `CREATE INDEX CONCURRENTLY`. Prisma's migration engine wraps every
-- migration file in a single transaction, and Postgres forbids
-- `CREATE INDEX CONCURRENTLY` inside a transaction block — so the migration
-- failed to apply on the shadow database (`prisma migrate diff`) and on
-- `prisma migrate deploy` with:
--   "CREATE INDEX CONCURRENTLY cannot run inside a transaction block"
-- (Prisma 5.x does NOT auto-split CONCURRENTLY statements, contrary to the
-- previous comment here.) CONCURRENTLY has therefore been dropped so the
-- migration applies cleanly through Prisma.
--
-- Why IF NOT EXISTS: keeps the migration idempotent. If these indexes were
-- already created out-of-band on a live database (e.g. applied manually via
-- psql with CONCURRENTLY to avoid a write lock, or by the pre-existing
-- unregistered `add_performance_indexes.sql`), this migration skips them
-- rather than erroring — so no environment that already has the indexes is
-- affected, and fresh/test/shadow databases (empty tables → no lock) get
-- them created normally.
--
-- Operational note: if a large production table does NOT yet have these
-- indexes, create them out-of-band with `CREATE INDEX CONCURRENTLY` via psql
-- BEFORE running this migration, so the plain CREATE INDEX below becomes a
-- no-op (IF NOT EXISTS) and avoids a long write lock.

-- Application: compound (status, isDeleted) — every list/dashboard query
-- filters on both. Previously required bitmap-AND of two single indexes.
CREATE INDEX IF NOT EXISTS "applications_status_isDeleted_idx"
    ON "applications" ("status", "isDeleted");

-- Application: compound (healthId, isDeleted, status) — applicant's
-- own-applications listing in `routes/api/applications/applications.js`.
CREATE INDEX IF NOT EXISTS "applications_healthId_isDeleted_status_idx"
    ON "applications" ("healthId", "isDeleted", "status");

-- Application: GIN on workflowHistory Json — reviewer dashboard at
-- `routes/api/provider/handlers/reviewer.js:63-66` currently fetches
-- 1,000 rows then JS-side filters by formData.PROVIDERAssignment. With
-- this GIN index Postgres can filter server-side using the JSONB @> op.
CREATE INDEX IF NOT EXISTS "applications_workflowHistory_gin_idx"
    ON "applications" USING GIN ("workflowHistory");

-- AuditLog: compound (actorId, createdAt DESC) — "all actions by actor X
-- in the past N days" queries. Without this, must scan all actor-X
-- entries then filter by date.
-- NOTE: AuditLog.createdAt is @map("timestamp") in schema — the physical
-- column is "timestamp", so the raw SQL must reference "timestamp" (the index
-- NAME keeps the Prisma field-name convention "...createdAt...").
CREATE INDEX IF NOT EXISTS "audit_logs_actorId_createdAt_idx"
    ON "audit_logs" ("actorId", "timestamp" DESC);

-- AuditLog: compound (resourceType, resourceId, createdAt DESC) — "all
-- audit entries for application X chronologically" — the canonical
-- audit-trail-for-resource query.
CREATE INDEX IF NOT EXISTS "audit_logs_resourceType_resourceId_createdAt_idx"
    ON "audit_logs" ("resourceType", "resourceId", "timestamp" DESC);
