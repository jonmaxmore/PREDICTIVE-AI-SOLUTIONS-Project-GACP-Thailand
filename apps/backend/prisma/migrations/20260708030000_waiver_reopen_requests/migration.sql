-- Waiver-reopen requests (owner ruling 2026-07-08).
-- Fees non-refundable on reject/auto-expiry; once-per-application special-case
-- reopen reusing the settled payment. Inspector initiates -> DTAM-side
-- accountant approves. docs/handoffs/waiver-reopen-decision-2026-07-08.md.
--
-- Idempotent (IF NOT EXISTS) — but DO NOT re-run standalone: superseded by
-- 20260708060000_waiver_once_only_leniency_scope, which DROPPED the
-- any-reasonCode APPROVED unique below and replaced it with a
-- LENIENCY-scoped one. Re-running this file alone would resurrect the
-- dropped index and re-block WRONGFUL_EXPIRY reinstates.

CREATE TABLE IF NOT EXISTS "waiver_reopen_requests" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requesterRole" TEXT NOT NULL,
    "expiredFromState" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL DEFAULT 'LENIENCY',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "approverSide" TEXT,
    "decisionNote" TEXT,

    CONSTRAINT "waiver_reopen_requests_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'waiver_reopen_requests_applicationId_fkey'
    ) THEN
        ALTER TABLE "waiver_reopen_requests"
            ADD CONSTRAINT "waiver_reopen_requests_applicationId_fkey"
            FOREIGN KEY ("applicationId") REFERENCES "applications"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "waiver_reopen_requests_applicationId_idx"
    ON "waiver_reopen_requests"("applicationId");

CREATE INDEX IF NOT EXISTS "waiver_reopen_requests_organizationId_status_idx"
    ON "waiver_reopen_requests"("organizationId", "status");

-- Guard rails the ruling requires, enforced at the DATABASE (FE/BE bugs cannot
-- bypass them):
--   * one OPEN (PENDING) request per application at a time
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_waiver_reopen_pending_per_app"
    ON "waiver_reopen_requests"("applicationId")
    WHERE "status" = 'PENDING';

--   * one APPROVED reopen per application EVER (เปิดได้ครั้งเดียว)
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_waiver_reopen_approved_per_app"
    ON "waiver_reopen_requests"("applicationId")
    WHERE "status" = 'APPROVED';
