// Wave B adversarial-verify M1 (2026-07-03) — the LEGACY_OWNER fast-path must
// NOT anoint the farm CREATOR forever.
//
// Farms created under a workspace stamp `ownerId` = the CREATING worker;
// revokeMember only flips membership status — so before this fix a REVOKED
// worker passed EVERY gate (read, mutation, per-permission engine, even
// soft-DELETE) via `farm.ownerId === userId` on farms they created while
// employed. REVOKE was unenforceable on those rows.
//
// Binding rule (adjudicated): when `farm.entityId != null`, the ownerId
// fast-path ALSO requires the caller to hold an ACTIVE membership on that
// entity (ANY role) — else fall through to the membership path, which denies
// REVOKED/PENDING/missing. Farms with `entityId == null` (solo legacy farms)
// stay byte-identical (test-pinned below). Entity-OWNER paths unchanged.
//
// Covers ALL FOUR row predicates + the Prisma-fragment builders so row-level
// reads agree with the row-compare predicates:
//   - resolveFarmAccess            (services/farm-access.js)
//   - resolveFarmOwnerAccess       (services/farm-access.js — DELETE-grade)
//   - farmAccessWhere / listAccessibleFarmIds (fragment builders)
//   - assertFarmActionPermission   (entity-effective-permissions-service.js)
//   - requireFarmOwnership         (middleware/farm-ownership.js)

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        farm: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
        entityMembership: { findUnique: jest.fn(), findMany: jest.fn() },
    },
}));

jest.mock('../../shared/logger', () => {
    const noop = () => {};
    const fake = { debug: noop, info: noop, warn: noop, error: noop };
    return { ...fake, createLogger: () => fake };
});

const { prisma } = require('../../services/prisma-database');
const {
    resolveFarmAccess,
    resolveFarmOwnerAccess,
    farmAccessWhere,
    listAccessibleFarmIds,
} = require('../../services/farm-access');
const {
    assertFarmActionPermission,
} = require('../../services/entity-effective-permissions-service');
const { requireFarmOwnership } = require('../../middleware/farm-ownership');
const { markHolderScoped } = require('../../services/holder-marker');

// The fired worker created this farm while employed on workspace ent-W.
const WORKSPACE_FARM = { ownerId: 'worker-1', entityId: 'ent-W' };
// The same worker's own solo farm (pre-workspace) — must stay reachable.
const SOLO_FARM = { ownerId: 'worker-1', entityId: null };

function emulateMembershipStatus(status, role = 'MANAGER') {
    // Row lookup (userId, entityId) — what the row predicates consult.
    prisma.entityMembership.findUnique.mockResolvedValue(
        status === null ? null : { status, role },
    );
    // ACTIVE-membership list — what the fragment builders consult.
    prisma.entityMembership.findMany.mockImplementation(async ({ where }) => {
        if (status !== 'ACTIVE') { return []; }
        const rows = [{ entityId: 'ent-W', role }];
        const filtered = where?.role?.not ? rows.filter((r) => r.role !== where.role.not) : rows;
        return filtered.map((r) => ({ entityId: r.entityId, role: r.role }));
    });
}

// Engine stub — injected prisma for assertFarmActionPermission.
function engineStub(status, role = 'MANAGER') {
    return {
        entityMembership: {
            findUnique: jest.fn().mockResolvedValue(status === null ? null : {
                id: 'mem-1', role, permissions: [], status,
            }),
        },
        entityMemberPermissionGrant: { findMany: jest.fn().mockResolvedValue([]) },
        farm: { findUnique: jest.fn() },
    };
}

beforeEach(() => jest.clearAllMocks());

describe('M1 — fired worker (REVOKED member) who CREATED the workspace farm is denied everywhere', () => {
    beforeEach(() => emulateMembershipStatus('REVOKED'));

    it('resolveFarmAccess (read-widened list grade): DENIED', async () => {
        await expect(resolveFarmAccess(WORKSPACE_FARM, 'worker-1')).resolves.toBe(false);
    });

    it('resolveFarmAccess forMutation: DENIED', async () => {
        await expect(
            resolveFarmAccess(WORKSPACE_FARM, 'worker-1', { forMutation: true }),
        ).resolves.toBe(false);
    });

    it('resolveFarmOwnerAccess (soft-DELETE grade): DENIED', async () => {
        await expect(resolveFarmOwnerAccess(WORKSPACE_FARM, 'worker-1')).resolves.toBe(false);
    });

    it('assertFarmActionPermission: throws ENTITY_PERMISSION_DENIED (mutation engine)', async () => {
        await expect(assertFarmActionPermission({
            farm: WORKSPACE_FARM,
            userId: 'worker-1',
            permission: 'HARVEST_RECORD',
            prisma: engineStub('REVOKED'),
        })).rejects.toMatchObject({ code: 'ENTITY_PERMISSION_DENIED', statusCode: 403 });
    });

    it('farmAccessWhere: ownerId disjunct is CONFINED to entityId=null (workspace rows need ACTIVE membership)', async () => {
        const where = await farmAccessWhere('worker-1');
        // Zero ACTIVE memberships → the ONLY reachable owner rows are solo farms.
        expect(where).toEqual(markHolderScoped({ ownerId: 'worker-1', entityId: null }));
    });

    it('listAccessibleFarmIds: farm query carries the confined owner disjunct', async () => {
        prisma.farm.findMany.mockResolvedValue([]);
        await listAccessibleFarmIds('worker-1');
        expect(prisma.farm.findMany).toHaveBeenCalledWith({
            where: { ...markHolderScoped({ ownerId: 'worker-1', entityId: null }), isDeleted: false },
            select: { id: true },
        });
    });

    it('requireFarmOwnership middleware: creator with REVOKED membership → denied (not fast-pathed)', async () => {
        prisma.farm.findUnique.mockResolvedValue({ id: 'farm-1', ...WORKSPACE_FARM });
        const req = { user: { id: 'worker-1' }, params: { farmId: 'farm-1' }, body: {}, query: {} };
        const res = {
            _status: 200,
            status(s) { this._status = s; return this; },
            json(b) { this._json = b; return this; },
        };
        let nextCalled = false;
        await requireFarmOwnership()(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(false);
        expect(res._status).toBe(403);
    });
});

describe('M1 — PENDING / missing membership on the farm entity also blocks the creator fast-path', () => {
    it('PENDING member-creator: resolveFarmAccess DENIED', async () => {
        emulateMembershipStatus('PENDING');
        await expect(resolveFarmAccess(WORKSPACE_FARM, 'worker-1')).resolves.toBe(false);
    });

    it('NO membership row at all: resolveFarmOwnerAccess DENIED', async () => {
        emulateMembershipStatus(null);
        await expect(resolveFarmOwnerAccess(WORKSPACE_FARM, 'worker-1')).resolves.toBe(false);
    });
});

describe('M1 — ACTIVE member-creator keeps READ + DELETE authority (any role); per-permission engine ignores authorship (F3)', () => {
    it('ACTIVE VIEWER creator: resolveFarmAccess passes even forMutation (owner fast-path, any role)', async () => {
        emulateMembershipStatus('ACTIVE', 'VIEWER');
        await expect(
            resolveFarmAccess(WORKSPACE_FARM, 'worker-1', { forMutation: true }),
        ).resolves.toBe(true);
    });

    it('ACTIVE MANAGER creator: resolveFarmOwnerAccess passes (delete authority retained while employed)', async () => {
        emulateMembershipStatus('ACTIVE', 'MANAGER');
        await expect(resolveFarmOwnerAccess(WORKSPACE_FARM, 'worker-1')).resolves.toBe(true);
    });

    it('ACTIVE VIEWER creator: assertFarmActionPermission is DENIED (F3 — per-permission engine ignores authorship)', async () => {
        // F3 fix (2026-07-06): the PER-PERMISSION mutation engine no longer
        // fast-paths a workspace-farm creator by authorship. A VIEWER creator's
        // effective set is empty (VIEWER role default = []), so HARVEST_RECORD
        // is DENIED — the OWNER must GRANT it. (READ reachability via
        // resolveFarmAccess and DELETE authority via resolveFarmOwnerAccess are
        // SEPARATE predicates and remain owner-fast-pathed — see the two tests
        // above; only the effective-permission engine tightened.)
        await expect(assertFarmActionPermission({
            farm: WORKSPACE_FARM,
            userId: 'worker-1',
            permission: 'HARVEST_RECORD',
            prisma: engineStub('ACTIVE', 'VIEWER'),
        })).rejects.toMatchObject({ code: 'ENTITY_PERMISSION_DENIED', statusCode: 403 });
    });

    it('farmAccessWhere: three-branch OR — solo owner rows, owner rows on ACTIVE entities, membership rows', async () => {
        emulateMembershipStatus('ACTIVE', 'MANAGER');
        await expect(farmAccessWhere('worker-1')).resolves.toEqual(markHolderScoped({
            OR: [
                { ownerId: 'worker-1', entityId: null },
                { ownerId: 'worker-1', entityId: { in: ['ent-W'] } },
                { entityId: { in: ['ent-W'] } },
            ],
        }));
    });

    it('farmAccessWhere forMutation with an ACTIVE VIEWER-only membership: owner disjunct keeps the entity, membership branch drops it', async () => {
        emulateMembershipStatus('ACTIVE', 'VIEWER');
        await expect(farmAccessWhere('worker-1', { forMutation: true })).resolves.toEqual(markHolderScoped({
            OR: [
                { ownerId: 'worker-1', entityId: null },
                { ownerId: 'worker-1', entityId: { in: ['ent-W'] } },
            ],
        }));
    });
});

describe('M1 — solo legacy farms (entityId=null) stay byte-identical', () => {
    beforeEach(() => emulateMembershipStatus(null));

    it('resolveFarmAccess: owner passes with NO membership query', async () => {
        await expect(resolveFarmAccess(SOLO_FARM, 'worker-1')).resolves.toBe(true);
        expect(prisma.entityMembership.findUnique).not.toHaveBeenCalled();
    });

    it('resolveFarmOwnerAccess: owner passes with NO membership query', async () => {
        await expect(resolveFarmOwnerAccess(SOLO_FARM, 'worker-1')).resolves.toBe(true);
        expect(prisma.entityMembership.findUnique).not.toHaveBeenCalled();
    });

    it('assertFarmActionPermission: solo owner passes via LEGACY_OWNER with NO membership query', async () => {
        const stub = engineStub(null);
        await expect(assertFarmActionPermission({
            farm: SOLO_FARM,
            userId: 'worker-1',
            permission: 'CYCLE_CREATE',
            prisma: stub,
        })).resolves.toMatchObject({ allowed: true, via: 'LEGACY_OWNER' });
        expect(stub.entityMembership.findUnique).not.toHaveBeenCalled();
    });

    it('requireFarmOwnership: solo owner keeps the byte-identical fast-path', async () => {
        prisma.farm.findUnique.mockResolvedValue({ id: 'farm-2', ...SOLO_FARM });
        const req = { user: { id: 'worker-1' }, params: { farmId: 'farm-2' }, body: {}, query: {} };
        const res = {
            _status: 200,
            status(s) { this._status = s; return this; },
            json(b) { this._json = b; return this; },
        };
        let nextCalled = false;
        await requireFarmOwnership()(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
    });
});
