-- T-010 / Subtask 1 (c) — promote `certificates.farmId` from a loose
-- scalar string into a proper foreign key referencing `farms.id`.
--
-- Why this matters
-- ----------------
-- Certificate rows carry the legal evidence that a farm passed GACP
-- audit (issue date, expiry, verification code, QR data). Without a
-- FK, the JOIN from Certificate → Farm at trace/verify time has no
-- DB-level guarantee that the farm referenced still exists or is the
-- farm originally certified.
--
-- The cert-issuance path (services/certificate-service.js:209,377,
-- 398,441,461) reads `farm.id` from a known Farm row before writing,
-- so live-traffic writes always have a valid pointer. The FK locks
-- in that invariant against:
--   - admin-tooling typos / direct DB inserts
--   - race conditions where Farm is deleted between issue + read
--   - data-restore scenarios where Certificate rows are imported
--     ahead of Farm rows
--
-- ON DELETE Restrict (NOT Cascade)
-- --------------------------------
-- Certificates are legal records. Cascade-deleting them when a farm
-- is hard-deleted would erase the audit trail of "this farm was
-- certified on date X" — exactly what regulators look for years
-- after a farm closes operations. Restrict makes the operator
-- explicit: archive certificates first (preserve audit trail),
-- THEN delete the farm.
--
-- The codebase soft-deletes farms via Farm.isDeleted, so this
-- Restrict is a belt-and-suspenders guard against accidental
-- hard-delete via prisma.farm.delete() in admin tooling.
--
-- Pre-migration data check (run on prod before applying — MANDATORY,
-- farmId is NOT NULL):
--
--   SELECT count(*) FROM "certificates" c
--   WHERE NOT EXISTS (SELECT 1 FROM "farms" f WHERE f."id" = c."farmId");
--   → must be 0 (otherwise dedupe / archive orphans first)
--
-- Idempotency note (matches 20260430200000_add_application_role_fks
-- pattern): re-runs on partially-migrated environments are no-ops.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'certificates'
          AND constraint_name = 'certificates_farmId_fkey'
          AND constraint_type = 'FOREIGN KEY'
    ) THEN
        ALTER TABLE "certificates"
        ADD CONSTRAINT "certificates_farmId_fkey"
        FOREIGN KEY ("farmId")
        REFERENCES "farms"("id")
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
    END IF;
END $$;
