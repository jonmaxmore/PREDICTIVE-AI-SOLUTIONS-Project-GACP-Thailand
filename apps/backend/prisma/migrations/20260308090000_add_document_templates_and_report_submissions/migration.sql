-- CreateTable: document_templates (Sprint 3 — Template Versioning)
-- Date: 2026-03-08
-- Versioned HTML templates for GACP certificates, invoices, etc.

CREATE TABLE IF NOT EXISTS "document_templates" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "titleTH" TEXT NOT NULL,
    "titleEN" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredDate" TIMESTAMP(3),
    "htmlTemplate" TEXT NOT NULL,
    "cssOverrides" TEXT,
    "payloadSchema" JSONB,
    "paperSize" TEXT NOT NULL DEFAULT 'A4_LANDSCAPE',
    "orientation" TEXT NOT NULL DEFAULT 'landscape',
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_templates_code_version_key" ON "document_templates"("code", "version");
CREATE INDEX IF NOT EXISTS "document_templates_code_idx" ON "document_templates"("code");
CREATE INDEX IF NOT EXISTS "document_templates_status_idx" ON "document_templates"("status");

-- CreateTable: report_submissions (Sprint 4 — Monthly Reports ภ.ท.27/28)
-- Monthly reports required by certificate holders

CREATE TABLE IF NOT EXISTS "report_submissions" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "certificateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "reportMonth" INTEGER NOT NULL,
    "reportYear" INTEGER NOT NULL,
    "formData" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "attachmentUrl" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "report_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "report_submissions_cert_type_month_year_key" ON "report_submissions"("certificateId", "reportType", "reportMonth", "reportYear");
CREATE INDEX IF NOT EXISTS "report_submissions_certificateId_idx" ON "report_submissions"("certificateId");
CREATE INDEX IF NOT EXISTS "report_submissions_userId_idx" ON "report_submissions"("userId");
CREATE INDEX IF NOT EXISTS "report_submissions_reportType_idx" ON "report_submissions"("reportType");
CREATE INDEX IF NOT EXISTS "report_submissions_status_idx" ON "report_submissions"("status");
CREATE INDEX IF NOT EXISTS "report_submissions_year_month_idx" ON "report_submissions"("reportYear", "reportMonth");

-- CreateTable: sop_documents (Sprint 5 — SOP Builder drafts)
-- User-created SOP documents stored as structured JSON

CREATE TABLE IF NOT EXISTS "sop_documents" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "sopType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "formData" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sop_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sop_documents_userId_idx" ON "sop_documents"("userId");
CREATE INDEX IF NOT EXISTS "sop_documents_sopType_idx" ON "sop_documents"("sopType");
CREATE INDEX IF NOT EXISTS "sop_documents_status_idx" ON "sop_documents"("status");

-- AddForeignKeys
ALTER TABLE "report_submissions" ADD CONSTRAINT "report_submissions_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_submissions" ADD CONSTRAINT "report_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sop_documents" ADD CONSTRAINT "sop_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
