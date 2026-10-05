/*
  Warnings:

  - You are about to drop the column `actualYield` on the `harvest_batches` table. All the data in the column will be lost.
  - You are about to drop the column `areaUnit` on the `harvest_batches` table. All the data in the column will be lost.
  - You are about to drop the column `cultivationType` on the `harvest_batches` table. All the data in the column will be lost.
  - You are about to drop the column `deletedAt` on the `harvest_batches` table. All the data in the column will be lost.
  - You are about to drop the column `estimatedYield` on the `harvest_batches` table. All the data in the column will be lost.
  - You are about to drop the column `plantingDate` on the `harvest_batches` table. All the data in the column will be lost.
  - You are about to drop the column `plotArea` on the `harvest_batches` table. All the data in the column will be lost.
  - You are about to drop the column `plotName` on the `harvest_batches` table. All the data in the column will be lost.
  - You are about to drop the column `qrCode` on the `harvest_batches` table. All the data in the column will be lost.
  - You are about to drop the column `seedSource` on the `harvest_batches` table. All the data in the column will be lost.
  - You are about to drop the column `speciesId` on the `harvest_batches` table. All the data in the column will be lost.
  - You are about to drop the column `trackingUrl` on the `harvest_batches` table. All the data in the column will be lost.
  - You are about to drop the column `yieldUnit` on the `harvest_batches` table. All the data in the column will be lost.
  - Added the required column `freshWeight` to the `harvest_batches` table without a default value. This is not possible if the table is not empty.
  - Made the column `harvestDate` on table `harvest_batches` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "harvest_batches" DROP CONSTRAINT "harvest_batches_speciesId_fkey";

-- DropIndex
DROP INDEX "harvest_batches_farmId_idx";

-- DropIndex
DROP INDEX "harvest_batches_harvestDate_idx";

-- DropIndex
DROP INDEX "harvest_batches_isDeleted_idx";

-- DropIndex
DROP INDEX "harvest_batches_qrCode_key";

-- DropIndex
DROP INDEX "harvest_batches_speciesId_idx";

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "personnelHygiene" JSONB,
ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';

-- AlterTable
ALTER TABLE "certificates" ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';

-- AlterTable
ALTER TABLE "farms" ADD COLUMN     "sanitationInfo" JSONB,
ADD COLUMN     "siteHistory" JSONB;

-- AlterTable
ALTER TABLE "harvest_batches" DROP COLUMN "actualYield",
DROP COLUMN "areaUnit",
DROP COLUMN "cultivationType",
DROP COLUMN "deletedAt",
DROP COLUMN "estimatedYield",
DROP COLUMN "plantingDate",
DROP COLUMN "plotArea",
DROP COLUMN "plotName",
DROP COLUMN "qrCode",
DROP COLUMN "seedSource",
DROP COLUMN "speciesId",
DROP COLUMN "trackingUrl",
DROP COLUMN "yieldUnit",
ADD COLUMN     "dryWeight" DOUBLE PRECISION,
ADD COLUMN     "dryingDuration" INTEGER,
ADD COLUMN     "dryingMethod" TEXT,
ADD COLUMN     "dryingTemp" DOUBLE PRECISION,
ADD COLUMN     "freshWeight" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "isDried" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lossWeight" DOUBLE PRECISION,
ADD COLUMN     "moistureContent" DOUBLE PRECISION,
ADD COLUMN     "plantCode" TEXT,
ADD COLUMN     "qcBy" TEXT,
ADD COLUMN     "qcNotes" TEXT,
ADD COLUMN     "qcPassed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recordedBy" TEXT,
ALTER COLUMN "harvestDate" SET NOT NULL,
ALTER COLUMN "harvestDate" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "status" SET DEFAULT 'RECEIVED';

-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '7 years';

-- AlterTable
ALTER TABLE "plant_species" ADD COLUMN     "maxYieldPerPlant" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "standardSpacing" TEXT,
ALTER COLUMN "group" SET DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "planting_cycles" ADD COLUMN     "plotId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verificationDocuments" JSONB,
ADD COLUMN     "verificationLockedUntil" TIMESTAMP(3),
ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verificationStatus" TEXT NOT NULL DEFAULT 'NEW',
ADD COLUMN     "verificationSubmittedAt" TIMESTAMP(3),
ALTER COLUMN "retainUntil" SET DEFAULT NOW() + INTERVAL '5 years';

-- CreateIndex
CREATE INDEX "harvest_batches_batchNumber_idx" ON "harvest_batches"("batchNumber");

-- AddForeignKey
ALTER TABLE "planting_cycles" ADD CONSTRAINT "planting_cycles_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "plots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_batches" ADD CONSTRAINT "harvest_batches_plantCode_fkey" FOREIGN KEY ("plantCode") REFERENCES "plant_species"("code") ON DELETE SET NULL ON UPDATE CASCADE;
