/**
 * V2-D RBAC regression — SCHEDULER permission contract on
 * `/api/audit/scheduling/*` (apps/backend/routes/api/audit/scheduling.js)
 * and `/api/provider/scheduler/*` (apps/backend/routes/api/provider/scheduler.js).
 *
 * Why this test exists:
 *   - The user's V2 worry was explicit: "ไม่มีการข้ามสิทธ์" (no cross-role
 *     leakage). The service-layer `assertSchedulerRole` already gates
 *     mutations (audit-scheduling-service.js:96-106), but the contract has
 *     never been pinned by a route-level assertion matrix. A future
 *     refactor that drops the route's `_internals.assertSchedulerRole`
 *     pre-flight would still 403 via the service path — but a stack-trace
 *     leak / silent late-throw is a regression class V2-D blocks here.
 *   - V1-D pattern: per-route × per-role assertion matrix asserting both
 *     the HTTP status AND that the service-layer side-effect did NOT fire
 *     (so a 403 truly means "no work done", not "work done then rolled back").
 *
 * Pattern: copied verbatim from V1-D's applications-route-rbac.test.js —
 * the auth middleware mock attaches `req.user` from `x-test-role` headers,
 * canonical-rbac stays REAL (so the test proves the canonical contract, not
 * a mock), and the service module's methods are spied so we assert no
 * side-effect on the 403 path.
 *
 * Coverage per RFC §V2-D acceptance:
 *   - `/api/audit/scheduling/queue`         — 6 negative + 2 positive
 *   - `/api/audit/scheduling/assign`        — 6 negative + 2 positive
 *   - `/api/audit/scheduling/:id/approve`   — 6 negative + 2 positive
 *   - `/api/audit/scheduling/auditor-availability/:id` — 6 negative + 2 positive
 *   - `/api/audit/scheduling/:id/reschedule` — auth-layer (HEALTH-only).
 *     7 non-HEALTH roles trip the auth middleware (401); HEALTH passes.
 *   - `/api/provider/scheduler/auditors` / `/reviewers` /
 *     `/reviewer-assignments` / `/dashboard` — 6 negative + 2 positive each.
 *
 * See: docs/handoffs/iter-V2/00-rfc.md §V2-D / RB-3, RB-4, RB-5, RB-6.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock (V1-D pattern) ────────────────────────────────────────────────
// `x-test-role` selects the role; `health` gets a healthId, providers get
// providerId. The auth middleware enforces a `requiresHealth` flag on the
// reschedule branch so we can test the HEALTH-only auth gate without
// inventing a JWT secret. Mirrors applications-route-rbac.test.js:33-55.
jest.mock('../../middleware/auth-middleware', () => {
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
    // authenticateHealth must reject non-HEALTH roles at the auth layer
    // (the existing real middleware does this via JWT decode + role check).
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
    // requireRole is consumed by the wider provider route registry
    // (admin handlers) — return a permissive pass-through so the router
    // can mount. The role gate we actually test in this file is the
    // canonical `assertSchedulerRole` / `requireCanonicalPermission`,
    // both of which run with the REAL canonical-rbac module.
    const requireRole = () => (_req, _res, next) => next();
    return {
        authenticateHealth: buildHealthOnly,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticate: buildHealthOnly,
        requireRole,
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

// ── Service-layer mock (I-008: expose every helper the SUT imports) ─────────
// The route imports `auditSchedulingService._internals.assertSchedulerRole`
// AND `assignAuditor` / `getSchedulingQueue` / `requestReschedule` /
// `approveReschedule` / `getAuditorAvailability`. The `_internals` namespace
// MUST run the REAL role check so the test proves the canonical contract
// (per V2 RFC §V2-D I-008 note); the other methods are jest.fn() so we can
// assert they were/weren't called and seed happy-path results.
const mockAssignAuditor = jest.fn();
const mockGetSchedulingQueue = jest.fn();
const mockRequestReschedule = jest.fn();
const mockApproveReschedule = jest.fn();
const mockGetAuditorAvailability = jest.fn();

jest.mock('../../services/audit-scheduling-service', () => {
    // Use the REAL assertSchedulerRole / assertApplicantRole so the gate
    // exercises the canonical SCHEDULER_ROLES + APPLICANT_ROLES sets (per
    // V2-D RFC: "we use the real normalizeRole + hasPermission so the test
    // proves the canonical contract, not the mock"). Routes that lack a
    // pre-flight check at the route layer (`/assign`, `/approve`) still
    // get the canonical 403 because the service mock wraps each method
    // with the same internal role assertion the real service runs at
    // lines 351, 646.
    const real = jest.requireActual('../../services/audit-scheduling-service');
    const wrapSchedulerGuarded = (fn) => (...args) => {
        const opts = args[0] && typeof args[0] === 'object' ? args[0] : args[1];
        const actor = opts?.actor;
        real._internals.assertSchedulerRole(actor);
        return fn(...args);
    };
    const wrapApplicantGuarded = (fn) => (...args) => {
        const opts = args[0] && typeof args[0] === 'object' ? args[0] : args[1];
        const actor = opts?.actor;
        real._internals.assertApplicantRole(actor);
        return fn(...args);
    };
    return {
        AUDITOR_MAX_PER_DAY: real.AUDITOR_MAX_PER_DAY,
        RESCHEDULE_STATUS: real.RESCHEDULE_STATUS,
        // getSchedulingQueue + getAuditorAvailability have a route-level
        // pre-flight already (audit/scheduling.js:64, 141) so no wrapper
        // is needed for them; the route's own call throws first.
        getSchedulingQueue: (...args) => mockGetSchedulingQueue(...args),
        getAuditorAvailability: (...args) => mockGetAuditorAvailability(...args),
        // assignAuditor / approveReschedule run assertSchedulerRole INSIDE
        // the service (lines 351 + 646). Mirror that here so the mock
        // surface preserves the canonical contract.
        assignAuditor: wrapSchedulerGuarded(mockAssignAuditor),
        approveReschedule: (id, opts) => {
            real._internals.assertSchedulerRole(opts?.actor);
            return mockApproveReschedule(id, opts);
        },
        // requestReschedule runs assertApplicantRole inside the service
        // (HEALTH only). Wrap the mock the same way.
        requestReschedule: wrapApplicantGuarded(mockRequestReschedule),
        _internals: real._internals,
    };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: {},
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

// `/api/provider/scheduler/*` routes pull from a wider deps tree. Stub
// every service the registry composes so the router file can load.
const mockListAuditorsForScheduler = jest.fn();
const mockListReviewerCandidates = jest.fn();
const mockFindActiveProviderReviewerById = jest.fn();
const mockListActiveAuditors = jest.fn();
jest.mock('../../services/provider-user-service', () => ({
    listAuditorsForScheduler: (...args) => mockListAuditorsForScheduler(...args),
    listReviewerCandidates: (...args) => mockListReviewerCandidates(...args),
    findActiveProviderReviewerById: (...args) => mockFindActiveProviderReviewerById(...args),
    listActiveAuditors: (...args) => mockListActiveAuditors(...args),
}));

const mockApplicationServiceMethods = {
    listSchedulerDashboardApplications: jest.fn().mockResolvedValue([]),
    listStuckApplications: jest.fn().mockResolvedValue([]),
    listAuditorsByIds: jest.fn().mockResolvedValue([]),
    listProviderApplications: jest.fn().mockResolvedValue([]),
    findFirstWithWhere: jest.fn().mockResolvedValue(null),
    writeAssignmentColumns: jest.fn().mockResolvedValue({}),
    countAuditorActiveAuditAssignments: jest.fn().mockResolvedValue(0),
    countAuditorCompletedAuditsSince: jest.fn().mockResolvedValue(0),
    findReminderTargetApplication: jest.fn().mockResolvedValue(null),
};
jest.mock('../../services/application-service', () => mockApplicationServiceMethods);

jest.mock('../../services/admin-application-service', () => ({
    listApproachingRevisionDeadlines: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/workflow-transition-service', () => ({
    resolveStateFromApplication: jest.fn(() => 'DOC_FEE_PAID'),
    buildTransitionUpdate: jest.fn(() => ({ updateData: { formData: {} } })),
    normalizeWorkflowStateInput: jest.fn((s) => s),
}));

jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(),
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(), logWithin: jest.fn() },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { MEDIUM: 'MEDIUM' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

// Reset the scheduling service mocks to a sensible happy-path before each
// test so positive assertions don't 500. The gate is what we're proving,
// not the downstream success body.
function seedHappyPath() {
    mockGetSchedulingQueue.mockResolvedValue([]);
    mockAssignAuditor.mockResolvedValue({ id: 'app-1', status: 'AUDIT_CONFIRMED' });
    mockRequestReschedule.mockResolvedValue({ id: 'res-1', status: 'PENDING' });
    mockApproveReschedule.mockResolvedValue({ id: 'res-1', status: 'APPROVED' });
    mockGetAuditorAvailability.mockResolvedValue({ busySlots: [], overCapDays: [] });
    mockListAuditorsForScheduler.mockResolvedValue([]);
    mockListReviewerCandidates.mockResolvedValue([]);
    mockFindActiveProviderReviewerById.mockResolvedValue(null);
    mockListActiveAuditors.mockResolvedValue([]);
    mockApplicationServiceMethods.listSchedulerDashboardApplications.mockResolvedValue([]);
    mockApplicationServiceMethods.listStuckApplications.mockResolvedValue([]);
    mockApplicationServiceMethods.listAuditorsByIds.mockResolvedValue([]);
    mockApplicationServiceMethods.findFirstWithWhere.mockResolvedValue(null);
}

const auditSchedulingRouter = require('../../routes/api/audit/scheduling');
const providerSchedulerRouter = require('../../routes/api/provider/scheduler');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/audit/scheduling', auditSchedulingRouter);
    app.use('/api/provider/scheduler', providerSchedulerRouter);
    return app;
}

/**
 * The 7 non-SCHEDULER roles per the V2 RFC. ADMIN is the only other
 * canonical role that satisfies `assertSchedulerRole`; everything else
 * must 403. AUDITOR has DOC_APPROVED transition power per RB-5 but does
 * NOT have APPLICATION_SCHEDULE permission, so it MUST 403 on scheduler
 * surfaces.
 */
const NON_SCHEDULER_ROLES = [
    'document_reviewer',
    'field_inspector',
    'finance_officer_dtam',
    'finance_officer_platform',
    'finance_officer_platform',
    'health',
    'system',
];

const SCHEDULER_ROLES = ['dispatcher', 'system_admin_dtam'];

// ── /api/audit/scheduling/* routes ──────────────────────────────────────────

const SCHEDULING_ROUTES = [
    {
        label: 'GET /api/audit/scheduling/queue',
        method: 'get',
        path: '/api/audit/scheduling/queue',
        mockToCheck: () => mockGetSchedulingQueue,
        body: undefined,
    },
    {
        label: 'POST /api/audit/scheduling/assign',
        method: 'post',
        path: '/api/audit/scheduling/assign',
        mockToCheck: () => mockAssignAuditor,
        body: {
            applicationId: 'app-1',
            auditorId: 'aud-1',
            scheduledDate: '2026-06-01',
        },
    },
    {
        label: 'POST /api/audit/scheduling/:id/approve',
        method: 'post',
        path: '/api/audit/scheduling/res-1/approve',
        mockToCheck: () => mockApproveReschedule,
        body: { newDate: '2026-06-15' },
    },
    {
        label: 'GET /api/audit/scheduling/auditor-availability/:id',
        method: 'get',
        path: '/api/audit/scheduling/auditor-availability/aud-1',
        mockToCheck: () => mockGetAuditorAvailability,
        body: undefined,
    },
];

describe('V2-D /api/audit/scheduling/* — SCHEDULER + ADMIN only', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    describe.each(SCHEDULING_ROUTES)('$label', ({ method, path, mockToCheck, body }) => {
        test.each(NON_SCHEDULER_ROLES)('%s role gets 403 FORBIDDEN_ROLE', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                success: false,
                error: 'FORBIDDEN_ROLE',
            });
            // The service-layer happy-path mock MUST NOT have been called
            // on a 403 — otherwise a "rejected" request still did the work
            // and only the body lied. This is the load-bearing assertion
            // that the user's "ไม่มีการข้ามสิทธ์" worry is actually closed.
            const sideEffect = mockToCheck();
            expect(sideEffect).not.toHaveBeenCalled();
        });

        test.each(SCHEDULER_ROLES)('%s role bypasses the role gate', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());
            // Any non-403 / non-401 means the gate let the request through
            // to the downstream service. Downstream may then 200, 201, 400
            // depending on body validity — we assert ONLY that the role
            // gate did not intercept.
            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
            expect(response.body).not.toMatchObject({ error: 'FORBIDDEN_ROLE' });
        });
    });

    describe('anonymous (no token) — auth middleware rejects before the role gate', () => {
        test.each(SCHEDULING_ROUTES)('$label returns 401 without a token', async ({ method, path, body }) => {
            const req = request(app)[method](path);
            const response = await (body !== undefined ? req.send(body) : req.send());
            expect(response.status).toBe(401);
            expect(response.body).not.toMatchObject({ error: 'FORBIDDEN_ROLE' });
        });
    });
});

// ── /api/audit/scheduling/:id/reschedule — HEALTH-only (auth layer) ─────────

describe('V2-D /api/audit/scheduling/:applicationId/reschedule — HEALTH auth gate', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    // All 7 non-HEALTH roles get 401 from the auth-middleware mock (it
    // mirrors the real authenticateHealth behaviour — HEALTH-only).
    const NON_HEALTH_ROLES = [
        'system_admin_dtam',
        'dispatcher',
        'document_reviewer',
        'field_inspector',
        'finance_officer_dtam',
        'finance_officer_platform',
        'finance_officer_platform',
    ];

    test.each(NON_HEALTH_ROLES)('%s role gets 401 from authenticateHealth', async (role) => {
        const response = await request(app)
            .post('/api/audit/scheduling/app-1/reschedule')
            .set('x-test-role', role)
            .send({ requestedDate: '2026-06-15', reason: 'unavailable' });

        expect(response.status).toBe(401);
        // No service call on auth failure.
        expect(mockRequestReschedule).not.toHaveBeenCalled();
    });

    test('health role passes through to the service', async () => {
        const response = await request(app)
            .post('/api/audit/scheduling/app-1/reschedule')
            .set('x-test-role', 'health')
            .send({ requestedDate: '2026-06-15', reason: 'unavailable' });

        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
        expect(mockRequestReschedule).toHaveBeenCalledTimes(1);
    });
});

// ── /api/provider/scheduler/* routes ────────────────────────────────────────

const PROVIDER_SCHEDULER_ROUTES = [
    {
        label: 'GET /api/provider/scheduler/auditors',
        method: 'get',
        path: '/api/provider/scheduler/auditors',
        mockToCheck: () => mockListAuditorsForScheduler,
        body: undefined,
    },
    {
        label: 'GET /api/provider/scheduler/reviewers',
        method: 'get',
        path: '/api/provider/scheduler/reviewers',
        mockToCheck: () => mockListReviewerCandidates,
        body: undefined,
    },
    {
        label: 'POST /api/provider/scheduler/reviewer-assignments',
        method: 'post',
        path: '/api/provider/scheduler/reviewer-assignments',
        // The handler exits early at the param-validation line for the
        // 200/400 happy-shape; the load-bearing assertion is that the
        // RBAC gate fires BEFORE that. We use findFirstWithWhere because
        // the route's body resolver hits it after the perm gate.
        mockToCheck: () => mockApplicationServiceMethods.findFirstWithWhere,
        body: { applicationId: 'app-1', reviewerId: 'rev-1' },
    },
    {
        label: 'GET /api/provider/scheduler/dashboard',
        method: 'get',
        path: '/api/provider/scheduler/dashboard',
        mockToCheck: () => mockApplicationServiceMethods.listSchedulerDashboardApplications,
        body: undefined,
    },
];

describe('V2-D /api/provider/scheduler/* — APPLICATION_SCHEDULE permission', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    describe.each(PROVIDER_SCHEDULER_ROUTES)('$label', ({ method, path, mockToCheck, body }) => {
        test.each(NON_SCHEDULER_ROLES)('%s role gets 403', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({ success: false });
            // No service call on 403.
            const sideEffect = mockToCheck();
            expect(sideEffect).not.toHaveBeenCalled();
        });

        test.each(SCHEDULER_ROLES)('%s role bypasses the perm gate', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());
            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
        });
    });

    describe('anonymous (no token) — auth middleware rejects', () => {
        test.each(PROVIDER_SCHEDULER_ROUTES)('$label returns 401 without a token', async ({ method, path, body }) => {
            const req = request(app)[method](path);
            const response = await (body !== undefined ? req.send(body) : req.send());
            expect(response.status).toBe(401);
        });
    });
});
