// Wave A fix S2 (adversarial-verify 2026-07-02) — route-level call contract:
// POST /planting-cycles (CYCLE_CREATE, a mutation) must probe farm ownership
// with `{ forMutation: true }` so the VIEWER floor applies; the GET list keeps
// the read-shaped probe. Mock harness mirrors
// planting-cycle-error-sanitization.test.js.

const express = require('express');
const request = require('supertest');

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { id: 'worker-1', healthId: 'health-1' };
        return next();
    },
}));

const mockVerifyOwnedFarm = jest.fn();

jest.mock('../../services/planting-service', () => ({
    listByOwner: jest.fn().mockResolvedValue([]),
    listByFarm: jest.fn().mockResolvedValue([]),
    getById: jest.fn(),
    createCycle: jest.fn().mockResolvedValue({ id: 'cycle-new' }),
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
    ALLOWED_ACTIVITY_TYPES: new Set(['IRRIGATION']),
    getAuthenticatedUserId: (req) => String(req.user?.id || '').trim(),
    toPositiveInt: (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d),
    normalizeActivityType: (v) => v,
    normalizeActivityScope: (v) => v,
    normalizeAttachmentIds: () => [],
    toActivityResponse: (v) => v,
    buildPlotCycleEntityId: (v) => v,
    loadOwnedCycleWithPlots: jest.fn().mockResolvedValue(null),
    verifyOwnedFarm: (...args) => mockVerifyOwnedFarm(...args),
    buildCycleIntegrity: jest.fn(),
    generatePlotCycleQrsForCycle: jest.fn(),
    ensureCycleOwned: (req, _res, next) => next(),
    // Wave B fix M2 — gated routes now front with read-shaped reachability.
    ensureCycleReachable: (req, _res, next) => next(),
    createHarvestBatches: jest.fn(),
    getCapacitySummary: jest.fn(),
    // Wave B chunk 4 — routes now also register per-permission gates; this
    // suite pins the reachability call-shape only, so the gates pass through.
    requireCycleFarmPermission: () => (_req, _res, next) => next(),
    resolveActivityPermission: jest.fn(),
    assertFarmPermission: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

const plantingCyclesRouter = require('../../routes/api/cultivation/planting-cycles');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/planting-cycles', plantingCyclesRouter);
    return app;
}

describe('M2 — POST /planting-cycles probes read-shaped (the CYCLE_CREATE gate is the mutation authority)', () => {
    let app;

    beforeAll(() => { app = buildApp(); });
    beforeEach(() => jest.clearAllMocks());

    test('POST / (cycle create) probes WITHOUT the VIEWER floor (M2: grants to VIEWER must reach the gate)', async () => {
        mockVerifyOwnedFarm.mockResolvedValue({ id: 'farm-1' });

        const response = await request(app)
            .post('/api/planting-cycles')
            .send({
                farmId: 'farm-1',
                plantSpeciesId: 'sp-1',
                cycleName: 'Cycle A',
                startDate: '2026-01-01',
                plotId: 'plot-1',
            });

        expect(response.status).toBe(201);
        expect(mockVerifyOwnedFarm).toHaveBeenCalledWith('farm-1', 'worker-1');
    });

    test('GET / (list) keeps the read-shaped probe (no forMutation)', async () => {
        mockVerifyOwnedFarm.mockResolvedValue({ id: 'farm-1' });

        const response = await request(app)
            .get('/api/planting-cycles')
            .query({ farmId: 'farm-1' });

        expect(response.status).toBe(200);
        expect(mockVerifyOwnedFarm).toHaveBeenCalledWith('farm-1', 'worker-1');
    });
});
