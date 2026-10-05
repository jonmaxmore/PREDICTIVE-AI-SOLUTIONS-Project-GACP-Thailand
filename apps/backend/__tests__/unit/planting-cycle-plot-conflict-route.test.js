/**
 * R15 at the HTTP door: a plot that already carries an open cycle answers 409, not 500.
 *
 * The service is where the rule is enforced (services/planting-service.js:95) so every door
 * inherits it. This file pins what the farmer's browser actually receives:
 *   - 409 CONFLICT, so a client can tell "that ground is taken" from a server fault (500) or
 *     a malformed body (400);
 *   - the machine-readable `code`, so the UI can act without string-matching Thai;
 *   - the Thai sentence itself, which names the plot and the cycle in the way. Without the
 *     explicit branch, safeErrorMessage would replace it with "Failed to create planting
 *     cycle" — a message that tells the farmer nothing about what to close.
 *
 * Harness mirrors planting-cycle-error-sanitization.test.js (header-driven auth mock +
 * mocked service layer; prisma-database stubbed so the suite runs without a DB).
 */

'use strict';

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
const mockUpdateCycle = jest.fn();

jest.mock('../../services/planting-service', () => ({
    listByOwner: jest.fn().mockResolvedValue([]),
    listByFarm: jest.fn().mockResolvedValue([]),
    getById: jest.fn(),
    createCycle: (...args) => mockCreateCycle(...args),
    updateCycle: (...args) => mockUpdateCycle(...args),
}));

jest.mock('../../services/qrcode/qrcode-service', () => ({
    generateForRecord: jest.fn(),
    generateQRCodeId: jest.fn(),
}));

jest.mock('../../services/planting-cycle-service', () => ({
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

const plantingCyclesRouter = require('../../routes/api/cultivation/planting-cycles');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/planting-cycles', plantingCyclesRouter);
    return app;
}

// The exact object services/planting-service.js:88-100 throws.
function r15Conflict() {
    const error = new Error(
        'พื้นที่ปลูก "PLOT-BEJAD-M4SR7" มีรอบปลูกที่ยังเปิดอยู่คือ "รอบที่ 1/2569" '
        + 'คุณต้องปิดรอบเดิมโดยบันทึกการเก็บเกี่ยวก่อน จึงจะเริ่มรอบใหม่ในพื้นที่นี้ได้',
    );
    error.code = 'PLOT_ALREADY_HAS_OPEN_CYCLE';
    error.statusCode = 409;
    error.plotId = 'plot-bejad';
    error.conflictingCycleId = 'cycle-open-1';
    return error;
}

const CREATE_BODY = {
    farmId: 'farm-1',
    plantSpeciesId: 'sp-1',
    cycleName: 'รอบที่ 2/2569',
    startDate: '2026-08-25',
    plotId: 'plot-bejad',
};

describe('R15 — the planting-cycle routes answer 409 on an occupied plot', () => {
    let app;

    beforeAll(() => { app = buildApp(); });
    beforeEach(() => { jest.clearAllMocks(); });

    test('POST / — 409 with the code, the plot and the blocking cycle', async () => {
        mockCreateCycle.mockRejectedValue(r15Conflict());

        const response = await request(app)
            .post('/api/planting-cycles')
            .set('x-test-user-id', 'user-1')
            .send(CREATE_BODY);

        expect(response.status).toBe(409);
        expect(response.body.success).toBe(false);
        expect(response.body.code).toBe('PLOT_ALREADY_HAS_OPEN_CYCLE');
        expect(response.body.plotId).toBe('plot-bejad');
        expect(response.body.conflictingCycleId).toBe('cycle-open-1');
        expect(response.body.error).toContain('PLOT-BEJAD-M4SR7');
        expect(response.body.error).toContain('รอบที่ 1/2569');
    });

    test('PATCH /:id — re-plotting onto occupied ground answers 409, not the generic 400', async () => {
        mockUpdateCycle.mockRejectedValue(r15Conflict());

        const response = await request(app)
            .patch('/api/planting-cycles/cycle-mine')
            .set('x-test-user-id', 'user-1')
            .send({ plotAssignments: [{ plotId: 'plot-bejad', allocatedAreaSqm: 500, plannedPlantCount: 100 }] });

        expect(response.status).toBe(409);
        expect(response.body.code).toBe('PLOT_ALREADY_HAS_OPEN_CYCLE');
        expect(response.body.conflictingCycleId).toBe('cycle-open-1');
    });

    test('an unrelated failure still takes the old path (500, sanitised) — the branch is not a catch-all', async () => {
        mockCreateCycle.mockRejectedValue(new Error('Invalid `prisma.plantingCycle.create()` invocation in /app/x.js:1:1'));

        const response = await request(app)
            .post('/api/planting-cycles')
            .set('x-test-user-id', 'user-1')
            .send(CREATE_BODY);

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to create planting cycle');
    });
});
