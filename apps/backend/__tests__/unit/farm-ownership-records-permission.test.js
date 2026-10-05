/**
 * Farm-worker Wave B, Chunk 4 — requireFarmOwnership middleware learns the
 * workspace dimension + optional per-permission gate (RECORDS_MANAGE
 * consumers: site-analyses POST, training-records POST).
 *
 * DISCOVERY (reported, not silently adapted): Wave A never widened this
 * middleware — it still pinned farm.ownerId strictly, so site-analyses /
 * training-records were unreachable for co-members and a RECORDS_MANAGE
 * gate would have been dead code. Wave B widens it the Wave-A way:
 *   - owner fast-path byte-identical (incl. missing-farm 404 / no-auth 401)
 *   - reads (no permission option): ACTIVE co-member passes via
 *     resolveFarmAccess (read-shaped)
 *   - writes ({ permission }): co-member must hold the effective permission
 *     (assertFarmActionPermission) → 403 ENTITY_PERMISSION_DENIED otherwise
 *   - non-member: legacy 403 unchanged
 */

'use strict';

const mockFarmFindUnique = jest.fn();
// Task 6: the code under test now passes a holder scope beside its pre-R1 where
// (spec 2026-09-30 §3.1). The scope's own reads are not this suite's subject; the
// real-Postgres walk (health-door-walk-real-postgres.test.js) proves them.
jest.mock('../../services/holder-access', () => ({
    holderScope: async (req) => ({ userId: String(req?.user?.id || ''), readIds: [], editIds: [] }),
    r1HolderOrLegacyWhenScoped: () => ({}),
}));
jest.mock('../../services/prisma-database', () => ({
    prisma: { farm: { findUnique: (...a) => mockFarmFindUnique(...a) } },
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockResolveFarmAccess = jest.fn();
jest.mock('../../services/farm-access', () => ({
    resolveFarmAccess: (...a) => mockResolveFarmAccess(...a),
}));

const mockAssertFarmActionPermission = jest.fn();
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertFarmActionPermission: (...a) => mockAssertFarmActionPermission(...a),
}));

const { requireFarmOwnership } = require('../../middleware/farm-ownership');

const FARM = { id: 'farm-1', ownerId: 'employer-1', entityId: 'ent-1' };
const SOLO_FARM = { id: 'farm-solo', ownerId: 'employer-1', entityId: null };

function buildReq({ userId = 'worker-1', farmId = 'farm-1' } = {}) {
    // farmId: null → simulate "no farm id anywhere on the request"
    const params = farmId === null ? {} : { farmId };
    return { params, body: {}, query: {}, user: userId ? { id: userId } : undefined };
}
function buildRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFarmFindUnique.mockResolvedValue(FARM);
});

describe('owner fast-path — Wave B fix M1: confined to entityId=null farms', () => {
    it('SOLO farm owner passes with and without a permission option, no predicate calls (byte-identical)', async () => {
        mockFarmFindUnique.mockResolvedValue(SOLO_FARM);
        for (const mw of [requireFarmOwnership(), requireFarmOwnership({ permission: 'RECORDS_MANAGE' })]) {
            const req = buildReq({ userId: 'employer-1' });
            const res = buildRes();
            const next = jest.fn();
            await mw(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(req.farm).toEqual(SOLO_FARM);
        }
        expect(mockResolveFarmAccess).not.toHaveBeenCalled();
        expect(mockAssertFarmActionPermission).not.toHaveBeenCalled();
    });

    it('WORKSPACE farm owner (creator) is NOT fast-pathed: the read predicate re-checks the membership', async () => {
        // M1 — farms created under a workspace stamp ownerId = the creating
        // worker; the middleware must delegate so a REVOKED creator is denied.
        mockResolveFarmAccess.mockResolvedValue(true);
        const req = buildReq({ userId: 'employer-1' });
        const res = buildRes();
        const next = jest.fn();
        await requireFarmOwnership()(req, res, next);
        expect(mockResolveFarmAccess).toHaveBeenCalledWith(FARM, 'employer-1');
        expect(next).toHaveBeenCalled();
    });

    it('WORKSPACE farm creator with a dead membership → 403 (fired-worker hole closed)', async () => {
        mockResolveFarmAccess.mockResolvedValue(false);
        const res = buildRes();
        const next = jest.fn();
        await requireFarmOwnership()(buildReq({ userId: 'employer-1' }), res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('missing farm → 404; missing farmId → 400; unauthenticated → 401 (unchanged)', async () => {
        mockFarmFindUnique.mockResolvedValue(null);
        let res = buildRes();
        await requireFarmOwnership()(buildReq(), res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(404);

        res = buildRes();
        await requireFarmOwnership()(buildReq({ farmId: null }), res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400);

        res = buildRes();
        await requireFarmOwnership()(buildReq({ userId: null }), res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(401);
    });
});

describe('reads (no permission option) — Wave-A style co-member widening', () => {
    it('ACTIVE co-member passes via resolveFarmAccess (read-shaped, no forMutation)', async () => {
        mockResolveFarmAccess.mockResolvedValue(true);
        const req = buildReq();
        const res = buildRes();
        const next = jest.fn();

        await requireFarmOwnership()(req, res, next);

        expect(mockResolveFarmAccess).toHaveBeenCalledWith(FARM, 'worker-1');
        expect(next).toHaveBeenCalled();
        expect(req.farm).toEqual(FARM);
    });

    it('non-member keeps the legacy 403', async () => {
        mockResolveFarmAccess.mockResolvedValue(false);
        const res = buildRes();
        await requireFarmOwnership()(buildReq(), res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(403);
    });
});

describe('writes ({ permission: RECORDS_MANAGE }) — effective permission decides', () => {
    it('co-member WITH the permission passes', async () => {
        mockAssertFarmActionPermission.mockResolvedValue({ allowed: true });
        const req = buildReq();
        const res = buildRes();
        const next = jest.fn();

        await requireFarmOwnership({ permission: 'RECORDS_MANAGE' })(req, res, next);

        expect(mockAssertFarmActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            farm: FARM, userId: 'worker-1', permission: 'RECORDS_MANAGE',
        }));
        expect(next).toHaveBeenCalled();
    });

    it('co-member WITHOUT the permission → 403 ENTITY_PERMISSION_DENIED naming it', async () => {
        const err = new Error('denied');
        err.code = 'ENTITY_PERMISSION_DENIED';
        err.statusCode = 403;
        err.permission = 'RECORDS_MANAGE';
        mockAssertFarmActionPermission.mockRejectedValue(err);

        const res = buildRes();
        const next = jest.fn();
        await requireFarmOwnership({ permission: 'RECORDS_MANAGE' })(buildReq(), res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            code: 'ENTITY_PERMISSION_DENIED',
            permission: 'RECORDS_MANAGE',
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('unexpected assert failure → 500 (existing catch), never a silent pass', async () => {
        mockAssertFarmActionPermission.mockRejectedValue(new Error('boom'));
        const res = buildRes();
        const next = jest.fn();
        await requireFarmOwnership({ permission: 'RECORDS_MANAGE' })(buildReq(), res, next);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(next).not.toHaveBeenCalled();
    });
});
