// Wave B adversarial-verify M3+M4 (2026-07-03) — the UNGATED TWIN ROUTERS.
//
// The FE-live surfaces (/planting-cycles/:id/activities, /:id/harvest-batches)
// carry per-type permission gates, but two API-drivable twins bypassed them:
//
//   M3  routes/api/cultivation/cultivation-logs.js — createLog used
//       listAccessibleFarmIds with no per-type check; PUT/DELETE used
//       resolveFarmAccess with no gate. A denied worker could log any
//       activity type (or edit/delete logs) through this router.
//   M4  routes/api/cultivation/harvest-batches.js — POST /, PUT /:id and
//       POST /:id/harvest had no HARVEST_RECORD gate.
//
// Fix: the SAME per-type gate as the gated activities route — resolve
// ACTIVITY_<TYPE> from logType (aliases PESTICIDE→PEST_CONTROL /
// WEEDING→WEED_CONTROL; this router's own extra catalog types
// PRUNING/OBSERVATION map to ACTIVITY_OTHER; unknown → 400 BEFORE any
// engine call) + assertFarmActionPermission; PUT/DELETE gate on the ROW's
// own type (and on the target type when the payload re-types the row).
// Harvest-batch mutations gate on HARVEST_RECORD with the farm resolved
// from the batch/body. Solo farms (entityId=null) are unchanged — the
// engine's LEGACY_OWNER rule handles them (its own suite covers that).

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { id: 'worker-1', healthId: 'health-1' };
        return next();
    },
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockAssert = jest.fn();
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertFarmActionPermission: (...a) => mockAssert(...a),
}));

// ── M3 router deps ──────────────────────────────────────────────────────────
const mockCycleFindUnique = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        plantingCycle: { findUnique: (...a) => mockCycleFindUnique(...a) },
    },
}));

const mockListAccessibleFarmIds = jest.fn();
const mockResolveFarmAccess = jest.fn();
jest.mock('../../services/farm-access', () => ({
    listAccessibleFarmIds: (...a) => mockListAccessibleFarmIds(...a),
    resolveFarmAccess: (...a) => mockResolveFarmAccess(...a),
}));

jest.mock('../../services/cultivation-log-service', () => ({
    createLog: jest.fn().mockResolvedValue({ id: 'log-1' }),
    getLogById: jest.fn(),
    updateLog: jest.fn().mockResolvedValue({ id: 'log-1' }),
    deleteLog: jest.fn().mockResolvedValue({}),
    getLogsByCycle: jest.fn().mockResolvedValue([]),
    getLogsByFarm: jest.fn().mockResolvedValue([]),
    getCycleSummary: jest.fn().mockResolvedValue({}),
}));

// ── M4 router deps ──────────────────────────────────────────────────────────
jest.mock('../../services/harvest-service', () => ({
    list: jest.fn().mockResolvedValue([]),
    getById: jest.fn(),
    getByBatchNumber: jest.fn(),
    findActivePlantSpeciesCode: jest.fn().mockResolvedValue('SP-1'),
    createHarvestBatchWithGeneratedNumber: jest.fn().mockResolvedValue({ id: 'batch-1' }),
    updateHarvestBatchTrackingUrl: jest.fn().mockResolvedValue({
        id: 'batch-1', qrCode: 'QR-1', trackingUrl: 'http://t/1', batchNumber: 'B-1',
        farmId: 'farm-1', harvestDate: new Date(), freshWeight: 5,
    }),
    updateBatch: jest.fn().mockResolvedValue({ id: 'batch-1' }),
    recordHarvest: jest.fn().mockResolvedValue({ id: 'batch-1' }),
    getStats: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../services/farm-service', () => ({
    listAccessibleFarmIds: (...a) => mockListAccessibleFarmIds(...a),
}));

jest.mock('../../services/qrcode/qrcode-service', () => ({
    generateQRCodeId: jest.fn(() => 'QR-1'),
    generatePublicTraceUrl: jest.fn(() => 'http://t/1'),
    registerTraceIntegrity: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue({}) },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

const cultivationLogService = require('../../services/cultivation-log-service');
const harvestService = require('../../services/harvest-service');
const cultivationLogsRouter = require('../../routes/api/cultivation/cultivation-logs');
const harvestBatchesRouter = require('../../routes/api/cultivation/harvest-batches');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/cultivation-logs', cultivationLogsRouter);
    app.use('/api/harvest-batches', harvestBatchesRouter);
    return app;
}

const DENY = () => {
    const err = new Error('denied');
    err.code = 'ENTITY_PERMISSION_DENIED';
    err.statusCode = 403;
    err.httpStatus = 403;
    return err;
};

const FARM = { farmName: 'F', ownerId: 'employer-1', entityId: 'ent-1' };

let app;
beforeAll(() => { app = buildApp(); });

beforeEach(() => {
    jest.clearAllMocks();
    mockAssert.mockResolvedValue({ allowed: true, via: 'ENTITY_PERMISSION' });
    mockListAccessibleFarmIds.mockResolvedValue(['farm-1']);
    mockResolveFarmAccess.mockResolvedValue(true);
    mockCycleFindUnique.mockResolvedValue({ farmId: 'farm-1' });
    cultivationLogService.getLogById.mockResolvedValue({
        id: 'log-1', logType: 'FERTILIZER', cycle: { farm: FARM },
    });
    harvestService.getById.mockResolvedValue({ id: 'batch-1', farmId: 'farm-1' });
});

// ═════ M3 — cultivation-logs ════════════════════════════════════════════════

describe('M3 — POST /api/cultivation-logs gates per activity type', () => {
    it('resolves ACTIVITY_IRRIGATION from logType and asserts it before the write', async () => {
        const res = await request(app).post('/api/cultivation-logs')
            .send({ cycleId: 'cycle-1', logType: 'IRRIGATION' });
        expect(res.status).toBe(201);
        expect(mockAssert).toHaveBeenCalledWith(expect.objectContaining({
            farmId: 'farm-1', userId: 'worker-1', permission: 'ACTIVITY_IRRIGATION',
        }));
    });

    it('legacy alias PESTICIDE normalizes to ACTIVITY_PEST_CONTROL', async () => {
        await request(app).post('/api/cultivation-logs')
            .send({ cycleId: 'cycle-1', logType: 'PESTICIDE' });
        expect(mockAssert).toHaveBeenCalledWith(expect.objectContaining({
            permission: 'ACTIVITY_PEST_CONTROL',
        }));
    });

    it('legacy alias WEEDING normalizes to ACTIVITY_WEED_CONTROL', async () => {
        await request(app).post('/api/cultivation-logs')
            .send({ cycleId: 'cycle-1', logType: 'WEEDING' });
        expect(mockAssert).toHaveBeenCalledWith(expect.objectContaining({
            permission: 'ACTIVITY_WEED_CONTROL',
        }));
    });

    it("this router's own catalog types PRUNING/OBSERVATION map to ACTIVITY_OTHER (not 400)", async () => {
        await request(app).post('/api/cultivation-logs')
            .send({ cycleId: 'cycle-1', logType: 'PRUNING' });
        expect(mockAssert).toHaveBeenCalledWith(expect.objectContaining({ permission: 'ACTIVITY_OTHER' }));

        mockAssert.mockClear();
        await request(app).post('/api/cultivation-logs')
            .send({ cycleId: 'cycle-1', logType: 'OBSERVATION' });
        expect(mockAssert).toHaveBeenCalledWith(expect.objectContaining({ permission: 'ACTIVITY_OTHER' }));
    });

    it('missing logType follows the service default (OBSERVATION) → ACTIVITY_OTHER', async () => {
        await request(app).post('/api/cultivation-logs').send({ cycleId: 'cycle-1' });
        expect(mockAssert).toHaveBeenCalledWith(expect.objectContaining({ permission: 'ACTIVITY_OTHER' }));
    });

    it('unknown logType → 400 BEFORE any engine call or write', async () => {
        const res = await request(app).post('/api/cultivation-logs')
            .send({ cycleId: 'cycle-1', logType: 'BOGUS_TYPE' });
        expect(res.status).toBe(400);
        expect(mockAssert).not.toHaveBeenCalled();
        expect(cultivationLogService.createLog).not.toHaveBeenCalled();
    });

    it('denied worker → 403 ENTITY_PERMISSION_DENIED, write blocked', async () => {
        mockAssert.mockRejectedValue(DENY());
        const res = await request(app).post('/api/cultivation-logs')
            .send({ cycleId: 'cycle-1', logType: 'IRRIGATION' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(cultivationLogService.createLog).not.toHaveBeenCalled();
    });
});

describe('M3 — PUT/DELETE /api/cultivation-logs/:id gate on the ROW\'s own type', () => {
    it('PUT asserts the stored row type (FERTILIZER → ACTIVITY_FERTILIZER)', async () => {
        const res = await request(app).put('/api/cultivation-logs/log-1').send({ notes: 'x' });
        expect(res.status).toBe(200);
        expect(mockAssert).toHaveBeenCalledWith(expect.objectContaining({
            farm: FARM, userId: 'worker-1', permission: 'ACTIVITY_FERTILIZER',
        }));
    });

    it('PUT that RE-TYPES the row also asserts the target type', async () => {
        await request(app).put('/api/cultivation-logs/log-1')
            .send({ logType: 'PEST_CONTROL' });
        const permissions = mockAssert.mock.calls.map((c) => c[0].permission);
        expect(permissions).toContain('ACTIVITY_FERTILIZER');   // row's own type
        expect(permissions).toContain('ACTIVITY_PEST_CONTROL'); // target type
    });

    it('PUT denied → 403, no write', async () => {
        mockAssert.mockRejectedValue(DENY());
        const res = await request(app).put('/api/cultivation-logs/log-1').send({ notes: 'x' });
        expect(res.status).toBe(403);
        expect(cultivationLogService.updateLog).not.toHaveBeenCalled();
    });

    it('DELETE asserts the stored row type; denied → 403, no delete', async () => {
        mockAssert.mockRejectedValue(DENY());
        const res = await request(app).delete('/api/cultivation-logs/log-1');
        expect(res.status).toBe(403);
        expect(cultivationLogService.deleteLog).not.toHaveBeenCalled();
    });

    it('DELETE allowed → 200 and deletes', async () => {
        const res = await request(app).delete('/api/cultivation-logs/log-1');
        expect(res.status).toBe(200);
        expect(mockAssert).toHaveBeenCalledWith(expect.objectContaining({
            permission: 'ACTIVITY_FERTILIZER',
        }));
        expect(cultivationLogService.deleteLog).toHaveBeenCalledWith('log-1');
    });
});

// ═════ M4 — harvest-batches ═════════════════════════════════════════════════

describe('M4 — harvest-batches mutations gate on HARVEST_RECORD', () => {
    it('POST / asserts HARVEST_RECORD with the body farmId; allowed → 201', async () => {
        const res = await request(app).post('/api/harvest-batches')
            .send({ farmId: 'farm-1', freshWeight: 5 });
        expect(res.status).toBe(201);
        expect(mockAssert).toHaveBeenCalledWith(expect.objectContaining({
            farmId: 'farm-1', userId: 'worker-1', permission: 'HARVEST_RECORD',
        }));
    });

    it('POST / denied → 403 ENTITY_PERMISSION_DENIED, no create', async () => {
        mockAssert.mockRejectedValue(DENY());
        const res = await request(app).post('/api/harvest-batches')
            .send({ farmId: 'farm-1', freshWeight: 5 });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(harvestService.createHarvestBatchWithGeneratedNumber).not.toHaveBeenCalled();
    });

    it('PUT /:id asserts HARVEST_RECORD with the BATCH farm; denied → 403, no update', async () => {
        mockAssert.mockRejectedValue(DENY());
        const res = await request(app).put('/api/harvest-batches/batch-1').send({ notes: 'x' });
        expect(res.status).toBe(403);
        expect(harvestService.updateBatch).not.toHaveBeenCalled();

        mockAssert.mockResolvedValue({ allowed: true });
        const ok = await request(app).put('/api/harvest-batches/batch-1').send({ notes: 'x' });
        expect(ok.status).toBe(200);
        expect(mockAssert).toHaveBeenCalledWith(expect.objectContaining({
            farmId: 'farm-1', permission: 'HARVEST_RECORD',
        }));
    });

    it('POST /:id/harvest asserts HARVEST_RECORD; denied → 403, no record', async () => {
        mockAssert.mockRejectedValue(DENY());
        const res = await request(app).post('/api/harvest-batches/batch-1/harvest').send({});
        expect(res.status).toBe(403);
        expect(harvestService.recordHarvest).not.toHaveBeenCalled();
    });

    it('reads stay ungated (GET /:id makes no engine call)', async () => {
        const res = await request(app).get('/api/harvest-batches/batch-1');
        expect(res.status).toBe(200);
        expect(mockAssert).not.toHaveBeenCalled();
    });
});
