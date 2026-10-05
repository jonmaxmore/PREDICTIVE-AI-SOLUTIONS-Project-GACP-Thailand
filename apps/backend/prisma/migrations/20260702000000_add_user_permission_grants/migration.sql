-- ============================================================================
-- Wave 2 — per-permission GRANT/REVOKE engine — user_permission_grants
-- ============================================================================
--
-- "Admin ควบคุม permission ได้": an ADDITIVE override layer on top of each
-- user's canonical-role permission baseline (ROLE_PERMISSIONS in
-- shared/canonical-rbac.js). The standard ERP model:
--
--   effective(user) = ROLE_PERMISSIONS[role] ∪ {GRANT rows} − {REVOKE rows}
--
-- Rows are read LIVE per request by services/effective-permissions-service.js
-- (NOT baked into the JWT), so a grant/revoke takes effect on the very next
-- request — no session-epoch bump needed, unlike a role change.
--
-- Structure mirrors user_group_memberships (ADR-016 Phase 1C):
--   * composite PK (userId, permission)
--   * organizationId mirrored from the user for tenant scope + RLS observe-only
--   * FK userId → users(id)               ON DELETE CASCADE  (grants die with user)
--   * FK organizationId → organizations   ON DELETE RESTRICT ON UPDATE CASCADE
--
-- ## Why this is SAFE / INERT
--   * Brand-new EMPTY table — touches no existing row, alters no column.
--   * Nothing reads it until an admin explicitly writes a grant (the engine
--     falls back to the pure role baseline when a user has zero rows).
--   * RLS observe-only policy matches the sibling table; rls_observe_check is
--     already defined by earlier RLS-phase-E1 migrations.
--
-- Additive-safe to apply. Run with `prisma migrate deploy`.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "user_permission_grants" (
    "userId"     TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "effect"     TEXT NOT NULL,
    "reason"     TEXT,
    "grantedBy"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    -- organizationId mirrored from the user for tenant scope. Stored
    -- denormalised because RLS observe-only needs a column on the row
    -- itself; resolving via JOIN to users would defeat per-row policy
    -- evaluation. Updated by application code; the User row is the
    -- source of truth.
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "user_permission_grants_pkey" PRIMARY KEY ("userId", "permission"),
    CONSTRAINT "user_permission_grants_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_permission_grants_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "user_permission_grants_userId_idx"
    ON "user_permission_grants" ("userId");
CREATE INDEX IF NOT EXISTS "user_permission_grants_organizationId_idx"
    ON "user_permission_grants" ("organizationId");

ALTER TABLE "user_permission_grants" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_permission_grants_observe_tenant" ON "user_permission_grants";
CREATE POLICY "user_permission_grants_observe_tenant" ON "user_permission_grants"
    FOR ALL
    TO PUBLIC
    USING (rls_observe_check('user_permission_grants', "organizationId"))
    WITH CHECK (rls_observe_check('user_permission_grants', "organizationId"));

COMMIT;
