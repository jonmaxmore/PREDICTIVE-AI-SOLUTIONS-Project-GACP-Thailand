-- ============================================================================
-- Add Organization table — Phase 1 of multi-tenancy foundation (ADR-014)
--
-- Background:
--   The platform is moving from single-tenant to multi-tenant. This migration
--   introduces the Organization entity ONLY. No existing tables are modified.
--   Subsequent phases will:
--     Phase 2 — add nullable organizationId FKs on tenant-scoped tables
--     Phase 3 — backfill all existing rows with the default Organization
--     Phase 4 — alter columns to NOT NULL + add composite indexes
--     Phase 5 — enable Postgres Row-Level Security
--
--   This migration is intentionally additive and reversible. It does not yet
--   change any application behavior — application code must opt-in to using
--   Organization in a separate change once the table is populated.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "organizations" (
    "id"            TEXT         NOT NULL,
    "uuid"          TEXT         NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    "name"          TEXT         NOT NULL,
    "slug"          TEXT         NOT NULL,
    "code"          TEXT         NOT NULL,

    "type"          TEXT         NOT NULL DEFAULT 'PRIVATE_CERTIFIER',
    "isolationTier" TEXT         NOT NULL DEFAULT 'SHARED',
    "status"        TEXT         NOT NULL DEFAULT 'ACTIVE',

    "locale"        TEXT         NOT NULL DEFAULT 'th-TH',
    "timezone"      TEXT         NOT NULL DEFAULT 'Asia/Bangkok',

    "contactEmail"  TEXT,
    "legalName"     TEXT,
    "taxId"         TEXT,
    "taxIdHash"     TEXT,

    "settings"      JSONB        NOT NULL DEFAULT '{}'::jsonb,

    "createdBy"     TEXT,
    "updatedBy"     TEXT,

    "isDeleted"     BOOLEAN      NOT NULL DEFAULT false,
    "deletedAt"     TIMESTAMP(3),
    "deletedBy"     TEXT,
    "deleteReason"  TEXT,
    "retainUntil"   TIMESTAMP(3) NOT NULL DEFAULT (NOW() + INTERVAL '5 years'),
    "legalHold"     BOOLEAN      NOT NULL DEFAULT false,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_uuid_key"      ON "organizations"("uuid");
CREATE UNIQUE INDEX "organizations_slug_key"      ON "organizations"("slug");
CREATE UNIQUE INDEX "organizations_code_key"      ON "organizations"("code");
CREATE UNIQUE INDEX "organizations_taxIdHash_key" ON "organizations"("taxIdHash");

CREATE INDEX "organizations_status_idx"        ON "organizations"("status");
CREATE INDEX "organizations_type_idx"          ON "organizations"("type");
CREATE INDEX "organizations_isolationTier_idx" ON "organizations"("isolationTier");

-- Seed the default Organization so existing single-tenant data has a home
-- once Phase 2 introduces the FK columns. Any later backfill script can refer
-- to this row by its stable slug 'default'.
INSERT INTO "organizations" (
    "id", "uuid", "updatedAt",
    "name", "slug", "code",
    "type", "isolationTier", "status",
    "locale", "timezone",
    "createdBy"
) VALUES (
    gen_random_uuid()::text,
    gen_random_uuid()::text,
    CURRENT_TIMESTAMP,
    'Default Organization',
    'default',
    'DEFAULT',
    'INTERNAL',
    'SHARED',
    'ACTIVE',
    'th-TH',
    'Asia/Bangkok',
    'system'
)
ON CONFLICT ("slug") DO NOTHING;
