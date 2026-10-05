/**
 * Farm-worker follow-up (F3 engine fix, 2026-07-06) —
 * `assertFarmActionPermission` must NOT let AUTHORSHIP override a
 * per-permission REVOKE on a WORKSPACE farm.
 *
 * THE GAP (pre-fix): on a workspace farm (entityId != null) the farm's
 * CREATOR (farm.ownerId === caller) with ANY ACTIVE membership short-circuited
 * to `{ allowed:true, via:'LEGACY_OWNER' }` BEFORE the effective-permission
 * set was consulted. So a per-member REVOKE never bound on farms a worker
 * created while employed — using who-created-the-row (authorship) as an
 * authorization grant, contradicting the engine's own "REVOKE wins over
 * EVERYTHING" invariant and the matrix UI that shows the REVOKE as effective.
 *
 * THE FIX: on the workspace branch, authorship no longer passes anyone. The
 * EFFECTIVE set decides for EVERYONE:
 *   - entity OWNER  → passes (OWNER role default = all farm ops)
 *   - MANAGER/VIEWER creator → subject to their effective set (REVOKE binds;
 *     permissions not in their role default are denied)
 *   - fired/REVOKED creator → empty effective set → denied (M1 preserved)
 *   - solo farm (entityId == null) → owner LEGACY_OWNER fast-path UNCHANGED
 *
 * RED-first: tests (1) MANAGER-creator + REVOKE and (6) MANAGER-creator +
 * EDIT_FARM FAIL before the fix (the LEGACY_OWNER bypass ALLOWs both).
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

// Stub prisma-database so require() does not process.exit(1) without
// DATABASE_URL. Tests inject their own prisma.
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

const {
    assertFarmActionPermission,
} = require('../../services/entity-effective-permissions-service');
const { CAPABILITIES } = require('../../services/entity-service');

/**
 * A single findUnique mock serves both consumers (the pre-fix owner-membership
 * lookup `select:{status}` and getEffectiveEntityPermissions `select:{id,role,
 * permissions,status}`); the returned row carries every field so each reads
 * what it needs.
 */
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

// A workspace farm the WORKER created: ownerId = the worker, entityId set.
const WORKER_CREATED_FARM = { ownerId: 'worker-1', entityId: 'ent-1' };

beforeEach(() => {
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
});

describe('assertFarmActionPermission — authorship must not override REVOKE on workspace farms (F3)', () => {
    it('(1) MANAGER-creator + REVOKE HARVEST_RECORD on their own workspace farm → DENIED', async () => {
        // Pre-fix: isOwner + ACTIVE → LEGACY_OWNER short-circuit → ALLOWED
        // (this assertion FAILS). Post-fix: effective = MANAGER − HARVEST_RECORD.
        const prisma = stubPrisma({
            membership: { id: 'mem-1', role: 'MANAGER', permissions: [], status: 'ACTIVE' },
            grants: [{ permission: CAPABILITIES.HARVEST_RECORD, effect: 'REVOKE' }],
        });
        await expect(assertFarmActionPermission({
            farm: WORKER_CREATED_FARM, userId: 'worker-1',
            permission: CAPABILITIES.HARVEST_RECORD, prisma,
        })).rejects.toMatchObject({
            code: 'ENTITY_PERMISSION_DENIED',
            statusCode: 403,
            permission: CAPABILITIES.HARVEST_RECORD,
        });
    });

    it('(2) MANAGER-creator + role-default ACTIVITY_IRRIGATION (no grants) → ALLOWED via effective set', async () => {
        const prisma = stubPrisma({
            membership: { id: 'mem-1', role: 'MANAGER', permissions: [], status: 'ACTIVE' },
        });
        await expect(assertFarmActionPermission({
            farm: WORKER_CREATED_FARM, userId: 'worker-1',
            permission: CAPABILITIES.ACTIVITY_IRRIGATION, prisma,
        })).resolves.toMatchObject({ allowed: true, via: 'ENTITY_PERMISSION' });
    });

    it('(3) entity OWNER acting on a WORKER-created farm → ALLOWED (OWNER default = all farm ops)', async () => {
        // Caller is the entity OWNER (not the farm creator): isOwner is false,
        // so this always flowed to the effective set — pin it stays ALLOWED.
        const prisma = stubPrisma({
            membership: { id: 'mem-owner', role: 'OWNER', permissions: [], status: 'ACTIVE' },
        });
        await expect(assertFarmActionPermission({
            farm: WORKER_CREATED_FARM, userId: 'owner-1',
            permission: CAPABILITIES.HARVEST_RECORD, prisma,
        })).resolves.toMatchObject({ allowed: true, via: 'ENTITY_PERMISSION' });
    });

    it('(4) fired/REVOKED creator → DENIED everything (M1 fired-worker protection preserved)', async () => {
        const prisma = stubPrisma({
            membership: { id: 'mem-1', role: 'MANAGER', permissions: [], status: 'REVOKED' },
        });
        await expect(assertFarmActionPermission({
            farm: WORKER_CREATED_FARM, userId: 'worker-1',
            permission: CAPABILITIES.HARVEST_RECORD, prisma,
        })).rejects.toMatchObject({ code: 'ENTITY_PERMISSION_DENIED', statusCode: 403 });
    });

    it('(5) solo farm (entityId=null) owner → ALLOWED via LEGACY_OWNER, no membership read (unchanged)', async () => {
        const prisma = stubPrisma({});
        await expect(assertFarmActionPermission({
            farm: { ownerId: 'solo-1', entityId: null }, userId: 'solo-1',
            permission: CAPABILITIES.HARVEST_RECORD, prisma,
        })).resolves.toMatchObject({ allowed: true, via: 'LEGACY_OWNER' });
        expect(prisma.entityMembership.findUnique).not.toHaveBeenCalled();
    });

    it('(6) MANAGER-creator + EDIT_FARM (not in MANAGER default, no grant) → DENIED (behavior-change pin)', async () => {
        // Pre-fix: LEGACY_OWNER bypass → ALLOWED (this assertion FAILS).
        // Post-fix: EDIT_FARM is not in MANAGER default and no GRANT → DENIED.
        // The OWNER must now explicitly GRANT EDIT_FARM — authorization by
        // permission, not authorship.
        const prisma = stubPrisma({
            membership: { id: 'mem-1', role: 'MANAGER', permissions: [], status: 'ACTIVE' },
        });
        await expect(assertFarmActionPermission({
            farm: WORKER_CREATED_FARM, userId: 'worker-1',
            permission: CAPABILITIES.EDIT_FARM, prisma,
        })).rejects.toMatchObject({
            code: 'ENTITY_PERMISSION_DENIED',
            statusCode: 403,
            permission: CAPABILITIES.EDIT_FARM,
        });
    });

    it('(7) MANAGER-creator + GRANT EDIT_FARM → ALLOWED (explicit grant restores the op)', async () => {
        const prisma = stubPrisma({
            membership: { id: 'mem-1', role: 'MANAGER', permissions: [], status: 'ACTIVE' },
            grants: [{ permission: CAPABILITIES.EDIT_FARM, effect: 'GRANT' }],
        });
        await expect(assertFarmActionPermission({
            farm: WORKER_CREATED_FARM, userId: 'worker-1',
            permission: CAPABILITIES.EDIT_FARM, prisma,
        })).resolves.toMatchObject({ allowed: true, via: 'ENTITY_PERMISSION' });
    });
});
