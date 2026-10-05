/**
 * Farm-worker Wave B, Chunk 4 — planting-cycle route wiring of the
 * per-permission gates (which route registers WHICH permission).
 *
 * planting-cycle-service is mocked; this suite pins the route↔permission
 * contract (mapping per the binding plan):
 *   POST /:id/activities            → requireCycleFarmPermission(resolveActivityPermission)
 *   POST /:id/harvest-batches       → HARVEST_RECORD
 *   POST /:id/harvest (legacy)      → HARVEST_RECORD
 *   POST /:id/plot-qrs/generate     → QR_GENERATE
 *
 * The four UNIT_MANAGE rows that stood here (plant-units generate/confirm/
 * reconcile + the legacy generate-units alias) were removed on 2026-08-25: R8 of
 * design note 2026-08-20-planting-tnt-design retires per-plant
 * tracking, and those four routes were deleted with it. The cycle router now
 * registers no UNIT_MANAGE gate at all.
 *   POST /              (cycle create) → assertFarmPermission CYCLE_CREATE
 *   PATCH /:id (FE-dead updateCycle) — intentionally NOT permission-gated
 *     (Wave-A VIEWER floor only; plan: "อย่า gate FE-dead endpoints เป็น live ops")
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { id: 'worker-1', healthId: 'health-1' };
        return next();
    },
}));

const mockRequireCycleFarmPermission = jest.fn(() => (req, _res, next) => next());
const mockResolveActivityPermission = jest.fn();
const mockAssertFarmPermission = jest.fn().mockResolvedValue({ allowed: true });
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
    ensureCycleOwned: (req, _res, next) => { req.cycleOwnership = { id: req.params.id, farmId: 'farm-1' }; return next(); },
    // Wave B fix M2 — gated routes front with read-shaped reachability.
    ensureCycleReachable: (req, _res, next) => { req.cycleOwnership = { id: req.params.id, farmId: 'farm-1' }; return next(); },
    createHarvestBatches: jest.fn(),
    getCapacitySummary: jest.fn(),
    requireCycleFarmPermission: (...args) => mockRequireCycleFarmPermission(...args),
    resolveActivityPermission: (...args) => mockResolveActivityPermission(...args),
    assertFarmPermission: (...args) => mockAssertFarmPermission(...args),
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

const plantingCyclesRouter = require('../../routes/api/cultivation/planting-cycles');

// Route registration happens at require time; the global jest.setup.js
// afterEach(jest.clearAllMocks) wipes mock.calls after the FIRST test, so
// snapshot the registration args NOW (module scope) and assert on the copy.
const REGISTERED_GATE_ARGS = mockRequireCycleFarmPermission.mock.calls.map((c) => c[0]);

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/planting-cycles', plantingCyclesRouter);
    return app;
}

describe('Wave B chunk 4 — cycle route registers the per-permission gates', () => {
    it('registers HARVEST_RECORD twice (harvest-batches + legacy harvest)', () => {
        expect(REGISTERED_GATE_ARGS.filter((p) => p === 'HARVEST_RECORD')).toHaveLength(2);
    });

    it('registers UNIT_MANAGE nowhere — the four per-plant routes it gated are gone', () => {
        // Asserted as ZERO rather than deleted outright: this is the pin that a
        // re-added plant-units route would trip. Spec R8 (2026-08-25).
        expect(REGISTERED_GATE_ARGS.filter((p) => p === 'UNIT_MANAGE')).toHaveLength(0);
    });

    it('registers QR_GENERATE once (plot-qrs/generate)', () => {
        expect(REGISTERED_GATE_ARGS.filter((p) => p === 'QR_GENERATE')).toHaveLength(1);
    });

    it('registers the per-type activity resolver for POST /:id/activities', () => {
        // the resolver function itself is passed through from the service
        expect(REGISTERED_GATE_ARGS.some((a) => typeof a === 'function')).toBe(true);
    });
});

describe('Wave B chunk 4 — POST / (cycle create) asserts CYCLE_CREATE', () => {
    let app;
    beforeAll(() => { app = buildApp(); });
    beforeEach(() => {
        mockAssertFarmPermission.mockClear();
        mockVerifyOwnedFarm.mockReset();
    });

    const CREATE_BODY = {
        farmId: 'farm-1',
        plantSpeciesId: 'sp-1',
        cycleName: 'Cycle A',
        startDate: '2026-01-01',
        plotId: 'plot-1',
    };

    it('allowed → 201, assertFarmPermission called with CYCLE_CREATE', async () => {
        mockVerifyOwnedFarm.mockResolvedValue({ id: 'farm-1' });
        mockAssertFarmPermission.mockResolvedValue({ allowed: true });

        const response = await request(app).post('/api/planting-cycles').send(CREATE_BODY);

        expect(response.status).toBe(201);
        expect(mockAssertFarmPermission).toHaveBeenCalledWith(expect.objectContaining({
            farmId: 'farm-1',
            userId: 'worker-1',
            permission: 'CYCLE_CREATE',
        }));
    });

    it('denied → 403 ENTITY_PERMISSION_DENIED naming the permission', async () => {
        mockVerifyOwnedFarm.mockResolvedValue({ id: 'farm-1' });
        const err = new Error('denied');
        err.code = 'ENTITY_PERMISSION_DENIED';
        err.statusCode = 403;
        err.permission = 'CYCLE_CREATE';
        mockAssertFarmPermission.mockRejectedValue(err);

        const response = await request(app).post('/api/planting-cycles').send(CREATE_BODY);

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(response.body.permission).toBe('CYCLE_CREATE');
    });
});
