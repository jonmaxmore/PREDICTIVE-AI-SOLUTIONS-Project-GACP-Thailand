-- CreateEnum
CREATE TYPE "license_declaration_status" AS ENUM ('HAVE', 'APPLIED', 'NONE');

-- AlterTable
ALTER TABLE "applicants" ALTER COLUMN "legal_name" DROP NOT NULL,
ALTER COLUMN "address_line" DROP NOT NULL,
ALTER COLUMN "subdistrict" DROP NOT NULL,
ALTER COLUMN "district" DROP NOT NULL,
ALTER COLUMN "province" DROP NOT NULL,
ALTER COLUMN "postal_code" DROP NOT NULL,
ALTER COLUMN "mobile_phone" DROP NOT NULL;

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "attorney_position_th" TEXT,
ADD COLUMN     "lease_ends_on" DATE;

-- AlterTable
ALTER TABLE "land_parcels" ALTER COLUMN "document_type" DROP NOT NULL,
ALTER COLUMN "document_number" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sites" ALTER COLUMN "name" DROP NOT NULL,
ALTER COLUMN "address_line" DROP NOT NULL,
ALTER COLUMN "subdistrict" DROP NOT NULL,
ALTER COLUMN "district" DROP NOT NULL,
ALTER COLUMN "province" DROP NOT NULL,
ALTER COLUMN "postal_code" DROP NOT NULL;

-- CreateTable
CREATE TABLE "application_documents" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "slot_code" "document_slot_code" NOT NULL,
    "version" INTEGER NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "issued_on" DATE,
    "uploaded_by_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(6),
    "removed_by_id" UUID,

    CONSTRAINT "application_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_status_declarations" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "slot_code" "document_slot_code" NOT NULL,
    "status" "license_declaration_status" NOT NULL,
    "license_number" TEXT,
    "issued_on" DATE,
    "expires_on" DATE,
    "receipt_number" TEXT,
    "filed_with_th" TEXT,
    "filed_on" DATE,
    "expected_decision_on" DATE,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "license_status_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_documents_file_key_key" ON "application_documents"("file_key");

-- CreateIndex
CREATE INDEX "application_documents_application_id_slot_code_idx" ON "application_documents"("application_id", "slot_code");

-- CreateIndex
CREATE UNIQUE INDEX "license_status_declarations_application_id_slot_code_key" ON "license_status_declarations"("application_id", "slot_code");

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_slot_code_fkey" FOREIGN KEY ("slot_code") REFERENCES "document_slots"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_status_declarations" ADD CONSTRAINT "license_status_declarations_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_status_declarations" ADD CONSTRAINT "license_status_declarations_slot_code_fkey" FOREIGN KEY ("slot_code") REFERENCES "document_slots"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
