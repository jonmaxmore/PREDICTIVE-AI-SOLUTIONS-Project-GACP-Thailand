-- AlterEnum: แปลงค่าเดิมโดยไม่ทิ้งข้อมูล (ADR 0004) MORPHROM → MORPHROM_HEALTH_ID, FINANCE_OFFICER → PLATFORM_OPERATOR_FINANCE_OFFICER, SYSTEM_ADMIN → PLATFORM_OPERATOR_ADMIN
BEGIN;
CREATE TYPE "identity_provider_new" AS ENUM ('THAID', 'MORPHROM_HEALTH_ID', 'DEV_LOCAL');
ALTER TABLE "user_identities" ALTER COLUMN "provider" TYPE "identity_provider_new" USING (CASE "provider"::text WHEN 'MORPHROM' THEN 'MORPHROM_HEALTH_ID' ELSE "provider"::text END)::"identity_provider_new";
ALTER TYPE "identity_provider" RENAME TO "identity_provider_old";
ALTER TYPE "identity_provider_new" RENAME TO "identity_provider";
DROP TYPE "public"."identity_provider_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "user_role_new" AS ENUM ('APPLICANT', 'DOCUMENT_REVIEWER', 'DISPATCHER', 'FIELD_INSPECTOR', 'CERTIFICATE_APPROVER', 'CERTIFICATION_BODY_ADMIN', 'CERTIFICATION_BODY_FINANCE_OFFICER', 'PLATFORM_OPERATOR_ADMIN', 'PLATFORM_OPERATOR_FINANCE_OFFICER');
ALTER TABLE "application_status_transitions" ALTER COLUMN "actor_role" TYPE "user_role_new" USING (CASE "actor_role"::text WHEN 'FINANCE_OFFICER' THEN 'PLATFORM_OPERATOR_FINANCE_OFFICER' WHEN 'SYSTEM_ADMIN' THEN 'PLATFORM_OPERATOR_ADMIN' ELSE "actor_role"::text END)::"user_role_new";
ALTER TABLE "audit_logs" ALTER COLUMN "actor_role" TYPE "user_role_new" USING (CASE "actor_role"::text WHEN 'FINANCE_OFFICER' THEN 'PLATFORM_OPERATOR_FINANCE_OFFICER' WHEN 'SYSTEM_ADMIN' THEN 'PLATFORM_OPERATOR_ADMIN' ELSE "actor_role"::text END)::"user_role_new";
ALTER TABLE "document_access_logs" ALTER COLUMN "role" TYPE "user_role_new" USING (CASE "role"::text WHEN 'FINANCE_OFFICER' THEN 'PLATFORM_OPERATOR_FINANCE_OFFICER' WHEN 'SYSTEM_ADMIN' THEN 'PLATFORM_OPERATOR_ADMIN' ELSE "role"::text END)::"user_role_new";
ALTER TABLE "staff_role_assignments" ALTER COLUMN "role" TYPE "user_role_new" USING (CASE "role"::text WHEN 'FINANCE_OFFICER' THEN 'PLATFORM_OPERATOR_FINANCE_OFFICER' WHEN 'SYSTEM_ADMIN' THEN 'PLATFORM_OPERATOR_ADMIN' ELSE "role"::text END)::"user_role_new";
ALTER TYPE "user_role" RENAME TO "user_role_old";
ALTER TYPE "user_role_new" RENAME TO "user_role";
DROP TYPE "public"."user_role_old";
COMMIT;

-- AlterTable
ALTER TABLE "user_identities" ADD COLUMN     "identity_assurance_level" TEXT,
ADD COLUMN     "verified_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "national_id_hmac" TEXT;

-- CreateTable
CREATE TABLE "provider_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_id" TEXT NOT NULL,
    "agency_business_id" TEXT,
    "agency_code" TEXT,
    "agency_name_th" TEXT,
    "position" TEXT,
    "position_type" TEXT,
    "license_id" TEXT,
    "profile_hash" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_verified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorized_provider_agencies" (
    "id" UUID NOT NULL,
    "business_id" TEXT NOT NULL,
    "agency_code" TEXT,
    "name_th" TEXT NOT NULL,
    "added_by_id" UUID,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_id" UUID,

    CONSTRAINT "authorized_provider_agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_operator_memberships" (
    "id" UUID NOT NULL,
    "national_id_hmac" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "user_id" UUID,
    "bootstrap_admin" BOOLEAN NOT NULL DEFAULT false,
    "added_by_id" UUID,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_id" UUID,

    CONSTRAINT "platform_operator_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_credentials_user_id_key" ON "provider_credentials"("user_id");

-- CreateIndex
CREATE INDEX "provider_credentials_agency_business_id_idx" ON "provider_credentials"("agency_business_id");

-- CreateIndex
CREATE UNIQUE INDEX "authorized_provider_agencies_business_id_key" ON "authorized_provider_agencies"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_operator_memberships_national_id_hmac_key" ON "platform_operator_memberships"("national_id_hmac");

-- CreateIndex
CREATE UNIQUE INDEX "platform_operator_memberships_user_id_key" ON "platform_operator_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_national_id_hmac_key" ON "users"("national_id_hmac");

-- AddForeignKey
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_operator_memberships" ADD CONSTRAINT "platform_operator_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

