/**
 * Farm-worker Wave B, Chunk 4 — farm + plot permission gates.
 *
 * Covers three surfaces:
 *   1. farm-service.updateFarm → EDIT_FARM assert (service-level, real service)
 *   2. routes farms.js: POST / → FARM_CREATE only in a real workspace context
 *      (personal:true or no context = solo farmer, byte-identical, NO gate);
 *      PATCH /:id maps the service denial to 403 ENTITY_PERMISSION_DENIED.
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

describe('POST /farms — FARM_CREATE gated ONLY in a real workspace context', () => {
    it('no active-entity context → no gate, 201 (legacy solo farmer path)', async () => {
        const res = await request(app).post('/api/farms').send(FARM_BODY);
        expect(res.status).toBe(201);
        expect(mockAssertEntityActionPermission).not.toHaveBeenCalled();
    });

    it('personal:true context → no gate, 201 (owner under own personal entity ALWAYS passes)', async () => {
        global.__testActiveEntity = { entityId: 'ent-personal', role: 'OWNER', personal: true };
        const res = await request(app).post('/api/farms').send(FARM_BODY);
        expect(res.status).toBe(201);
        expect(mockAssertEntityActionPermission).not.toHaveBeenCalled();
    });

    it('workspace context (personal:false) → FARM_CREATE asserted against that entity', async () => {
        global.__testActiveEntity = { entityId: 'ent-work', role: 'MANAGER', personal: false };
        mockAssertEntityActionPermission.mockResolvedValue({ allowed: true });

        const res = await request(app).post('/api/farms').send(FARM_BODY);

        expect(res.status).toBe(201);
        expect(mockAssertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-work', userId: 'caller-1', permission: 'FARM_CREATE',
        }));
    });

    it('workspace context, denied → 403 ENTITY_PERMISSION_DENIED', async () => {
        global.__testActiveEntity = { entityId: 'ent-work', role: 'MANAGER', personal: false };
        mockAssertEntityActionPermission.mockRejectedValue(deniedError('FARM_CREATE'));

        const res = await request(app).post('/api/farms').send(FARM_BODY);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(res.body.permission).toBe('FARM_CREATE');
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
