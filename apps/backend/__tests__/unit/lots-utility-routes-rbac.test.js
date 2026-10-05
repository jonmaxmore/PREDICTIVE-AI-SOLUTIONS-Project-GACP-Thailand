/**
 * X1-FIX-A / C-4 RBAC regression — `/api/lots/:id/print`, `/:id/qr`,
 * `/:id/qr/print`, and `/batch/:batchId` MUST now require auth and reject
 * cross-tenant access with a 404 (anti-enumeration per T-014 / PR-02).
 *
 * Why this test exists:
 *   - Pre-X1, registerLotUtilityRoutes (apps/backend/routes/api/helpers/
 *     lots-utility-routes.js) mounted four routes on `/api/lots` with
 *     NO authenticateHealth and NO ownership filter. Any anonymous caller
 *     could (a) flip a lot's print-lock + (b) exfiltrate the lot's QR
 *     payload + (c) read the lot's farm name / province / packaging.
 *     X1-D §4 H-1 flagged this hole and X1-D §5 corroborated it.
 *   - The fix wires authenticateHealth + a farm-ownership probe (matching
 *     the pattern in lots.js:286-309 + lots-label-routes.js:13-44).
 *   - This file locks the post-fix invariants:
 *       1. Anonymous request → 401 Unauthorized.
 *       2. HEALTH user A → 404 on HEALTH user B's lot/batch
 *          (same shape as "does not exist" — anti-enumeration).
 *       3. HEALTH user → 200 on their own lot/batch (positive control).
 *
 * Pattern mirrors `applications-review-rbac.test.js`: stub the auth
 * middleware via x-test-* headers, mock the service layer so the
 * positive case returns deterministic rows, then assert per-role status.
 *
 * See: docs/handoffs/iter-X1/X1-D.md §4 H-1 + §5 (last row).
 */

const express = require('express');
const request = require('supertest');

// ── Mocks ────────────────────────────────────────────────────────────────

// I-008: every helper the SUT imports must be exposed. The utility-routes
// registrar imports the safeErrorMessage helper + the traceabilityService;
// both are mocked below.
jest.mock('../../shared/api-response', () => ({
    safeErrorMessage: (err) => (err && err.message) || 'unknown',
}));

// All 6 service-layer touch points the registrar calls. Each test
// resets the impl via mockImplementationOnce so we can drive
// per-case behaviour (found vs not-found, owned vs cross-tenant).
const mockFindLotDetailById = jest.fn();
const mockFindLotForPrintCheck = jest.fn();
const mockMarkLotAsPrinted = jest.fn();
const mockFindLotQrPayload = jest.fn();
const mockFindLotPrintLabelPayload = jest.fn();
const mockFindHarvestBatchFarmId = jest.fn();
const mockListLotsByBatchId = jest.fn();
jest.mock('../../services/traceability-service', () => ({
    findLotDetailById: (...args) => mockFindLotDetailById(...args),
    findLotForPrintCheck: (...args) => mockFindLotForPrintCheck(...args),
    markLotAsPrinted: (...args) => mockMarkLotAsPrinted(...args),
    findLotQrPayload: (...args) => mockFindLotQrPayload(...args),
    findLotPrintLabelPayload: (...args) => mockFindLotPrintLabelPayload(...args),
    findHarvestBatchFarmId: (...args) => mockFindHarvestBatchFarmId(...args),
    listLotsByBatchId: (...args) => mockListLotsByBatchId(...args),
}));

const { registerLotUtilityRoutes } = require('../../routes/api/helpers/lots-utility-routes');

/**
 * Stub the qrcode service so the PNG / data-URL paths don't try to read
 * fonts off disk.
 */
const qrcodeStub = {
    generateBuffer: jest.fn(async () => Buffer.from('qr-png-bytes')),
    generateDataUrl: jest.fn(async () => 'data:image/png;base64,QR'),
    generatePublicTraceUrl: (path) => `https://verify.example.test/${path}`,
};

const loggerStub = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

/**
 * Auth-middleware stub mirroring the pattern in
 * `applications-review-rbac.test.js`. A missing or 'anonymous' role
 * returns 401 so we can assert that the unauthenticated branch never
 * reaches the handler.
 */
function authenticateHealthStub(req, res, next) {
    const role = req.headers['x-test-role'];
    if (!role || role === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = {
        id: req.headers['x-test-user-id'] || 'user-1',
        role,
        canonicalRole: role,
        healthId: req.headers['x-test-health-id'] || 'health-1',
    };
    return next();
}

/**
 * Farm-ownership helper stub. Each test sets which farmIds the user owns
 * via the x-test-farm-ids header (comma-separated). The stub closes over
 * the request scope by reading the most recently set fixture below — the
 * tests reset `currentOwnedFarmIds` per case.
 */
let currentOwnedFarmIds = [];
async function getUserFarmIdsStub() {
    return currentOwnedFarmIds;
}

function buildApp() {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerLotUtilityRoutes({
        router,
        prisma: {},
        qrcodeService: qrcodeStub,
        authenticateHealth: authenticateHealthStub,
        getUserFarmIds: getUserFarmIdsStub,
        logger: loggerStub,
    });
    app.use('/api/lots', router);
    return app;
}

describe('[X1-FIX-A / C-4] lots-utility-routes RBAC', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        currentOwnedFarmIds = [];
    });

    // ── Surface — every route in the registrar. Keeping the table here so
    // a future route added without auth would have to be explicitly
    // listed in NEW negative cases. ──────────────────────────────────────
    const ROUTES = [
        { method: 'post', path: '/api/lots/lot-1/print', label: 'POST /lots/:id/print' },
        { method: 'get', path: '/api/lots/lot-1/qr', label: 'GET /lots/:id/qr' },
        { method: 'get', path: '/api/lots/lot-1/qr/print', label: 'GET /lots/:id/qr/print' },
        { method: 'get', path: '/api/lots/batch/batch-1', label: 'GET /lots/batch/:batchId' },
    ];

    describe.each(ROUTES)('$label', ({ method, path }) => {
        test('anonymous (no role header) returns 401', async () => {
            const response = await request(app)[method](path).send();
            expect(response.status).toBe(401);
            expect(response.body).toMatchObject({
                success: false,
                error: 'Unauthorized',
            });
            // The handler must short-circuit BEFORE any service call
            // — otherwise we did the work and only the response code is
            // honest (silent privilege escalation surface).
            expect(mockFindLotDetailById).not.toHaveBeenCalled();
            expect(mockFindHarvestBatchFarmId).not.toHaveBeenCalled();
            expect(mockMarkLotAsPrinted).not.toHaveBeenCalled();
        });
    });

    describe('cross-tenant access (HEALTH user A → HEALTH user B\'s lot)', () => {
        // Same physical lot id, owned by farm-B; user A owns only farm-A.
        const OTHER_USERS_LOT = {
            id: 'lot-1',
            lotNumber: 'LOT-2026-0001',
            batch: { farmId: 'farm-B' },
        };
        const OTHER_USERS_BATCH = { farmId: 'farm-B' };

        beforeEach(() => {
            currentOwnedFarmIds = ['farm-A']; // user A's farms only
        });

        test('POST /lots/:id/print returns 404 (not 403) for cross-tenant', async () => {
            mockFindLotDetailById.mockResolvedValueOnce(OTHER_USERS_LOT);
            const response = await request(app)
                .post('/api/lots/lot-1/print')
                .set('x-test-role', 'health')
                .set('x-test-user-id', 'user-A')
                .send();
            // 404 (not 403) so cross-tenant attempts are indistinguishable
            // from "lot does not exist" — anti-enumeration per T-014.
            expect(response.status).toBe(404);
            // Critically: the print-mark MUST NOT have run.
            expect(mockMarkLotAsPrinted).not.toHaveBeenCalled();
            expect(mockFindLotForPrintCheck).not.toHaveBeenCalled();
        });

        test('GET /lots/:id/qr returns 404 for cross-tenant', async () => {
            mockFindLotDetailById.mockResolvedValueOnce(OTHER_USERS_LOT);
            const response = await request(app)
                .get('/api/lots/lot-1/qr')
                .set('x-test-role', 'health')
                .set('x-test-user-id', 'user-A')
                .send();
            expect(response.status).toBe(404);
            // The QR payload MUST NOT have been fetched or rendered.
            expect(mockFindLotQrPayload).not.toHaveBeenCalled();
            expect(qrcodeStub.generateBuffer).not.toHaveBeenCalled();
        });

        test('GET /lots/:id/qr/print returns 404 for cross-tenant', async () => {
            mockFindLotPrintLabelPayload.mockResolvedValueOnce({
                ...OTHER_USERS_LOT,
                packageType: 'BOX',
                unitWeight: 1.0,
                batch: {
                    farmId: 'farm-B',
                    farm: { farmName: 'B Farm', farmNameTH: 'ฟาร์มบี', province: 'เชียงใหม่' },
                    plant: { nameTH: 'กัญชา' },
                    harvestDate: '2026-01-01',
                },
            });
            const response = await request(app)
                .get('/api/lots/lot-1/qr/print')
                .set('x-test-role', 'health')
                .set('x-test-user-id', 'user-A')
                .send();
            expect(response.status).toBe(404);
            // The label-render MUST NOT have run — the leak the X1-D §4
            // H-1 finding called out is the farmName/province payload.
            expect(qrcodeStub.generateDataUrl).not.toHaveBeenCalled();
        });

        test('GET /lots/batch/:batchId returns 404 for cross-tenant', async () => {
            mockFindHarvestBatchFarmId.mockResolvedValueOnce(OTHER_USERS_BATCH);
            const response = await request(app)
                .get('/api/lots/batch/batch-1')
                .set('x-test-role', 'health')
                .set('x-test-user-id', 'user-A')
                .send();
            expect(response.status).toBe(404);
            // The listing MUST NOT have run.
            expect(mockListLotsByBatchId).not.toHaveBeenCalled();
        });
    });

    describe('owner happy path — HEALTH user reaches their own lot/batch', () => {
        // Same lot id, owned by farm-A; user A owns farm-A.
        const OWN_LOT = {
            id: 'lot-1',
            lotNumber: 'LOT-2026-0001',
            batch: { farmId: 'farm-A' },
        };

        beforeEach(() => {
            currentOwnedFarmIds = ['farm-A'];
        });

        test('POST /lots/:id/print marks the lot when caller owns the farm', async () => {
            mockFindLotDetailById.mockResolvedValueOnce(OWN_LOT);
            mockFindLotForPrintCheck.mockResolvedValueOnce({ printedAt: null });
            mockMarkLotAsPrinted.mockResolvedValueOnce({
                lotNumber: 'LOT-2026-0001',
                printedAt: new Date('2026-05-18T10:00:00.000Z'),
            });
            const response = await request(app)
                .post('/api/lots/lot-1/print')
                .set('x-test-role', 'health')
                .set('x-test-user-id', 'user-A')
                .send();
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(mockMarkLotAsPrinted).toHaveBeenCalledWith('lot-1');
        });

        test('GET /lots/batch/:batchId lists lots when caller owns the batch', async () => {
            mockFindHarvestBatchFarmId.mockResolvedValueOnce({ farmId: 'farm-A' });
            mockListLotsByBatchId.mockResolvedValueOnce([
                { id: 'lot-1', lotNumber: 'LOT-2026-0001' },
                { id: 'lot-2', lotNumber: 'LOT-2026-0002' },
            ]);
            const response = await request(app)
                .get('/api/lots/batch/batch-1')
                .set('x-test-role', 'health')
                .set('x-test-user-id', 'user-A')
                .send();
            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({ success: true, count: 2 });
        });
    });
});
