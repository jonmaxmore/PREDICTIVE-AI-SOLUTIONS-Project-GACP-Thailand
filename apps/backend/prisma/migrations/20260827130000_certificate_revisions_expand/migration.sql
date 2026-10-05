-- =============================================================================
-- Certificate revisions (ฉบับแก้ไขภายใต้เลขเดิม) — expand only.
-- Spec: design note 2026-08-27-certificate-revision-design §2
-- =============================================================================
--
-- WHY. A certificate whose location facts are wrong because the SYSTEM wrote
-- them wrong (a farm register that changed under it, a copy that never ran)
-- must be corrected without changing what the holder and the public already
-- hold: the number, the QR, the id the planting cycles point at. Editing the
-- row in place would silently break the signature over the original document;
-- revoking and re-issuing would change the number and orphan every reference.
-- So the correction is a REVISION: the signed document as it stood is archived
-- verbatim as revision n, the live row is rewritten from the Farm row only and
-- re-signed as revision n+1. Both remain verifiable in public.
--
-- EXPAND ONLY. One new table, four ADDED columns on "certificates" (one with a
-- default of 1 — every certificate that exists today IS its own first revision,
-- so 1 is a fact, not a placeholder; the other three NULL = never revised).
-- Nothing is dropped, renamed, retyped or backfilled. ADD COLUMN with a
-- constant default takes no table rewrite on PostgreSQL 11+.
--
-- Same shape as 20260819000000_add_gps_verification_log: organizationId is
-- copied from the certificate (required, FK RESTRICT/CASCADE), no soft-delete
-- columns (append-only archive), and the RLS observe-only tenant policy that
-- every tenant table since RLS phase E1 carries (rls_observe_check is defined
-- by 20260429100100_rls_phase_e1_observe_only).
--
-- This SQL ships in the same change as prisma/schema/certification.prisma
-- because CI's migration-drift-check diffs the migration chain against the
-- schema; either half landing alone turns that required gate red.
-- -----------------------------------------------------------------------------

ALTER TABLE "certificates" ADD COLUMN "revisionNo" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "certificates" ADD COLUMN "revisedAt" TIMESTAMP(3);
ALTER TABLE "certificates" ADD COLUMN "revisedBy" TEXT;
ALTER TABLE "certificates" ADD COLUMN "revisionReason" TEXT;

CREATE TABLE "certificate_revisions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "certificateId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "documentHash" TEXT,
    "signature" TEXT,
    "signatureAlgorithm" TEXT,
    "signatureKeyId" TEXT,
    "signaturePublicKey" TEXT,
    "signedBy" TEXT,
    "signedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3) NOT NULL,
    "supersededBy" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT,
    "correctedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "certificate_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "certificate_revisions_certificateId_revisionNo_key" ON "certificate_revisions"("certificateId", "revisionNo");
CREATE INDEX "certificate_revisions_certificateId_idx" ON "certificate_revisions"("certificateId");
CREATE INDEX "certificate_revisions_organizationId_idx" ON "certificate_revisions"("organizationId");

ALTER TABLE "certificate_revisions" ADD CONSTRAINT "certificate_revisions_certificateId_fkey"
    FOREIGN KEY ("certificateId") REFERENCES "certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "certificate_revisions" ADD CONSTRAINT "certificate_revisions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS observe-only tenant policy (measure, enforce nothing yet), as on every
-- tenant table since phase E1. The table is created above in this same
-- migration, so no policy can pre-exist and nothing needs dropping first.
ALTER TABLE "certificate_revisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "certificate_revisions_observe_tenant" ON "certificate_revisions"
    FOR ALL
    TO PUBLIC
    USING (rls_observe_check('certificate_revisions', "organizationId"))
    WITH CHECK (rls_observe_check('certificate_revisions', "organizationId"));

-- ROLLBACK (only if the release is pulled before anything writes a revision;
-- the columns are additive and inert, so leaving them in place is also a
-- valid rollback):
--   DROP TABLE IF EXISTS "certificate_revisions";
--   ALTER TABLE "certificates"
--     DROP COLUMN IF EXISTS "revisionNo",
--     DROP COLUMN IF EXISTS "revisedAt",
--     DROP COLUMN IF EXISTS "revisedBy",
--     DROP COLUMN IF EXISTS "revisionReason";
