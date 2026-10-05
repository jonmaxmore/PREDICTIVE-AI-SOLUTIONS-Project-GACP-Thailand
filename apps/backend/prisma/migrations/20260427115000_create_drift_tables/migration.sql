-- ============================================================================
-- Backfill missing CREATE TABLE migrations for three Prisma models that were
-- introduced via `prisma db push` on production but never had a corresponding
-- migration generated. The Prisma schema declared:
--
--   • ScopeOfWork    -> "scope_of_works"
--   • AuditChecklist -> "audit_checklists"
--   • MeetingRoom    -> "meeting_rooms"
--
-- but no `CREATE TABLE` SQL was ever committed for them. The next migration
-- in the chain (20260427120100_add_organization_id_columns) tries to
-- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS "organizationId"` against these
-- tables, which fails on a fresh database with:
--
--   ERROR: relation "scope_of_works" does not exist
--
-- (PostgreSQL only treats `IF NOT EXISTS` as guarding the *column*; the
-- table itself must exist.) Production survived this drift only because
-- the tables already existed there from earlier `db push` operations.
--
-- IDEMPOTENCY (Strategy B):
--   • CREATE TABLE IF NOT EXISTS  — production tables are unchanged.
--   • CREATE INDEX IF NOT EXISTS  — production indexes are unchanged.
--   • FK ADD CONSTRAINT wrapped in DO/EXCEPTION so it is a no-op when the
--     constraint already exists (e.g. on production, where the FKs were
--     created out-of-band, or on a fresh DB after migration 120300 has
--     created them — though 120300 runs *after* this one).
--
-- COLUMN PARITY:
--   • These CREATE TABLE statements intentionally OMIT "organizationId"
--     so that the existing ALTER TABLE ADD COLUMN IF NOT EXISTS in
--     20260427120100 still operates correctly on a fresh DB (it adds
--     the column after this migration creates the table) and is a true
--     no-op on production (the column already exists).
--
-- TIMESTAMP ORDERING (operator note):
--   • This migration's directory uses timestamp 20260427115000 so it sorts
--     BEFORE 20260427120100. On a fresh database the ordering is:
--       115000 (this) -> 120000 (organizations) -> 120100 (alter columns).
--     Wait — 115000 sorts before 120000 too. That is intentional: only the
--     three tables created here are referenced in this migration, and they
--     do not depend on `organizations` (the FK to organizations is added
--     later in 120300, which runs after the organizations table exists).
--   • Because this migration is being inserted into the history *between*
--     existing applied migrations, production already has these tables.
--     The Prisma _prisma_migrations table will not contain a row for
--     20260427115000_create_drift_tables on production, so `prisma migrate
--     deploy` would attempt to apply it and the CREATE TABLE IF NOT EXISTS
--     statements would no-op cleanly. However, to keep the audit trail
--     accurate, the recommended one-time operator step on production is:
--
--       npx prisma migrate resolve --applied 20260427115000_create_drift_tables
--
--     before the next deploy. CI / fresh-DB / preview environments do not
--     need this — they apply the migration normally.
-- ============================================================================

-- ── scope_of_works ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "scope_of_works" (
    "id"                TEXT          NOT NULL,
    "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)  NOT NULL,

    "applicationId"     TEXT          NOT NULL,

    "title"             TEXT          NOT NULL,
    "description"       TEXT,
    "standardCode"      TEXT          NOT NULL DEFAULT 'GACP',
    "inspectionScope"   JSONB,
    "estimatedDays"     INTEGER       NOT NULL DEFAULT 1,

    "assignedAuditorId" TEXT,
    "assignedAuditor"   TEXT,

    "status"            TEXT          NOT NULL DEFAULT 'DRAFT',
    "approvedBy"        TEXT,
    "approvedAt"        TIMESTAMP(3),

    "createdBy"         TEXT,
    "updatedBy"         TEXT,

    CONSTRAINT "scope_of_works_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scope_of_works_applicationId_idx" ON "scope_of_works"("applicationId");
CREATE INDEX IF NOT EXISTS "scope_of_works_status_idx"        ON "scope_of_works"("status");

-- FK to applications(id) — wrapped for idempotency.
DO $$
BEGIN
    ALTER TABLE "scope_of_works"
        ADD CONSTRAINT "scope_of_works_applicationId_fkey"
        FOREIGN KEY ("applicationId") REFERENCES "applications"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ── audit_checklists ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "audit_checklists" (
    "id"             TEXT          NOT NULL,
    "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)  NOT NULL,

    "applicationId"  TEXT          NOT NULL,

    "templateName"   TEXT          NOT NULL,
    "version"        INTEGER       NOT NULL DEFAULT 1,

    "sections"       JSONB         NOT NULL,
    "completedItems" INTEGER       NOT NULL DEFAULT 0,
    "totalItems"     INTEGER       NOT NULL DEFAULT 0,
    "score"          DOUBLE PRECISION,

    "auditorId"      TEXT          NOT NULL,
    "auditorName"    TEXT,

    "status"         TEXT          NOT NULL DEFAULT 'IN_PROGRESS',
    "submittedAt"    TIMESTAMP(3),

    "createdBy"      TEXT,
    "updatedBy"      TEXT,

    CONSTRAINT "audit_checklists_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_checklists_applicationId_idx" ON "audit_checklists"("applicationId");
CREATE INDEX IF NOT EXISTS "audit_checklists_auditorId_idx"     ON "audit_checklists"("auditorId");
CREATE INDEX IF NOT EXISTS "audit_checklists_status_idx"        ON "audit_checklists"("status");

DO $$
BEGIN
    ALTER TABLE "audit_checklists"
        ADD CONSTRAINT "audit_checklists_applicationId_fkey"
        FOREIGN KEY ("applicationId") REFERENCES "applications"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ── meeting_rooms ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "meeting_rooms" (
    "id"             TEXT          NOT NULL,
    "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)  NOT NULL,

    "applicationId"  TEXT          NOT NULL,

    "roomName"       TEXT          NOT NULL,
    "roomUrl"        TEXT          NOT NULL,
    "provider"       TEXT          NOT NULL DEFAULT 'JITSI',
    "scheduledAt"    TIMESTAMP(3)  NOT NULL,
    "duration"       INTEGER       NOT NULL DEFAULT 60,

    "hostId"         TEXT          NOT NULL,
    "hostName"       TEXT,
    "participantIds" JSONB         NOT NULL,

    "status"         TEXT          NOT NULL DEFAULT 'SCHEDULED',
    "startedAt"      TIMESTAMP(3),
    "endedAt"        TIMESTAMP(3),
    "recordingUrl"   TEXT,

    "notes"          TEXT,

    "createdBy"      TEXT,

    CONSTRAINT "meeting_rooms_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "meeting_rooms_applicationId_idx" ON "meeting_rooms"("applicationId");
CREATE INDEX IF NOT EXISTS "meeting_rooms_scheduledAt_idx"   ON "meeting_rooms"("scheduledAt");
CREATE INDEX IF NOT EXISTS "meeting_rooms_status_idx"        ON "meeting_rooms"("status");

DO $$
BEGIN
    ALTER TABLE "meeting_rooms"
        ADD CONSTRAINT "meeting_rooms_applicationId_fkey"
        FOREIGN KEY ("applicationId") REFERENCES "applications"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
