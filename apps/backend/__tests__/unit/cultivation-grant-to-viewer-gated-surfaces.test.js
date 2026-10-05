// Wave B adversarial-verify M2 (2026-07-03) — GRANT-to-VIEWER must be LIVE on
// every surface where the per-permission engine runs.
//
// The Wave-A interim `forMutation` VIEWER floor ran BEFORE
// requireCycleFarmPermission / assertFarmActionPermission could read grants:
// a VIEWER co-member holding an explicit GRANT (binding acceptance: "GRANT
// ให้ VIEWER → ทำได้") was 404'd by the floor and the engine never executed —
// on ~10 of the 13 gated surfaces the grant admin API was therefore dead for
// VIEWERs.
//
// Fix shape (per-site, coherent): surfaces WITH a per-permission gate use a
// READ-shaped reachability lookup and let assertFarmActionPermission be the
// sole mutation authority (VIEWER role default = [] so an un-granted VIEWER
// is still denied — SAME net posture, but grants now work; the denial is an
// explicit 403 ENTITY_PERMISSION_DENIED instead of the floor's opaque 404).
// The floor stays ONLY on surfaces with NO per-permission gate (PATCH /:id
// cycle update — ensureCycleOwned keeps its method-derived floor there).
//
// REAL planting-cycle-service + REAL farm-access + REAL permission engine
// against a mocked prisma, so the predicate + engine chain is exercised
// end-to-end (not a stub of it).

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        plantingCycle: { findFirst: jest.fn(), findUnique: jest.fn() },
        farm: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
        entityMembership: { findUnique: jest.fn(), findMany: jest.fn() },
        entityMemberPermissionGrant: { findMany: jest.fn() },
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
    ensureCycleReachable,
    requireCycleFarmPermission,
    verifyOwnedFarm,
} = require('../../services/planting-cycle-service');

const FARM = { id: 'farm-1', ownerId: 'employer-1', entityId: 'ent-1' };

function makeRes() {
    const res = { _status: 200, _json: null };
    res.status = (s) => { res._status = s; return res; };
    res.json = (b) => { res._json = b; return res; };
    return res;
}

function makeReq(method = 'POST') {
    return { method, params: { id: 'cycle-1' }, user: { id: 'worker-1' }, body: {} };
}

/**
 * Emulate the DB for a workspace worker on ent-1:
 *  - role: membership role (ACTIVE)
 *  - grants: entity_member_permission_grants rows for that membership
 */
function emulateWorker(role, grants = []) {
    prisma.entityMembership.findMany.mockResolvedValue([{ entityId: 'ent-1', role }]);
    prisma.entityMembership.findUnique.mockResolvedValue({
        id: 'mem-1', role, permissions: [], status: 'ACTIVE',
    });
    prisma.entityMemberPermissionGrant.findMany.mockResolvedValue(grants);
    prisma.farm.findUnique.mockResolvedValue(FARM);
    // The farm belongs to ent-1 and is owned by someone else — only the
    // MEMBERSHIP branch (no ownerId pin) of the access where can match.
    const membershipBranchMatches = (or) => Array.isArray(or)
        && or.some((b) => b.entityId?.in?.includes('ent-1') && b.ownerId === undefined);
    prisma.plantingCycle.findFirst.mockImplementation(async ({ where }) => (
        membershipBranchMatches(where?.farm?.OR) ? { id: 'cycle-1', farmId: 'farm-1' } : null
    ));
    prisma.farm.findFirst.mockImplementation(async ({ where }) => (
        membershipBranchMatches(where?.OR) ? { id: 'farm-1' } : null
    ));
}

async function runGatedChain(permission, req = makeReq('POST')) {
    // The gated-route middleware chain: reachability (read-shaped) → engine.
    const res = makeRes();
    let reached = false;
    await ensureCycleReachable(req, res, () => { reached = true; });
    if (!reached) { return { res, reached, gated: false }; }
    let gated = false;
    await requireCycleFarmPermission(permission)(req, res, () => { gated = true; });
    return { res, reached, gated };
}

beforeEach(() => jest.clearAllMocks());

describe('M2 — VIEWER + GRANT reaches and passes the per-permission gate', () => {
    it('VIEWER with GRANT HARVEST_RECORD: reachability passes AND the gate allows (200-path)', async () => {
        emulateWorker('VIEWER', [{ permission: 'HARVEST_RECORD', effect: 'GRANT' }]);
        const { reached, gated } = await runGatedChain('HARVEST_RECORD');
        expect(reached).toBe(true);
        expect(gated).toBe(true);
    });

    // Retargeted 2026-08-25: this case used to read "VIEWER with GRANT
    // UNIT_MANAGE passes the plant-units gate". There is no plant-units gate any
    // more — spec R8 retired per-plant tracking and the routes it guarded were
    // deleted. What the case is actually for is proving the engine honours a
    // GRANT on a SECOND permission, not just the first one, so it now names a
    // permission that still guards a live route (plot-qrs/generate).
    it('VIEWER with GRANT QR_GENERATE passes the plot-QR gate', async () => {
        emulateWorker('VIEWER', [{ permission: 'QR_GENERATE', effect: 'GRANT' }]);
        const { gated } = await runGatedChain('QR_GENERATE');
        expect(gated).toBe(true);
    });

    it('un-granted VIEWER: reaches, but the engine denies with an explicit 403 (same net posture as the floor)', async () => {
        emulateWorker('VIEWER', []);
        const { reached, gated, res } = await runGatedChain('HARVEST_RECORD');
        expect(reached).toBe(true);
        expect(gated).toBe(false);
        expect(res._status).toBe(403);
        expect(res._json).toMatchObject({ code: 'ENTITY_PERMISSION_DENIED' });
    });

    it('regression pin: MANAGER with REVOKE HARVEST_RECORD is denied by the engine', async () => {
        emulateWorker('MANAGER', [{ permission: 'HARVEST_RECORD', effect: 'REVOKE' }]);
        const { reached, gated, res } = await runGatedChain('HARVEST_RECORD');
        expect(reached).toBe(true);
        expect(gated).toBe(false);
        expect(res._status).toBe(403);
        expect(res._json).toMatchObject({
            code: 'ENTITY_PERMISSION_DENIED',
            permission: 'HARVEST_RECORD',
        });
    });

    it('regression pin: MANAGER (role default holds HARVEST_RECORD) still passes', async () => {
        emulateWorker('MANAGER', []);
        const { gated } = await runGatedChain('HARVEST_RECORD');
        expect(gated).toBe(true);
    });
});

describe('M2 — verifyOwnedFarm at the CYCLE_CREATE site is read-shaped (gate is the sole authority)', () => {
    it('VIEWER co-member reaches the farm row (the CYCLE_CREATE engine gate then decides)', async () => {
        emulateWorker('VIEWER', []);
        // The route now probes read-shaped; the VIEWER row must be reachable.
        await expect(verifyOwnedFarm('farm-1', 'worker-1')).resolves.toEqual({ id: 'farm-1' });
    });
});
