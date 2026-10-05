/**
 * V3-D RBAC matrix — AUDITOR permission contract on
 * `/api/provider/auditor/*` (apps/backend/routes/api/provider/auditor.js).
 *
 * Why this test exists:
 *   - Loop V Iter 3 audited the AUDITOR surface end-to-end and discovered
 *     that the 10 routes in `routes/api/provider/auditor.js` had ZERO route
 *     × role RBAC coverage. The user's V3 worry mirrors V2's "ไม่มีการข้ามสิทธ์"
 *     concern: a misconfigured frontend or a stolen non-auditor token must
 *     never reach an auditor mutation, and a 403 must mean "no work done".
 *   - V1-D / V2-D pattern: per-route × per-role assertion matrix asserting
 *     both the HTTP status AND that the service-layer side-effect did NOT
 *     fire (so a 403 truly means "no work done", not "work done then
 *     rolled back").
 *
 * Pattern: copied verbatim from V2-D's scheduling-route-rbac.test.js —
 * the auth middleware mock attaches `req.user` from `x-test-role`
 * headers, canonical-rbac stays REAL (so the test proves the canonical
 * contract, not a mock), and the service module's methods are spied so
 * we assert no side-effect on the 403 path.
 *
 * Coverage per RFC §V3-D / RB-3 — 10 routes:
 *   - GET    /dashboard
 *   - POST   /applications/:id/inspection-starts
 *   - POST   /applications/:id/audit-decisions
 *   - GET    /applications/:id/session
 *   - POST   /applications/:id/session/checkin
 *   - POST   /applications/:id/session/evidence
 *   - POST   /applications/:id/session/notes
 *   - GET    /final-approval-queue
 *   - POST   /applications/:id/final-approvals
 *   - POST   /applications/:id/reject-to-auditor
 *
 * Permission gates per RFC:
 *   - APPLICATION_AUDIT_RECORD (auditor + admin) for /dashboard +
 *     /inspection-starts + /audit-decisions
 *   - AUDIT_SUBMIT (auditor + admin) for /session/checkin + /evidence +
 *     /notes
 *   - GET /session: authenticateProvider only; positives are all provider
 *     roles, negatives are HEALTH + anonymous
 *   - APPLICATION_WORKFLOW_TRANSITION (auditor + admin + scheduler +
 *     document_reviewer) for /final-approval-queue + /final-approvals +
 *     /reject-to-auditor — so account_* + health are negatives.
 *
 * See: docs/handoffs/iter-V3/00-rfc.md §V3-D / RB-3.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock (I-008: expose every helper the SUT imports) ──────────────────
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

// ── Service-layer mocks (I-008) ─────────────────────────────────────────────
// application-service: every helper the auditor handlers + final-approval
// routes import. Each method that performs a write is a jest.fn() so the
// "side-effect not called on 403" assertion can fire.
const mockListAuditorDashboardApplications = jest.fn();
const mockFindAuditDecisionApplication = jest.fn();
const mockFindAuditDecisionPostWriteSlice = jest.fn();
const mockWriteInspectionStart = jest.fn();
const mockFindApplicationForFinalApproval = jest.fn();
const mockListFinalApprovalQueue = jest.fn();
const mockUpdateApplicationColumns = jest.fn();
const mockFindFirstWithWhere = jest.fn();
const mockListAuditorsByIds = jest.fn();

jest.mock('../../services/application-service', () => ({
    listAuditorDashboardApplications: (...args) => mockListAuditorDashboardApplications(...args),
    findAuditDecisionApplication: (...args) => mockFindAuditDecisionApplication(...args),
    findAuditDecisionPostWriteSlice: (...args) => mockFindAuditDecisionPostWriteSlice(...args),
    writeInspectionStart: (...args) => mockWriteInspectionStart(...args),
    findApplicationForFinalApproval: (...args) => mockFindApplicationForFinalApproval(...args),
    listFinalApprovalQueue: (...args) => mockListFinalApprovalQueue(...args),
    updateApplicationColumns: (...args) => mockUpdateApplicationColumns(...args),
    findFirstWithWhere: (...args) => mockFindFirstWithWhere(...args),
    listAuditorsByIds: (...args) => mockListAuditorsByIds(...args),
}));

// F-FINAL-APPROVAL-NO-AUDIT: the final-approvals route runs a real
// prisma.$transaction(tx => tx.application.update(...)) — give the mock a
// working tx so the canonical-audit test below can drive the happy path.
const mockTxApplicationUpdate = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        $transaction: async (cb) => cb({ application: { update: (...a) => mockTxApplicationUpdate(...a) } }),
    },
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

const mockWriteApplicationStatus = jest.fn();
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...args) => mockWriteApplicationStatus(...args),
}));

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));

jest.mock('../../services/user-lookup-service', () => ({
    resolveUserIdFromHealthIdSecurely: jest.fn().mockResolvedValue('u-1'),
}));

jest.mock('../../middleware/audit-logger', () => {
    const auditLogger = { log: jest.fn().mockResolvedValue(null), logWithin: jest.fn().mockResolvedValue(null) };
    return {
        auditLogger,
        AuditCategory: { APPLICATION: 'APPLICATION', AUDIT: 'AUDIT' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', MEDIUM: 'MEDIUM' },
        ResourceType: { APPLICATION: 'APPLICATION' },
        // Same mapping as the real statusTransitionAuditHook (audit-logger.js:834),
        // wired to THIS mock's logWithin so tests can assert the canonical row.
        statusTransitionAuditHook: ({ tx, metadata = {} } = {}) => (entry) => auditLogger.logWithin({
            category: 'APPLICATION',
            action: entry?.event || 'APPLICATION_STATUS_TRANSITION',
            severity: 'INFO',
            actorId: entry?.actorId || 'SYSTEM',
            actorRole: entry?.actorRole || 'UNKNOWN',
            resourceType: 'APPLICATION',
            resourceId: entry?.applicationId,
            metadata: {
                fromStatus: entry?.fromStatus ?? null,
                toStatus: entry?.toStatus ?? null,
                reason: entry?.reason ?? null,
                ...metadata,
            },
        }, tx),
    };
});

jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: jest.fn().mockResolvedValue([]),
    listSettlementsByApplicationIds: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/phase-billing-service', () => ({
    computePhaseSettlement: jest.fn(() => ({ phasePaid: false, phaseReceiptIssued: false })),
    getServiceTypesForPhaseComponent: jest.fn(() => []),
    getCanonicalServiceTypeForComponent: jest.fn(() => null),
    isInvoicePaidStatus: jest.fn(() => false),
}));

jest.mock('../../utils/client-ip', () => ({
    getRequestIp: jest.fn(() => '127.0.0.1'),
}));

jest.mock('../../shared/application-visibility', () => ({
    withVisibility: (where) => where,
}));

jest.mock('../../services/traceability-service', () => ({}));

jest.mock('../../services/certificate-service', () => ({
    generateCertificate: jest.fn().mockResolvedValue(null),
    ensureCertificateIssuedForApplication: jest.fn().mockResolvedValue(null),
    revokeCertificateForApplication: jest.fn().mockResolvedValue(null),
}));

// workflow-transition-service: keep REAL ROLE_TRANSITIONS + canonical
// state-resolver so positive paths reach their downstream service mocks,
// and buildTransitionUpdate returns a sane updateData blob.
jest.mock('../../services/workflow-transition-service', () => {
    const real = jest.requireActual('../../services/workflow-transition-service');
    return {
        ...real,
        buildTransitionUpdate: jest.fn(({ application, toState }) => ({
            updateData: { status: toState, formData: application?.formData || {} },
        })),
    };
});

function seedHappyPath() {
    mockListAuditorDashboardApplications.mockResolvedValue([]);
    mockListAuditorsByIds.mockResolvedValue([]);
    mockListFinalApprovalQueue.mockResolvedValue([]);
    // For the per-application routes, the auditor handler runs ownership
    // gate BEFORE service writes. Seed application.auditorId = user-1 so
    // the positive (auditor) case passes the gate and reaches the service.
    mockFindAuditDecisionApplication.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        healthId: 'h-1',
        auditorId: 'user-1',
        // a different person: one user holding both sides is refused (separation of duties)
        reviewerId: 'reviewer-1',
        status: 'AUDIT_CONFIRMED',
        formData: { reviewedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
        workflowHistory: [],
    });
    mockFindApplicationForFinalApproval.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        status: 'AUDIT_PASSED',
        formData: {},
        workflowHistory: [],
    });
    mockFindAuditDecisionPostWriteSlice.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        status: 'AUDIT_PASSED',
    });
    mockWriteInspectionStart.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
    });
    mockUpdateApplicationColumns.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        status: 'APPROVED',
        updatedAt: new Date().toISOString(),
    });
    mockFindFirstWithWhere.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        formData: {},
        auditorId: 'user-1',
    });
    mockWriteApplicationStatus.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        status: 'AUDIT_PASSED',
    });
}

const auditorRouter = require('../../routes/api/provider/auditor');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/provider/auditor', auditorRouter);
    return app;
}

// ── Role groupings ──────────────────────────────────────────────────────────

// Routes with APPLICATION_AUDIT_RECORD gate (auditor + admin only):
// dashboard, inspection-starts, audit-decisions
const AUDIT_RECORD_POSITIVE_ROLES = ['field_inspector', 'system_admin_dtam'];
const AUDIT_RECORD_NEGATIVE_ROLES = [
    'document_reviewer',
    'dispatcher',
    'finance_officer_dtam',
    'finance_officer_platform',
    'finance_officer_platform',
    'health',
];

// Routes with AUDIT_SUBMIT gate (auditor + admin only):
// session/checkin, session/evidence, session/notes
const AUDIT_SUBMIT_POSITIVE_ROLES = ['field_inspector', 'system_admin_dtam'];
const AUDIT_SUBMIT_NEGATIVE_ROLES = [
    'document_reviewer',
    'dispatcher',
    'finance_officer_dtam',
    'finance_officer_platform',
    'finance_officer_platform',
    'health',
];

// Routes with APPLICATION_WORKFLOW_TRANSITION gate (auditor + admin +
// scheduler + document_reviewer): final-approval-queue, final-approvals,
// reject-to-auditor
const WORKFLOW_TRANSITION_POSITIVE_ROLES = [
    'field_inspector',
    'system_admin_dtam',
    'dispatcher',
    'document_reviewer',
];
const WORKFLOW_TRANSITION_NEGATIVE_ROLES = [
    'finance_officer_dtam',
    'finance_officer_platform',
    'finance_officer_platform',
    'health',
];

// ── /dashboard, /inspection-starts, /audit-decisions (APPLICATION_AUDIT_RECORD) ──

const AUDIT_RECORD_ROUTES = [
    {
        label: 'GET /api/provider/auditor/dashboard',
        method: 'get',
        path: '/api/provider/auditor/dashboard',
        body: undefined,
        sideEffectMock: () => mockListAuditorDashboardApplications,
    },
    {
        label: 'POST /api/provider/auditor/applications/:id/inspection-starts',
        method: 'post',
        path: '/api/provider/auditor/applications/app-1/inspection-starts',
        body: {},
        sideEffectMock: () => mockWriteInspectionStart,
    },
    {
        label: 'POST /api/provider/auditor/applications/:id/audit-decisions',
        method: 'post',
        path: '/api/provider/auditor/applications/app-1/audit-decisions',
        body: { decision: 'PASS' },
        sideEffectMock: () => mockWriteApplicationStatus,
    },
];

describe('V3-D /api/provider/auditor/* — APPLICATION_AUDIT_RECORD gate', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    describe.each(AUDIT_RECORD_ROUTES)('$label', ({ method, path, body, sideEffectMock }) => {
        test.each(AUDIT_RECORD_NEGATIVE_ROLES)('%s role gets 403 (perm-gate)', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({ success: false });
            // I-008 load-bearing: the service-layer side-effect MUST NOT
            // have been called on a 403 response.
            expect(sideEffectMock()).not.toHaveBeenCalled();
        });

        test.each(AUDIT_RECORD_POSITIVE_ROLES)('%s role bypasses the perm gate', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());
            // Any non-403 / non-401 means the gate let the request through.
            // Downstream may still 200/400/404/422 depending on body/state.
            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
        });
    });

    describe('anonymous (no token) — auth middleware rejects', () => {
        test.each(AUDIT_RECORD_ROUTES)('$label returns 401 without a token', async ({ method, path, body }) => {
            const req = request(app)[method](path);
            const response = await (body !== undefined ? req.send(body) : req.send());
            expect(response.status).toBe(401);
        });
    });
});

// ── /session/checkin, /session/evidence, /session/notes (AUDIT_SUBMIT) ───────

const AUDIT_SUBMIT_ROUTES = [
    {
        label: 'POST /api/provider/auditor/applications/:id/session/checkin',
        method: 'post',
        path: '/api/provider/auditor/applications/app-1/session/checkin',
        body: { latitude: 13.0, longitude: 100.0 },
        sideEffectMock: () => mockUpdateApplicationColumns,
    },
    {
        label: 'POST /api/provider/auditor/applications/:id/session/evidence',
        method: 'post',
        path: '/api/provider/auditor/applications/app-1/session/evidence',
        body: { photos: [{ id: 'p-1', latitude: 13.0, longitude: 100.0 }] },
        sideEffectMock: () => mockUpdateApplicationColumns,
    },
    {
        label: 'POST /api/provider/auditor/applications/:id/session/notes',
        method: 'post',
        path: '/api/provider/auditor/applications/app-1/session/notes',
        body: { liveNotes: 'hello', durationSeconds: 60 },
        sideEffectMock: () => mockUpdateApplicationColumns,
    },
];

describe('V3-D /api/provider/auditor/applications/:id/session/* — AUDIT_SUBMIT gate', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    describe.each(AUDIT_SUBMIT_ROUTES)('$label', ({ method, path, body, sideEffectMock }) => {
        test.each(AUDIT_SUBMIT_NEGATIVE_ROLES)('%s role gets 403 (perm-gate)', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({ success: false });
            expect(sideEffectMock()).not.toHaveBeenCalled();
        });

        test.each(AUDIT_SUBMIT_POSITIVE_ROLES)('%s role bypasses the perm gate', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());
            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
        });
    });

    describe('anonymous (no token) — auth middleware rejects', () => {
        test.each(AUDIT_SUBMIT_ROUTES)('$label returns 401 without a token', async ({ method, path, body }) => {
            const req = request(app)[method](path);
            const response = await (body !== undefined ? req.send(body) : req.send());
            expect(response.status).toBe(401);
        });
    });
});

// ── GET /session — authenticateProvider only (no perm gate) ─────────────────

describe('V3-D GET /api/provider/auditor/applications/:id/session — provider auth gate', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    // Provider roles all pass the auth middleware. The route does not
    // additionally narrow via requireCanonicalPermission, so the only
    // negative is HEALTH + anonymous. The handler then uses withVisibility
    // (mocked to identity) → all provider roles can hit the read path.
    const PROVIDER_ROLES = [
        'field_inspector',
        'system_admin_dtam',
        'dispatcher',
        'document_reviewer',
        'finance_officer_dtam',
        'finance_officer_platform',
        'finance_officer_platform',
    ];

    test.each(PROVIDER_ROLES)('%s role reaches the handler', async (role) => {
        const response = await request(app)
            .get('/api/provider/auditor/applications/app-1/session')
            .set('x-test-role', role);
        // The route uses authenticateProvider only — no canonical-perm
        // gate. Any provider-shaped role passes through to the handler.
        expect(response.status).not.toBe(401);
    });

    test('anonymous request returns 401', async () => {
        const response = await request(app)
            .get('/api/provider/auditor/applications/app-1/session');
        expect(response.status).toBe(401);
    });
});

// ── /final-approval-queue, /final-approvals, /reject-to-auditor ─────────────
// APPLICATION_WORKFLOW_TRANSITION gate (auditor + admin + scheduler +
// document_reviewer). account_* + health = 403.

const WORKFLOW_TRANSITION_ROUTES = [
    {
        label: 'GET /api/provider/auditor/final-approval-queue',
        method: 'get',
        path: '/api/provider/auditor/final-approval-queue',
        body: undefined,
        sideEffectMock: () => mockListFinalApprovalQueue,
    },
    {
        label: 'POST /api/provider/auditor/applications/:id/final-approvals',
        method: 'post',
        path: '/api/provider/auditor/applications/app-1/final-approvals',
        body: { comment: 'ok' },
        sideEffectMock: () => mockUpdateApplicationColumns,
    },
    {
        label: 'POST /api/provider/auditor/applications/:id/reject-to-auditor',
        method: 'post',
        path: '/api/provider/auditor/applications/app-1/reject-to-auditor',
        body: { comment: 'needs more evidence' },
        sideEffectMock: () => mockUpdateApplicationColumns,
    },
];

describe('V3-D /api/provider/auditor/{final-approval-queue,final-approvals,reject-to-auditor} — APPLICATION_WORKFLOW_TRANSITION gate', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    describe.each(WORKFLOW_TRANSITION_ROUTES)('$label', ({ method, path, body, sideEffectMock }) => {
        test.each(WORKFLOW_TRANSITION_NEGATIVE_ROLES)('%s role gets 403 (perm-gate)', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({ success: false });
            expect(sideEffectMock()).not.toHaveBeenCalled();
        });

        test.each(WORKFLOW_TRANSITION_POSITIVE_ROLES)('%s role bypasses the perm gate', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());
            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
        });
    });

    describe('anonymous (no token) — auth middleware rejects', () => {
        test.each(WORKFLOW_TRANSITION_ROUTES)('$label returns 401 without a token', async ({ method, path, body }) => {
            const req = request(app)[method](path);
            const response = await (body !== undefined ? req.send(body) : req.send());
            expect(response.status).toBe(401);
        });
    });

    // F-FINAL-APPROVAL-NO-AUDIT (Phase 0 walk-2 2026-08-19, C13): this route
    // updates the application row directly inside its own tx and never goes
    // through writeApplicationStatus, so the AUDIT_PASSED → APPROVED hop
    // committed with ZERO canonical APPLICATION_STATUS_TRANSITION rows — the
    // fail-open audit hole the phase-0 C13 checkpoint hunts (spec assertion
    // "0 new rows = the fail-open hole"). The canonical row must be written in
    // the SAME tx as the status flip.
    describe('F-FINAL-APPROVAL-NO-AUDIT — the APPROVED hop writes its canonical audit row', () => {
        test('POST final-approvals logs APPLICATION_STATUS_TRANSITION (→APPROVED) in the tx', async () => {
            seedHappyPath();
            mockTxApplicationUpdate.mockResolvedValue({
                id: 'app-1', applicationNumber: 'APP-001', status: 'APPROVED', updatedAt: new Date(),
            });
            const { auditLogger } = require('../../middleware/audit-logger');

            const response = await request(app)
                .post('/api/provider/auditor/applications/app-1/final-approvals')
                .set('x-test-role', 'field_inspector')
                .send({ comment: 'ok' });

            expect(response.status).toBe(200);
            const canonical = auditLogger.logWithin.mock.calls.find(
                ([e]) => e?.action === 'APPLICATION_STATUS_TRANSITION' && e?.resourceId === 'app-1',
            );
            expect(canonical).toBeDefined(); // 0 canonical rows = the fail-open hole
            expect(canonical[0].metadata).toMatchObject({ toStatus: 'APPROVED' });
        });

        test('POST reject-to-auditor logs APPLICATION_STATUS_TRANSITION (→CAR_REVIEWING) in the tx', async () => {
            // The sibling hole in the same file: the AUDIT_PASSED → CAR_REVIEWING
            // reversal also committed with no canonical row (review 2026-08-19
            // flagged that this fix shipped without its own pin).
            seedHappyPath();
            mockTxApplicationUpdate.mockResolvedValue({
                id: 'app-1', applicationNumber: 'APP-001', status: 'CAR_REVIEWING', updatedAt: new Date(),
            });
            const { auditLogger } = require('../../middleware/audit-logger');

            const response = await request(app)
                .post('/api/provider/auditor/applications/app-1/reject-to-auditor')
                .set('x-test-role', 'field_inspector')
                .send({ comment: 'needs more evidence' });

            expect(response.status).toBe(200);
            const canonical = auditLogger.logWithin.mock.calls.find(
                ([e]) => e?.action === 'APPLICATION_STATUS_TRANSITION' && e?.resourceId === 'app-1',
            );
            expect(canonical).toBeDefined();
            expect(canonical[0].metadata).toMatchObject({ toStatus: 'CAR_REVIEWING' });
        });
    });
});
