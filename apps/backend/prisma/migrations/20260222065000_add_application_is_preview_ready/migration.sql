-- Add missing Application preview readiness flag to align DB with committed Prisma schema/runtime usage.
ALTER TABLE "applications"
ADD COLUMN IF NOT EXISTS "isPreviewReady" BOOLEAN NOT NULL DEFAULT false;
