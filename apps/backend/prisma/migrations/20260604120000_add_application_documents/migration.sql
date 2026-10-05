-- CreateTable
CREATE TABLE "application_documents" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,
    "documentId" TEXT,
    "slotId" TEXT,
    "stepKey" TEXT,
    "documentType" TEXT NOT NULL,
    "fileName" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "fileHash" TEXT,
    "photoHash" TEXT,
    "idNumber" TEXT,
    "verificationStatus" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "uploadedBy" TEXT,
    CONSTRAINT "application_documents_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "application_documents_applicationId_idx" ON "application_documents"("applicationId");
-- CreateIndex
CREATE INDEX "application_documents_documentType_idx" ON "application_documents"("documentType");
-- CreateIndex
CREATE INDEX "application_documents_idNumber_idx" ON "application_documents"("idNumber");
-- CreateIndex
CREATE INDEX "application_documents_photoHash_idx" ON "application_documents"("photoHash");
-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
