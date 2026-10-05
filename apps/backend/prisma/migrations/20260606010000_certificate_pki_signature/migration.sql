-- ============================================================================
-- CERT-01 — PKI digital signature on the certificate (RSA-SHA256 over documentHash)
-- ============================================================================
--
-- Adds three nullable columns to `certificates` so the issued certificate
-- carries a verifiable PKI signature (non-repudiation / third-party crypto
-- verification) in addition to the existing SHA-256 content hash. Required for
-- a government e-certificate.
--
-- Strictly ADDITIVE / non-destructive:
--   - Three nullable TEXT columns, no default, no backfill needed.
--   - Existing rows keep signature = NULL (legacy / hash-only integrity); the
--     verifier reports them as "signed: false" and falls back to hash checking.
--   - Forward-compatible: a signing outage at issuance also leaves NULL, so the
--     single-auditor auto-issue flow never blocks on the signing service.
-- ============================================================================

ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "signature" TEXT;
ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "signatureAlgorithm" TEXT;
ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "signatureKeyId" TEXT;

-- Rollback (DBA reference — NOT applied automatically):
--   ALTER TABLE "certificates" DROP COLUMN IF EXISTS "signature";
--   ALTER TABLE "certificates" DROP COLUMN IF EXISTS "signatureAlgorithm";
--   ALTER TABLE "certificates" DROP COLUMN IF EXISTS "signatureKeyId";
