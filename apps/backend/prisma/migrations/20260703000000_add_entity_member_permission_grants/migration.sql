-- ============================================================================
-- Farm-worker Wave B — per-member permission GRANT/REVOKE engine —
-- entity_member_permission_grants
-- ============================================================================
--
-- "เจ้าของปรับ permission รายคน-รายการกระทำ": an ADDITIVE override layer on top
-- of each workspace member's role baseline (DEFAULT_PERMISSIONS_BY_ROLE in
-- services/entity-service.js) + the legacy EntityMembership.permissions[]
-- array. The standard ERP model, mirrored from user_permission_grants
-- (Wave 2, 20260702000000):
--
--   effective(member) = DEFAULT_PERMISSIONS_BY_ROLE[role]
--                       ∪ legacy membership.permissions[]
--                       ∪ {GRANT rows} − {REVOKE rows}   (REVOKE wins)
--
-- Rows are read LIVE per request by
-- services/entity-effective-permissions-service.js (NOT baked into a token),
-- so an OWNER's grant/revoke takes effect on the member's very next request.
--
-- Structure mirrors user_permission_grants:
--   * composite PK (membershipId, permission)
--   * organizationId mirrored from the membership for tenant scope + RLS observe-only
--   * FK membershipId → entity_memberships(id) ON DELETE CASCADE (grants die with the membership)
--   * FK organizationId → organizations       ON DELETE RESTRICT ON UPDATE CASCADE
--
-- ## Why this is SAFE / INERT
--   * Brand-new EMPTY table — touches no existing row, alters no column.
--   * Nothing reads it until an entity OWNER explicitly writes a grant (the
--     engine falls back to the role baseline + legacy permissions[] when a
--     membership has zero rows).
--   * RLS observe-only policy matches the sibling table; rls_observe_check is
--     already defined by earlier RLS-phase-E1 migrations.
--
-- Additive-safe to apply. Run with `prisma migrate deploy`.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "entity_member_permission_grants" (
    "membershipId" TEXT NOT NULL,
    "permission"   TEXT NOT NULL,
    "effect"       TEXT NOT NULL,
    "reason"       TEXT,
    "grantedBy"    TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    -- organizationId mirrored from the membership for tenant scope. Stored
    -- denormalised because RLS observe-only needs a column on the row
    -- itself; resolving via JOIN to entity_memberships would defeat per-row
    -- policy evaluation. Updated by application code; the membership row is
    -- the source of truth.
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "entity_member_permission_grants_pkey" PRIMARY KEY ("membershipId", "permission"),
    CONSTRAINT "entity_member_permission_grants_membershipId_fkey"
        FOREIGN KEY ("membershipId") REFERENCES "entity_memberships"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "entity_member_permission_grants_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "entity_member_permission_grants_membershipId_idx"
    ON "entity_member_permission_grants" ("membershipId");
CREATE INDEX IF NOT EXISTS "entity_member_permission_grants_organizationId_idx"
    ON "entity_member_permission_grants" ("organizationId");

ALTER TABLE "entity_member_permission_grants" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entity_member_permission_grants_observe_tenant" ON "entity_member_permission_grants";
CREATE POLICY "entity_member_permission_grants_observe_tenant" ON "entity_member_permission_grants"
    FOR ALL
    TO PUBLIC
    USING (rls_observe_check('entity_member_permission_grants', "organizationId"))
    WITH CHECK (rls_observe_check('entity_member_permission_grants', "organizationId"));

COMMIT;
