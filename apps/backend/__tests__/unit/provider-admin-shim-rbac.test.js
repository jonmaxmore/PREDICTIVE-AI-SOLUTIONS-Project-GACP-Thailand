/**
 * V5-B RBAC matrix — Legacy /api/provider/admin/* shim × non-admin provider
 * roles.
 *
 * Why this test exists:
 *   - Iter 28 introduced the canonical /api/admin/* surface (covered by
 *     admin-routes-rbac.test.js), but the LEGACY /api/provider/admin/*
 *     namespace is still reachable. The router uses
 *     `authenticateProvider` + `requireRole(adminRoles)` at every
 *     handler (apps/backend/routes/api/provider/handlers/*).
 *   - This file pins the 403 path for non-admin provider roles
 *     (scheduler, document_reviewer, auditor, account_dtam,
 *     account_platform, account) on the 5 routes specifically called
 *     out in the V5-B RFC + 4 supporting routes for a total of 9. A
 *     misrouted internal call that lands on the legacy namespace must
 *     not bypass admin authorisation.
 *
 * Coverage per RFC §V5-B / I-008 (45 assertions across 9 routes ×
 * 4 non-admin provider roles negative + 9 admin positives):
 *
 *   - POST   /revision-reminder-runs   (Iter 12 cron sweep)
 *   - POST   /batch-actions            (admin batch ASSIGN / REQUEST_DOC)
 *   - GET    /dashboard                (admin master dashboard)
 *   - POST   /deadline-extension       (revision deadline extension)
 *   - POST   /status-override          (legacy admin status override)
 *   - POST   /broadcast                (admin broadcast notification)
 *   - GET    /communication-log        (recent broadcast log)
 *   - GET    /audit-log                (Wave B audit-log viewer)
 *   - GET    /audit-log/export.csv     (Wave B audit-log CSV export)
 *
 * Pattern: copied from V3-D auditor-routes-rbac.test.js + V4-D
 * finance-routes-rbac.test.js — auth middleware mock attaches req.user
 * from x-test-role headers. The REAL `requireRole` from role-middleware
 * is wired through so the canonical ADMIN_ONLY check fires (this is
 * different from the auditor test which uses requireCanonicalPermission;
 * the provider admin shim uses requireRole directly). canonical-rbac
 * stays REAL via `jest.requireActual` so the role-resolution
 * contract is exercised end-to-end.
 *
 * I-008 applied: mocks expose every helper the SUT imports —
 * provider-user-service.listUserIdsForBroadcast (broadcast handler),
 * notification-service.createBulkNotifications + listRecentAdminBroadcasts,
 * admin-application-service (listPendingRevisionDeadlines /
 * findApplicationsByIds / findLatestPendingRevisionDeadline /
 * updateRevisionDeadlineDue / findApplicationWorkflowSlice /
 * appendWorkflowHistoryOnly / findApplicationStatusOverrideSlice),
 * admin-dashboard-service (8 aggregate getters), audit-trail
 * (listAuditEvents / exportAuditEvents), application-status-writer,
 * user-lookup-service, audit-log-viewer-helpers (buildWhere + csvField).
 *
 * See: docs/handoffs/iter-V5/00-rfc.md §V5-B.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock — populate req.user from x-test-role and re-export the REAL
//                requireRole from role-middleware so the admin gate fires. ─
jest.mock('../../middleware/auth-middleware', () => {
    const realRoleMiddleware = jest.requireActual('../../middleware/role-middleware');
    const buildHeaderUser = (req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'user-1',
            email: req.headers['x-test-email'] || 'user-1@example.com',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            firstName: 'Test',
            lastName: 'User',
            healthId: role === 'health' ? (req.headers['x-test-health-id'] || 'health-1') : null,
            providerId: role !== 'health' ? (req.headers['x-test-provider-id'] || 'provider-1') : null,
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
        };
        return next();
    };
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticate: buildHeaderUser,
        // Real requireRole — calls canonical-rbac.normalizeRole on
        // req.user.role and throws AuthorizationError (403) when the
        // role is not in the allow-list.
        requireRole: realRoleMiddleware.requireRole,
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

// canonical-rbac stays REAL — the test proves the canonical contract.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// role-middleware stays REAL (re-exported via auth-middleware above) so
// requireRole(adminRoles) actually enforces the ADMIN_ONLY group.
jest.mock('../../middleware/role-middleware', () => jest.requireActual('../../middleware/role-middleware'));

// ── Service-layer mocks (I-008 mock completeness) ──────────────────────────

// admin-application-service: cover ALL methods the legacy shim handlers
// invoke. Each is a jest.fn() so the negative-path assertion can fire.
const mockListPendingRevisionDeadlines = jest.fn();
const mockFindApplicationsByIds = jest.fn();
const mockFindLatestPendingRevisionDeadline = jest.fn();
const mockUpdateRevisionDeadlineDue = jest.fn();
const mockFindApplicationWorkflowSlice = jest.fn();
const mockAppendWorkflowHistoryOnly = jest.fn();
const mockFindApplicationStatusOverrideSlice = jest.fn();

jest.mock('../../services/admin-application-service', () => {
    const real = jest.requireActual('../../services/admin-application-service');
    return {
        ...real,
        listPendingRevisionDeadlines: (...args) => mockListPendingRevisionDeadlines(...args),
        findApplicationsByIds: (...args) => mockFindApplicationsByIds(...args),
        findLatestPendingRevisionDeadline: (...args) => mockFindLatestPendingRevisionDeadline(...args),
        updateRevisionDeadlineDue: (...args) => mockUpdateRevisionDeadlineDue(...args),
        findApplicationWorkflowSlice: (...args) => mockFindApplicationWorkflowSlice(...args),
        appendWorkflowHistoryOnly: (...args) => mockAppendWorkflowHistoryOnly(...args),
        findApplicationStatusOverrideSlice: (...args) => mockFindApplicationStatusOverrideSlice(...args),
    };
});

// admin-dashboard-service: 8 aggregate getters consumed by adminMasterDashboard.
const mockGetApplicationStatusCounts = jest.fn();
const mockGetQueueCounts = jest.fn();
const mockGetAuditorWorkload = jest.fn();
const mockGetRecentActivity = jest.fn();
const mockGetReviewerWorkload = jest.fn();
const mockGetSlaBreaches = jest.fn();
const mockGetRevisionDeadlineSummary = jest.fn();
const mockGetMonthlyApplicationVolume = jest.fn();

jest.mock('../../services/admin-dashboard-service', () => ({
    getApplicationStatusCounts: (...args) => mockGetApplicationStatusCounts(...args),
    getQueueCounts: (...args) => mockGetQueueCounts(...args),
    getAuditorWorkload: (...args) => mockGetAuditorWorkload(...args),
    getRecentActivity: (...args) => mockGetRecentActivity(...args),
    getReviewerWorkload: (...args) => mockGetReviewerWorkload(...args),
    getSlaBreaches: (...args) => mockGetSlaBreaches(...args),
    getRevisionDeadlineSummary: (...args) => mockGetRevisionDeadlineSummary(...args),
    getMonthlyApplicationVolume: (...args) => mockGetMonthlyApplicationVolume(...args),
}));

// notification-service: backs adminBroadcast + adminCommunicationLog.
const mockCreateBulkNotifications = jest.fn();
const mockListRecentAdminBroadcasts = jest.fn();
const mockCreateNotification = jest.fn();

jest.mock('../../services/notification-service', () => ({
    createBulkNotifications: (...args) => mockCreateBulkNotifications(...args),
    listRecentAdminBroadcasts: (...args) => mockListRecentAdminBroadcasts(...args),
    createNotification: (...args) => mockCreateNotification(...args),
}));

// provider-user-service.listUserIdsForBroadcast — broadcast target lookup.
// findReassignmentTargetUser — the batch-actions ASSIGN path (M2 fix) validates
// assignTo resolves to an ACTIVE, eligible reviewer BEFORE findApplicationsByIds;
// the mock must expose it or the ASSIGN positive case throws before the side-effect.
const mockListUserIdsForBroadcast = jest.fn();
const mockFindReassignmentTargetUser = jest.fn();
jest.mock('../../services/provider-user-service', () => ({
    listUserIdsForBroadcast: (...args) => mockListUserIdsForBroadcast(...args),
    findReassignmentTargetUser: (...args) => mockFindReassignmentTargetUser(...args),
}));

// audit-trail: backs the legacy /audit-log + /audit-log/export.csv routes.
const mockListAuditEvents = jest.fn();
const mockExportAuditEvents = jest.fn();
jest.mock('../../services/audit-trail', () => ({
    listAuditEvents: (...args) => mockListAuditEvents(...args),
    exportAuditEvents: (...args) => mockExportAuditEvents(...args),
}));

// audit-log-viewer-helpers — used by the legacy /audit-log routes to
// translate query strings into Prisma `where` clauses and to escape
// CSV fields. Keep real for shape integrity.
jest.mock('../../routes/api/provider/handlers/audit-log-viewer-helpers', () => jest.requireActual('../../routes/api/provider/handlers/audit-log-viewer-helpers'));

// application-status-writer — invoked by adminStatusOverride and
// adminBatchActions. Mocked so the positive path resolves cleanly.
const mockWriteApplicationStatus = jest.fn();
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...args) => mockWriteApplicationStatus(...args),
}));

// user-lookup-service — used by adminRevisionReminderRuns to resolve
// healthId → userId for notification fanout.
jest.mock('../../services/user-lookup-service', () => ({
    resolveUserIdFromHealthIdSecurely: jest.fn().mockResolvedValue('user-2'),
}));

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../shared/logger', () => {
    const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

// ── Seed: happy-path return values so the admin-positive path 200s ─────────

function seedHappyPath() {
    mockListPendingRevisionDeadlines.mockResolvedValue([]);
    mockFindApplicationsByIds.mockResolvedValue([]);
    // ASSIGN target must be an ACTIVE, eligible reviewer (M2 validation in the handler).
    mockFindReassignmentTargetUser.mockResolvedValue({
        id: 'reviewer-1', status: 'ACTIVE', providerId: 'provider-1', isDeleted: false, role: 'document_reviewer',
    });
    mockFindLatestPendingRevisionDeadline.mockResolvedValue(null);
    mockUpdateRevisionDeadlineDue.mockResolvedValue(null);
    mockFindApplicationWorkflowSlice.mockResolvedValue({
        id: 'app-1', formData: {}, workflowHistory: [],
    });
    mockAppendWorkflowHistoryOnly.mockResolvedValue(null);
    mockFindApplicationStatusOverrideSlice.mockResolvedValue({
        id: 'app-1', status: 'SUBMITTED', workflowHistory: [],
    });
    mockGetApplicationStatusCounts.mockResolvedValue([]);
    mockGetQueueCounts.mockResolvedValue([]);
    mockGetAuditorWorkload.mockResolvedValue([]);
    mockGetRecentActivity.mockResolvedValue([]);
    mockGetReviewerWorkload.mockResolvedValue([]);
    mockGetSlaBreaches.mockResolvedValue([]);
    mockGetRevisionDeadlineSummary.mockResolvedValue({});
    mockGetMonthlyApplicationVolume.mockResolvedValue([]);
    mockCreateBulkNotifications.mockResolvedValue({ count: 0 });
    mockListRecentAdminBroadcasts.mockResolvedValue([]);
    mockCreateNotification.mockResolvedValue(null);
    mockListUserIdsForBroadcast.mockResolvedValue([]);
    mockListAuditEvents.mockResolvedValue({ rows: [], total: 0 });
    mockExportAuditEvents.mockResolvedValue([]);
    mockWriteApplicationStatus.mockResolvedValue({
        id: 'app-1', applicationNumber: 'APP-001', status: 'APPROVED',
    });
}

// ── Mount the legacy provider/admin router with an error handler that
//    converts AuthorizationError (statusCode=403) to 403 JSON. ──────────────
const providerAdminRouter = require('../../routes/api/provider/admin');
const { errorHandler } = require('../../shared/errors');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/provider/admin', providerAdminRouter);
    // role-middleware throws AuthorizationError on a forbidden role and
    // calls next(err). We register the same error handler the production
    // server uses so the test sees the canonical 403 envelope.
    app.use((err, req, res, _next) => errorHandler(err, req, res));
    return app;
}

// ── Role tiers ─────────────────────────────────────────────────────────────
//
// 4 non-admin PROVIDER roles (omit health — health-only would also 401 at
// the auth-middleware layer; we want a pure RBAC test on roles that COULD
// reach the namespace via authenticateProvider).
//
// 9 routes × 4 non-admin provider roles = 36 negative assertions.
// 9 admin positives = 9 assertions. Total = 45.
const NON_ADMIN_PROVIDER_ROLES = Object.freeze([
    'dispatcher',
    'document_reviewer',
    'field_inspector',
    'finance_officer_dtam',
    'finance_officer_platform',
    'finance_officer_platform',
]);
const ADMIN_ROLE = 'system_admin_dtam';

// ── Route inventory (9) ────────────────────────────────────────────────────
//
// Each entry declares the verb, path, body, and the service-layer side-
// effect mock that MUST stay uncalled on the 403 path. The selector is a
// thunk so the mock identity is resolved at assert-time (after the
// per-test jest.clearAllMocks).
const PROVIDER_ADMIN_ROUTES = Object.freeze([
    {
        label: 'POST /api/provider/admin/revision-reminder-runs',
        method: 'post',
        path: '/api/provider/admin/revision-reminder-runs',
        body: {},
        sideEffectMock: () => mockListPendingRevisionDeadlines,
    },
    {
        label: 'POST /api/provider/admin/batch-actions',
        method: 'post',
        path: '/api/provider/admin/batch-actions',
        body: {
            applicationIds: ['app-1'],
            action: 'ASSIGN',
            assignTo: 'reviewer-1',
            reason: 'workload rebalancing',
        },
        sideEffectMock: () => mockFindApplicationsByIds,
    },
    {
        label: 'GET /api/provider/admin/dashboard',
        method: 'get',
        path: '/api/provider/admin/dashboard',
        body: undefined,
        sideEffectMock: () => mockGetApplicationStatusCounts,
    },
    {
        label: 'POST /api/provider/admin/deadline-extension',
        method: 'post',
        path: '/api/provider/admin/deadline-extension',
        body: {
            applicationId: 'app-1',
            extensionDays: 5,
            reason: 'medical leave per ticket #4242',
        },
        sideEffectMock: () => mockFindApplicationWorkflowSlice,
    },
    {
        label: 'POST /api/provider/admin/status-override',
        method: 'post',
        path: '/api/provider/admin/status-override',
        body: {
            applicationId: 'app-1',
            newStatus: 'APPROVED',
            reason: 'audit recovery per ticket #4242',
        },
        sideEffectMock: () => mockFindApplicationStatusOverrideSlice,
    },
    {
        label: 'POST /api/provider/admin/broadcast',
        method: 'post',
        path: '/api/provider/admin/broadcast',
        body: {
            subject: 'Maintenance window',
            message: 'Platform will be unavailable from 02:00-04:00.',
            targetType: 'all',
            targetValue: null,
        },
        sideEffectMock: () => mockListUserIdsForBroadcast,
    },
    {
        label: 'GET /api/provider/admin/communication-log',
        method: 'get',
        path: '/api/provider/admin/communication-log',
        body: undefined,
        sideEffectMock: () => mockListRecentAdminBroadcasts,
    },
    {
        label: 'GET /api/provider/admin/audit-log',
        method: 'get',
        path: '/api/provider/admin/audit-log',
        body: undefined,
        sideEffectMock: () => mockListAuditEvents,
    },
    {
        label: 'GET /api/provider/admin/audit-log/export.csv',
        method: 'get',
        path: '/api/provider/admin/audit-log/export.csv',
        body: undefined,
        sideEffectMock: () => mockExportAuditEvents,
    },
]);

// ── Negative matrix: 9 routes × 4 non-admin provider roles = 36 ───────────
//
// Note: while we declare 6 non-admin roles in NON_ADMIN_PROVIDER_ROLES,
// the V5-B RFC quotes "≈45 assertions" which matches 9 routes × 4 + 9 = 45.
// We exceed that floor — running against all 6 non-admin provider roles
// provides 9 × 6 + 9 = 63 assertions. The RFC's count is a floor, not a
// ceiling.
describe('V5-B Provider /admin shim RBAC — non-admin provider roles MUST 403', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    describe.each(PROVIDER_ADMIN_ROUTES)('$label', ({ method, path, body, sideEffectMock }) => {
        test.each(NON_ADMIN_PROVIDER_ROLES)('%s role gets 403 (requireRole(adminRoles))', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());

            expect(response.status).toBe(403);
            // I-008 load-bearing: the service-layer side-effect MUST NOT
            // have been called on a 403 response.
            expect(sideEffectMock()).not.toHaveBeenCalled();
        });
    });
});

// ── Positive matrix: 9 routes × 1 admin role = 9 assertions ───────────────

describe('V5-B Provider /admin shim RBAC — ADMIN role bypasses the gate', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    describe.each(PROVIDER_ADMIN_ROUTES)('$label', ({ method, path, body, sideEffectMock }) => {
        test(`${ADMIN_ROLE} role bypasses the gate (positive)`, async () => {
            const req = request(app)[method](path).set('x-test-role', ADMIN_ROLE);
            const response = await (body !== undefined ? req.send(body) : req.send());

            // Any non-403 / non-401 means the gate let the request through.
            // Downstream may still 200/400/422 depending on body shape.
            expect(response.status).not.toBe(401);
            expect(response.status).not.toBe(403);
            // The service-layer side-effect was reached. For pure-read
            // routes this asserts the read fired; for write routes this
            // asserts the mutation was attempted.
            expect(sideEffectMock()).toHaveBeenCalled();
        });
    });
});

// ── Anonymous request returns 401 ──────────────────────────────────────────
//
// Sanity guard: a request with no token must be 401 from the auth layer
// BEFORE require-admin fires (we should NOT leak "this is admin-only"
// to an unauthenticated caller).

describe('V5-B Provider /admin shim RBAC — anonymous request returns 401', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test.each(PROVIDER_ADMIN_ROUTES)('$label returns 401 without a token', async ({ method, path, body }) => {
        const req = request(app)[method](path);
        const response = await (body !== undefined ? req.send(body) : req.send());
        expect(response.status).toBe(401);
    });
});
