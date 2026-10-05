/**
 * HD-cultivation info-disclosure hardening — planting-cycle routes.
 *
 * The 5xx catch blocks in planting-cycles.js + its unit-plot/activity-harvest
 * sub-routers previously returned `error.message` verbatim, e.g.
 *   res.status(500).json({ success: false, error: error.message || 'Failed …' })
 * That leaks ORM/stack/path internals to the client (information disclosure).
 *
 * They now route the message through the shared `safeErrorMessage(error, fallback)`
 * sanitiser (same helper already used by sibling harvest-batches.js / lots.js).
 * This regression test proves:
 *   1. an internal error (Prisma/stack/path style) NO LONGER appears in the
 *      500 body — the generic fallback is returned instead;
 *   2. the 500 status + `{ success:false, error:<string> }` shape are preserved;
 *   3. a safe/allowlisted message (e.g. "not found") still passes through.
 *
 * Pattern mirrors certificates-route-rbac.test.js (header-driven auth mock +
 * mocked service layer; prisma-database stubbed so the suite runs without a DB).
 */

const express = require('express');
const request = require('supertest');

// prisma-database does process.exit(1) without DATABASE_URL — stub it so the
// route module (and the services it pulls) can be required on any machine.
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

// Auth mock — authenticateHealth sets req.user from a header.
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { id: req.headers['x-test-user-id'] || 'user-1', healthId: 'health-1' };
        return next();
    },
}));

// Service mocks. The router + both sub-route registrars require these at module
// load; planting-cycle-service additionally supplies getAuthenticatedUserId,
// verifyOwnedFarm, ensureCycleOwned, createHarvestBatches.
const mockCreateCycle = jest.fn();
const mockCreateHarvestBatches = jest.fn();

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
    // verifyOwnedFarm resolves truthy so POST / reaches createCycle (the catch under test).
    verifyOwnedFarm: jest.fn().mockResolvedValue({ id: 'farm-1' }),
    buildCycleIntegrity: jest.fn(),
    generatePlotCycleQrsForCycle: jest.fn(),
    // ensureCycleOwned passes through so POST /:id/harvest-batches reaches the handler.
    ensureCycleOwned: (req, _res, next) => next(),
    // Wave B — gated mutation routes front with read-shaped reachability and
    // register per-permission gates at require time; pass both through (the
    // permission engine has its own suites).
    ensureCycleReachable: (req, _res, next) => next(),
    requireCycleFarmPermission: () => (_req, _res, next) => next(),
    resolveActivityPermission: jest.fn(),
    assertFarmPermission: jest.fn().mockResolvedValue({ allowed: true }),
    createHarvestBatches: (...args) => mockCreateHarvestBatches(...args),
    getCapacitySummary: jest.fn(),
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

// A message that looks like an internal leak — contains an UNSAFE indicator
// (".js:" stack frame + prisma) so safeErrorMessage MUST replace it.
const LEAKY_MESSAGE =
    'Invalid `prisma.plantingCycle.create()` invocation in /app/services/planting-service.js:42:13';

describe('HD-cultivation — planting-cycle 5xx error sanitization', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('POST / — internal error message is NOT leaked in the 500 body', async () => {
        mockCreateCycle.mockRejectedValue(new Error(LEAKY_MESSAGE));

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

        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        // The raw ORM/stack/path internals must NOT reach the client.
        expect(response.body.error).not.toContain('prisma');
        expect(response.body.error).not.toContain('.js:');
        expect(response.body.error).not.toContain('/app/');
        // Falls back to the caller-supplied generic message.
        expect(response.body.error).toBe('Failed to create planting cycle');
    });

    test('POST /:id/harvest-batches — internal error message is NOT leaked in the 500 body', async () => {
        mockCreateHarvestBatches.mockRejectedValue(new Error(LEAKY_MESSAGE));

        const response = await request(app)
            .post('/api/planting-cycles/cycle-1/harvest-batches')
            .set('x-test-user-id', 'user-1')
            .send({});

        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        expect(response.body.error).not.toContain('prisma');
        expect(response.body.error).not.toContain('.js:');
        expect(response.body.error).toBe('Failed to create harvest batches');
    });

    test('POST / — an allowlisted (safe) message still passes through unchanged', async () => {
        // "not found" is on the SAFE allowlist with no unsafe indicators, so
        // safeErrorMessage returns it verbatim — sanitisation is not blanket.
        mockCreateCycle.mockRejectedValue(new Error('Plant species not found'));

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

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Plant species not found');
    });
});
