/**
 * A3 (HIGH) — a producer must NOT be able to bind farm A's harvest batch to
 * farm B's certified planting cycle. The create route validated only farmId,
 * never cycle.farmId, so a batch on farm A could ride farm B's valid GACP cert
 * onto the public QR (per-batch self-declared weight → unbounded).
 *
 * Fix (layer 1, definitive): when cycleId is present, load the cycle and REJECT
 * unless cycle.farmId === farmId.
 *
 * REAL harvest-batches route over mocked services + a mocked prisma
 * (plantingCycle.findUnique for the new cycle-farm check).
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { id: 'owner-1', healthId: 'health-1', canonicalRole: 'health' };
        return next();
    },
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockFarmIds = jest.fn();
jest.mock('../../services/farm-service', () => ({ listAccessibleFarmIds: (...a) => mockFarmIds(...a) }));

const mockHarvest = {
    findActivePlantSpeciesCode: jest.fn().mockResolvedValue('CANN'),
    createHarvestBatchWithGeneratedNumber: jest.fn(),
    updateHarvestBatchTrackingUrl: jest.fn(),
};
jest.mock('../../services/harvest-service', () => mockHarvest);

jest.mock('../../services/qrcode/qrcode-service', () => ({
    generateQRCodeId: jest.fn(() => 'QR-1'),
    generatePublicTraceUrl: jest.fn((p) => `https://trace/${p}`),
    registerTraceIntegrity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(undefined) },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

jest.mock('../../utils/field-encryption', () => ({ maskThaiId: (x) => `masked(${x})` }));
jest.mock('../../utils/client-ip', () => ({ getRequestIp: () => '127.0.0.1' }));

// Permission engine — allow the harvest write (owner passes).
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertFarmActionPermission: jest.fn().mockResolvedValue(true),
}));

const mockPlantingCycleFindUnique = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: { plantingCycle: { findUnique: (...a) => mockPlantingCycleFindUnique(...a) } },
}));

const harvestRouter = require('../../routes/api/cultivation/harvest-batches');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/harvest-batches', harvestRouter);
    return app;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFarmIds.mockResolvedValue(['farm-A']); // caller owns farm-A
    mockHarvest.findActivePlantSpeciesCode.mockResolvedValue('CANN');
    mockHarvest.createHarvestBatchWithGeneratedNumber.mockResolvedValue({
        id: 'batch-1', batchNumber: 'BATCH-2026-000001', farmId: 'farm-A',
        harvestDate: new Date().toISOString(), freshWeight: 10, qrCode: 'QR-1',
    });
    mockHarvest.updateHarvestBatchTrackingUrl.mockResolvedValue({
        id: 'batch-1', batchNumber: 'BATCH-2026-000001', farmId: 'farm-A',
        harvestDate: new Date().toISOString(), freshWeight: 10, qrCode: 'QR-1', trackingUrl: 'https://trace/batch/batch-1',
    });
});

describe('A3 — create rejects a cross-farm cycle binding', () => {
    test('cycleId whose cycle.farmId !== farmId → rejected, batch NOT created', async () => {
        mockPlantingCycleFindUnique.mockResolvedValue({ farmId: 'farm-B', isDeleted: false });
        const res = await request(buildApp())
            .post('/api/harvest-batches')
            .send({ farmId: 'farm-A', cycleId: 'cycle-on-B', freshWeight: 10 });

        expect([400, 403]).toContain(res.status);
        expect(res.body.success).toBe(false);
        expect(mockHarvest.createHarvestBatchWithGeneratedNumber).not.toHaveBeenCalled();
    });

    test('cycleId that does not resolve to a cycle → rejected, batch NOT created', async () => {
        mockPlantingCycleFindUnique.mockResolvedValue(null);
        const res = await request(buildApp())
            .post('/api/harvest-batches')
            .send({ farmId: 'farm-A', cycleId: 'ghost', freshWeight: 10 });

        expect([400, 403]).toContain(res.status);
        expect(mockHarvest.createHarvestBatchWithGeneratedNumber).not.toHaveBeenCalled();
    });
});

describe('A3 — legit paths still create', () => {
    test('cycleId whose cycle.farmId === farmId → 201, batch created with cycleId', async () => {
        mockPlantingCycleFindUnique.mockResolvedValue({ farmId: 'farm-A', isDeleted: false });
        const res = await request(buildApp())
            .post('/api/harvest-batches')
            .send({ farmId: 'farm-A', cycleId: 'cycle-on-A', freshWeight: 10 });

        expect(res.status).toBe(201);
        expect(mockHarvest.createHarvestBatchWithGeneratedNumber).toHaveBeenCalledWith(
            expect.objectContaining({ farmId: 'farm-A', cycleId: 'cycle-on-A' }),
        );
    });

    test('no cycleId → 201, batch created (no cycle check)', async () => {
        const res = await request(buildApp())
            .post('/api/harvest-batches')
            .send({ farmId: 'farm-A', freshWeight: 10 });

        expect(res.status).toBe(201);
        expect(mockPlantingCycleFindUnique).not.toHaveBeenCalled();
        expect(mockHarvest.createHarvestBatchWithGeneratedNumber).toHaveBeenCalledWith(
            expect.objectContaining({ farmId: 'farm-A', cycleId: null }),
        );
    });
});
