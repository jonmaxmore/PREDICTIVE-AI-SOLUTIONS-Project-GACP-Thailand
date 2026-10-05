-- Partner access log (DTAM Next integration, 2026-07-08): audit trail of
-- partner reads through /interoperability/v1/*. Platform-level table —
-- partner requests carry no tenant context. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS "partner_access_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partnerId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "code" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "status" INTEGER,
    "ip" TEXT,

    CONSTRAINT "partner_access_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "partner_access_logs_partnerId_createdAt_idx"
    ON "partner_access_logs"("partnerId", "createdAt" DESC);
