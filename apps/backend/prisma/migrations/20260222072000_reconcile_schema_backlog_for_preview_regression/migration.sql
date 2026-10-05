-- Reconcile committed Prisma schema with local-prod DB after preview/regression rehearsal exposed drift.
-- Generated from `prisma migrate diff` and reviewed to avoid destructive operations.
-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "bundleId" TEXT,
ADD COLUMN     "phase1ExpiresAt" TIMESTAMP(3),
ADD COLUMN     "phase1InvoiceId" TEXT,
ADD COLUMN     "phase1PaymentUrl" TEXT,
ADD COLUMN     "phase2InvoiceId" TEXT,
ADD COLUMN     "phase2PaymentUrl" TEXT,
ADD COLUMN     "previewData" JSONB,
ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';

-- AlterTable
ALTER TABLE "certificates" ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';

-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '7 years';

-- AlterTable
ALTER TABLE "planting_cycle_plots" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';

-- CreateTable
CREATE TABLE "drying_temperatures" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "farmId" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "humidity" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "recordedBy" TEXT,

    CONSTRAINT "drying_temperatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drying_humidity" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "farmId" TEXT NOT NULL,
    "humidity" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "recordedBy" TEXT,

    CONSTRAINT "drying_humidity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drying_dark_rooms" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "farmId" TEXT NOT NULL,
    "lightLevel" DOUBLE PRECISION NOT NULL,
    "darkRoomUsed" BOOLEAN NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "recordedBy" TEXT,

    CONSTRAINT "drying_dark_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curing_processes" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "farmId" TEXT NOT NULL,
    "cureDuration" INTEGER NOT NULL,
    "curationType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "curing_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumer_feedback" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "certificateId" TEXT,
    "rating" INTEGER NOT NULL,
    "feedback" TEXT NOT NULL,
    "contact" TEXT,
    "productName" TEXT,
    "batchNumber" TEXT,
    "farmName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "consumer_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_audit_tasks" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "documents" JSONB,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "assignedTo" TEXT,
    "assignedBy" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "post_audit_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revision_deadlines" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,
    "revisionDue" TIMESTAMP(3) NOT NULL,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "extensionDays" INTEGER,
    "extensionReason" TEXT,
    "extensionApprovedBy" TEXT,
    "extensionApprovedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "revision_deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "water_sources" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "plotId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "filtrationTypes" JSONB,
    "irrigationType" TEXT,
    "isTested" BOOLEAN NOT NULL DEFAULT false,
    "testDate" TIMESTAMP(3),
    "testResults" JSONB,
    "testDocumentUrl" TEXT,
    "description" TEXT,

    CONSTRAINT "water_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growing_media" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cycleId" TEXT NOT NULL,
    "mediumType" TEXT NOT NULL,
    "customType" TEXT,
    "brand" TEXT,
    "supplierName" TEXT,
    "supplierAddress" TEXT,
    "isOrganic" BOOLEAN NOT NULL DEFAULT false,
    "organicCertUrl" TEXT,
    "notes" TEXT,

    CONSTRAINT "growing_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seed_sources" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cycleId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "supplierName" TEXT,
    "supplierAddress" TEXT,
    "supplierPhone" TEXT,
    "supplierLicense" TEXT,
    "hasCertificate" BOOLEAN NOT NULL DEFAULT false,
    "certificateNo" TEXT,
    "certificateUrl" TEXT,
    "certificateDate" TIMESTAMP(3),
    "isPorPor4Registered" BOOLEAN NOT NULL DEFAULT false,
    "porPor4No" TEXT,
    "porPor4Url" TEXT,
    "varietyName" TEXT,
    "lotNo" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "seed_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fertilizer_records" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cycleId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "productName" TEXT,
    "registrationNo" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "usageDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "applicationMethod" TEXT,
    "npkN" DOUBLE PRECISION,
    "npkP" DOUBLE PRECISION,
    "npkK" DOUBLE PRECISION,
    "purchasedFrom" TEXT,
    "batchNo" TEXT,
    "withholdingDays" INTEGER,
    "productLabelUrl" TEXT,
    "msdsUrl" TEXT,
    "recordedBy" TEXT,
    "notes" TEXT,

    CONSTRAINT "fertilizer_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controlled_environments" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "plotId" TEXT NOT NULL,
    "structureType" TEXT NOT NULL,
    "areaSqm" DOUBLE PRECISION,
    "heightM" DOUBLE PRECISION,
    "hasTempControl" BOOLEAN NOT NULL DEFAULT false,
    "tempControlType" TEXT,
    "tempRangeMin" INTEGER,
    "tempRangeMax" INTEGER,
    "targetTemp" INTEGER,
    "hasHumidityControl" BOOLEAN NOT NULL DEFAULT false,
    "humidityRangeMin" INTEGER,
    "humidityRangeMax" INTEGER,
    "targetHumidity" INTEGER,
    "hasLightControl" BOOLEAN NOT NULL DEFAULT false,
    "lightControlType" TEXT,
    "lightHoursPerDay" INTEGER,
    "hasVentilation" BOOLEAN NOT NULL DEFAULT false,
    "ventilationType" TEXT,
    "roofMaterial" TEXT,
    "wallMaterial" TEXT,
    "isGmpCertified" BOOLEAN NOT NULL DEFAULT false,
    "gmpCertificateNo" TEXT,
    "gmpCertUrl" TEXT,
    "photos" JSONB,
    "notes" TEXT,

    CONSTRAINT "controlled_environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_details" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "batchId" TEXT NOT NULL,
    "packageType" TEXT NOT NULL,
    "grade" TEXT,
    "material" TEXT,
    "isFoodGrade" BOOLEAN NOT NULL DEFAULT false,
    "storageTemp" INTEGER,
    "storageHumidity" INTEGER,
    "storageDays" INTEGER,
    "labelText" TEXT,
    "hasQrCode" BOOLEAN NOT NULL DEFAULT false,
    "qrCodeData" TEXT,
    "sealingMethod" TEXT,
    "isTamperProof" BOOLEAN NOT NULL DEFAULT false,
    "photoUrl" TEXT,

    CONSTRAINT "packaging_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drying_processes" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cycleId" TEXT,
    "batchId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "dryingDays" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL,
    "tempLogs" JSONB,
    "hasDarkRoom" BOOLEAN NOT NULL DEFAULT false,
    "darkRoomHours" INTEGER,
    "moistureContent" DOUBLE PRECISION,
    "isQualityChecked" BOOLEAN NOT NULL DEFAULT false,
    "hasCuring" BOOLEAN NOT NULL DEFAULT false,
    "curingDays" INTEGER,
    "curingContainer" TEXT,
    "location" TEXT,
    "photos" JSONB,
    "performedBy" TEXT,
    "notes" TEXT,

    CONSTRAINT "drying_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_bundles" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "bundleType" TEXT NOT NULL DEFAULT 'TRIPLE',
    "bundleName" TEXT,
    "totalFee" INTEGER NOT NULL DEFAULT 90000,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "finalFee" INTEGER NOT NULL DEFAULT 90000,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "application_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "gatewayRef" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT,
    "paymentData" JSONB,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "webhookReceivedAt" TIMESTAMP(3),
    "webhookData" JSONB,
    "idempotencyKey" TEXT,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drying_temperatures_farmId_idx" ON "drying_temperatures"("farmId");

-- CreateIndex
CREATE INDEX "drying_temperatures_timestamp_idx" ON "drying_temperatures"("timestamp");

-- CreateIndex
CREATE INDEX "drying_humidity_farmId_idx" ON "drying_humidity"("farmId");

-- CreateIndex
CREATE INDEX "drying_humidity_timestamp_idx" ON "drying_humidity"("timestamp");

-- CreateIndex
CREATE INDEX "drying_dark_rooms_farmId_idx" ON "drying_dark_rooms"("farmId");

-- CreateIndex
CREATE INDEX "drying_dark_rooms_timestamp_idx" ON "drying_dark_rooms"("timestamp");

-- CreateIndex
CREATE INDEX "curing_processes_farmId_idx" ON "curing_processes"("farmId");

-- CreateIndex
CREATE INDEX "curing_processes_status_idx" ON "curing_processes"("status");

-- CreateIndex
CREATE INDEX "curing_processes_startDate_idx" ON "curing_processes"("startDate");

-- CreateIndex
CREATE INDEX "consumer_feedback_certificateId_idx" ON "consumer_feedback"("certificateId");

-- CreateIndex
CREATE INDEX "consumer_feedback_status_idx" ON "consumer_feedback"("status");

-- CreateIndex
CREATE INDEX "consumer_feedback_createdAt_idx" ON "consumer_feedback"("createdAt");

-- CreateIndex
CREATE INDEX "post_audit_tasks_applicationId_idx" ON "post_audit_tasks"("applicationId");

-- CreateIndex
CREATE INDEX "post_audit_tasks_status_idx" ON "post_audit_tasks"("status");

-- CreateIndex
CREATE INDEX "post_audit_tasks_dueDate_idx" ON "post_audit_tasks"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "revision_deadlines_applicationId_key" ON "revision_deadlines"("applicationId");

-- CreateIndex
CREATE INDEX "revision_deadlines_applicationId_idx" ON "revision_deadlines"("applicationId");

-- CreateIndex
CREATE INDEX "revision_deadlines_status_idx" ON "revision_deadlines"("status");

-- CreateIndex
CREATE INDEX "revision_deadlines_revisionDue_idx" ON "revision_deadlines"("revisionDue");

-- CreateIndex
CREATE INDEX "water_sources_plotId_idx" ON "water_sources"("plotId");

-- CreateIndex
CREATE INDEX "growing_media_cycleId_idx" ON "growing_media"("cycleId");

-- CreateIndex
CREATE INDEX "seed_sources_cycleId_idx" ON "seed_sources"("cycleId");

-- CreateIndex
CREATE INDEX "seed_sources_certificateNo_idx" ON "seed_sources"("certificateNo");

-- CreateIndex
CREATE INDEX "seed_sources_porPor4No_idx" ON "seed_sources"("porPor4No");

-- CreateIndex
CREATE INDEX "fertilizer_records_cycleId_idx" ON "fertilizer_records"("cycleId");

-- CreateIndex
CREATE INDEX "fertilizer_records_registrationNo_idx" ON "fertilizer_records"("registrationNo");

-- CreateIndex
CREATE INDEX "controlled_environments_plotId_idx" ON "controlled_environments"("plotId");

-- CreateIndex
CREATE INDEX "controlled_environments_structureType_idx" ON "controlled_environments"("structureType");

-- CreateIndex
CREATE INDEX "packaging_details_batchId_idx" ON "packaging_details"("batchId");

-- CreateIndex
CREATE INDEX "drying_processes_batchId_idx" ON "drying_processes"("batchId");

-- CreateIndex
CREATE INDEX "application_bundles_userId_idx" ON "application_bundles"("userId");

-- CreateIndex
CREATE INDEX "application_bundles_status_idx" ON "application_bundles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_idempotencyKey_key" ON "payment_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_transactions_applicationId_idx" ON "payment_transactions"("applicationId");

-- CreateIndex
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions"("status");

-- CreateIndex
CREATE INDEX "payment_transactions_gatewayRef_idx" ON "payment_transactions"("gatewayRef");

-- CreateIndex
CREATE INDEX "payment_transactions_createdAt_idx" ON "payment_transactions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "applications_phase1InvoiceId_key" ON "applications"("phase1InvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "applications_phase2InvoiceId_key" ON "applications"("phase2InvoiceId");

-- CreateIndex
CREATE INDEX "applications_bundleId_idx" ON "applications"("bundleId");

-- CreateIndex
CREATE INDEX "applications_formData_idx" ON "applications" USING GIN ("formData");

-- CreateIndex
CREATE INDEX "audit_logs_metadata_idx" ON "audit_logs" USING GIN ("metadata");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "application_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drying_temperatures" ADD CONSTRAINT "drying_temperatures_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drying_humidity" ADD CONSTRAINT "drying_humidity_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drying_dark_rooms" ADD CONSTRAINT "drying_dark_rooms_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curing_processes" ADD CONSTRAINT "curing_processes_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_feedback" ADD CONSTRAINT "consumer_feedback_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_audit_tasks" ADD CONSTRAINT "post_audit_tasks_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_deadlines" ADD CONSTRAINT "revision_deadlines_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_sources" ADD CONSTRAINT "water_sources_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "plots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growing_media" ADD CONSTRAINT "growing_media_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "planting_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seed_sources" ADD CONSTRAINT "seed_sources_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "planting_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_records" ADD CONSTRAINT "fertilizer_records_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "planting_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controlled_environments" ADD CONSTRAINT "controlled_environments_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "plots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_details" ADD CONSTRAINT "packaging_details_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "harvest_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drying_processes" ADD CONSTRAINT "drying_processes_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "planting_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drying_processes" ADD CONSTRAINT "drying_processes_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "harvest_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_bundles" ADD CONSTRAINT "application_bundles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "trace_qr_security_entity_idx" RENAME TO "trace_qr_security_entityType_entityId_idx";

-- RenameIndex
ALTER INDEX "trace_qr_security_entity_key" RENAME TO "trace_qr_security_entityType_entityId_key";
