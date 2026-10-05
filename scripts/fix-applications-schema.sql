-- Fix Prisma Schema Drift: applications.state + applications.version + other missing columns
-- The Prisma schema defines 'state' but DB has 'status'
-- Also adds other missing columns that Prisma expects

-- 1. Add 'state' column (copy from 'status')
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "state" TEXT NOT NULL DEFAULT 'DRAFT';
UPDATE "applications" SET "state" = "status" WHERE "state" = 'DRAFT' AND "status" != 'DRAFT';

-- 2. Add 'version' column
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "version" INT NOT NULL DEFAULT 1;

-- 3. Add missing payment columns
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "phase1Status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "phase1InvoiceId" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "phase1PaymentUrl" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "phase1ExpiresAt" TIMESTAMP(3);
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "phase2InvoiceId" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "phase2PaymentUrl" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "phase2Status" TEXT NOT NULL DEFAULT 'PENDING';

-- 4. Add missing role columns
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "reviewerProviderId" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "headAuditorProviderId" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "schedulerProviderId" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "auditorProviderId" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "sameReviewerAuditor" BOOLEAN NOT NULL DEFAULT false;

-- 5. Add missing workflow columns
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "certificationPurpose" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "previousCertNumber" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "consentedPDPA" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "auditNotes" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "appointmentMode" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "meetingUrl" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "appointmentLocation" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "auditMode" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "auditMeetingUrl" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "auditLocation" TEXT;

-- 6. Add missing data columns
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "formData" JSONB;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "personnelHygiene" JSONB;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "attachments" JSONB;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "workflowHistory" JSONB;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "supplementaryCriteria" JSONB;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "supplementarySkipped" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "previewData" JSONB;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "isPreviewReady" BOOLEAN NOT NULL DEFAULT false;

-- 7. Add missing lab/audit columns
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "labResults" JSONB;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "labResultStatus" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "labName" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "submissionHash" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "officialReceiptNumber" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- 8. Add missing PDPA/legal columns
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "createdByIp" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "updatedByIp" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "retainUntil" TIMESTAMP(3) NOT NULL DEFAULT NOW() + INTERVAL '5 years';
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "legalHold" BOOLEAN NOT NULL DEFAULT false;

-- 9. Add missing bundle column
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "bundleId" TEXT;

-- 10. Create indexes
CREATE INDEX IF NOT EXISTS "applications_state_idx" ON "applications"("state");
CREATE INDEX IF NOT EXISTS "applications_auditorProviderId_idx" ON "applications"("auditorProviderId");
CREATE INDEX IF NOT EXISTS "applications_bundleId_idx" ON "applications"("bundleId");
CREATE UNIQUE INDEX IF NOT EXISTS "applications_idempotencyKey_key" ON "applications"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "applications_phase1InvoiceId_key" ON "applications"("phase1InvoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "applications_phase2InvoiceId_key" ON "applications"("phase2InvoiceId");
