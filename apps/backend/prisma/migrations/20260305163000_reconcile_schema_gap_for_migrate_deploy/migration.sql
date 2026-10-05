BEGIN;

ALTER TABLE "application_comments" DROP CONSTRAINT IF EXISTS "application_comments_applicationId_fkey";
ALTER TABLE "application_comments"
  ADD CONSTRAINT "application_comments_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "applications"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "labName" TEXT,
  ADD COLUMN IF NOT EXISTS "labResultStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "labResults" JSONB;
ALTER TABLE "applications" ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';

ALTER TABLE "certificates" ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';
ALTER TABLE "cultivation_logs" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "harvest_batches"
  ADD COLUMN IF NOT EXISTS "qrCode" TEXT,
  ADD COLUMN IF NOT EXISTS "trackingUrl" TEXT;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptIssuedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "receiptIssuedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptNumber" TEXT;
ALTER TABLE "invoices" ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '7 years';

ALTER TABLE "lots" ADD COLUMN IF NOT EXISTS "printedAt" TIMESTAMP(3);
ALTER TABLE "plant_units" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "planting_cycles" ADD COLUMN IF NOT EXISTS "estimatedPlantCount" INTEGER DEFAULT 0;
ALTER TABLE "system_configs" ALTER COLUMN "value" SET DEFAULT '';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "notificationSettings" JSONB,
  ADD COLUMN IF NOT EXISTS "privacySettings" JSONB,
  ADD COLUMN IF NOT EXISTS "twoFactorBackupCodes" JSONB,
  ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT;
ALTER TABLE "users" ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';

CREATE TABLE IF NOT EXISTS "application_drafts" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastSavedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  "plantId" TEXT,
  "serviceType" TEXT NOT NULL DEFAULT 'NEW',
  "currentStep" INTEGER NOT NULL DEFAULT 0,
  "formData" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  CONSTRAINT "application_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "site_analyses" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "farmId" TEXT NOT NULL,
  "analysisDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "analysisType" TEXT NOT NULL,
  "previousLandUse" TEXT,
  "yearsOfHistory" INTEGER,
  "hasChemicalHistory" BOOLEAN NOT NULL DEFAULT false,
  "chemicalDetails" TEXT,
  "soilPH" DOUBLE PRECISION,
  "soilOrganic" DOUBLE PRECISION,
  "soilNitrogen" DOUBLE PRECISION,
  "soilPhosphorus" DOUBLE PRECISION,
  "soilPotassium" DOUBLE PRECISION,
  "soilHeavyMetals" JSONB,
  "soilReportUrl" TEXT,
  "waterPH" DOUBLE PRECISION,
  "waterEC" DOUBLE PRECISION,
  "waterColiform" DOUBLE PRECISION,
  "waterHeavyMetals" JSONB,
  "waterReportUrl" TEXT,
  "bufferZoneMeters" INTEGER,
  "nearbyPollution" TEXT,
  "floodRisk" TEXT,
  "riskLevel" TEXT,
  "riskDetails" TEXT,
  "mitigationPlan" TEXT,
  "passedCriteria" BOOLEAN NOT NULL DEFAULT false,
  "verifiedBy" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "notes" TEXT,
  CONSTRAINT "site_analyses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "training_records" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "farmId" TEXT NOT NULL,
  "personName" TEXT NOT NULL,
  "personRole" TEXT,
  "personIdCard" TEXT,
  "trainingTopic" TEXT NOT NULL,
  "trainingType" TEXT NOT NULL,
  "trainingDate" TIMESTAMP(3) NOT NULL,
  "trainingHours" DOUBLE PRECISION,
  "trainingLocation" TEXT,
  "trainedBy" TEXT,
  "organizerName" TEXT,
  "hasCertificate" BOOLEAN NOT NULL DEFAULT false,
  "certificateNo" TEXT,
  "certificateUrl" TEXT,
  "expiryDate" TIMESTAMP(3),
  "preTestScore" DOUBLE PRECISION,
  "postTestScore" DOUBLE PRECISION,
  "passed" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "recordedBy" TEXT,
  CONSTRAINT "training_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plant_unit_edit_history" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "plantUnitId" TEXT NOT NULL,
  "editedBy" TEXT,
  "editedByIp" TEXT,
  "fieldName" TEXT NOT NULL,
  "oldValue" TEXT,
  "newValue" TEXT,
  "reason" TEXT,
  CONSTRAINT "plant_unit_edit_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "care_logs" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "plantUnitId" TEXT NOT NULL,
  "logType" TEXT NOT NULL,
  "logDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "photoUrl" TEXT,
  "recordedBy" TEXT,
  "height" DOUBLE PRECISION,
  "leafCount" INTEGER,
  "healthScore" INTEGER,
  CONSTRAINT "care_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "wizard_step_configs" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "stepNumber" INTEGER NOT NULL,
  "stepKey" TEXT NOT NULL,
  "titleTH" TEXT NOT NULL,
  "titleEN" TEXT NOT NULL,
  "description" TEXT,
  "icon" TEXT,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "plantGroups" JSONB NOT NULL DEFAULT '["*"]'::jsonb,
  "validationRules" JSONB,
  "componentName" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  CONSTRAINT "wizard_step_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "application_drafts_userId_idx" ON "application_drafts"("userId");
CREATE INDEX IF NOT EXISTS "application_drafts_lastSavedAt_idx" ON "application_drafts"("lastSavedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "application_drafts_userId_status_key" ON "application_drafts"("userId", "status");

CREATE INDEX IF NOT EXISTS "site_analyses_farmId_idx" ON "site_analyses"("farmId");
CREATE INDEX IF NOT EXISTS "site_analyses_analysisDate_idx" ON "site_analyses"("analysisDate");

CREATE INDEX IF NOT EXISTS "training_records_farmId_idx" ON "training_records"("farmId");
CREATE INDEX IF NOT EXISTS "training_records_trainingDate_idx" ON "training_records"("trainingDate");
CREATE INDEX IF NOT EXISTS "training_records_trainingType_idx" ON "training_records"("trainingType");

CREATE INDEX IF NOT EXISTS "plant_unit_edit_history_plantUnitId_idx" ON "plant_unit_edit_history"("plantUnitId");
CREATE INDEX IF NOT EXISTS "plant_unit_edit_history_createdAt_idx" ON "plant_unit_edit_history"("createdAt");

CREATE INDEX IF NOT EXISTS "care_logs_plantUnitId_idx" ON "care_logs"("plantUnitId");
CREATE INDEX IF NOT EXISTS "care_logs_logType_idx" ON "care_logs"("logType");
CREATE INDEX IF NOT EXISTS "care_logs_logDate_idx" ON "care_logs"("logDate");

CREATE UNIQUE INDEX IF NOT EXISTS "wizard_step_configs_stepNumber_key" ON "wizard_step_configs"("stepNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "wizard_step_configs_stepKey_key" ON "wizard_step_configs"("stepKey");
CREATE INDEX IF NOT EXISTS "wizard_step_configs_isEnabled_idx" ON "wizard_step_configs"("isEnabled");
CREATE INDEX IF NOT EXISTS "wizard_step_configs_displayOrder_idx" ON "wizard_step_configs"("displayOrder");

CREATE UNIQUE INDEX IF NOT EXISTS "harvest_batches_qrCode_key" ON "harvest_batches"("qrCode");
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_receiptNumber_key" ON "invoices"("receiptNumber");
CREATE INDEX IF NOT EXISTS "system_configs_key_idx" ON "system_configs"("key");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'application_drafts'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'application_drafts_userId_fkey'
  ) THEN
    ALTER TABLE "application_drafts"
      ADD CONSTRAINT "application_drafts_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_analyses'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'site_analyses_farmId_fkey'
  ) THEN
    ALTER TABLE "site_analyses"
      ADD CONSTRAINT "site_analyses_farmId_fkey"
      FOREIGN KEY ("farmId") REFERENCES "farms"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'training_records'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'training_records_farmId_fkey'
  ) THEN
    ALTER TABLE "training_records"
      ADD CONSTRAINT "training_records_farmId_fkey"
      FOREIGN KEY ("farmId") REFERENCES "farms"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'plant_unit_edit_history'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plant_unit_edit_history_plantUnitId_fkey'
  ) THEN
    ALTER TABLE "plant_unit_edit_history"
      ADD CONSTRAINT "plant_unit_edit_history_plantUnitId_fkey"
      FOREIGN KEY ("plantUnitId") REFERENCES "plant_units"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'care_logs'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'care_logs_plantUnitId_fkey'
  ) THEN
    ALTER TABLE "care_logs"
      ADD CONSTRAINT "care_logs_plantUnitId_fkey"
      FOREIGN KEY ("plantUnitId") REFERENCES "plant_units"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
