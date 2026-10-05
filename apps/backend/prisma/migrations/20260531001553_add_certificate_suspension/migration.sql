-- AlterTable
ALTER TABLE "certificates" ADD COLUMN     "reinstatedAt" TIMESTAMP(3),
ADD COLUMN     "reinstatedBy" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedBy" TEXT,
ADD COLUMN     "suspendedReason" TEXT;
