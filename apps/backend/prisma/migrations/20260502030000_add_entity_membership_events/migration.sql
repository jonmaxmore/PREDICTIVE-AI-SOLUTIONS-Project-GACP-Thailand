-- Wave C — schema-drift reconciliation (auto-generated, idempotent).
--
-- Bridges the gap between prisma/migrations history and prisma/schema.
-- Every operation is safe to apply against:
--   1. A fresh DB (creates everything to schema state)
--   2. A partially-migrated DB
--   3. A DB already in target state (no-op)
--
-- Re-generate with:
--   prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema --shadow-database-url <url> --script | node scripts/idempotify-drift.js > apps/backend/prisma/migrations/<ts>_reconcile_drift/migration.sql

-- CreateTable

CREATE TABLE IF NOT EXISTS "entity_membership_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "targetUserId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" VARCHAR(512),
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "entity_membership_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entity_membership_events_entityId_createdAt_idx" ON "entity_membership_events"("entityId", "createdAt" DESC);

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entity_membership_events_actorUserId_idx" ON "entity_membership_events"("actorUserId");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entity_membership_events_targetUserId_idx" ON "entity_membership_events"("targetUserId");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entity_membership_events_eventType_idx" ON "entity_membership_events"("eventType");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entity_membership_events_organizationId_idx" ON "entity_membership_events"("organizationId");

-- AddForeignKey

DO $$ BEGIN
  ALTER TABLE IF EXISTS "entity_membership_events" ADD CONSTRAINT "entity_membership_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN duplicate_alias THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN undefined_function THEN NULL;
END $$;

-- AddForeignKey

DO $$ BEGIN
  ALTER TABLE IF EXISTS "entity_membership_events" ADD CONSTRAINT "entity_membership_events_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN duplicate_alias THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN undefined_function THEN NULL;
END $$;

-- AddForeignKey

DO $$ BEGIN
  ALTER TABLE IF EXISTS "entity_membership_events" ADD CONSTRAINT "entity_membership_events_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN duplicate_alias THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN undefined_function THEN NULL;
END $$;

-- AddForeignKey

DO $$ BEGIN
  ALTER TABLE IF EXISTS "entity_membership_events" ADD CONSTRAINT "entity_membership_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN duplicate_alias THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN undefined_function THEN NULL;
END $$;
