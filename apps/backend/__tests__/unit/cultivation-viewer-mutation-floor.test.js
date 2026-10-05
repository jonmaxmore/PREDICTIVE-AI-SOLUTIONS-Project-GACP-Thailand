// Wave A fix S2 (adversarial-verify 2026-07-02) — interim VIEWER floor on
// cultivation MUTATIONS reached through planting-cycle-service:
//
//   - verifyOwnedCycle / verifyOwnedFarm accept `{ forMutation: true }` and
//     thread it into farmAccessWhere → the entity-membership branch excludes
//     role VIEWER (owner pin unaffected).
//   - ensureCycleOwned (the shared gate in front of every /:id/* cycle route:
//     activities POST, harvest-batches POST, plot-qrs/generate, PATCH /:id —
//     the plant-units generate/confirm/reconcile routes were deleted on
//     2026-08-25 with per-plant tracking, spec R8) derives forMutation from the
//     HTTP method: non-GET/HEAD → mutation floor; GET stays read-shaped.
//
// Uses the REAL planting-cycle-service + REAL farm-access against a mocked
// prisma, so the membership predicate itself is exercised (not a stub of it).
// Wave B replaces this floor with per-permission gates.

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        plantingCycle: { findFirst: jest.fn(), findUnique: jest.fn() },
        farm: { findFirst: jest.fn(), findMany: jest.fn() },
        entityMembership: { findUnique: jest.fn(), findMany: jest.fn() },
        traceQrSecurity: { findMany: jest.fn() },
    },
}));

jest.mock('../../services/qrcode/qrcode-service', () => ({
    generateQRCodeId: jest.fn(),
    generatePublicTraceUrl: jest.fn(),
    registerTraceIntegrity: jest.fn(),
}));


jest.mock('../../shared/logger', () => {
    const noop = () => {};
    const fake = { debug: noop, info: noop, warn: noop, error: noop };
    return { ...fake, createLogger: () => fake };
});

const { prisma } = require('../../services/prisma-database');
const {
    verifyOwnedCycle,
    verifyOwnedFarm,
    ensureCycleOwned,
} = require('../../services/planting-cycle-service');

function makeRes() {
    const res = { _status: 200, _json: null };
    res.status = (s) => { res._status = s; return res; };
    res.json = (b) => { res._json = b; return res; };
    return res;
}

// Emulate the DB: the worker holds ONE membership (role parametrised per
// test) on ent-1; the cycle/farm under test belongs to ent-1 and is owned
// by someone else. findMany honours the role filter exactly like Postgres
// would; findFirst matches only when the where carries the entity OR branch.
function emulateMembership(role) {
    // M1 — farm-access now selects { entityId, role } for ACTIVE rows and
    // applies the VIEWER floor in JS; emulate Postgres by returning the row.
    prisma.entityMembership.findMany.mockResolvedValue([{ entityId: 'ent-1', role }]);
    // The farm under test belongs to ent-1 and is owned by someone else, so
    // only the MEMBERSHIP branch (`{ entityId: { in: [...] } }` WITHOUT an
    // ownerId pin) can match it — emulate that match exactly.
    const membershipBranchMatches = (or) => Array.isArray(or)
        && or.some((b) => b.entityId?.in?.includes('ent-1') && b.ownerId === undefined);
    prisma.plantingCycle.findFirst.mockImplementation(async ({ where }) => (
        membershipBranchMatches(where?.farm?.OR) ? { id: 'cycle-1', farmId: 'farm-1' } : null
    ));
    prisma.farm.findFirst.mockImplementation(async ({ where }) => (
        membershipBranchMatches(where?.OR) ? { id: 'farm-1' } : null
    ));
}

describe('S2 — verifyOwnedCycle / verifyOwnedFarm mutation floor', () => {
    beforeEach(() => jest.clearAllMocks());

    it('verifyOwnedCycle forMutation: the membership branch excludes VIEWER (JS floor over the ACTIVE lookup)', async () => {
        emulateMembership('MANAGER');
        await verifyOwnedCycle('cycle-1', 'worker-1', { forMutation: true });
        expect(prisma.entityMembership.findMany).toHaveBeenCalledWith({
            where: { userId: 'worker-1', status: 'ACTIVE', entity: { isDeleted: false } },
            select: { entityId: true, role: true },
        });
    });

    it('verifyOwnedCycle read path uses the same ACTIVE lookup', async () => {
        emulateMembership('VIEWER');
        await verifyOwnedCycle('cycle-1', 'worker-1');
        expect(prisma.entityMembership.findMany).toHaveBeenCalledWith({
            where: { userId: 'worker-1', status: 'ACTIVE', entity: { isDeleted: false } },
            select: { entityId: true, role: true },
        });
    });

    it('VIEWER co-member: mutation lookup finds nothing, read finds the cycle', async () => {
        emulateMembership('VIEWER');
        await expect(verifyOwnedCycle('cycle-1', 'worker-1', { forMutation: true })).resolves.toBeNull();
        await expect(verifyOwnedCycle('cycle-1', 'worker-1')).resolves.toEqual({ id: 'cycle-1', farmId: 'farm-1' });
    });

    it('MANAGER co-member passes the mutation lookup', async () => {
        emulateMembership('MANAGER');
        await expect(verifyOwnedCycle('cycle-1', 'worker-1', { forMutation: true })).resolves.toEqual({ id: 'cycle-1', farmId: 'farm-1' });
    });

    it('verifyOwnedFarm forMutation (POST /planting-cycles create): VIEWER excluded, MANAGER passes', async () => {
        emulateMembership('VIEWER');
        await expect(verifyOwnedFarm('farm-1', 'worker-1', { forMutation: true })).resolves.toBeNull();

        emulateMembership('MANAGER');
        await expect(verifyOwnedFarm('farm-1', 'worker-1', { forMutation: true })).resolves.toEqual({ id: 'farm-1' });
    });
});

describe('S2 — ensureCycleOwned derives the floor from the HTTP method', () => {
    beforeEach(() => jest.clearAllMocks());

    function makeReq(method) {
        return { method, params: { id: 'cycle-1' }, user: { id: 'worker-1' } };
    }

    it('POST (activity/harvest/unit mutations): VIEWER co-member → 404, next NOT called', async () => {
        emulateMembership('VIEWER');
        const res = makeRes();
        let nextCalled = false;
        await ensureCycleOwned(makeReq('POST'), res, () => { nextCalled = true; });
        expect(res._status).toBe(404);
        expect(nextCalled).toBe(false);
    });

    it('POST: MANAGER co-member passes to the handler', async () => {
        emulateMembership('MANAGER');
        const res = makeRes();
        let nextCalled = false;
        await ensureCycleOwned(makeReq('POST'), res, () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
    });

    it('PATCH is a mutation too: VIEWER co-member → 404', async () => {
        emulateMembership('VIEWER');
        const res = makeRes();
        let nextCalled = false;
        await ensureCycleOwned(makeReq('PATCH'), res, () => { nextCalled = true; });
        expect(res._status).toBe(404);
        expect(nextCalled).toBe(false);
    });

    it('GET (reads) unchanged for VIEWER: passes', async () => {
        emulateMembership('VIEWER');
        const res = makeRes();
        let nextCalled = false;
        await ensureCycleOwned(makeReq('GET'), res, () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
    });
});
