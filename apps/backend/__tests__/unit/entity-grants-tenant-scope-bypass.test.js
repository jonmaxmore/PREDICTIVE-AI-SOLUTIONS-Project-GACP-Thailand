/**
 * Wave B adversarial-verify S7 (2026-07-03) — the grant engine's reads (and
 * the admin API's grant writes) must BYPASS the tenant read/write scope.
 *
 * EntityMemberPermissionGrant is in TENANT_SCOPED_MODELS, so under
 * TENANT_READ_ORG_SCOPE=true the tenant-prisma-extension injects
 * `organizationId = <caller's org>` into findMany. A cross-org member's
 * grants live under the ENTITY's org (mirrored from the membership row) —
 * the caller's request context carries the CALLER's org, so the engine's
 * grant read came back EMPTY and a REVOKE silently dropped (fail-open on the
 * exact control the engine exists to enforce).
 *
 * Writes: the extension's applyToRecord throws CROSS_TENANT_WRITE when an
 * explicitly-stamped organizationId (correctly = the entity's org, via
 * membership.organizationId) differs from the bound context → the admin API
 * 500'd for a cross-org OWNER.
 *
 * Fix: the grant read in entity-effective-permissions-service and the
 * grant-write transactions in entity-service (setMemberPermissionGrant /
 * resetMemberPermissionGrant, + clearMembershipGrants' snapshot read) run
 * inside withoutTenantScope — the entity dimension owns these rows and every
 * write stamps organizationId explicitly from the membership row.
 *
 * The fake prisma client below BEHAVES like the extension (reads the REAL
 * tenant-context and applies the org filter / write guard), so the tests
 * prove the wrapper, not a stub of it.
 */

'use strict';

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

// entity-service's module-level prisma import (unused by these tests — we
// exercise the tx-callback with the fake client) must not process.exit.
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

const { runWithTenantContext, getTenantContext } = require('../../services/tenant-context');
const {
    getEffectiveEntityPermissions,
} = require('../../services/entity-effective-permissions-service');
const entityService = require('../../services/entity-service');

const ENTITY_ORG = 'org-entity';
const CALLER_ORG = 'org-caller';

const MEMBERSHIP = {
    id: 'mem-1', userId: 'worker-1', entityId: 'ent-1',
    role: 'MANAGER', permissions: [], status: 'ACTIVE', organizationId: ENTITY_ORG,
};

const GRANT_ROWS = [
    { membershipId: 'mem-1', permission: 'HARVEST_RECORD', effect: 'REVOKE', organizationId: ENTITY_ORG },
];

/**
 * Extension-behaving fake:
 *  - findMany on the grants model injects `organizationId = ctx.organizationId`
 *    when a tenant context is bound (TENANT_READ_ORG_SCOPE=true emulation)
 *    and then FILTERS rows like Postgres would.
 *  - upsert enforces the CROSS_TENANT_WRITE guard exactly like applyToRecord.
 */
function extensionBehavingClient() {
    const client = {
        entityMembership: {
            findUnique: jest.fn().mockResolvedValue(MEMBERSHIP),
        },
        entityMemberPermissionGrant: {
            findMany: jest.fn(async (args) => {
                const ctx = getTenantContext();
                const where = { ...(args?.where || {}) };
                if (ctx) { where.organizationId = ctx.organizationId; }
                return GRANT_ROWS.filter((g) => (
                    g.membershipId === where.membershipId
                    && (where.organizationId === undefined || g.organizationId === where.organizationId)
                ));
            }),
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn(async (args) => {
                const ctx = getTenantContext();
                const record = args.create;
                if (ctx && record.organizationId && record.organizationId !== ctx.organizationId) {
                    const err = new Error('Cross-tenant write blocked');
                    err.code = 'CROSS_TENANT_WRITE';
                    throw err;
                }
                return record;
            }),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        entityMembershipEvent: { create: jest.fn().mockResolvedValue({ id: 'evt' }) },
        farm: { findUnique: jest.fn() },
    };
    client.$transaction = jest.fn(async (fn) => fn(client));
    return client;
}

describe('S7 — engine grant read bypasses the tenant read scope', () => {
    it('cross-org member under the CALLER-org context: REVOKE still drops the permission', async () => {
        const prisma = extensionBehavingClient();
        const res = await runWithTenantContext({ organizationId: CALLER_ORG }, () => (
            getEffectiveEntityPermissions({ membershipId: 'mem-1', prisma })
        ));
        // Pre-fix: the org-injected read returned [] → REVOKE dropped and
        // MANAGER's role default resurrected HARVEST_RECORD (fail-open).
        expect(res.grants).toEqual([{ permission: 'HARVEST_RECORD', effect: 'REVOKE' }]);
        expect(res.effective).not.toContain('HARVEST_RECORD');
    });

    it('same-org context keeps working (wrapper is a no-op for the common case)', async () => {
        const prisma = extensionBehavingClient();
        const res = await runWithTenantContext({ organizationId: ENTITY_ORG }, () => (
            getEffectiveEntityPermissions({ membershipId: 'mem-1', prisma })
        ));
        expect(res.effective).not.toContain('HARVEST_RECORD');
    });
});

describe('S7 — admin-API grant writes bypass the tenant write guard', () => {
    it('setMemberPermissionGrant stamps the ENTITY org and succeeds under a cross-org caller context', async () => {
        const prisma = extensionBehavingClient();
        // entity-service uses its module-level prisma for $transaction; pass
        // the fake as an explicit tx client (the ownTx path is the same run
        // body — the wrapper under test covers both).
        await runWithTenantContext({ organizationId: CALLER_ORG }, () => (
            entityService.setMemberPermissionGrant({
                entityId: 'ent-1',
                targetUserId: 'worker-1',
                permission: 'HARVEST_RECORD',
                effect: 'REVOKE',
                reason: null,
                actorUserId: 'user-owner',
                tx: prisma,
            })
        ));
        const upsertArgs = prisma.entityMemberPermissionGrant.upsert.mock.calls[0][0];
        // Verify the stamping: organizationId = the ENTITY's org (mirrored
        // from the membership row), NOT the caller's context org.
        expect(upsertArgs.create.organizationId).toBe(ENTITY_ORG);
    });

    it('clearMembershipGrants snapshot read is not org-filtered (revoke under cross-org context still clears)', async () => {
        const prisma = extensionBehavingClient();
        prisma.entityMembership.update = jest.fn().mockResolvedValue({ ...MEMBERSHIP, status: 'REVOKED' });
        await runWithTenantContext({ organizationId: CALLER_ORG }, () => (
            entityService.revokeMember({
                entityId: 'ent-1', userId: 'worker-1', actorUserId: 'user-owner', tx: prisma,
            })
        ));
        // Pre-fix the snapshot read came back [] under the caller org → the
        // deleteMany was skipped → stale grants survived the revoke.
        expect(prisma.entityMemberPermissionGrant.deleteMany).toHaveBeenCalledWith({
            where: { membershipId: 'mem-1' },
        });
    });
});
