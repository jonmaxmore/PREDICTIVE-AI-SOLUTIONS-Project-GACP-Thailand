-- M1 EXPAND only (guidance §4) — no column dropped, no meaning changed on old columns.
ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "submittedByUserId" TEXT;
ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "holderDisplayName" TEXT;
ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "holderType" TEXT;

-- Backfill 1: submitter of record = old userId (spec §3.1:28-29)
UPDATE "certificates" SET "submittedByUserId" = "userId"
WHERE "submittedByUserId" IS NULL;

-- Backfill 2 (D1 priority 1): application → entity
UPDATE "certificates" c
SET "holderDisplayName" = e."displayName", "holderType" = e."type"
FROM "applications" a JOIN "entities" e ON e."id" = a."entityId"
WHERE c."applicationId" = a."id" AND a."entityId" IS NOT NULL
  AND c."holderDisplayName" IS NULL;

-- Backfill 3 (D1 priority 2): farm → entity
UPDATE "certificates" c
SET "holderDisplayName" = e."displayName", "holderType" = e."type"
FROM "farms" f JOIN "entities" e ON e."id" = f."entityId"
WHERE c."farmId" = f."id" AND f."entityId" IS NOT NULL
  AND c."holderDisplayName" IS NULL;

-- Backfill 4 (D1 fallback): frozen person name — counted as LEGACY_PERSON
UPDATE "certificates" SET "holderDisplayName" = "applicantName", "holderType" = 'LEGACY_PERSON'
WHERE "holderDisplayName" IS NULL;
