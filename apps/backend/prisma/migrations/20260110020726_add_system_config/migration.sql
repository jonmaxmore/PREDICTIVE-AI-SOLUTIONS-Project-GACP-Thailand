-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "email" TEXT,
    "password" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "phoneNumber" TEXT,
    "idCard" TEXT,
    "idCardHash" TEXT,
    "laserCode" TEXT,
    "companyName" TEXT,
    "taxId" TEXT,
    "taxIdHash" TEXT,
    "representativeName" TEXT,
    "representativePosition" TEXT,
    "communityName" TEXT,
    "communityRegistrationNo" TEXT,
    "communityRegistrationNoHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'FARMER',
    "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "address" TEXT,
    "province" TEXT,
    "district" TEXT,
    "subdistrict" TEXT,
    "zipCode" TEXT,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificationToken" TEXT,
    "emailVerificationExpiry" TIMESTAMP(3),
    "passwordResetToken" TEXT,
    "passwordResetExpiry" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "loginAttempts" INTEGER NOT NULL DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedUntil" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdByIp" TEXT,
    "updatedByIp" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deleteReason" TEXT,
    "retainUntil" TIMESTAMP(3) NOT NULL DEFAULT NOW() + INTERVAL '5 years',
    "legalHold" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL DEFAULT 'new_application',
    "areaType" TEXT NOT NULL,
    "standardCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rejectCount" INTEGER NOT NULL DEFAULT 0,
    "batchId" TEXT,
    "areaTypeIndex" INTEGER NOT NULL DEFAULT 0,
    "totalAreaTypes" INTEGER NOT NULL DEFAULT 1,
    "phase1Amount" INTEGER NOT NULL DEFAULT 5000,
    "phase1Status" TEXT NOT NULL DEFAULT 'PENDING',
    "phase1PaidAt" TIMESTAMP(3),
    "phase2Amount" INTEGER NOT NULL DEFAULT 25000,
    "phase2Status" TEXT NOT NULL DEFAULT 'PENDING',
    "phase2PaidAt" TIMESTAMP(3),
    "auditorId" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "auditResult" TEXT,
    "auditNotes" TEXT,
    "formData" JSONB,
    "attachments" JSONB,
    "workflowHistory" JSONB,
    "supplementaryCriteria" JSONB,
    "supplementarySkipped" BOOLEAN NOT NULL DEFAULT false,
    "submissionHash" TEXT,
    "officialReceiptNumber" TEXT,
    "idempotencyKey" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdByIp" TEXT,
    "updatedByIp" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deleteReason" TEXT,
    "retainUntil" TIMESTAMP(3) NOT NULL DEFAULT NOW() + INTERVAL '5 years',
    "legalHold" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "qrData" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "farmName" TEXT NOT NULL,
    "farmerName" TEXT NOT NULL,
    "cropType" TEXT NOT NULL,
    "farmSize" DOUBLE PRECISION NOT NULL,
    "province" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "subDistrict" TEXT NOT NULL,
    "address" TEXT,
    "standardCode" TEXT,
    "standardId" TEXT NOT NULL,
    "standardName" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "issuedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "validityYears" INTEGER NOT NULL DEFAULT 3,
    "issuedBy" TEXT NOT NULL,
    "pdfGenerated" BOOLEAN NOT NULL DEFAULT false,
    "pdfUrl" TEXT,
    "pdfGeneratedAt" TIMESTAMP(3),
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "verificationCount" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokedReason" TEXT,
    "renewedCertificateId" TEXT,
    "previousCertificateId" TEXT,
    "documentHash" TEXT,
    "signedBy" TEXT,
    "signedAt" TIMESTAMP(3),
    "printHistory" JSONB,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deleteReason" TEXT,
    "retainUntil" TIMESTAMP(3) NOT NULL DEFAULT NOW() + INTERVAL '5 years',
    "legalHold" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "quoteId" TEXT,
    "serviceType" TEXT NOT NULL,
    "billingName" TEXT,
    "billingAddress" TEXT,
    "certificateNumber" TEXT,
    "items" JSONB,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "vat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "totalAmountText" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paidAt" TIMESTAMP(3),
    "paymentTransactionId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdByIp" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deleteReason" TEXT,
    "retainUntil" TIMESTAMP(3) NOT NULL DEFAULT NOW() + INTERVAL '7 years',
    "legalHold" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "items" JSONB,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "vat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "validUntil" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "farmName" TEXT NOT NULL,
    "farmType" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "subDistrict" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "totalArea" DOUBLE PRECISION NOT NULL,
    "cultivationArea" DOUBLE PRECISION NOT NULL,
    "areaUnit" TEXT NOT NULL DEFAULT 'rai',
    "cultivationMethod" TEXT NOT NULL,
    "irrigationType" TEXT,
    "soilType" TEXT,
    "waterSource" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "verificationNotes" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "landDocuments" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deleteReason" TEXT,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "actorEmail" TEXT,
    "actorRole" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "metadata" JSONB,
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "previousHash" TEXT NOT NULL,
    "currentHash" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256',

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_consents" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "grantedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plant_species" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "nameTH" TEXT NOT NULL,
    "nameEN" TEXT,
    "scientificName" TEXT,
    "familyName" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "group" TEXT NOT NULL,
    "requiresLicense" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "units" JSONB,
    "plantParts" JSONB,
    "securityRequirements" JSONB,
    "productionInputs" JSONB,
    "gacpCategory" TEXT,
    "dtamPlantCode" TEXT,
    "cultivationType" TEXT DEFAULT 'SELF_GROWN',
    "harvestCycle" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "plant_species_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requirements" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "plantCode" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "documentNameTH" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "allowedFileTypes" JSONB,
    "maxFileSizeMB" INTEGER NOT NULL DEFAULT 10,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planting_cycles" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cycleName" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL DEFAULT 1,
    "farmId" TEXT NOT NULL,
    "certificateId" TEXT,
    "plantSpeciesId" TEXT NOT NULL,
    "varietyName" TEXT,
    "plotName" TEXT,
    "plotArea" DOUBLE PRECISION,
    "areaUnit" TEXT NOT NULL DEFAULT 'rai',
    "startDate" TIMESTAMP(3) NOT NULL,
    "expectedHarvestDate" TIMESTAMP(3),
    "actualHarvestDate" TIMESTAMP(3),
    "seedSource" TEXT,
    "seedQuantity" DOUBLE PRECISION,
    "cultivationType" TEXT NOT NULL DEFAULT 'SELF_GROWN',
    "soilType" TEXT,
    "irrigationType" TEXT,
    "estimatedYield" DOUBLE PRECISION,
    "actualYield" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "notes" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "planting_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plots" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "farmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" DOUBLE PRECISION NOT NULL,
    "areaUnit" TEXT NOT NULL DEFAULT 'rai',
    "solarSystem" TEXT NOT NULL DEFAULT 'OUTDOOR',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "plots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harvest_batches" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "speciesId" TEXT NOT NULL,
    "cycleId" TEXT,
    "plantingDate" TIMESTAMP(3) NOT NULL,
    "harvestDate" TIMESTAMP(3),
    "cultivationType" TEXT NOT NULL DEFAULT 'SELF_GROWN',
    "seedSource" TEXT,
    "plotName" TEXT,
    "plotArea" DOUBLE PRECISION,
    "areaUnit" TEXT NOT NULL DEFAULT 'rai',
    "estimatedYield" DOUBLE PRECISION,
    "actualYield" DOUBLE PRECISION,
    "yieldUnit" TEXT NOT NULL DEFAULT 'kg',
    "status" TEXT NOT NULL DEFAULT 'GROWING',
    "qualityGrade" TEXT,
    "notes" TEXT,
    "qrCode" TEXT,
    "trackingUrl" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "harvest_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dtam_staff" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "employeeId" TEXT,
    "department" TEXT NOT NULL DEFAULT 'กรมการแพทย์แผนไทย',
    "role" TEXT NOT NULL DEFAULT 'reviewer',
    "userType" TEXT NOT NULL DEFAULT 'DTAM_STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "mfaBackupCodes" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "dtam_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certification_standards" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameTH" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT NOT NULL DEFAULT 'v2024',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "logoUrl" TEXT,
    "targetMarket" TEXT,

    CONSTRAINT "certification_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard_requirements" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "standardId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameTH" TEXT NOT NULL,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "standard_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "packageType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitWeight" DOUBLE PRECISION NOT NULL,
    "totalWeight" DOUBLE PRECISION,
    "qrCode" TEXT NOT NULL,
    "trackingUrl" TEXT,
    "processedAt" TIMESTAMP(3),
    "packagedAt" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "labTestReportUrl" TEXT,
    "thcContent" DOUBLE PRECISION,
    "cbdContent" DOUBLE PRECISION,
    "moistureContent" DOUBLE PRECISION,
    "testStatus" TEXT,
    "destinationType" TEXT,
    "destination" TEXT,
    "shippedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplementary_criteria" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "categoryTH" TEXT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "icon" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "inputType" TEXT NOT NULL DEFAULT 'checkbox',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "supplementary_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'STRING',
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_uuid_key" ON "users"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_idCardHash_key" ON "users"("idCardHash");

-- CreateIndex
CREATE UNIQUE INDEX "users_taxIdHash_key" ON "users"("taxIdHash");

-- CreateIndex
CREATE UNIQUE INDEX "users_communityRegistrationNoHash_key" ON "users"("communityRegistrationNoHash");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_accountType_idx" ON "users"("accountType");

-- CreateIndex
CREATE INDEX "users_isDeleted_idx" ON "users"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "applications_uuid_key" ON "applications"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "applications_applicationNumber_key" ON "applications"("applicationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "applications_idempotencyKey_key" ON "applications"("idempotencyKey");

-- CreateIndex
CREATE INDEX "applications_farmerId_idx" ON "applications"("farmerId");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE INDEX "applications_applicationNumber_idx" ON "applications"("applicationNumber");

-- CreateIndex
CREATE INDEX "applications_isDeleted_idx" ON "applications"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_uuid_key" ON "certificates"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_certificateNumber_key" ON "certificates"("certificateNumber");

-- CreateIndex
CREATE INDEX "certificates_userId_idx" ON "certificates"("userId");

-- CreateIndex
CREATE INDEX "certificates_status_idx" ON "certificates"("status");

-- CreateIndex
CREATE INDEX "certificates_certificateNumber_idx" ON "certificates"("certificateNumber");

-- CreateIndex
CREATE INDEX "certificates_expiryDate_idx" ON "certificates"("expiryDate");

-- CreateIndex
CREATE INDEX "certificates_isDeleted_idx" ON "certificates"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_uuid_key" ON "invoices"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoices_applicationId_idx" ON "invoices"("applicationId");

-- CreateIndex
CREATE INDEX "invoices_farmerId_idx" ON "invoices"("farmerId");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_invoiceNumber_idx" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoices_isDeleted_idx" ON "invoices"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_uuid_key" ON "quotes"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_quoteNumber_key" ON "quotes"("quoteNumber");

-- CreateIndex
CREATE INDEX "quotes_applicationId_idx" ON "quotes"("applicationId");

-- CreateIndex
CREATE INDEX "quotes_status_idx" ON "quotes"("status");

-- CreateIndex
CREATE INDEX "quotes_isDeleted_idx" ON "quotes"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "farms_uuid_key" ON "farms"("uuid");

-- CreateIndex
CREATE INDEX "farms_ownerId_idx" ON "farms"("ownerId");

-- CreateIndex
CREATE INDEX "farms_status_idx" ON "farms"("status");

-- CreateIndex
CREATE INDEX "farms_province_idx" ON "farms"("province");

-- CreateIndex
CREATE INDEX "farms_isDeleted_idx" ON "farms"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_uuid_key" ON "notifications"("uuid");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_logId_key" ON "audit_logs"("logId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_sequenceNumber_key" ON "audit_logs"("sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_currentHash_key" ON "audit_logs"("currentHash");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_logs_category_severity_idx" ON "audit_logs"("category", "severity");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "user_consents_userId_idx" ON "user_consents"("userId");

-- CreateIndex
CREATE INDEX "user_consents_category_idx" ON "user_consents"("category");

-- CreateIndex
CREATE INDEX "user_consents_granted_idx" ON "user_consents"("granted");

-- CreateIndex
CREATE UNIQUE INDEX "user_consents_userId_category_key" ON "user_consents"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "plant_species_uuid_key" ON "plant_species"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "plant_species_code_key" ON "plant_species"("code");

-- CreateIndex
CREATE INDEX "plant_species_code_idx" ON "plant_species"("code");

-- CreateIndex
CREATE INDEX "plant_species_nameTH_idx" ON "plant_species"("nameTH");

-- CreateIndex
CREATE INDEX "plant_species_isActive_isDeleted_idx" ON "plant_species"("isActive", "isDeleted");

-- CreateIndex
CREATE INDEX "document_requirements_plantCode_requestType_idx" ON "document_requirements"("plantCode", "requestType");

-- CreateIndex
CREATE UNIQUE INDEX "planting_cycles_uuid_key" ON "planting_cycles"("uuid");

-- CreateIndex
CREATE INDEX "planting_cycles_farmId_idx" ON "planting_cycles"("farmId");

-- CreateIndex
CREATE INDEX "planting_cycles_certificateId_idx" ON "planting_cycles"("certificateId");

-- CreateIndex
CREATE INDEX "planting_cycles_status_idx" ON "planting_cycles"("status");

-- CreateIndex
CREATE INDEX "planting_cycles_isDeleted_idx" ON "planting_cycles"("isDeleted");

-- CreateIndex
CREATE INDEX "plots_farmId_idx" ON "plots"("farmId");

-- CreateIndex
CREATE UNIQUE INDEX "harvest_batches_uuid_key" ON "harvest_batches"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "harvest_batches_batchNumber_key" ON "harvest_batches"("batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "harvest_batches_qrCode_key" ON "harvest_batches"("qrCode");

-- CreateIndex
CREATE INDEX "harvest_batches_farmId_idx" ON "harvest_batches"("farmId");

-- CreateIndex
CREATE INDEX "harvest_batches_speciesId_idx" ON "harvest_batches"("speciesId");

-- CreateIndex
CREATE INDEX "harvest_batches_status_idx" ON "harvest_batches"("status");

-- CreateIndex
CREATE INDEX "harvest_batches_harvestDate_idx" ON "harvest_batches"("harvestDate");

-- CreateIndex
CREATE INDEX "harvest_batches_isDeleted_idx" ON "harvest_batches"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "dtam_staff_uuid_key" ON "dtam_staff"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "dtam_staff_username_key" ON "dtam_staff"("username");

-- CreateIndex
CREATE UNIQUE INDEX "dtam_staff_email_key" ON "dtam_staff"("email");

-- CreateIndex
CREATE UNIQUE INDEX "dtam_staff_employeeId_key" ON "dtam_staff"("employeeId");

-- CreateIndex
CREATE INDEX "dtam_staff_username_idx" ON "dtam_staff"("username");

-- CreateIndex
CREATE INDEX "dtam_staff_email_idx" ON "dtam_staff"("email");

-- CreateIndex
CREATE INDEX "dtam_staff_role_idx" ON "dtam_staff"("role");

-- CreateIndex
CREATE INDEX "dtam_staff_isActive_idx" ON "dtam_staff"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "certification_standards_code_key" ON "certification_standards"("code");

-- CreateIndex
CREATE INDEX "certification_standards_code_idx" ON "certification_standards"("code");

-- CreateIndex
CREATE INDEX "certification_standards_isActive_idx" ON "certification_standards"("isActive");

-- CreateIndex
CREATE INDEX "standard_requirements_standardId_idx" ON "standard_requirements"("standardId");

-- CreateIndex
CREATE INDEX "standard_requirements_category_idx" ON "standard_requirements"("category");

-- CreateIndex
CREATE UNIQUE INDEX "lots_uuid_key" ON "lots"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "lots_lotNumber_key" ON "lots"("lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "lots_qrCode_key" ON "lots"("qrCode");

-- CreateIndex
CREATE INDEX "lots_batchId_idx" ON "lots"("batchId");

-- CreateIndex
CREATE INDEX "lots_qrCode_idx" ON "lots"("qrCode");

-- CreateIndex
CREATE INDEX "lots_status_idx" ON "lots"("status");

-- CreateIndex
CREATE INDEX "lots_isDeleted_idx" ON "lots"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "supplementary_criteria_code_key" ON "supplementary_criteria"("code");

-- CreateIndex
CREATE INDEX "supplementary_criteria_category_idx" ON "supplementary_criteria"("category");

-- CreateIndex
CREATE INDEX "supplementary_criteria_isActive_idx" ON "supplementary_criteria"("isActive");

-- CreateIndex
CREATE INDEX "supplementary_criteria_sortOrder_idx" ON "supplementary_criteria"("sortOrder");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_standardCode_fkey" FOREIGN KEY ("standardCode") REFERENCES "certification_standards"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_standardCode_fkey" FOREIGN KEY ("standardCode") REFERENCES "certification_standards"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_plantCode_fkey" FOREIGN KEY ("plantCode") REFERENCES "plant_species"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planting_cycles" ADD CONSTRAINT "planting_cycles_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planting_cycles" ADD CONSTRAINT "planting_cycles_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planting_cycles" ADD CONSTRAINT "planting_cycles_plantSpeciesId_fkey" FOREIGN KEY ("plantSpeciesId") REFERENCES "plant_species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_batches" ADD CONSTRAINT "harvest_batches_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_batches" ADD CONSTRAINT "harvest_batches_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "plant_species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_batches" ADD CONSTRAINT "harvest_batches_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "planting_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_requirements" ADD CONSTRAINT "standard_requirements_standardId_fkey" FOREIGN KEY ("standardId") REFERENCES "certification_standards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "harvest_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
