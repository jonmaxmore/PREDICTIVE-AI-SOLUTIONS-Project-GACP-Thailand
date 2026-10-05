/**
 * V3-D RBAC matrix — AUDITOR permission contract on
 * `/api/audit/onsite/*` (apps/backend/routes/api/audit/onsite.js).
 *
 * Why this test exists:
 *   - Loop V Iter 3 audited the AUDITOR surface end-to-end and discovered
 *     the entire `audit/onsite` router was historically un-mounted (DI-1)
 *     AND had ZERO route × role RBAC coverage. After V3-A wires the router
 *     in `routes/api/index.js`, this matrix asserts the actual permission
 *     contract per route × role so the gate cannot regress silently.
 *   - The route file uses a TWO-LAYER gate:
 *       1. file-level `requireRole(ROLE_GROUPS.AUDIT_STAFF)` (admin,
 *          document_reviewer, auditor, scheduler)
 *       2. per-route narrow `requireRole(ROLE_GROUPS.AUDITORS)` (admin,
 *          auditor)
 *     So document_reviewer + scheduler pass the file-level gate but fail
 *     the per-route AUDITORS gate; account_* + health fail BOTH; anonymous
 *     fails at `authenticateProvider` with 401.
 *   - V3-D pattern: per-route × per-role assertion matrix asserting both
 *     the HTTP status AND that the service-layer side-effect did NOT fire.
 *
 * Coverage per RFC §V3-D / RB-2 — 5 routes:
 *   - POST /api/audit/onsite/:auditId/start
 *   - POST /api/audit/onsite/:auditId/checklist
 *   - POST /api/audit/onsite/:auditId/photo (multipart — uses memoryStorage)
 *   - GET  /api/audit/onsite/:auditId/gps-verify
 *   - POST /api/audit/onsite/:auditId/decision
 *
 * NOTE: this test file works AFTER V3-A wires `audit/onsite` into the
 * route index. It mounts the router file directly under supertest, so the
 * RBAC contract is provable even if the prod mount line has not yet been
 * added — the router exports the same Express.Router() either way.
 *
 * See: docs/handoffs/iter-V3/00-rfc.md §V3-D / RB-2.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock (I-008: expose every helper the SUT imports) ──────────────────
// onsite.js uses `authenticateProvider` + `requireRole(ROLE_GROUPS.X)`.
// The auth mock attaches req.user from x-test-role headers. requireRole
// MUST be the REAL implementation so the test proves the canonical
// AUDIT_STAFF + AUDITORS contract, not a mock.
jest.mock('../../middleware/auth-middleware', () => {
    const real = jest.requireActual('../../middleware/auth-middleware');
    const buildHeaderUser = (req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'user-1',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            healthId: role === 'health' ? (req.headers['x-test-health-id'] || 'health-1') : null,
            providerId: role !== 'health' ? (req.headers['x-test-provider-id'] || 'provider-1') : null,
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
        };
        return next();
    };
    const buildHealthOnly = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        if (role !== 'health') {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'HEALTH role required',
            });
        }
        return buildHeaderUser(req, res, next);
    };
    return {
        ...real,
        authenticateHealth: buildHealthOnly,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticate: buildHealthOnly,
        // requireRole REAL — exercises the canonical role-set contract.
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

// ── Service-layer mocks (I-008) ─────────────────────────────────────────────
// audit-onsite-service: 4 lifecycle methods + 1 GPS verifier. The route
// is a thin adapter so we mock every method the route imports. Positive
// path returns a stub body; negative path asserts not-called.
const mockStartInspection = jest.fn();
const mockSubmitChecklistItem = jest.fn();
const mockUploadPhoto = jest.fn();
const mockVerifyGpsAgainstFarm = jest.fn();
const mockSubmitDecision = jest.fn();

jest.mock('../../services/audit-onsite-service', () => ({
    startInspection: (...args) => mockStartInspection(...args),
    submitChecklistItem: (...args) => mockSubmitChecklistItem(...args),
    uploadPhoto: (...args) => mockUploadPhoto(...args),
    verifyGpsAgainstFarm: (...args) => mockVerifyGpsAgainstFarm(...args),
    submitDecision: (...args) => mockSubmitDecision(...args),
    // Constants are read at module load time; provide stubs.
    DECISIONS: { PASS: 'PASS', FAIL: 'FAIL', NEEDS_REVIEW: 'NEEDS_REVIEW' },
    ALL_DECISIONS: ['PASS', 'FAIL', 'NEEDS_REVIEW'],
    DEFAULT_GPS_TOLERANCE_M: 500,
    DEFAULT_MIN_PHOTOS: 5,
    CHECKLIST_TEMPLATE_2026: [],
    TEMPLATE_VERSION: '2026-05',
    haversineDistanceMeters: jest.fn(() => 0),
    computePhotoHash: jest.fn(() => 'hash'),
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

function seedHappyPath() {
    mockStartInspection.mockResolvedValue({
        audit: { id: 'aud-1', status: 'IN_PROGRESS', auditorId: 'user-1' },
        gpsLog: { id: 'gps-1' },
        checklistTemplate: [],
        templateVersion: '2026-05',
    });
    mockSubmitChecklistItem.mockResolvedValue({ id: 'item-1' });
    mockUploadPhoto.mockResolvedValue({
        photoId: 'photo-1',
        fileHash: 'hash',
        attachmentId: 'att-1',
    });
    mockVerifyGpsAgainstFarm.mockResolvedValue({
        withinTolerance: true,
        distanceMeters: 0,
        farmLatitude: 13.0,
        farmLongitude: 100.0,
    });
    mockSubmitDecision.mockResolvedValue({
        audit: { id: 'aud-1', status: 'COMPLETED' },
        application: { id: 'app-1', status: 'AUDIT_PASSED' },
    });
}

const onsiteRouter = require('../../routes/api/audit/onsite');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/audit/onsite', onsiteRouter);
    return app;
}

// ── Role groupings per RFC §RB-2 ────────────────────────────────────────────
// AUDIT_STAFF (file-level gate): admin, document_reviewer, auditor, scheduler.
// AUDITORS (per-route gate): auditor only — admin REMOVED 2026-06-24 (AUDIT-001: SoD).
//
// Therefore:
//   - auditor passes BOTH → positive
//   - admin + document_reviewer + scheduler pass file-level, fail per-route → 403
//   - account_dtam + account_platform + account + health fail file-level → 403
//   - HEALTH passes authenticateProvider via the mock (the mock doesn't
//     enforce provider-vs-health, only anon = 401). Real prod
//     authenticateProvider would reject HEALTH at JWT decode; the mock
//     defers that to requireRole. requireRole(AUDIT_STAFF) rejects HEALTH
//     so the end result (403) is still right.
//   - anonymous → 401 from authenticateProvider mock.

const POSITIVE_ROLES = ['field_inspector'];

// Roles in AUDIT_STAFF but NOT AUDITORS (file gate passes, route gate
// rejects). All produce 403 with FORBIDDEN_ROLE. AUDIT-001 (2026-06-24):
// admin was REMOVED from ROLE_GROUPS.AUDITORS (SoD — admin is not in the audit
// decision path), so admin passes the file-level AUDIT_STAFF gate but is now
// rejected by the per-route AUDITORS gate.
const AUDIT_STAFF_NOT_AUDITORS = ['system_admin_dtam', 'document_reviewer', 'dispatcher'];

// Roles NOT in AUDIT_STAFF (file gate rejects). All produce 403.
const NOT_AUDIT_STAFF = [
    'finance_officer_dtam',
    'finance_officer_platform',
    'finance_officer_platform',
    'health',
];

// All negative roles combined.
const NEGATIVE_ROLES = [...AUDIT_STAFF_NOT_AUDITORS, ...NOT_AUDIT_STAFF];

// ── Routes under test ──────────────────────────────────────────────────────

const ONSITE_ROUTES = [
    {
        label: 'POST /api/audit/onsite/:auditId/start',
        method: 'post',
        path: '/api/audit/onsite/aud-1/start',
        body: { gpsLat: 13.0, gpsLng: 100.0, gpsAccuracy: 5 },
        sideEffectMock: () => mockStartInspection,
    },
    {
        label: 'POST /api/audit/onsite/:auditId/checklist',
        method: 'post',
        path: '/api/audit/onsite/aud-1/checklist',
        body: {
            items: [{ itemCode: 'FARM_BOUNDARY', response: 'YES', notes: 'ok' }],
        },
        sideEffectMock: () => mockSubmitChecklistItem,
    },
    {
        label: 'GET /api/audit/onsite/:auditId/gps-verify',
        method: 'get',
        path: '/api/audit/onsite/aud-1/gps-verify?lat=13.0&lng=100.0',
        body: undefined,
        sideEffectMock: () => mockVerifyGpsAgainstFarm,
    },
    {
        label: 'POST /api/audit/onsite/:auditId/decision',
        method: 'post',
        path: '/api/audit/onsite/aud-1/decision',
        body: { decision: 'PASS', summary: 'ok', criticalFindings: [] },
        sideEffectMock: () => mockSubmitDecision,
    },
];

describe('V3-D /api/audit/onsite/* — AUDIT_STAFF file gate + AUDITORS per-route gate', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    describe.each(ONSITE_ROUTES)('$label', ({ method, path, body, sideEffectMock }) => {
        test.each(NEGATIVE_ROLES)('%s role gets 403 (role gate)', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());

            // requireRole throws AuthorizationError (statusCode = 403),
            // which Express's default error handler surfaces as 403.
            expect(response.status).toBe(403);
            // I-008 load-bearing: service-layer side-effect MUST NOT fire
            // on a 403 — the role gate sits before the service call.
            expect(sideEffectMock()).not.toHaveBeenCalled();
        });

        test.each(POSITIVE_ROLES)('%s role bypasses both role gates', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());
            // Any non-403 / non-401 means both gates let the request
            // through. Downstream may 200/400/404/422 depending on body.
            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
        });
    });

    describe('anonymous (no token) — authenticateProvider rejects', () => {
        test.each(ONSITE_ROUTES)('$label returns 401 without a token', async ({ method, path, body }) => {
            const req = request(app)[method](path);
            const response = await (body !== undefined ? req.send(body) : req.send());
            expect(response.status).toBe(401);
        });
    });
});

// ── POST /photo — multipart route gets its own block ────────────────────────
// multer may swallow the request body in a way that confuses the role-gate
// matrix, so we cover it explicitly without the body to assert the gate
// fires for non-AUDITORS regardless of whether a file is attached.

describe('V3-D POST /api/audit/onsite/:auditId/photo — AUDITORS gate', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test.each(NEGATIVE_ROLES)('%s role gets 403 even with empty body', async (role) => {
        const response = await request(app)
            .post('/api/audit/onsite/aud-1/photo')
            .set('x-test-role', role);

        expect(response.status).toBe(403);
        expect(mockUploadPhoto).not.toHaveBeenCalled();
    });

    test.each(POSITIVE_ROLES)('%s role bypasses the gate (may 400 on missing file)', async (role) => {
        const response = await request(app)
            .post('/api/audit/onsite/aud-1/photo')
            .set('x-test-role', role);
        // The gate lets the request through; multer returns 400 because
        // no file is attached — that's expected and proves the role gate
        // was not the rejection cause.
        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
    });

    test('anonymous returns 401', async () => {
        const response = await request(app).post('/api/audit/onsite/aud-1/photo');
        expect(response.status).toBe(401);
    });
});
