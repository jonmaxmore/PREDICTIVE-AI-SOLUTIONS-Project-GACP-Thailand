-- Migration: Add cryptographic QR integrity tables (no blockchain)
-- Purpose: Track signed/hash-chained metadata for public trace QR endpoints.
--
-- Rollback (manual):
--   1) DROP TABLE IF EXISTS "trace_qr_scans";
--   2) DROP TABLE IF EXISTS "trace_qr_security";
--   3) Revert application code to skip QR integrity persistence.

BEGIN;

CREATE TABLE IF NOT EXISTS "trace_qr_security" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "qrCode" TEXT,
  "publicUrl" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "dataHash" TEXT NOT NULL,
  "previousHash" TEXT,
  "chainHash" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "signatureAlgorithm" TEXT NOT NULL DEFAULT 'RSA-SHA256',
  "timestampData" JSONB,
  "keyFingerprint" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "scanCount" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "trace_qr_security_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trace_qr_security_entity_key"
  ON "trace_qr_security"("entityType", "entityId");

CREATE INDEX IF NOT EXISTS "trace_qr_security_entity_idx"
  ON "trace_qr_security"("entityType", "entityId");

CREATE INDEX IF NOT EXISTS "trace_qr_security_chainHash_idx"
  ON "trace_qr_security"("chainHash");

CREATE INDEX IF NOT EXISTS "trace_qr_security_createdAt_idx"
  ON "trace_qr_security"("createdAt" DESC);

CREATE TABLE IF NOT EXISTS "trace_qr_scans" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "qrSecurityId" TEXT NOT NULL,
  "requestIp" TEXT,
  "userAgent" TEXT,
  "requestPath" TEXT,
  "verification" JSONB,
  "verified" BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "trace_qr_scans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trace_qr_scans_qrSecurityId_fkey"
    FOREIGN KEY ("qrSecurityId")
    REFERENCES "trace_qr_security"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "trace_qr_scans_qrSecurityId_idx"
  ON "trace_qr_scans"("qrSecurityId");

CREATE INDEX IF NOT EXISTS "trace_qr_scans_createdAt_idx"
  ON "trace_qr_scans"("createdAt" DESC);

COMMIT;
