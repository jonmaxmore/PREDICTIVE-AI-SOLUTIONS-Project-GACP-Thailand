-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "payment_audits" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gateway" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNPROCESSED',
    "errorMessage" TEXT,

    CONSTRAINT "payment_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reconciliations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciliationDate" TIMESTAMP(3) NOT NULL,
    "bankReference" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "matchedTransactions" INTEGER NOT NULL DEFAULT 0,
    "failedTransactions" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,

    CONSTRAINT "payment_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maker_audit_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT NOT NULL,
    "auditorId" TEXT NOT NULL,
    "fieldEdited" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "redFlagReason" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "maker_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_audits_status_idx" ON "payment_audits"("status");

-- CreateIndex
CREATE INDEX "payment_audits_createdAt_idx" ON "payment_audits"("createdAt");

-- CreateIndex
CREATE INDEX "payment_reconciliations_reconciliationDate_idx" ON "payment_reconciliations"("reconciliationDate");

-- CreateIndex
CREATE INDEX "payment_reconciliations_status_idx" ON "payment_reconciliations"("status");

-- CreateIndex
CREATE INDEX "maker_audit_logs_applicationId_idx" ON "maker_audit_logs"("applicationId");

-- CreateIndex
CREATE INDEX "maker_audit_logs_auditorId_idx" ON "maker_audit_logs"("auditorId");

-- AddForeignKey
ALTER TABLE "maker_audit_logs" ADD CONSTRAINT "maker_audit_logs_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maker_audit_logs" ADD CONSTRAINT "maker_audit_logs_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


