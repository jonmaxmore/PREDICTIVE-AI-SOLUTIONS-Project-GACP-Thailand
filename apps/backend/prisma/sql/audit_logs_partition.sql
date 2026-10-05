-- ==============================================================================
-- Migration Script: Convert `audit_logs` to a Declarative Partitioned Table
-- Supports PostgreSQL 11+
-- Warning: Because Prisma requires `@id` on strings, and we partition by date, 
-- we use `PARTITION BY RANGE (timestamp)`. 
-- To satisfy Postgres, the partition key must be part of the Primary Key.
-- ==============================================================================

BEGIN;

-- 1. Rename the existing table to back it up temporarily
ALTER TABLE "public"."audit_logs" RENAME TO "audit_logs_old";

-- 2. Create the new partitioned table matching the Prisma schema structure
-- BUT removing the strict primary key constraint, or using a composite primary key (id, timestamp)
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "actorEmail" TEXT,
    "actorRole" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "metadata" JSONB,
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "previousHash" TEXT NOT NULL,
    "currentHash" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256',
    
    -- In PostgreSQL partitioned tables, the partition key must be part of the unique/primary constraints
    PRIMARY KEY ("id", "timestamp")
) PARTITION BY RANGE ("timestamp");

-- 3. Create initial Partitions (e.g., for 2025 and 2026)
CREATE TABLE "public"."audit_logs_y2025" PARTITION OF "public"."audit_logs"
    FOR VALUES FROM ('2025-01-01 00:00:00') TO ('2026-01-01 00:00:00');

CREATE TABLE "public"."audit_logs_y2026" PARTITION OF "public"."audit_logs"
    FOR VALUES FROM ('2026-01-01 00:00:00') TO ('2027-01-01 00:00:00');

-- 4. Create Indexes on the partitioned table
CREATE INDEX "audit_logs_actorId_idx" ON "public"."audit_logs"("actorId");
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "public"."audit_logs"("resourceType", "resourceId");
CREATE INDEX "audit_logs_category_severity_idx" ON "public"."audit_logs"("category", "severity");
CREATE INDEX "audit_logs_timestamp_idx" ON "public"."audit_logs"("timestamp" DESC);
CREATE INDEX "audit_logs_metadata_idx" ON "public"."audit_logs" USING GIN ("metadata");

-- 5. Copy data from the old table to the new partitioned table
INSERT INTO "public"."audit_logs" (
    "id", "timestamp", "logId", "sequenceNumber", "category", "action", "severity", 
    "actorId", "actorType", "actorEmail", "actorRole", "resourceType", "resourceId", 
    "ipAddress", "userAgent", "metadata", "result", "errorCode", "errorMessage", 
    "previousHash", "currentHash", "hashAlgorithm"
)
SELECT 
    "id", "timestamp", "logId", "sequenceNumber", "category", "action", "severity", 
    "actorId", "actorType", "actorEmail", "actorRole", "resourceType", "resourceId", 
    "ipAddress", "userAgent", "metadata", "result", "errorCode", "errorMessage", 
    "previousHash", "currentHash", "hashAlgorithm"
FROM "public"."audit_logs_old";

-- 6. Drop the old table now that data has been safely migrated
DROP TABLE "public"."audit_logs_old";

COMMIT;
