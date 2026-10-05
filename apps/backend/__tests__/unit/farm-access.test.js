// Farm-worker Wave A, Chunk 3 (2026-07-02) — assertFarmAccess core unpin.
//
// Every cultivation guard reduces to ONE predicate: caller owns the farm
// (legacy ownerId pin) OR caller holds an ACTIVE EntityMembership on the
// farm's entity (workspace co-worker). services/farm-access.js is the single
// home for that predicate:
//   - resolveFarmAccess(farm, userId)  → row-based boolean check
//   - farmAccessWhere(userId)          → Prisma where-fragment for query guards
//   - listAccessibleFarmIds(userId)    → farm-id set for includes()-style guards
//
// Compat invariants pinned here (updated for Wave B fix M1 — fired-worker
// hole: the ownerId fast-path on a WORKSPACE farm now also requires an
// ACTIVE membership on the farm's entity; solo entityId=null farms are
// byte-identical):
//   - farm.entityId = null → owner-only (pre-backfill farms must NOT lock out
//     their owner, and must NOT open to anyone else)
//   - membership lookup failure → solo owner rows stay reachable; the
//     workspace dimension denies (fail closed — never fail-open)
//   - no ACTIVE memberships → where confines the owner pin to entityId=null

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        farm: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        entityMembership: { findUnique: jest.fn(), findMany: jest.fn() },
        certificate: { findMany: jest.fn() },
        plot: { groupBy: jest.fn() },
    },
}));

jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../shared/logger', () => {
    const noop = () => {};
    return {
        debug: noop, info: noop, warn: noop, error: noop,
        createLogger: () => ({ debug: noop, info: noop, warn: noop, error: noop }),
    };
});

const { prisma } = require('../../services/prisma-database');
const {
    resolveFarmAccess,
    resolveFarmOwnerAccess,
    farmAccessWhere,
    listAccessibleFarmIds,
} = require('../../services/farm-access');
const farmService = require('../../services/farm-service');
const { markHolderScoped } = require('../../services/holder-marker');

describe('Wave A chunk 3 — resolveFarmAccess (row-based predicate)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('allows the SOLO legacy owner without any membership query (entityId=null)', async () => {
        await expect(resolveFarmAccess({ ownerId: 'u1', entityId: null }, 'u1')).resolves.toBe(true);
        expect(prisma.entityMembership.findUnique).not.toHaveBeenCalled();
    });

    it('M1: WORKSPACE farm owner (creator) passes only while their membership is ACTIVE', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'MANAGER' });
        await expect(resolveFarmAccess({ ownerId: 'u1', entityId: 'ent-1' }, 'u1')).resolves.toBe(true);
        expect(prisma.entityMembership.findUnique).toHaveBeenCalled();

        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'REVOKED', role: 'MANAGER' });
        await expect(resolveFarmAccess({ ownerId: 'u1', entityId: 'ent-1' }, 'u1')).resolves.toBe(false);
    });

    it('allows an ACTIVE co-member of the farm entity', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'VIEWER' });
        await expect(resolveFarmAccess({ ownerId: 'owner-9', entityId: 'ent-1' }, 'worker-1')).resolves.toBe(true);
        expect(prisma.entityMembership.findUnique).toHaveBeenCalledWith({
            where: { userId_entityId: { userId: 'worker-1', entityId: 'ent-1' } },
            select: { status: true, role: true, entity: { select: { isDeleted: true } } },
        });
    });

    it('denies a PENDING member', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'PENDING' });
        await expect(resolveFarmAccess({ ownerId: 'owner-9', entityId: 'ent-1' }, 'worker-1')).resolves.toBe(false);
    });

    it('denies a non-member', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue(null);
        await expect(resolveFarmAccess({ ownerId: 'owner-9', entityId: 'ent-1' }, 'stranger')).resolves.toBe(false);
    });

    it('entityId=null farm stays owner-only (no membership query)', async () => {
        await expect(resolveFarmAccess({ ownerId: 'owner-9', entityId: null }, 'worker-1')).resolves.toBe(false);
        expect(prisma.entityMembership.findUnique).not.toHaveBeenCalled();
    });

    it('is falsy-safe: null farm / missing user → false, no throw', async () => {
        await expect(resolveFarmAccess(null, 'u1')).resolves.toBe(false);
        await expect(resolveFarmAccess({ ownerId: 'u1' }, '')).resolves.toBe(false);
    });

    it('membership lookup failure → legacy owner-only behaviour (deny non-owner, no throw)', async () => {
        prisma.entityMembership.findUnique.mockRejectedValue(new Error('db down'));
        await expect(resolveFarmAccess({ ownerId: 'owner-9', entityId: 'ent-1' }, 'worker-1')).resolves.toBe(false);
    });
});

describe('Wave A chunk 3 — farmAccessWhere (query-guard fragment)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('no memberships → owner pin confined to solo farms (M1: fired worker loses workspace rows)', async () => {
        prisma.entityMembership.findMany.mockResolvedValue([]);
        await expect(farmAccessWhere('u1')).resolves.toEqual(markHolderScoped({ ownerId: 'u1', entityId: null }));
    });

    it('ACTIVE memberships → OR of solo owner pin, creator-on-active-entity pin and entity membership', async () => {
        prisma.entityMembership.findMany.mockResolvedValue([
            { entityId: 'ent-1', role: 'MANAGER' }, { entityId: 'ent-2', role: 'VIEWER' },
        ]);
        await expect(farmAccessWhere('worker-1')).resolves.toEqual(markHolderScoped({
            OR: [
                { ownerId: 'worker-1', entityId: null },
                { ownerId: 'worker-1', entityId: { in: ['ent-1', 'ent-2'] } },
                { entityId: { in: ['ent-1', 'ent-2'] } },
            ],
        }));
        expect(prisma.entityMembership.findMany).toHaveBeenCalledWith({
            where: { userId: 'worker-1', status: 'ACTIVE', entity: { isDeleted: false } },
            select: { entityId: true, role: true },
        });
    });

    it('membership lookup failure → solo owner pin (workspace dimension fails closed, no throw)', async () => {
        prisma.entityMembership.findMany.mockRejectedValue(new Error('db down'));
        await expect(farmAccessWhere('u1')).resolves.toEqual(markHolderScoped({ ownerId: 'u1', entityId: null }));
    });
});

describe('Wave A chunk 3 — listAccessibleFarmIds', () => {
    beforeEach(() => jest.clearAllMocks());

    it('queries farms with the access where-fragment and maps ids', async () => {
        prisma.entityMembership.findMany.mockResolvedValue([{ entityId: 'ent-1', role: 'MANAGER' }]);
        prisma.farm.findMany.mockResolvedValue([{ id: 'farm-1' }, { id: 'farm-2' }]);
        await expect(listAccessibleFarmIds('worker-1')).resolves.toEqual(['farm-1', 'farm-2']);
        expect(prisma.farm.findMany).toHaveBeenCalledWith({
            where: {
                ...markHolderScoped({
                    OR: [
                        { ownerId: 'worker-1', entityId: null },
                        { ownerId: 'worker-1', entityId: { in: ['ent-1'] } },
                        { entityId: { in: ['ent-1'] } },
                    ],
                }),
                isDeleted: false,
            },
            select: { id: true },
        });
    });

    it('returns [] for a missing userId without querying', async () => {
        await expect(listAccessibleFarmIds('')).resolves.toEqual([]);
        expect(prisma.farm.findMany).not.toHaveBeenCalled();
    });
});

describe('Wave A chunk 3 — farm-service query guards use the access predicate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prisma.farm.findMany.mockResolvedValue([]);
        prisma.farm.findFirst.mockResolvedValue(null);
    });

    const THREE_BRANCH_OR = [
        { ownerId: 'worker-1', entityId: null },
        { ownerId: 'worker-1', entityId: { in: ['ent-1'] } },
        { entityId: { in: ['ent-1'] } },
    ];

    it('getByOwner: co-member where-clause carries the entity OR branch', async () => {
        prisma.entityMembership.findMany.mockResolvedValue([{ entityId: 'ent-1', role: 'MANAGER' }]);
        await farmService.getByOwner('worker-1');
        const where = prisma.farm.findMany.mock.calls[0][0].where;
        expect(where).toEqual({ ...markHolderScoped({ OR: THREE_BRANCH_OR }), isDeleted: false });
    });

    it('getByOwner: solo farmer (no memberships) keeps the solo owner pin (M1)', async () => {
        prisma.entityMembership.findMany.mockResolvedValue([]);
        await farmService.getByOwner('u1');
        const where = prisma.farm.findMany.mock.calls[0][0].where;
        expect(where).toEqual({ ...markHolderScoped({ ownerId: 'u1', entityId: null }), isDeleted: false });
    });

    it('getById: keeps 404-semantics chokepoint but honours co-membership', async () => {
        prisma.entityMembership.findMany.mockResolvedValue([{ entityId: 'ent-1', role: 'MANAGER' }]);
        await farmService.getById('farm-1', 'worker-1');
        const where = prisma.farm.findFirst.mock.calls[0][0].where;
        expect(where).toMatchObject({
            id: 'farm-1',
            OR: THREE_BRANCH_OR,
            isDeleted: false,
        });
    });

    it('findOwnedFarmForPlotOps: plot ops honour co-membership', async () => {
        prisma.entityMembership.findMany.mockResolvedValue([{ entityId: 'ent-1', role: 'MANAGER' }]);
        await farmService.findOwnedFarmForPlotOps('farm-1', 'worker-1');
        const where = prisma.farm.findFirst.mock.calls[0][0].where;
        expect(where).toMatchObject({
            id: 'farm-1',
            OR: THREE_BRANCH_OR,
            isDeleted: false,
        });
    });
});

// ─────────────────────────────────────────────────────────────────────
// Wave A fix S2 (adversarial-verify 2026-07-02) — interim VIEWER floor
// on MUTATIONS. Reads keep the plain ACTIVE-membership predicate; call
// sites that mutate pass `{ forMutation: true }` and a VIEWER (read-only
// role by definition, entity.prisma:135) is excluded. Owner always OK.
// Wave B replaces this with per-permission gates.
// ─────────────────────────────────────────────────────────────────────
describe('Wave A fix S2 — VIEWER floor on mutations (forMutation)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('resolveFarmAccess forMutation: ACTIVE VIEWER co-member is DENIED', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'VIEWER' });
        await expect(
            resolveFarmAccess({ ownerId: 'owner-9', entityId: 'ent-1' }, 'worker-1', { forMutation: true }),
        ).resolves.toBe(false);
    });

    it('resolveFarmAccess forMutation: ACTIVE MANAGER co-member passes', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'MANAGER' });
        await expect(
            resolveFarmAccess({ ownerId: 'owner-9', entityId: 'ent-1' }, 'worker-1', { forMutation: true }),
        ).resolves.toBe(true);
    });

    it('resolveFarmAccess READ path: ACTIVE VIEWER still reads (unchanged)', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'VIEWER' });
        await expect(
            resolveFarmAccess({ ownerId: 'owner-9', entityId: 'ent-1' }, 'worker-1'),
        ).resolves.toBe(true);
    });

    it('SOLO legacy owner bypasses the floor (no membership query)', async () => {
        await expect(
            resolveFarmAccess({ ownerId: 'u1', entityId: null }, 'u1', { forMutation: true }),
        ).resolves.toBe(true);
        expect(prisma.entityMembership.findUnique).not.toHaveBeenCalled();
    });

    it('M1: workspace-farm CREATOR bypasses the floor while ACTIVE (any role, incl. VIEWER)', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'VIEWER' });
        await expect(
            resolveFarmAccess({ ownerId: 'u1', entityId: 'ent-1' }, 'u1', { forMutation: true }),
        ).resolves.toBe(true);
    });

    it('farmAccessWhere forMutation: VIEWER memberships are dropped from the MEMBERSHIP branch', async () => {
        prisma.entityMembership.findMany.mockResolvedValue([
            { entityId: 'ent-v', role: 'VIEWER' }, { entityId: 'ent-m', role: 'MANAGER' },
        ]);
        await expect(farmAccessWhere('worker-1', { forMutation: true })).resolves.toEqual(markHolderScoped({
            OR: [
                { ownerId: 'worker-1', entityId: null },
                { ownerId: 'worker-1', entityId: { in: ['ent-v', 'ent-m'] } },
                { entityId: { in: ['ent-m'] } },
            ],
        }));
    });

    it('farmAccessWhere READ path keeps VIEWER memberships in the branch', async () => {
        prisma.entityMembership.findMany.mockResolvedValue([{ entityId: 'ent-v', role: 'VIEWER' }]);
        await expect(farmAccessWhere('worker-1')).resolves.toEqual(markHolderScoped({
            OR: [
                { ownerId: 'worker-1', entityId: null },
                { ownerId: 'worker-1', entityId: { in: ['ent-v'] } },
                { entityId: { in: ['ent-v'] } },
            ],
        }));
    });
});

// ─────────────────────────────────────────────────────────────────────
// Wave A fix M1 (adversarial-verify 2026-07-02) — farm soft-DELETE must
// NOT ride the access-widened lookup. Farm deletion is permanent-grade
// (no FARM_DELETE in the Wave-B taxonomy) so it is gated to the legacy
// owner (ownerId === userId) OR an ACTIVE entity-role OWNER. Every other
// co-member (VIEWER/MANAGER/ADMIN) gets the 404-not-403 denial.
// ─────────────────────────────────────────────────────────────────────
describe('Wave A fix M1 — deleteFarm is owner-gated', () => {
    const FARM_ROW = { id: 'farm-1', ownerId: 'owner-9', entityId: 'ent-1' };

    beforeEach(() => {
        jest.clearAllMocks();
        prisma.farm.update.mockResolvedValue({ id: 'farm-1' });
    });

    it('SOLO legacy owner still deletes (no membership query needed)', async () => {
        prisma.farm.findFirst.mockResolvedValue({ ...FARM_ROW, ownerId: 'u1', entityId: null });
        await expect(farmService.deleteFarm('farm-1', 'u1')).resolves.toBe(true);
        expect(prisma.entityMembership.findUnique).not.toHaveBeenCalled();
        expect(prisma.farm.update).toHaveBeenCalledTimes(1);
        expect(prisma.farm.update.mock.calls[0][0].data.isDeleted).toBe(true);
    });

    it('M1: workspace-farm CREATOR deletes only while their membership is ACTIVE', async () => {
        prisma.farm.findFirst.mockResolvedValue({ ...FARM_ROW, ownerId: 'u1' });
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'MANAGER' });
        await expect(farmService.deleteFarm('farm-1', 'u1')).resolves.toBe(true);

        prisma.farm.update.mockClear();
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'REVOKED', role: 'MANAGER' });
        await expect(farmService.deleteFarm('farm-1', 'u1')).resolves.toBe(false);
        expect(prisma.farm.update).not.toHaveBeenCalled();
    });

    it('ACTIVE co-member VIEWER cannot delete → false (route 404)', async () => {
        prisma.farm.findFirst.mockResolvedValue(FARM_ROW);
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'VIEWER' });
        await expect(farmService.deleteFarm('farm-1', 'worker-1')).resolves.toBe(false);
        expect(prisma.farm.update).not.toHaveBeenCalled();
    });

    it('ACTIVE co-member MANAGER cannot delete → false (route 404)', async () => {
        prisma.farm.findFirst.mockResolvedValue(FARM_ROW);
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'MANAGER' });
        await expect(farmService.deleteFarm('farm-1', 'worker-1')).resolves.toBe(false);
        expect(prisma.farm.update).not.toHaveBeenCalled();
    });

    it('ACTIVE entity-role OWNER co-member may delete', async () => {
        prisma.farm.findFirst.mockResolvedValue(FARM_ROW);
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'OWNER' });
        await expect(farmService.deleteFarm('farm-1', 'worker-1')).resolves.toBe(true);
        expect(prisma.farm.update).toHaveBeenCalledTimes(1);
    });

    it('PENDING entity-role OWNER is denied (status must be ACTIVE)', async () => {
        prisma.farm.findFirst.mockResolvedValue(FARM_ROW);
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'PENDING', role: 'OWNER' });
        await expect(farmService.deleteFarm('farm-1', 'worker-1')).resolves.toBe(false);
        expect(prisma.farm.update).not.toHaveBeenCalled();
    });

    it('missing farm → false, no update', async () => {
        prisma.farm.findFirst.mockResolvedValue(null);
        await expect(farmService.deleteFarm('farm-x', 'u1')).resolves.toBe(false);
        expect(prisma.farm.update).not.toHaveBeenCalled();
    });

    it('membership lookup failure → fail-closed to owner-only (deny co-member, no throw)', async () => {
        prisma.farm.findFirst.mockResolvedValue(FARM_ROW);
        prisma.entityMembership.findUnique.mockRejectedValue(new Error('db down'));
        await expect(farmService.deleteFarm('farm-1', 'worker-1')).resolves.toBe(false);
        expect(prisma.farm.update).not.toHaveBeenCalled();
    });
});

// 2026-09-30 (remove-workspace-mode Task 1, review m1) — the three farm-access
// shapes agree on a soft-deleted entity: listActiveMemberships filters it in
// SQL, and the two row predicates refuse it from the membership row.
describe('soft-deleted entity grants nothing on every shape', () => {
    beforeEach(() => jest.clearAllMocks());
    const deleted = (role) => ({ status: 'ACTIVE', role, entity: { isDeleted: true } });

    it('resolveFarmAccess: ACTIVE membership on a deleted entity → false (creator and co-member)', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue(deleted('OWNER'));
        await expect(resolveFarmAccess({ ownerId: 'u1', entityId: 'ent-del' }, 'u1')).resolves.toBe(false);
        await expect(resolveFarmAccess({ ownerId: 'owner-9', entityId: 'ent-del' }, 'u1')).resolves.toBe(false);
    });

    it('resolveFarmOwnerAccess: ACTIVE OWNER on a deleted entity → false', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue(deleted('OWNER'));
        await expect(resolveFarmOwnerAccess({ ownerId: 'u1', entityId: 'ent-del' }, 'u1')).resolves.toBe(false);
        await expect(resolveFarmOwnerAccess({ ownerId: 'owner-9', entityId: 'ent-del' }, 'u1')).resolves.toBe(false);
        expect(prisma.entityMembership.findUnique).toHaveBeenCalledWith({
            where: { userId_entityId: { userId: 'u1', entityId: 'ent-del' } },
            select: { status: true, role: true, entity: { select: { isDeleted: true } } },
        });
    });

    it('a live entity still passes both predicates', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'OWNER', entity: { isDeleted: false } });
        await expect(resolveFarmAccess({ ownerId: 'owner-9', entityId: 'ent-1' }, 'u1')).resolves.toBe(true);
        await expect(resolveFarmOwnerAccess({ ownerId: 'owner-9', entityId: 'ent-1' }, 'u1')).resolves.toBe(true);
    });
});
