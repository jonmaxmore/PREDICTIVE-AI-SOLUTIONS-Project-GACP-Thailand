/**
 * Bug 8.4 (adversarial-verify follow-up) — BOTH callers of
 * generatePlotCycleQrsForCycle must CONSUME the new 'partial' status.
 *
 * The service was upgraded (Batch 8) to isolate per-plot failures and emit a
 * real partial report ({ status:'partial', generated, failed, missingCount }).
 * The two verify skeptics found neither caller consumed it:
 *   - the manual POST /:id/plot-qrs/generate returned a plain 201 success and
 *     DISCARDED result.failed/missingCount → operator saw success with a
 *     silently-reduced count;
 *   - the create-cycle automation only warned on status==='failed', so a
 *     partial failure produced a GREEN success toast (pre-fix the throw
 *     surfaced a yellow warning).
 *
 * Harness mirrors planting-cycle-error-sanitization.test.js (auth via header,
 * planting-cycle-service fully mocked, prisma stubbed).
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { id: req.headers['x-test-user-id'] || 'user-1', healthId: 'health-1' };
        return next();
    },
}));

const mockCreateCycle = jest.fn();

jest.mock('../../services/planting-service', () => ({
    listByOwner: jest.fn().mockResolvedValue([]),
    listByFarm: jest.fn().mockResolvedValue([]),
    getById: jest.fn(),
    createCycle: (...args) => mockCreateCycle(...args),
    updateCycle: jest.fn(),
}));


jest.mock('../../services/qrcode/qrcode-service', () => ({
    generateForRecord: jest.fn(),
    generateQRCodeId: jest.fn(),
}));

jest.mock('../../services/planting-cycle-service', () => ({
    // 'PLANT_UNIT' left this set in the real service on 2026-08-25 (spec R8 —
    // per-plant tracking retired). A mock that still offered it would let a
    // PLANT_UNIT-scoped activity pass here while the real service rejects it.
    ALLOWED_ACTIVITY_SCOPE: new Set(['CYCLE', 'PLOT']),
    ALLOWED_ACTIVITY_TYPES: new Set(['WATERING']),
    getAuthenticatedUserId: (req) => String(req.user?.id || '').trim(),
    toPositiveInt: (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d),
    normalizeActivityType: (v) => v,
    normalizeActivityScope: (v) => v,
    normalizeAttachmentIds: () => [],
    toActivityResponse: (v) => v,
    buildPlotCycleEntityId: (v) => v,
    loadOwnedCycleWithPlots: jest.fn(),
    verifyOwnedFarm: jest.fn().mockResolvedValue({ id: 'farm-1' }),
    buildCycleIntegrity: jest.fn(),
    generatePlotCycleQrsForCycle: jest.fn(),
    ensureCycleOwned: (req, _res, next) => next(),
    // Wave B — gated mutation routes front with read-shaped reachability and
    // register per-permission gates at require time; pass both through (the
    // permission engine has its own suites).
    ensureCycleReachable: (req, _res, next) => next(),
    requireCycleFarmPermission: () => (_req, _res, next) => next(),
    resolveActivityPermission: jest.fn(),
    assertFarmPermission: jest.fn().mockResolvedValue({ allowed: true }),
    createHarvestBatches: jest.fn(),
    getCapacitySummary: jest.fn(),
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

const cycleService = require('../../services/planting-cycle-service');
const plantingCyclesRouter = require('../../routes/api/cultivation/planting-cycles');

const PARTIAL_RESULT = {
    status: 'partial',
    generated: [{ cyclePlotId: 'cp1', qrCode: 'QR-1' }],
    failed: [{ cyclePlotId: 'cp2', error: 'trace integrity write failed' }],
    missingCount: 1,
};

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/planting-cycles', plantingCyclesRouter);
    return app;
}

describe('Bug 8.4 — routes consume the partial plot-QR report', () => {
    let app;
    beforeAll(() => { app = buildApp(); });
    beforeEach(() => { jest.clearAllMocks(); });

    test('manual POST /:id/plot-qrs/generate surfaces failed plots on partial (not a silent success)', async () => {
        cycleService.loadOwnedCycleWithPlots.mockResolvedValue({ id: 'cycle-1', cyclePlots: [{ id: 'cp1' }, { id: 'cp2' }] });
        cycleService.generatePlotCycleQrsForCycle.mockResolvedValue(PARTIAL_RESULT);

        const response = await request(app)
            .post('/api/planting-cycles/cycle-1/plot-qrs/generate')
            .set('x-test-user-id', 'user-1')
            .send({});

        expect(response.status).toBe(201);
        expect(response.body.status).toBe('partial');
        expect(response.body.count).toBe(1);
        expect(response.body.missingCount).toBe(1);
        expect(response.body.failed).toHaveLength(1);
        expect(response.body.failed[0].cyclePlotId).toBe('cp2');
    });

    test('manual POST /:id/plot-qrs/generate still 400s when ALL plots failed', async () => {
        cycleService.loadOwnedCycleWithPlots.mockResolvedValue({ id: 'cycle-1', cyclePlots: [{ id: 'cp1' }] });
        cycleService.generatePlotCycleQrsForCycle.mockResolvedValue({
            status: 'failed', generated: [], failed: [{ cyclePlotId: 'cp1', error: 'down' }], missingCount: 1, error: 'All 1 plot QR registration(s) failed',
        });

        const response = await request(app)
            .post('/api/planting-cycles/cycle-1/plot-qrs/generate')
            .set('x-test-user-id', 'user-1')
            .send({});

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
    });

    test('create-cycle automation pushes a WARNING on partial (no green success toast)', async () => {
        mockCreateCycle.mockResolvedValue({ id: 'cycle-new', plannedPlantCount: 0 });
        cycleService.loadOwnedCycleWithPlots.mockResolvedValue({ id: 'cycle-new', cyclePlots: [{ id: 'cp1' }, { id: 'cp2' }] });
        cycleService.generatePlotCycleQrsForCycle.mockResolvedValue(PARTIAL_RESULT);

        const response = await request(app)
            .post('/api/planting-cycles')
            .set('x-test-user-id', 'user-1')
            .send({
                farmId: 'farm-1',
                plantSpeciesId: 'sp-1',
                cycleName: 'Cycle A',
                startDate: '2026-01-01',
                plotId: 'plot-1',
            });

        expect(response.status).toBe(201);
        const warnings = response.body.warnings || [];
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.join(' ')).toContain('ล้มเหลว 1 แปลง');
    });
});
