/**
 * Farm-worker Wave B, Chunk 1 — EntityMemberPermissionGrant schema contract.
 *
 * Mirrors the Wave-2 UserPermissionGrant shape (composite PK, GRANT|REVOKE
 * effect column, organizationId tenant FK, ON DELETE CASCADE off the parent
 * row) but keyed by EntityMembership instead of User.
 *
 * These are STATIC contract pins (schema file + tenant-extension registry +
 * migration SQL): no DB needed, so they run on every machine. The live
 * behaviour is covered by the engine/route suites in later chunks.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(
    __dirname, '..', '..', 'prisma', 'schema', 'entity-member-permission-grants.prisma',
);
const MIGRATION_DIR = path.join(
    __dirname, '..', '..', 'prisma', 'migrations',
    '20260703000000_add_entity_member_permission_grants',
);

describe('EntityMemberPermissionGrant — schema file', () => {
    let schema;
    beforeAll(() => {
        schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    });

    it('defines the model with the mirrored UserPermissionGrant columns', () => {
        expect(schema).toContain('model EntityMemberPermissionGrant');
        expect(schema).toMatch(/membershipId\s+String/);
        expect(schema).toMatch(/permission\s+String/);
        expect(schema).toMatch(/effect\s+String/);
        expect(schema).toMatch(/reason\s+String\?/);
        // grantedBy is a User.id UUID (never a national ID — scalar-audit rule)
        expect(schema).toMatch(/grantedBy\s+String\?/);
        expect(schema).toMatch(/organizationId\s+String/);
    });

    it('composite PK (membershipId, permission) + cascade off the membership row', () => {
        expect(schema).toMatch(/@@id\(\[membershipId,\s*permission\]\)/);
        expect(schema).toMatch(/references:\s*\[id\],\s*onDelete:\s*Cascade/);
        expect(schema).toContain('@@map("entity_member_permission_grants")');
    });
});

describe('EntityMemberPermissionGrant — ADR-014 tenant registration', () => {
    it('is registered in TENANT_SCOPED_MODELS like UserPermissionGrant', () => {
        const { TENANT_SCOPED_MODELS } = require('../../services/tenant-prisma-extension');
        expect(TENANT_SCOPED_MODELS.has('UserPermissionGrant')).toBe(true); // sibling sanity
        expect(TENANT_SCOPED_MODELS.has('EntityMemberPermissionGrant')).toBe(true);
    });
});

describe('EntityMemberPermissionGrant — handcrafted migration', () => {
    let sql;
    beforeAll(() => {
        sql = fs.readFileSync(path.join(MIGRATION_DIR, 'migration.sql'), 'utf8');
    });

    it('creates the table with composite PK + both FKs (mirrors user_permission_grants)', () => {
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS "entity_member_permission_grants"');
        expect(sql).toMatch(/PRIMARY KEY \("membershipId", "permission"\)/);
        expect(sql).toMatch(/REFERENCES "entity_memberships"\("id"\)\s*\n?\s*ON DELETE CASCADE/);
        expect(sql).toMatch(/REFERENCES "organizations"\("id"\)\s*\n?\s*ON DELETE RESTRICT/);
    });

    it('enables the RLS observe-only policy like the sibling table', () => {
        expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
        expect(sql).toContain("rls_observe_check('entity_member_permission_grants'");
    });
});
