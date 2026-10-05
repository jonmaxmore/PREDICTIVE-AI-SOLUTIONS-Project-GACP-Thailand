/**
 * Farm-worker Wave B, Chunk 3 — entity-effective-permissions-service.
 *
 * Mirrors the Wave-2 provider-side engine (effective-permissions-service):
 *
 *   effective(member) = DEFAULT_PERMISSIONS_BY_ROLE[role]
 *                       ∪ legacy membership.permissions[]
 *                       ∪ {GRANT rows} − {REVOKE rows}    (REVOKE wins over ALL)
 *
 * Grants live in entity_member_permission_grants and are read LIVE per
 * request. Fail-SAFE: grant-read throw → role∪legacy baseline (logged),
 * never a throw. Per-request caching via an injectable Map.
 *
 * entity-service stays REAL (role defaults are the real Wave-B bundles).
 * A tiny injected prisma stub supplies membership + grant rows.
 */

'use strict';

const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();
jest.mock('../../shared/logger', () => {
    const l = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: (...a) => mockLoggerWarn(...a),
        error: (...a) => mockLoggerError(...a),
    };
    return { ...l, createLogger: jest.fn(() => l) };
});

// prisma-database is the service default; stub it so require() does not
// process.exit(1) without DATABASE_URL. Tests inject their own prisma.
jest.mock('../../services/prisma-database', () => ({
    prisma: {},
}));

const {
    getEffectiveEntityPermissions,
    entityMemberHasPermission,
    assertFarmActionPermission,
    isGrantableFarmOperation,
} = require('../../services/entity-effective-permissions-service');
const { CAPABILITIES, DEFAULT_PERMISSIONS_BY_ROLE } = require('../../services/entity-service');

function stubPrisma({ membership, grants = [], farm } = {}) {
    return {
        entityMembership: {
            findUnique: jest.fn().mockResolvedValue(membership === undefined ? null : membership),
        },
        entityMemberPermissionGrant: {
            findMany: jest.fn().mockResolvedValue(grants),
        },
        farm: {
            findUnique: jest.fn().mockResolvedValue(farm === undefined ? null : farm),
        },
    };
}

const ACTIVE_MANAGER = {
    id: 'mem-1', role: 'MANAGER', permissions: [], status: 'ACTIVE',
};
const ACTIVE_VIEWER = {
    id: 'mem-2', role: 'VIEWER', permissions: [], status: 'ACTIVE',
};

beforeEach(() => {
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
});

describe('getEffectiveEntityPermissions — baseline + union + REVOKE-wins', () => {
    it('MANAGER with zero grants → effective == role defaults (has HARVEST_RECORD, lacks EDIT_FARM/FARM_CREATE)', async () => {
        const prisma = stubPrisma({ membership: ACTIVE_MANAGER });
        const res = await getEffectiveEntityPermissions({ membershipId: 'mem-1', prisma });

        expect(res.effective.sort()).toEqual([...DEFAULT_PERMISSIONS_BY_ROLE.MANAGER].sort());
        expect(res.effective).toContain(CAPABILITIES.HARVEST_RECORD);
        expect(res.effective).not.toContain(CAPABILITIES.EDIT_FARM);
        expect(res.effective).not.toContain(CAPABILITIES.FARM_CREATE);
        expect(res.grants).toEqual([]);
    });

    it('legacy membership.permissions[] unions in (VIEWER + legacy PRINT_QR)', async () => {
        const prisma = stubPrisma({
            membership: { ...ACTIVE_VIEWER, permissions: [CAPABILITIES.PRINT_QR] },
        });
        const res = await getEffectiveEntityPermissions({ membershipId: 'mem-2', prisma });
        expect(res.effective).toContain(CAPABILITIES.PRINT_QR);
    });

    it('GRANT adds a role-lacked permission (VIEWER + GRANT HARVEST_RECORD)', async () => {
        const prisma = stubPrisma({
            membership: ACTIVE_VIEWER,
            grants: [{ permission: CAPABILITIES.HARVEST_RECORD, effect: 'GRANT' }],
        });
        const res = await getEffectiveEntityPermissions({ membershipId: 'mem-2', prisma });
        expect(res.effective).toContain(CAPABILITIES.HARVEST_RECORD);
    });

    it('REVOKE wins over the role default (MANAGER − HARVEST_RECORD)', async () => {
        const prisma = stubPrisma({
            membership: ACTIVE_MANAGER,
            grants: [{ permission: CAPABILITIES.HARVEST_RECORD, effect: 'REVOKE' }],
        });
        const res = await getEffectiveEntityPermissions({ membershipId: 'mem-1', prisma });
        expect(res.effective).not.toContain(CAPABILITIES.HARVEST_RECORD);
    });

    it('REVOKE wins over the LEGACY permissions[] array (pre-Wave-B seeded EDIT_FARM)', async () => {
        const prisma = stubPrisma({
            membership: { ...ACTIVE_MANAGER, permissions: [CAPABILITIES.EDIT_FARM] },
            grants: [{ permission: CAPABILITIES.EDIT_FARM, effect: 'REVOKE' }],
        });
        const res = await getEffectiveEntityPermissions({ membershipId: 'mem-1', prisma });
        expect(res.effective).not.toContain(CAPABILITIES.EDIT_FARM);
    });

    it('REVOKE wins over a same-permission GRANT', async () => {
        const prisma = stubPrisma({
            membership: ACTIVE_VIEWER,
            grants: [
                { permission: CAPABILITIES.QR_GENERATE, effect: 'GRANT' },
                { permission: CAPABILITIES.QR_GENERATE, effect: 'REVOKE' },
            ],
        });
        const res = await getEffectiveEntityPermissions({ membershipId: 'mem-2', prisma });
        expect(res.effective).not.toContain(CAPABILITIES.QR_GENERATE);
    });

    it('an invalid stored GRANT is ignored (drift tolerance)', async () => {
        const prisma = stubPrisma({
            membership: ACTIVE_VIEWER,
            grants: [{ permission: 'totally.bogus', effect: 'GRANT' }],
        });
        const res = await getEffectiveEntityPermissions({ membershipId: 'mem-2', prisma });
        expect(res.effective).not.toContain('totally.bogus');
    });

    it('resolves the membership by (userId, entityId) when membershipId is not given', async () => {
        const prisma = stubPrisma({ membership: ACTIVE_MANAGER });
        const res = await getEffectiveEntityPermissions({
            userId: 'worker-1', entityId: 'ent-1', prisma,
        });
        expect(prisma.entityMembership.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { userId_entityId: { userId: 'worker-1', entityId: 'ent-1' } },
            }),
        );
        expect(res.effective).toContain(CAPABILITIES.HARVEST_RECORD);
    });

    it('non-ACTIVE membership → empty effective set (fail closed)', async () => {
        const prisma = stubPrisma({ membership: { ...ACTIVE_MANAGER, status: 'REVOKED' } });
        const res = await getEffectiveEntityPermissions({ membershipId: 'mem-1', prisma });
        expect(res.effective).toEqual([]);
    });

    it('no membership found → empty effective set (fail closed)', async () => {
        const prisma = stubPrisma({ membership: null });
        const res = await getEffectiveEntityPermissions({ membershipId: 'nope', prisma });
        expect(res.effective).toEqual([]);
    });

    it('fail-SAFE: grant read throws → role∪legacy baseline + log, no throw', async () => {
        const prisma = stubPrisma({
            membership: { ...ACTIVE_MANAGER, permissions: [CAPABILITIES.EDIT_FARM] },
        });
        prisma.entityMemberPermissionGrant.findMany.mockRejectedValue(new Error('db down'));

        const res = await getEffectiveEntityPermissions({ membershipId: 'mem-1', prisma });
        expect(res.grants).toEqual([]);
        expect(res.effective).toContain(CAPABILITIES.HARVEST_RECORD); // role baseline governs
        expect(res.effective).toContain(CAPABILITIES.EDIT_FARM);      // legacy array kept
        expect(mockLoggerWarn.mock.calls.length + mockLoggerError.mock.calls.length)
            .toBeGreaterThan(0);
    });

    it('reads grants LIVE per call, but a shared per-request cache short-circuits the second read', async () => {
        const prisma = stubPrisma({ membership: ACTIVE_MANAGER });

        await getEffectiveEntityPermissions({ membershipId: 'mem-1', prisma });
        await getEffectiveEntityPermissions({ membershipId: 'mem-1', prisma });
        expect(prisma.entityMemberPermissionGrant.findMany).toHaveBeenCalledTimes(2);

        const cache = new Map();
        await getEffectiveEntityPermissions({ membershipId: 'mem-1', prisma, cache });
        await getEffectiveEntityPermissions({ membershipId: 'mem-1', prisma, cache });
        expect(prisma.entityMemberPermissionGrant.findMany).toHaveBeenCalledTimes(3);
    });
});

describe('entityMemberHasPermission', () => {
    it('true when the role default grants it', async () => {
        const prisma = stubPrisma({ membership: ACTIVE_MANAGER });
        await expect(entityMemberHasPermission(
            { membershipId: 'mem-1', prisma }, CAPABILITIES.UNIT_MANAGE,
        )).resolves.toBe(true);
    });

    it('false after REVOKE', async () => {
        const prisma = stubPrisma({
            membership: ACTIVE_MANAGER,
            grants: [{ permission: CAPABILITIES.UNIT_MANAGE, effect: 'REVOKE' }],
        });
        await expect(entityMemberHasPermission(
            { membershipId: 'mem-1', prisma }, CAPABILITIES.UNIT_MANAGE,
        )).resolves.toBe(false);
    });
});

describe('assertFarmActionPermission — the chunk-4 gate primitive', () => {
    const WORKSPACE_FARM = { ownerId: 'employer-1', entityId: 'ent-1' };

    it('the WORKSPACE farm owner passes via ENTITY_PERMISSION (OWNER role default), membership read live', async () => {
        // F3 fix (2026-07-06): a workspace farm has NO authorship fast-path —
        // the entity OWNER passes through the EFFECTIVE set (OWNER role default
        // = every farm-op code), NOT the old LEGACY_OWNER authorship bypass.
        // The membership is still read live (that is where the ACTIVE check +
        // role baseline come from).
        const prisma = stubPrisma({
            membership: { id: 'mem-owner', role: 'OWNER', permissions: [], status: 'ACTIVE' },
        });
        await expect(assertFarmActionPermission({
            farm: WORKSPACE_FARM, userId: 'employer-1',
            permission: CAPABILITIES.HARVEST_RECORD, prisma,
        })).resolves.toMatchObject({ allowed: true, via: 'ENTITY_PERMISSION' });
        expect(prisma.entityMembership.findUnique).toHaveBeenCalled();
    });

    it('rule (a) solo: the entityId=null farm owner passes with NO membership lookup (byte-identical)', async () => {
        const prisma = stubPrisma({});
        await expect(assertFarmActionPermission({
            farm: { ownerId: 'employer-1', entityId: null }, userId: 'employer-1',
            permission: CAPABILITIES.HARVEST_RECORD, prisma,
        })).resolves.toMatchObject({ allowed: true, via: 'LEGACY_OWNER' });
        expect(prisma.entityMembership.findUnique).not.toHaveBeenCalled();
    });

    it('M1: the fired (REVOKED) CREATOR of a workspace farm is denied despite ownerId matching', async () => {
        const prisma = stubPrisma({
            membership: { id: 'mem-owner', role: 'MANAGER', permissions: [], status: 'REVOKED' },
        });
        await expect(assertFarmActionPermission({
            farm: { ownerId: 'worker-1', entityId: 'ent-1' }, userId: 'worker-1',
            permission: CAPABILITIES.HARVEST_RECORD, prisma,
        })).rejects.toMatchObject({ code: 'ENTITY_PERMISSION_DENIED', statusCode: 403 });
    });

    it('workspace member whose effective set holds the permission passes', async () => {
        const prisma = stubPrisma({ membership: ACTIVE_MANAGER });
        await expect(assertFarmActionPermission({
            farm: WORKSPACE_FARM, userId: 'worker-1',
            permission: CAPABILITIES.HARVEST_RECORD, prisma,
        })).resolves.toMatchObject({ allowed: true });
    });

    it('member WITHOUT the permission → throws ENTITY_PERMISSION_DENIED, statusCode 403, permission named', async () => {
        const prisma = stubPrisma({
            membership: ACTIVE_MANAGER,
            grants: [{ permission: CAPABILITIES.HARVEST_RECORD, effect: 'REVOKE' }],
        });
        await expect(assertFarmActionPermission({
            farm: WORKSPACE_FARM, userId: 'worker-1',
            permission: CAPABILITIES.HARVEST_RECORD, prisma,
        })).rejects.toMatchObject({
            code: 'ENTITY_PERMISSION_DENIED',
            statusCode: 403,
            permission: CAPABILITIES.HARVEST_RECORD,
        });
    });

    it('VIEWER (role default = none) is denied — the Wave-A floor is preserved', async () => {
        const prisma = stubPrisma({ membership: ACTIVE_VIEWER });
        await expect(assertFarmActionPermission({
            farm: WORKSPACE_FARM, userId: 'worker-1',
            permission: CAPABILITIES.ACTIVITY_IRRIGATION, prisma,
        })).rejects.toMatchObject({ code: 'ENTITY_PERMISSION_DENIED' });
    });

    it('farm with NO entityId + non-owner caller → denied (fail closed)', async () => {
        const prisma = stubPrisma({});
        await expect(assertFarmActionPermission({
            farm: { ownerId: 'employer-1', entityId: null }, userId: 'worker-1',
            permission: CAPABILITIES.CYCLE_CREATE, prisma,
        })).rejects.toMatchObject({ code: 'ENTITY_PERMISSION_DENIED' });
    });

    it('non-ACTIVE membership → denied', async () => {
        const prisma = stubPrisma({ membership: { ...ACTIVE_MANAGER, status: 'REVOKED' } });
        await expect(assertFarmActionPermission({
            farm: WORKSPACE_FARM, userId: 'worker-1',
            permission: CAPABILITIES.CYCLE_CREATE, prisma,
        })).rejects.toMatchObject({ code: 'ENTITY_PERMISSION_DENIED' });
    });

    it('accepts a farmId and loads {ownerId, entityId} itself', async () => {
        const prisma = stubPrisma({ membership: ACTIVE_MANAGER, farm: WORKSPACE_FARM });
        await expect(assertFarmActionPermission({
            farmId: 'farm-9', userId: 'worker-1',
            permission: CAPABILITIES.UNIT_MANAGE, prisma,
        })).resolves.toMatchObject({ allowed: true });
        expect(prisma.farm.findUnique).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'farm-9' },
        }));
    });

    it('membership lookup THROW on a mutation gate → denied (fail closed), logged', async () => {
        const prisma = stubPrisma({});
        prisma.entityMembership.findUnique.mockRejectedValue(new Error('db down'));
        await expect(assertFarmActionPermission({
            farm: WORKSPACE_FARM, userId: 'worker-1',
            permission: CAPABILITIES.CYCLE_CREATE, prisma,
        })).rejects.toMatchObject({ code: 'ENTITY_PERMISSION_DENIED' });
        expect(mockLoggerWarn.mock.calls.length + mockLoggerError.mock.calls.length)
            .toBeGreaterThan(0);
    });
});

describe('isGrantableFarmOperation', () => {
    it('true for farm-operation codes, false for workspace-management codes', () => {
        expect(isGrantableFarmOperation(CAPABILITIES.HARVEST_RECORD)).toBe(true);
        expect(isGrantableFarmOperation(CAPABILITIES.EDIT_FARM)).toBe(true);
        expect(isGrantableFarmOperation(CAPABILITIES.INVITE_MEMBER)).toBe(false);
        expect(isGrantableFarmOperation(CAPABILITIES.TRANSFER_OWNERSHIP)).toBe(false);
        expect(isGrantableFarmOperation('FARM_DELETE')).toBe(false);
        expect(isGrantableFarmOperation(null)).toBe(false);
    });
});
