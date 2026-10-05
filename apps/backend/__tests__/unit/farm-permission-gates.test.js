/**
 * Farm-worker Wave B, Chunk 4 — farm + plot permission gates.
 *
 * Covers three surfaces:
 *   1. farm-service.updateFarm → EDIT_FARM assert (service-level, real service)
 *   2. routes farms.js: POST / names its holder in body.entityId (R2 Task 10,
 *      spec 2026-09-30-remove-workspace-mode §3.2 B7/B8). Missing → 400
 *      APPLICATION_HOLDER_REQUIRED; FARM_CREATE is checked on that entity every
 *      time, the personal entity included (its OWNER holds it by role); the
 *      active-entity header never decides. PATCH /:id maps the service denial
 *      to 403 ENTITY_PERMISSION_DENIED.
 *   3. routes plots.js: plot create + delete → CYCLE_CREATE (plots are
 *      cycle-prep per the plan mapping).
 */

'use strict';

const express = require('express');
const request = require('supertest');

// The plot door consults the farm's certificate before it will add a plot (B6 /
// กทล.๑ ส่วนที่ ๔ (๓) — services/certified-scope.js), and that guard fails CLOSED when it
// cannot read: a scope lock that lapses whenever the database hiccups is a lock that is
// open exactly when things are going wrong. These fixtures are farms with no certificate
// yet, which is the state this suite is actually about, so the read answers null.
jest.mock('../../services/prisma-database', () => ({
    prisma: { certificate: { findMany: jest.fn(async () => []) } },
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l), logger: l };
});
jest.mock('../../shared', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { logger: l };
});

const mockAssertFarmActionPermission = jest.fn();
const mockAssertEntityActionPermission = jest.fn();
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertFarmActionPermission: (...a) => mockAssertFarmActionPermission(...a),
    assertEntityActionPermission: (...a) => mockAssertEntityActionPermission(...a),
}));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { id: 'caller-1', healthId: 'health-1' };
        if (global.__testActiveEntity !== undefined) {
            req.activeEntity = global.__testActiveEntity;
        }
        return next();
    },
}));

jest.mock('../../middleware/upload-middleware', () => ({
    single: () => (_req, _res, next) => next(),
}));

const mockFarmService = {
    getByOwner: jest.fn().mockResolvedValue([]),
    getById: jest.fn(),
    createFarm: jest.fn().mockResolvedValue({ id: 'farm-new' }),
    updateFarm: jest.fn(),
    deleteFarm: jest.fn(),
    generateQRCode: jest.fn(),
    getEligibleForPlanting: jest.fn().mockResolvedValue([]),
    findOwnedFarmForPlotOps: jest.fn(),
    listAccessibleFarmIds: jest.fn(),
};
jest.mock('../../services/farm-service', () => mockFarmService);

const mockPlantingService = {
    createPlotForFarm: jest.fn().mockResolvedValue({ id: 'plot-new' }),
    listPlotsByFarm: jest.fn().mockResolvedValue([]),
    findPlotWithFarmOwner: jest.fn(),
    deletePlot: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../services/planting-service', () => mockPlantingService);

const mockResolveFarmAccess = jest.fn();
jest.mock('../../services/farm-access', () => ({
    resolveFarmAccess: (...a) => mockResolveFarmAccess(...a),
}));

const farmsRouter = require('../../routes/api/cultivation/farms');
const plotsRouter = require('../../routes/api/cultivation/plots');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/farms', farmsRouter);
    app.use('/api', plotsRouter);
    return app;
}

function deniedError(permission) {
    const err = new Error(`denied ${permission}`);
    err.code = 'ENTITY_PERMISSION_DENIED';
    err.statusCode = 403;
    err.permission = permission;
    return err;
}

const FARM_BODY = {
    farmName: 'ฟาร์มทดสอบ', address: 'addr', province: 'p', district: 'd', subDistrict: 's',
};

let app;
beforeAll(() => { app = buildApp(); });
beforeEach(() => {
    jest.clearAllMocks();
    global.__testActiveEntity = undefined;
    mockFarmService.createFarm.mockResolvedValue({ id: 'farm-new' });
});
afterAll(() => { delete global.__testActiveEntity; });

const DENIED_TH = 'คุณไม่มีสิทธิ์ทำรายการนี้ในนามของผู้ถือรายนี้ ขอให้เจ้าของมอบสิทธิ์ให้คุณก่อน แล้วลองอีกครั้ง';
const HOLDER_REQUIRED_TH = 'ยังไม่ได้เลือกว่าจะยื่นในนามใคร กรุณาเลือกที่ขั้นตอนที่ 1 หากเปิดหน้านี้ค้างไว้ ให้โหลดหน้าใหม่ก่อน';

describe('POST /farms — the farm names its holder; FARM_CREATE is checked on it every time', () => {
    it('POST /farms without entityId → 400 APPLICATION_HOLDER_REQUIRED, nothing created', async () => {
        const res = await request(app).post('/api/farms').send(FARM_BODY);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('APPLICATION_HOLDER_REQUIRED');
        expect(res.body.messageTh).toBe(HOLDER_REQUIRED_TH);
        expect(mockFarmService.createFarm).not.toHaveBeenCalled();
        expect(mockAssertEntityActionPermission).not.toHaveBeenCalled();
    });

    it('without entityId the active-entity header is no fallback → still 400', async () => {
        global.__testActiveEntity = { entityId: 'ent-personal', role: 'OWNER', personal: true };
        const res = await request(app).post('/api/farms').send(FARM_BODY);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('APPLICATION_HOLDER_REQUIRED');
        expect(mockFarmService.createFarm).not.toHaveBeenCalled();
    });

    it('POST /farms passes body.entityId to createFarm and checks FARM_CREATE on it', async () => {
        mockAssertEntityActionPermission.mockResolvedValue({ allowed: true });
        const res = await request(app).post('/api/farms').send({ ...FARM_BODY, entityId: 'ent-work' });
        expect(res.status).toBe(201);
        expect(mockAssertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-work', userId: 'caller-1', permission: 'FARM_CREATE',
        }));
        expect(mockFarmService.createFarm).toHaveBeenCalledWith(
            'caller-1', expect.objectContaining({ farmName: FARM_BODY.farmName }), undefined, { entityId: 'ent-work' },
        );
    });

    it('the body names the holder, not the header: header PA + body C → checked and written on C', async () => {
        global.__testActiveEntity = { entityId: 'ent-personal', role: 'OWNER', personal: true };
        mockAssertEntityActionPermission.mockResolvedValue({ allowed: true });
        const res = await request(app).post('/api/farms').send({ ...FARM_BODY, entityId: 'ent-company' });
        expect(res.status).toBe(201);
        expect(mockAssertEntityActionPermission).toHaveBeenCalledTimes(1);
        expect(mockAssertEntityActionPermission.mock.calls[0][0].entityId).toBe('ent-company');
        expect(mockFarmService.createFarm.mock.calls[0][3]).toEqual({ entityId: 'ent-company' });
    });

    it('FARM_CREATE is checked on the personal entity too (its OWNER passes by role)', async () => {
        global.__testActiveEntity = { entityId: 'ent-personal', role: 'OWNER', personal: true };
        mockAssertEntityActionPermission.mockResolvedValue({ allowed: true });
        const res = await request(app).post('/api/farms').send({ ...FARM_BODY, entityId: 'ent-personal' });
        expect(res.status).toBe(201);
        expect(mockAssertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-personal', userId: 'caller-1', permission: 'FARM_CREATE',
        }));
    });

    it('denied → 403 ENTITY_PERMISSION_DENIED, nothing created', async () => {
        mockAssertEntityActionPermission.mockRejectedValue(deniedError('FARM_CREATE'));
        const res = await request(app).post('/api/farms').send({ ...FARM_BODY, entityId: 'ent-work' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(res.body.permission).toBe('FARM_CREATE');
        expect(res.body.error).toBe(DENIED_TH);
        expect(mockFarmService.createFarm).not.toHaveBeenCalled();
    });

    it('missing required fields → 400 before the holder is checked, nothing created', async () => {
        const res = await request(app).post('/api/farms').send({ farmName: 'x', entityId: 'ent-work' });
        expect(res.status).toBe(400);
        expect(mockAssertEntityActionPermission).not.toHaveBeenCalled();
        expect(mockFarmService.createFarm).not.toHaveBeenCalled();
    });
});

describe('PATCH /farms/:id — service denial maps to 403 (not 500)', () => {
    it('farm-service throws ENTITY_PERMISSION_DENIED → 403 with the permission named', async () => {
        mockFarmService.updateFarm.mockRejectedValue(deniedError('EDIT_FARM'));

        const res = await request(app).patch('/api/farms/farm-1').send({ farmName: 'x' });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(res.body.permission).toBe('EDIT_FARM');
    });

    it('normal update still 200', async () => {
        mockFarmService.updateFarm.mockResolvedValue({ id: 'farm-1' });
        const res = await request(app).patch('/api/farms/farm-1').send({ farmName: 'x' });
        expect(res.status).toBe(200);
    });
});

describe('plots — CYCLE_CREATE on create + delete (plots are cycle-prep)', () => {
    it('POST /farms/:farmId/plots asserts CYCLE_CREATE after the reachability probe', async () => {
        mockFarmService.findOwnedFarmForPlotOps.mockResolvedValue({ id: 'farm-1', cultivationMethod: 'BOTH' });
        mockAssertFarmActionPermission.mockResolvedValue({ allowed: true });

        const res = await request(app)
            .post('/api/farms/farm-1/plots')
            .send({ name: 'Plot A', area: 10 });

        expect(res.status).toBe(201);
        expect(mockAssertFarmActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            farmId: 'farm-1', userId: 'caller-1', permission: 'CYCLE_CREATE',
        }));
    });

    it('POST plot denied → 403 ENTITY_PERMISSION_DENIED, plot NOT created', async () => {
        mockFarmService.findOwnedFarmForPlotOps.mockResolvedValue({ id: 'farm-1', cultivationMethod: 'BOTH' });
        mockAssertFarmActionPermission.mockRejectedValue(deniedError('CYCLE_CREATE'));

        const res = await request(app)
            .post('/api/farms/farm-1/plots')
            .send({ name: 'Plot A', area: 10 });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(res.body.messageTh).toBe(DENIED_TH);
        expect(res.body.error).toBe(DENIED_TH);
        expect(mockPlantingService.createPlotForFarm).not.toHaveBeenCalled();
    });

    it('DELETE /plots/:id asserts CYCLE_CREATE with the loaded farm row', async () => {
        const farm = { id: 'farm-1', ownerId: 'employer-1', entityId: 'ent-1' };
        mockPlantingService.findPlotWithFarmOwner.mockResolvedValue({ id: 'plot-1', farm });
        mockResolveFarmAccess.mockResolvedValue(true);
        mockAssertFarmActionPermission.mockResolvedValue({ allowed: true });

        const res = await request(app).delete('/api/plots/plot-1');

        expect(res.status).toBe(200);
        expect(mockAssertFarmActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            farm, userId: 'caller-1', permission: 'CYCLE_CREATE',
        }));
    });

    it('DELETE plot denied → 403, plot NOT deleted', async () => {
        const farm = { id: 'farm-1', ownerId: 'employer-1', entityId: 'ent-1' };
        mockPlantingService.findPlotWithFarmOwner.mockResolvedValue({ id: 'plot-1', farm });
        mockResolveFarmAccess.mockResolvedValue(true);
        mockAssertFarmActionPermission.mockRejectedValue(deniedError('CYCLE_CREATE'));

        const res = await request(app).delete('/api/plots/plot-1');

        expect(res.status).toBe(403);
        expect(mockPlantingService.deletePlot).not.toHaveBeenCalled();
    });
});
