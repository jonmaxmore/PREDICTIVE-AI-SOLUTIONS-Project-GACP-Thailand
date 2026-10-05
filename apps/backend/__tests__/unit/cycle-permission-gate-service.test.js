/**
 * Farm-worker Wave B, Chunk 4 — the REAL planting-cycle-service gate helpers:
 *   - resolveActivityPermission(req) → per-type ACTIVITY_* code | null
 *   - requireCycleFarmPermission(permissionOrResolver) express middleware
 *   - assertFarmPermission({ farmId, userId, permission, req }) wrapper
 *
 * entity-effective-permissions-service is mocked here (its math has its own
 * suite); this proves the glue: resolver mapping, 400-before-permission on an
 * unknown activity type, 403 shape on denial, per-request cache reuse.
 */

'use strict';

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../services/qrcode/qrcode-service', () => ({
    generateQRCodeId: jest.fn(),
    generatePublicTraceUrl: jest.fn(),
    registerTraceIntegrity: jest.fn(),
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockAssertFarmActionPermission = jest.fn();
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertFarmActionPermission: (...a) => mockAssertFarmActionPermission(...a),
}));

const {
    resolveActivityPermission,
    requireCycleFarmPermission,
    assertFarmPermission,
} = require('../../services/planting-cycle-service');

function buildRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

beforeEach(() => {
    mockAssertFarmActionPermission.mockReset().mockResolvedValue({ allowed: true });
});

describe('resolveActivityPermission — payload type → ACTIVITY_* code', () => {
    const CASES = [
        ['IRRIGATION', 'ACTIVITY_IRRIGATION'],
        ['FERTILIZER', 'ACTIVITY_FERTILIZER'],
        ['PEST_CONTROL', 'ACTIVITY_PEST_CONTROL'],
        ['WEED_CONTROL', 'ACTIVITY_WEED_CONTROL'],
        ['INSPECTION', 'ACTIVITY_INSPECTION'],
        ['INCIDENT', 'ACTIVITY_INCIDENT'],
        ['OTHER', 'ACTIVITY_OTHER'],
    ];
    it.each(CASES)('%s → %s', (type, code) => {
        expect(resolveActivityPermission({ body: { activityType: type } })).toBe(code);
    });

    it('normalizes legacy aliases (PESTICIDE → ACTIVITY_PEST_CONTROL, lowercase ok)', () => {
        expect(resolveActivityPermission({ body: { activityType: 'PESTICIDE' } }))
            .toBe('ACTIVITY_PEST_CONTROL');
        expect(resolveActivityPermission({ body: { activityType: 'irrigation' } }))
            .toBe('ACTIVITY_IRRIGATION');
    });

    it('unknown / missing type → null', () => {
        expect(resolveActivityPermission({ body: { activityType: 'DANCING' } })).toBeNull();
        expect(resolveActivityPermission({ body: {} })).toBeNull();
        expect(resolveActivityPermission({})).toBeNull();
    });
});

describe('requireCycleFarmPermission — express gate after ensureCycleOwned', () => {
    function buildReq(overrides = {}) {
        return {
            user: { id: 'worker-1' },
            cycleOwnership: { id: 'cycle-1', farmId: 'farm-1' },
            body: {},
            ...overrides,
        };
    }

    it('static permission: allowed → next(), assert called with farmId+userId+permission', async () => {
        const req = buildReq();
        const res = buildRes();
        const next = jest.fn();

        await requireCycleFarmPermission('UNIT_MANAGE')(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(mockAssertFarmActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            farmId: 'farm-1', userId: 'worker-1', permission: 'UNIT_MANAGE',
        }));
    });

    it('denied → 403 with code ENTITY_PERMISSION_DENIED + permission in the body', async () => {
        const err = new Error('denied');
        err.code = 'ENTITY_PERMISSION_DENIED';
        err.statusCode = 403;
        err.permission = 'HARVEST_RECORD';
        mockAssertFarmActionPermission.mockRejectedValue(err);

        const req = buildReq();
        const res = buildRes();
        const next = jest.fn();
        await requireCycleFarmPermission('HARVEST_RECORD')(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            code: 'ENTITY_PERMISSION_DENIED',
            permission: 'HARVEST_RECORD',
        }));
    });

    it('resolver returning null (unknown activity type) → 400 BEFORE any permission check', async () => {
        const req = buildReq({ body: { activityType: 'DANCING' } });
        const res = buildRes();
        const next = jest.fn();

        await requireCycleFarmPermission(resolveActivityPermission)(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockAssertFarmActionPermission).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('resolver with a valid type gates on the per-type code', async () => {
        const req = buildReq({ body: { activityType: 'IRRIGATION' } });
        const res = buildRes();
        const next = jest.fn();

        await requireCycleFarmPermission(resolveActivityPermission)(req, res, next);

        expect(mockAssertFarmActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            permission: 'ACTIVITY_IRRIGATION',
        }));
        expect(next).toHaveBeenCalled();
    });

    it('shares ONE per-request cache Map across gates on the same req', async () => {
        const req = buildReq();
        const res = buildRes();

        await requireCycleFarmPermission('UNIT_MANAGE')(req, res, jest.fn());
        const firstCache = mockAssertFarmActionPermission.mock.calls[0][0].cache;
        await requireCycleFarmPermission('QR_GENERATE')(req, res, jest.fn());
        const secondCache = mockAssertFarmActionPermission.mock.calls[1][0].cache;

        expect(firstCache).toBeInstanceOf(Map);
        expect(secondCache).toBe(firstCache);
    });

    it('unexpected (non-denial) failure → 500, not a hang', async () => {
        mockAssertFarmActionPermission.mockRejectedValue(new Error('boom'));
        const req = buildReq();
        const res = buildRes();
        const next = jest.fn();

        await requireCycleFarmPermission('UNIT_MANAGE')(req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(next).not.toHaveBeenCalled();
    });
});

describe('assertFarmPermission — req-cached wrapper for inline route gates', () => {
    it('delegates with the req-scoped cache', async () => {
        const req = { user: { id: 'worker-1' } };
        await assertFarmPermission({ farmId: 'farm-1', userId: 'worker-1', permission: 'CYCLE_CREATE', req });
        expect(mockAssertFarmActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            farmId: 'farm-1', userId: 'worker-1', permission: 'CYCLE_CREATE',
            cache: expect.any(Map),
        }));
    });

    it('propagates the denial error untouched', async () => {
        const err = new Error('denied');
        err.code = 'ENTITY_PERMISSION_DENIED';
        mockAssertFarmActionPermission.mockRejectedValue(err);
        await expect(assertFarmPermission({
            farmId: 'farm-1', userId: 'worker-1', permission: 'CYCLE_CREATE', req: {},
        })).rejects.toBe(err);
    });
});
