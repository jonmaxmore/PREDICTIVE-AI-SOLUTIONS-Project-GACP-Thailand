-- ADR-016 Phase 1C — first-class M2M user/group model.
--
-- The single User.role column models "this user is exactly one role".
-- In reality (per the 2026-04-30 SOW review) one person commonly does
-- both DOCUMENT_REVIEWER + AUDITOR work on the same application. Phase 1A
-- introduced WorkActivity to track work-by-work-type; this phase makes
-- the *user* side support multi-group too — so a single auditor can
-- claim DOC_REVIEW activities AND FIELD_AUDIT activities without role-
-- swapping.
--
-- Two new tables:
--
--   role_groups              global registry of canonical groups
--   user_group_memberships   M2M between users and groups (per-tenant)
--
-- Backward-compatible: User.role stays. Reads fall back to User.role
-- when the user has no memberships yet (defensive). The backfill below
-- creates one membership row per user from their existing role, so
-- post-migration every user already has the right groups via the new
-- table. The fallback guards against a future user being created
-- without memberships (e.g. admin self-service signup).

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- role_groups — global config (one row per canonical role)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role_groups" (
    "id"        TEXT PRIMARY KEY,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "code"     TEXT NOT NULL UNIQUE,
    "titleTH"  TEXT NOT NULL,
    "titleEN"  TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO "role_groups" ("id", "code", "titleTH", "titleEN") VALUES
    ('rg_admin',              'admin',              'ผู้ดูแลระบบ',           'System Administrator'),
    ('rg_scheduler',          'scheduler',          'ผู้จัดคิว',              'Scheduler / Coordinator'),
    ('rg_document_reviewer',  'document_reviewer',  'ผู้ตรวจเอกสาร',         'Document Reviewer'),
    ('rg_auditor',            'auditor',            'ผู้ตรวจประเมิน',         'Auditor'),
    ('rg_account',            'account',            'บัญชี',                  'Accountant')
ON CONFLICT ("code") DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- user_group_memberships — M2M
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_group_memberships" (
    "userId"     TEXT NOT NULL,
    "groupId"    TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    "isActive"   BOOLEAN NOT NULL DEFAULT TRUE,

    -- organizationId mirrored from the user for tenant scope. Stored
    -- denormalised because RLS observe-only needs a column on the row
    -- itself; resolving via JOIN to users would defeat per-row policy
    -- evaluation. Updated by application code; the User row is the
    -- source of truth.
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "user_group_memberships_pkey" PRIMARY KEY ("userId", "groupId"),
    CONSTRAINT "user_group_memberships_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_group_memberships_groupId_fkey"
        FOREIGN KEY ("groupId") REFERENCES "role_groups"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "user_group_memberships_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "user_group_memberships_userId_idx"
    ON "user_group_memberships" ("userId");
CREATE INDEX IF NOT EXISTS "user_group_memberships_groupId_idx"
    ON "user_group_memberships" ("groupId");
CREATE INDEX IF NOT EXISTS "user_group_memberships_organizationId_groupId_idx"
    ON "user_group_memberships" ("organizationId", "groupId");

ALTER TABLE "user_group_memberships" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_group_memberships_observe_tenant" ON "user_group_memberships";
CREATE POLICY "user_group_memberships_observe_tenant" ON "user_group_memberships"
    FOR ALL
    TO PUBLIC
    USING (rls_observe_check('user_group_memberships', "organizationId"))
    WITH CHECK (rls_observe_check('user_group_memberships', "organizationId"));

-- ──────────────────────────────────────────────────────────────────────────
-- Backfill: one membership row per user from their existing User.role
-- ──────────────────────────────────────────────────────────────────────────
-- Map legacy role string → canonical group code.
-- Mirrors canonicalToLegacyRole in apps/backend/shared/canonical-rbac.js.
INSERT INTO "user_group_memberships" ("userId", "groupId", "organizationId")
SELECT
    u."id",
    rg."id",
    u."organizationId"
FROM "users" u
JOIN "role_groups" rg ON rg."code" = (
    CASE LOWER(COALESCE(u."role", ''))
        WHEN 'admin'              THEN 'admin'
        WHEN 'super_admin'        THEN 'admin'
        WHEN 'scheduler'          THEN 'scheduler'
        WHEN 'reviewer_auditor'   THEN 'document_reviewer'
        WHEN 'document_reviewer'  THEN 'document_reviewer'
        WHEN 'reviewer'           THEN 'document_reviewer'
        WHEN 'auditor'            THEN 'auditor'
        WHEN 'inspector'          THEN 'auditor'
        WHEN 'audit'              THEN 'auditor'
        WHEN 'head_auditor'       THEN 'auditor'
        WHEN 'approver'           THEN 'auditor'
        WHEN 'final_approver'     THEN 'auditor'
        WHEN 'account'            THEN 'account'
        WHEN 'accountant'         THEN 'account'
        WHEN 'finance'            THEN 'account'
        ELSE NULL
    END
)
WHERE u."isDeleted" = FALSE
  AND u."organizationId" IS NOT NULL
ON CONFLICT ("userId", "groupId") DO NOTHING;

-- HEALTH users intentionally don't get a membership row — the M2M groups
-- are for staff (provider-side) only. HEALTH users continue to be
-- identified by User.role = 'HEALTH'.

DO $$
DECLARE
    member_count INT;
    user_count INT;
BEGIN
    SELECT COUNT(*) INTO user_count
    FROM "users"
    WHERE "isDeleted" = FALSE
      AND LOWER(COALESCE("role", '')) NOT IN ('health', '');
    SELECT COUNT(*) INTO member_count FROM "user_group_memberships";
    RAISE NOTICE 'ADR-016 Phase 1C: backfilled % membership rows for % staff users',
                 member_count, user_count;
END
$$;

COMMIT;
