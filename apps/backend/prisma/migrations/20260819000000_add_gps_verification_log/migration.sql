-- ============================================================================
-- GPS start-marker revival — gps_verification_logs
-- (F-ONSITE-GPS-CHECKIN-UNREACHABLE, 2026-08-19)
-- ============================================================================
--
-- GpsVerificationLog never existed as a Prisma model or table.
-- services/audit-onsite-service.js startInspection guards every write with
-- `typeof prisma.gpsVerificationLog?.create === 'function'` (silent no-op
-- when false), so the field app's GPS check-in has been dead since it
-- shipped: startedAt always resolved null, the FE always reopened on the
-- start screen, and check-in GPS coordinates were never persisted. This
-- migration provisions the table the guard was written to expect; no
-- application code changes shape to accommodate it (the create() payload at
-- audit-onsite-service.js:474-487 already matches this table's columns
-- exactly).
--
-- Structure mirrors the sibling evidence table farm_audit_photos
-- (prisma/schema/audit-onsite-evidence.prisma):
--   * organizationId supplied by the caller (startInspection reads it off
--     the already-fetched audit row) — required, FK RESTRICT/CASCADE.
--   * No soft-delete columns — append-only evidence, same as
--     FarmAuditPhoto/FarmAuditChecklistItem.
--   * RLS observe-only tenant policy, matching every RLS-phase-E1+ table
--     (rls_observe_check is already defined by earlier migrations).
--
-- NOTE: the immediately preceding evidence-table migration
-- (20260816161908_onsite_evidence_models) shipped WITHOUT the RLS step for
-- farm_audit_photos / farm_audit_checklist_items — that omission is a known
-- gap tracked separately and is NOT repeated here.
--
-- ## Why this is SAFE / expand-only
--   * Brand-new EMPTY table — touches no existing row, alters no column.
--   * Nothing reads it until an auditor calls POST .../start (guarded
--     create() above); the guard itself is left in place by this change,
--     so a rollback of this migration alone returns the app to today's
--     no-op-safe behavior.
--
-- Additive-safe to apply. Run with `prisma migrate deploy`.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "gps_verification_logs" (
    "id"                 TEXT NOT NULL,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entityType"         TEXT NOT NULL,
    "entityId"           TEXT NOT NULL,
    "reportedLatitude"   DOUBLE PRECISION NOT NULL,
    "reportedLongitude"  DOUBLE PRECISION NOT NULL,
    "gpsAccuracy"        DOUBLE PRECISION,
    "verifiedBy"         TEXT NOT NULL,
    "verifiedAt"         TIMESTAMP(3) NOT NULL,
    "verificationMethod" TEXT NOT NULL,
    "isVerified"         BOOLEAN NOT NULL DEFAULT false,
    "organizationId"     TEXT NOT NULL,

    CONSTRAINT "gps_verification_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gps_verification_logs_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "gps_verification_logs_entityType_entityId_idx"
    ON "gps_verification_logs" ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "gps_verification_logs_organizationId_idx"
    ON "gps_verification_logs" ("organizationId");

ALTER TABLE "gps_verification_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gps_verification_logs_observe_tenant" ON "gps_verification_logs";
CREATE POLICY "gps_verification_logs_observe_tenant" ON "gps_verification_logs"
    FOR ALL
    TO PUBLIC
    USING (rls_observe_check('gps_verification_logs', "organizationId"))
    WITH CHECK (rls_observe_check('gps_verification_logs', "organizationId"));

COMMIT;
