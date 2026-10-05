-- AlterTable: Add assignment and mode fields to Application
-- Date: 2026-03-06
-- CP-13: Case Assignment (reviewer/scheduler/headAuditor per case)
-- CP-14: Appointment & Audit Mode (ONLINE/OFFLINE)

-- Case Assignment Fields
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "reviewerUserId" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "schedulerUserId" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "headAuditorUserId" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "sameReviewerAuditor" BOOLEAN NOT NULL DEFAULT false;

-- Appointment Mode Fields
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "appointmentMode" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "meetingUrl" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "appointmentLocation" TEXT;

-- Audit Mode Fields
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "auditMode" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "auditMeetingUrl" TEXT;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "auditLocation" TEXT;
