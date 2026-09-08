-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "applicant_type" AS ENUM ('INDIVIDUAL', 'JURISTIC_PERSON', 'COMMUNITY_ENTERPRISE');

-- CreateEnum
CREATE TYPE "applicant_member_role" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "request_type" AS ENUM ('NEW', 'RENEWAL', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "certification_scope" AS ENUM ('CULTIVATION', 'PROCESSING');

-- CreateEnum
CREATE TYPE "purpose" AS ENUM ('MEDICAL', 'EXPORT');

-- CreateEnum
CREATE TYPE "area_type" AS ENUM ('OUTDOOR', 'INDOOR', 'GREENHOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "land_tenure" AS ENUM ('OWNED', 'STATE_PERMITTED', 'RENTED', 'OWNER_PERMITTED');

-- CreateEnum
CREATE TYPE "application_status" AS ENUM ('DRAFT', 'AWAITING_DOCUMENT_REVIEW_FEE', 'SUBMITTED', 'UNDER_DOCUMENT_REVIEW', 'REVISION_REQUESTED', 'DOCUMENTS_ACCEPTED', 'AWAITING_INSPECTION_FEE', 'AWAITING_INSPECTION', 'INSPECTION_SCHEDULED', 'UNDER_INSPECTION', 'AWAITING_APPROVAL', 'CERTIFIED', 'REJECTED', 'NOT_CERTIFIED', 'WITHDRAWN', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "plant_material_kind" AS ENUM ('SEED', 'OTHER_PART', 'PROCESSING_PART');

-- CreateEnum
CREATE TYPE "material_origin" AS ENUM ('DOMESTIC', 'IMPORTED');

-- CreateEnum
CREATE TYPE "document_access_kind" AS ENUM ('VIEW', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('APPLICANT', 'FINANCE_OFFICER', 'DISPATCHER', 'DOCUMENT_REVIEWER', 'FIELD_INSPECTOR', 'CERTIFICATE_APPROVER', 'SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "identity_provider" AS ENUM ('THAID', 'MORPHROM', 'DEV_LOCAL');

-- CreateEnum
CREATE TYPE "actor_kind" AS ENUM ('USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "applicants" (
    "id" UUID NOT NULL,
    "type" "applicant_type" NOT NULL,
    "legal_name" TEXT NOT NULL,
    "registration_number" TEXT,
    "representative_name" TEXT,
    "nationality" TEXT,
    "national_id_encrypted" TEXT,
    "national_id_hmac" TEXT,
    "house_registration_no" TEXT,
    "address_line" TEXT NOT NULL,
    "subdistrict" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "mobile_phone" TEXT NOT NULL,
    "email" TEXT,
    "line_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "applicants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicant_members" (
    "id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "applicant_member_role" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applicant_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "subdistrict" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "phone" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "land_parcels" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_number" TEXT NOT NULL,
    "volume" TEXT,
    "page" TEXT,
    "issued_by" TEXT,
    "area_square_metres" DECIMAL(12,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "land_parcels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "applicant_id" UUID NOT NULL,
    "site_id" UUID,
    "plant_code" TEXT NOT NULL,
    "request_type" "request_type" NOT NULL,
    "certification_scope" "certification_scope" NOT NULL,
    "purposes" "purpose"[],
    "area_types" "area_type"[],
    "area_type_other" TEXT,
    "land_tenure" "land_tenure",
    "landlord_name" TEXT,
    "plants_per_cycle" INTEGER,
    "cycles_per_year" INTEGER,
    "is_attorney_in_fact" BOOLEAN NOT NULL DEFAULT false,
    "previous_certificate_number" TEXT,
    "status" "application_status" NOT NULL DEFAULT 'DRAFT',
    "rule_snapshot" JSONB,
    "submitted_at" TIMESTAMPTZ(6),
    "declarations_accepted_at" TIMESTAMPTZ(6),
    "declarations_accepted_by_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_status_transitions" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_status" "application_status",
    "to_status" "application_status" NOT NULL,
    "event" TEXT NOT NULL,
    "actor_kind" "actor_kind" NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "user_role",
    "reason_th" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_status_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_declarations" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "clause_code" TEXT NOT NULL,
    "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_by_id" UUID NOT NULL,

    CONSTRAINT "application_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_plant_materials" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "kind" "plant_material_kind" NOT NULL,
    "variety_name" TEXT NOT NULL,
    "origin" "material_origin",
    "origin_country" TEXT,
    "source" TEXT NOT NULL,
    "quantity" DECIMAL(12,2),
    "unit" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "application_plant_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_kind" "actor_kind" NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "user_role",
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "diff" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_access_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "user_role" NOT NULL,
    "document_id" UUID NOT NULL,
    "application_id" UUID,
    "access_kind" "document_access_kind" NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certification_bodies" (
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certification_bodies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "disabled_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "identity_provider" NOT NULL,
    "subject_hmac" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_role_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "user_role" NOT NULL,
    "assigned_by_id" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_id" UUID,

    CONSTRAINT "staff_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title_th" TEXT NOT NULL,
    "body_th" TEXT NOT NULL,
    "link_path" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plants" (
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "scientific_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plants_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "applicants_national_id_hmac_idx" ON "applicants"("national_id_hmac");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_members_applicant_id_user_id_key" ON "applicant_members"("applicant_id", "user_id");

-- CreateIndex
CREATE INDEX "sites_applicant_id_idx" ON "sites"("applicant_id");

-- CreateIndex
CREATE INDEX "land_parcels_site_id_idx" ON "land_parcels"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_reference_number_key" ON "applications"("reference_number");

-- CreateIndex
CREATE INDEX "applications_applicant_id_status_idx" ON "applications"("applicant_id", "status");

-- CreateIndex
CREATE INDEX "applications_status_submitted_at_idx" ON "applications"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "application_status_transitions_application_id_occurred_at_idx" ON "application_status_transitions"("application_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "application_declarations_application_id_clause_code_key" ON "application_declarations"("application_id", "clause_code");

-- CreateIndex
CREATE INDEX "application_plant_materials_application_id_idx" ON "application_plant_materials"("application_id");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_occurred_at_idx" ON "audit_logs"("target_type", "target_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_occurred_at_idx" ON "audit_logs"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "document_access_logs_document_id_occurred_at_idx" ON "document_access_logs"("document_id", "occurred_at");

-- CreateIndex
CREATE INDEX "document_access_logs_user_id_occurred_at_idx" ON "document_access_logs"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "user_identities_user_id_idx" ON "user_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_subject_hmac_key" ON "user_identities"("provider", "subject_hmac");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "staff_role_assignments_user_id_role_idx" ON "staff_role_assignments"("user_id", "role");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_read_at_created_at_idx" ON "notifications"("recipient_user_id", "read_at", "created_at");

-- AddForeignKey
ALTER TABLE "applicant_members" ADD CONSTRAINT "applicant_members_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant_members" ADD CONSTRAINT "applicant_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "land_parcels" ADD CONSTRAINT "land_parcels_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_plant_code_fkey" FOREIGN KEY ("plant_code") REFERENCES "plants"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_transitions" ADD CONSTRAINT "application_status_transitions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_declarations" ADD CONSTRAINT "application_declarations_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_plant_materials" ADD CONSTRAINT "application_plant_materials_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_role_assignments" ADD CONSTRAINT "staff_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
