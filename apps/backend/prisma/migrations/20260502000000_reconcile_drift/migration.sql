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

-- DropForeignKey

ALTER TABLE IF EXISTS "application_bundles" DROP CONSTRAINT IF EXISTS "application_bundles_userId_fkey";

-- DropForeignKey

ALTER TABLE IF EXISTS "application_comments" DROP CONSTRAINT IF EXISTS "application_comments_applicationId_fkey";

-- DropForeignKey

ALTER TABLE IF EXISTS "application_drafts" DROP CONSTRAINT IF EXISTS "application_drafts_userId_fkey";

-- DropForeignKey

ALTER TABLE IF EXISTS "applications" DROP CONSTRAINT IF EXISTS "applications_healthId_fkey";

-- DropForeignKey

ALTER TABLE IF EXISTS "invoices" DROP CONSTRAINT IF EXISTS "invoices_applicationId_fkey";

-- DropForeignKey

ALTER TABLE IF EXISTS "invoices" DROP CONSTRAINT IF EXISTS "invoices_subscriptionId_fkey";

-- DropForeignKey

ALTER TABLE IF EXISTS "maker_audit_logs" DROP CONSTRAINT IF EXISTS "maker_audit_logs_applicationId_fkey";

-- DropForeignKey

ALTER TABLE IF EXISTS "maker_audit_logs" DROP CONSTRAINT IF EXISTS "maker_audit_logs_auditorId_fkey";

-- DropIndex

DROP INDEX IF EXISTS "application_bundles_status_idx";

-- DropIndex

DROP INDEX IF EXISTS "application_bundles_userId_idx";

-- DropIndex

DROP INDEX IF EXISTS "application_comments_auditorId_idx";

-- DropIndex

DROP INDEX IF EXISTS "application_comments_type_idx";

-- DropIndex

DROP INDEX IF EXISTS "application_drafts_lastSavedAt_idx";

-- DropIndex

DROP INDEX IF EXISTS "applications_formData_idx";

-- DropIndex

DROP INDEX IF EXISTS "applications_isDeleted_idx";

-- DropIndex

DROP INDEX IF EXISTS "invoices_subscriptionId_idx";

-- DropIndex

DROP INDEX IF EXISTS "meeting_rooms_hostId_idx";

-- DropIndex

DROP INDEX IF EXISTS "payment_slips_subscriptionId_idx";

-- DropIndex

DROP INDEX IF EXISTS "scope_of_works_assignedAuditorId_idx";

-- DropIndex

DROP INDEX IF EXISTS "users_accountTier_idx";

-- DropIndex

DROP INDEX IF EXISTS "users_authType_idx";

-- DropIndex

DROP INDEX IF EXISTS "users_isDeleted_idx";

-- DropIndex

DROP INDEX IF EXISTS "users_ministryVerified_idx";

-- AlterTable

ALTER TABLE IF EXISTS "application_bundles" DROP COLUMN IF EXISTS "bundleName",
DROP COLUMN IF EXISTS "bundleType",
DROP COLUMN IF EXISTS "discount",
DROP COLUMN IF EXISTS "finalFee",
DROP COLUMN IF EXISTS "paidAmount",
DROP COLUMN IF EXISTS "paymentStatus",
DROP COLUMN IF EXISTS "reviewedAt",
DROP COLUMN IF EXISTS "reviewedBy",
DROP COLUMN IF EXISTS "submittedAt",
DROP COLUMN IF EXISTS "submittedBy",
DROP COLUMN IF EXISTS "totalFee",
DROP COLUMN IF EXISTS "userId",
ADD COLUMN IF NOT EXISTS "bundleNumber" TEXT NOT NULL,
ADD COLUMN IF NOT EXISTS "healthId" TEXT NOT NULL;

-- AlterTable

ALTER TABLE IF EXISTS "application_comments" DROP COLUMN IF EXISTS "attachments",
DROP COLUMN IF EXISTS "auditorId",
DROP COLUMN IF EXISTS "commentText",
DROP COLUMN IF EXISTS "resolvedAt",
DROP COLUMN IF EXISTS "resolvedBy",
DROP COLUMN IF EXISTS "type",
ADD COLUMN IF NOT EXISTS "authorId" TEXT NOT NULL,
ADD COLUMN IF NOT EXISTS "content" TEXT NOT NULL,
ADD COLUMN IF NOT EXISTS "internalOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL;

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "applications" ADD COLUMN IF NOT EXISTS "consentedPDPA" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "entityId" TEXT,
  ADD COLUMN IF NOT EXISTS "previousCertNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "submitterId" TEXT,
  ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';
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

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "certificates" DROP COLUMN IF EXISTS "farmerName",
  ADD COLUMN IF NOT EXISTS "applicantName" TEXT NOT NULL,
  ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';
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

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "document_templates" ALTER COLUMN "id" DROP DEFAULT;
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

-- AlterTable

ALTER TABLE IF EXISTS "farms" ADD COLUMN IF NOT EXISTS "entityId" TEXT;

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "invoices" ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '7 years';
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

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "organizations" ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';
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

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "payment_slips" ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '7 years';
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

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "report_submissions" ALTER COLUMN "id" DROP DEFAULT;
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

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "role_groups" ALTER COLUMN "updatedAt" DROP DEFAULT;
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

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "sla_policies" ALTER COLUMN "updatedAt" DROP DEFAULT;
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

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "sop_documents" ALTER COLUMN "id" DROP DEFAULT;
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

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "stage_activity_configs" ALTER COLUMN "updatedAt" DROP DEFAULT;
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

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "users" DROP COLUMN IF EXISTS "verificationAttempts",
  DROP COLUMN IF EXISTS "verificationDocuments",
  DROP COLUMN IF EXISTS "verificationLockedUntil",
  DROP COLUMN IF EXISTS "verificationNote",
  DROP COLUMN IF EXISTS "verificationStatus",
  DROP COLUMN IF EXISTS "verificationSubmittedAt",
  ADD COLUMN IF NOT EXISTS "entityType" TEXT,
  ALTER COLUMN "accountType" SET DEFAULT 'HEALTH',
  ALTER COLUMN "role" SET DEFAULT 'HEALTH',
  ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';
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

-- AlterTable

DO $$ BEGIN
  ALTER TABLE IF EXISTS "work_activities" ALTER COLUMN "updatedAt" DROP DEFAULT;
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

-- DropTable

DROP TABLE IF EXISTS "dtam_staff" CASCADE;

-- DropTable

DROP TABLE IF EXISTS "maker_audit_logs" CASCADE;

-- DropTable

DROP TABLE IF EXISTS "system_config" CASCADE;

-- CreateTable

CREATE TABLE IF NOT EXISTS "entity_context_switches" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "fromEntityId" TEXT,
    "toEntityId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" VARCHAR(512),
    "source" TEXT NOT NULL DEFAULT 'HEADER',
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "entity_context_switches_pkey" PRIMARY KEY ("id")
);

-- CreateTable

CREATE TABLE IF NOT EXISTS "entities" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "thaiCitizenId" TEXT,
    "thaiCitizenIdHash" TEXT,
    "juristicId" TEXT,
    "juristicIdHash" TEXT,
    "communityRegNo" TEXT,
    "communityRegNoHash" TEXT,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdBy" TEXT,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable

CREATE TABLE IF NOT EXISTS "entity_memberships" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invitedBy" TEXT,
    "invitedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "entity_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable

CREATE TABLE IF NOT EXISTS "role_job_descriptions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "roleCode" TEXT NOT NULL,
    "titleTH" TEXT NOT NULL,
    "titleEN" TEXT NOT NULL,
    "descriptionTH" TEXT NOT NULL,
    "descriptionEN" TEXT NOT NULL,
    "responsibilities" JSONB NOT NULL,
    "permissions" JSONB NOT NULL,
    "slaTargets" JSONB,
    "kpiDefinitions" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "role_job_descriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entity_context_switches_userId_createdAt_idx" ON "entity_context_switches"("userId", "createdAt" DESC);

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entity_context_switches_toEntityId_idx" ON "entity_context_switches"("toEntityId");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entity_context_switches_organizationId_idx" ON "entity_context_switches"("organizationId");

-- CreateIndex

CREATE UNIQUE INDEX IF NOT EXISTS "entities_uuid_key" ON "entities"("uuid");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entities_organizationId_idx" ON "entities"("organizationId");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entities_type_idx" ON "entities"("type");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entities_status_idx" ON "entities"("status");

-- CreateIndex

CREATE UNIQUE INDEX IF NOT EXISTS "entities_type_thaiCitizenIdHash_key" ON "entities"("type", "thaiCitizenIdHash");

-- CreateIndex

CREATE UNIQUE INDEX IF NOT EXISTS "entities_type_juristicIdHash_key" ON "entities"("type", "juristicIdHash");

-- CreateIndex

CREATE UNIQUE INDEX IF NOT EXISTS "entities_type_communityRegNoHash_key" ON "entities"("type", "communityRegNoHash");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entity_memberships_entityId_idx" ON "entity_memberships"("entityId");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entity_memberships_userId_idx" ON "entity_memberships"("userId");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entity_memberships_status_idx" ON "entity_memberships"("status");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "entity_memberships_organizationId_idx" ON "entity_memberships"("organizationId");

-- CreateIndex

CREATE UNIQUE INDEX IF NOT EXISTS "entity_memberships_userId_entityId_key" ON "entity_memberships"("userId", "entityId");

-- CreateIndex

CREATE UNIQUE INDEX IF NOT EXISTS "role_job_descriptions_roleCode_key" ON "role_job_descriptions"("roleCode");

-- CreateIndex

CREATE UNIQUE INDEX IF NOT EXISTS "application_bundles_bundleNumber_key" ON "application_bundles"("bundleNumber");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "application_bundles_healthId_idx" ON "application_bundles"("healthId");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "application_comments_authorId_idx" ON "application_comments"("authorId");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "applications_entityId_idx" ON "applications"("entityId");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "applications_submitterId_idx" ON "applications"("submitterId");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "applications_auditorId_idx" ON "applications"("auditorId");

-- CreateIndex

CREATE INDEX IF NOT EXISTS "farms_entityId_idx" ON "farms"("entityId");

-- CreateIndex

CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_gatewayRef_key" ON "payment_transactions"("gatewayRef");

-- CreateIndex

CREATE UNIQUE INDEX IF NOT EXISTS "trace_qr_security_qrCode_key" ON "trace_qr_security"("qrCode");

-- AddForeignKey

DO $$ BEGIN
  ALTER TABLE IF EXISTS "applications" ADD CONSTRAINT "applications_healthId_fkey" FOREIGN KEY ("healthId") REFERENCES "users"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "applications" ADD CONSTRAINT "applications_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "applications" ADD CONSTRAINT "applications_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "application_comments" ADD CONSTRAINT "application_comments_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "application_drafts" ADD CONSTRAINT "application_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "application_bundles" ADD CONSTRAINT "application_bundles_healthId_fkey" FOREIGN KEY ("healthId") REFERENCES "users"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "invoices" ADD CONSTRAINT "invoices_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "invoices" ADD CONSTRAINT "invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "plant_units" ADD CONSTRAINT "plant_units_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "planting_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "plant_units" ADD CONSTRAINT "plant_units_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "harvest_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "cultivation_logs" ADD CONSTRAINT "cultivation_logs_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "planting_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "entity_context_switches" ADD CONSTRAINT "entity_context_switches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "entity_context_switches" ADD CONSTRAINT "entity_context_switches_fromEntityId_fkey" FOREIGN KEY ("fromEntityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "entity_context_switches" ADD CONSTRAINT "entity_context_switches_toEntityId_fkey" FOREIGN KEY ("toEntityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "entity_context_switches" ADD CONSTRAINT "entity_context_switches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "entities" ADD CONSTRAINT "entities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "entity_memberships" ADD CONSTRAINT "entity_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "entity_memberships" ADD CONSTRAINT "entity_memberships_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "entity_memberships" ADD CONSTRAINT "entity_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
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
  ALTER TABLE IF EXISTS "farms" ADD CONSTRAINT "farms_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
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

-- RenameIndex

DO $$ BEGIN
  ALTER INDEX "bank_accounts_active_default_phase_idx" RENAME TO "bank_accounts_organizationId_isActive_defaultForPhase_effec_idx";
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

-- RenameIndex

DO $$ BEGIN
  ALTER INDEX "bank_accounts_org_active_idx" RENAME TO "bank_accounts_organizationId_isActive_idx";
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

-- RenameIndex

DO $$ BEGIN
  ALTER INDEX "bank_accounts_org_bank_account_unique" RENAME TO "bank_accounts_organizationId_bankCode_accountNumber_key";
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

-- RenameIndex

DO $$ BEGIN
  ALTER INDEX "payment_slips_app_phase_status_idx" RENAME TO "payment_slips_applicationId_phase_status_idx";
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

-- RenameIndex

DO $$ BEGIN
  ALTER INDEX "payment_slips_invoice_idx" RENAME TO "payment_slips_invoiceId_idx";
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

-- RenameIndex

DO $$ BEGIN
  ALTER INDEX "payment_slips_org_status_idx" RENAME TO "payment_slips_organizationId_status_idx";
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

-- RenameIndex

DO $$ BEGIN
  ALTER INDEX "payment_slips_status_created_idx" RENAME TO "payment_slips_status_createdAt_idx";
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

-- RenameIndex

DO $$ BEGIN
  ALTER INDEX "report_submissions_cert_type_month_year_key" RENAME TO "report_submissions_certificateId_reportType_reportMonth_rep_key";
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

-- RenameIndex

DO $$ BEGIN
  ALTER INDEX "report_submissions_year_month_idx" RENAME TO "report_submissions_reportYear_reportMonth_idx";
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

-- RenameIndex

DO $$ BEGIN
  ALTER INDEX "stage_activity_configs_unique" RENAME TO "stage_activity_configs_workflowStage_workType_key";
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

-- RenameIndex

DO $$ BEGIN
  ALTER INDEX "stage_activity_configs_workflowStage_idx" RENAME TO "stage_activity_configs_workflowStage_isActive_idx";
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

-- RenameIndex

DO $$ BEGIN
  ALTER INDEX "users_idCardHash_key" RENAME TO "users_idCardHash_deprecated_key";
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

-- Replace partial unique indexes with non-partial ones to match the
-- @unique declarations in prisma/schema. The 2026-03-06 migration created
-- these as partial (WHERE col IS NOT NULL) which Postgres handles fine
-- but Prisma's drift detector flags as non-matching.
DROP INDEX IF EXISTS "payment_transactions_gatewayRef_key";
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_gatewayRef_key" ON "payment_transactions"("gatewayRef");

DROP INDEX IF EXISTS "trace_qr_security_qrCode_key";
CREATE UNIQUE INDEX IF NOT EXISTS "trace_qr_security_qrCode_key" ON "trace_qr_security"("qrCode");

-- Re-apply retainUntil defaults to match the schema's canonical form.
-- Postgres normalises both inputs to the same internal representation
-- (`(now() + 'N years'::interval)`), so this is a no-op idempotently;
-- it just lets prisma migrate diff stop flagging cosmetic differences.
ALTER TABLE IF EXISTS "applications"   ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';
ALTER TABLE IF EXISTS "certificates"   ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';
ALTER TABLE IF EXISTS "invoices"       ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '7 years';
ALTER TABLE IF EXISTS "organizations"  ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';
ALTER TABLE IF EXISTS "payment_slips"  ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '7 years';
ALTER TABLE IF EXISTS "users"          ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';
