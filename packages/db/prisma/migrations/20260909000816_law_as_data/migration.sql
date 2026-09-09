-- CreateEnum
CREATE TYPE "document_slot_code" AS ENUM ('NATIONAL_ID_COPY', 'HOUSE_REGISTRATION_COPY', 'COMMUNITY_ENTERPRISE_REGISTRATION', 'COMMUNITY_MEMBER_LIST', 'COMMUNITY_ASSIGNMENT_LETTER', 'PRODUCER_SUPERVISION_LETTER', 'JURISTIC_REGISTRATION', 'JURISTIC_DIRECTOR_LIST', 'JURISTIC_AUTHORITY_LETTER', 'POWER_OF_ATTORNEY', 'POA_GRANTOR_ID_COPY', 'LAND_RIGHTS_DOCUMENT', 'LANDLORD_CONSENT_LETTER', 'SITE_MAP_WITH_COORDINATES', 'BUILDING_PLAN_AND_PHOTOS', 'FIELD_AND_SURROUNDINGS_PHOTOS', 'PRODUCTION_SITE_PHOTOS', 'PRODUCTION_AND_UTILISATION_PLAN', 'SECURITY_MEASURES_PLAN', 'RESIDUE_UTILISATION_PLAN', 'SOP_MANUAL', 'CONTROLLED_HERB_LICENSE_RESEARCH', 'CONTROLLED_HERB_LICENSE_EXPORT', 'CONTROLLED_HERB_LICENSE_COMMERCIAL', 'PREVIOUS_CERTIFICATE_ORIGINAL', 'RENEWAL_CULTIVATION_PLAN', 'RENEWAL_UTILISATION_PLAN', 'OPERATION_SUMMARY_REPORT', 'POLICE_REPORT', 'DAMAGED_CERTIFICATE', 'WATER_TEST_RESULT', 'SOIL_TEST_RESULT', 'LAB_CERTIFICATE', 'ADDITIONAL_DOCUMENTS', 'KATORLOR1_GENERATED');

-- CreateEnum
CREATE TYPE "document_slot_group" AS ENUM ('IDENTITY', 'QUALIFICATION', 'POWER_OF_ATTORNEY', 'LAND_AND_SITE', 'PLANS', 'CONTROLLED_HERB_LICENSE', 'RENEWAL', 'REPLACEMENT', 'OPTIONAL', 'GENERATED');

-- CreateEnum
CREATE TYPE "sop_sub_item_code" AS ENUM ('SITE_PREPARATION', 'PLANTING', 'CROP_CARE', 'PEST_MANAGEMENT', 'FERTILISER_AND_SOIL_AMENDMENT', 'HARVEST', 'STORAGE', 'PRIMARY_PROCESSING', 'PERSONNEL_HYGIENE', 'TRACEABILITY', 'SITE_SANITATION');

-- CreateEnum
CREATE TYPE "requirement_level" AS ENUM ('REQUIRED', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "fee_stage" AS ENUM ('DOCUMENT_REVIEW', 'ONSITE_INSPECTION');

-- CreateEnum
CREATE TYPE "fee_basis" AS ENUM ('PER_CULTIVATION_FORMAT', 'PER_APPLICATION');

-- CreateEnum
CREATE TYPE "inspection_checklist_category" AS ENUM ('SITE_AND_ENVIRONMENT', 'WATER', 'PLANTING_MATERIAL', 'CULTIVATION_PRACTICE', 'FERTILISER_AND_SOIL', 'PLANT_PROTECTION', 'HARVEST', 'POST_HARVEST_AND_PRIMARY_PROCESSING', 'PACKAGING_AND_LABELLING', 'STORAGE_AND_TRANSPORT', 'PERSONNEL_HYGIENE', 'FACILITIES_AND_EQUIPMENT', 'DOCUMENTATION_AND_TRACEABILITY', 'SECURITY_AND_ACCESS_CONTROL');

-- CreateTable
CREATE TABLE "document_slots" (
    "code" "document_slot_code" NOT NULL,
    "group" "document_slot_group" NOT NULL,
    "form_step" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "label_th" TEXT NOT NULL,
    "what_is_it_th" TEXT NOT NULL,
    "how_to_obtain_th" TEXT,
    "accepted_mime_types" TEXT[],
    "max_files" INTEGER NOT NULL,
    "max_file_bytes" INTEGER NOT NULL,
    "requires_issued_date" BOOLEAN NOT NULL,
    "issued_within_days" INTEGER,
    "is_license" BOOLEAN NOT NULL,
    "sub_item_codes" "sop_sub_item_code"[],
    "is_system_generated" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_slots_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "document_requirement_rules" (
    "code" TEXT NOT NULL,
    "plant_code" TEXT NOT NULL,
    "slot_code" "document_slot_code" NOT NULL,
    "requirement_level" "requirement_level" NOT NULL,
    "applicant_types" "applicant_type"[],
    "request_types" "request_type"[],
    "certification_scopes" "certification_scope"[],
    "purposes" "purpose"[],
    "area_types" "area_type"[],
    "land_tenures" "land_tenure"[],
    "attorney_in_fact" BOOLEAN,
    "alternative_group_code" TEXT,
    "reason_th" TEXT NOT NULL,
    "source_th" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_requirement_rules_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "fee_schedules" (
    "code" TEXT NOT NULL,
    "plant_code" TEXT NOT NULL,
    "fee_stage" "fee_stage" NOT NULL,
    "request_types" "request_type"[],
    "fee_basis" "fee_basis" NOT NULL,
    "line_title_th" TEXT NOT NULL,
    "state_fee_satang" INTEGER NOT NULL,
    "service_fee_satang" INTEGER NOT NULL,
    "vat_rate_basis_points" INTEGER NOT NULL,
    "quotation_valid_days" INTEGER NOT NULL,
    "source_th" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_schedules_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "inspection_checklist_items" (
    "code" TEXT NOT NULL,
    "plant_code" TEXT NOT NULL,
    "category" "inspection_checklist_category" NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "text_th" TEXT NOT NULL,
    "guidance_th" TEXT,
    "is_critical" BOOLEAN NOT NULL,
    "requires_photo_evidence" BOOLEAN NOT NULL,
    "source_th" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_checklist_items_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "certificate_terms" (
    "code" TEXT NOT NULL,
    "plant_code" TEXT NOT NULL,
    "certification_scopes" "certification_scope"[],
    "request_types" "request_type"[],
    "validity_months" INTEGER NOT NULL,
    "source_th" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_terms_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "public_holidays" (
    "date" DATE NOT NULL,
    "name_th" TEXT NOT NULL,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "document_requirement_rules_plant_code_effective_from_idx" ON "document_requirement_rules"("plant_code", "effective_from");

-- CreateIndex
CREATE INDEX "fee_schedules_plant_code_fee_stage_effective_from_idx" ON "fee_schedules"("plant_code", "fee_stage", "effective_from");

-- CreateIndex
CREATE INDEX "inspection_checklist_items_plant_code_effective_from_idx" ON "inspection_checklist_items"("plant_code", "effective_from");

-- CreateIndex
CREATE INDEX "certificate_terms_plant_code_effective_from_idx" ON "certificate_terms"("plant_code", "effective_from");

-- AddForeignKey
ALTER TABLE "document_requirement_rules" ADD CONSTRAINT "document_requirement_rules_slot_code_fkey" FOREIGN KEY ("slot_code") REFERENCES "document_slots"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requirement_rules" ADD CONSTRAINT "document_requirement_rules_plant_code_fkey" FOREIGN KEY ("plant_code") REFERENCES "plants"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_plant_code_fkey" FOREIGN KEY ("plant_code") REFERENCES "plants"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_checklist_items" ADD CONSTRAINT "inspection_checklist_items_plant_code_fkey" FOREIGN KEY ("plant_code") REFERENCES "plants"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_terms" ADD CONSTRAINT "certificate_terms_plant_code_fkey" FOREIGN KEY ("plant_code") REFERENCES "plants"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
