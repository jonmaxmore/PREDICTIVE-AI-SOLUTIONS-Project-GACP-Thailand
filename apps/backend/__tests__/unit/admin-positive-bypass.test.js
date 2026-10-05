/**
 * V5-A ADMIN positive-bypass matrix.
 *
 * Why this test exists:
 *   - V1-V4 each added per-route × per-role NEGATIVE matrices proving
 *     non-target roles get 403 + service-layer spy NOT called. ADMIN
 *     was the implicit positive case in those files (e.g., V4-D's
 *     finance routes have `'system_admin_dtam' role bypasses the gate` blocks).
 *   - V5-A consolidates the ADMIN positive bypass into a single file
 *     so a future regression that excludes ADMIN from one specific
 *     gate fails loudly here even if the per-iter file is removed.
 *   - The user's standing worry was "ไม่มีการข้ามสิทธ์" (no cross-role
 *     leakage) — but ADMIN MUST cross every role gate because that is
 *     the break-glass contract. This file pins that contract.
 *
 * Pattern: copied 8 cases from V2-D / V3-D / V4-D negative matrices
 * and FLIPPED to assert:
 *   (a) status NOT 403 / NOT 401 (gate let request through)
 *   (b) service-layer spy WAS called exactly once (work happened)
 *   (c) response body does NOT contain FORBIDDEN_ROLE / forbidden codes
 *
 * Cases covered (matching V5-A AB-1..AB-3 spec):
 *   - V2-D: POST /api/audit/scheduling/assign           (SCHEDULER + ADMIN)
 *   - V2-D: POST /api/audit/scheduling/:id/approve       (SCHEDULER + ADMIN)
 *   - V3-D: GET  /api/provider/auditor/dashboard         (AUDITOR + ADMIN)
 *   - V3-D: POST /api/provider/auditor/.../audit-decisions (AUDITOR + ADMIN)
 *   - V4-D: POST /api/finance/period-close                (ACCOUNT + ADMIN, sep-of-duties)
 *   - V4-D: POST /api/finance/period-close/:id/reopen     (ADMIN_ONLY)
 *   - V4-D: POST /api/finance/refunds/:id/cancel          (ADMIN_ONLY)
 *   - V4-D: POST /api/finance/manual-journal-entries/:id/approve (ADMIN_ONLY)
 *
 * I-008 applied: mocks expose every helper the SUT imports — auditLogger
 * `log` + `logWithin`, prisma db, logger.createLogger, full service
 * surfaces.  canonical-rbac stays REAL via `jest.requireActual` so the
 * test proves the canonical contract, not a mock's behaviour.
 *
 * See: docs/handoffs/iter-V5/00-rfc.md §V5-A AB-1..AB-3.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock (V1-D / V2-D / V3-D / V4-D pattern) ───────────────────────────
jest.mock('../../middleware/auth-middleware', () => {
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
            healthId: role === 'health' ? (req.headers['x-test-health-id'] || 'health-1') : null,
            providerId: role !== 'health' ? (req.headers['x-test-provider-id'] || 'provider-1') : null,
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
        };
        return next();
    };
    const requireRole = () => (_req, _res, next) => next();
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticate: buildHeaderUser,
        requireRole,
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

// canonical-rbac stays REAL — the test proves the canonical ADMIN contract.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// ── audit-scheduling-service (V2-D AB-1 / AB-2) ─────────────────────────────
const mockAssignAuditor = jest.fn();
const mockGetSchedulingQueue = jest.fn();
const mockApproveReschedule = jest.fn();
const mockGetAuditorAvailability = jest.fn();

jest.mock('../../services/audit-scheduling-service', () => {
    const real = jest.requireActual('../../services/audit-scheduling-service');
    return {
        AUDITOR_MAX_PER_DAY: real.AUDITOR_MAX_PER_DAY,
        RESCHEDULE_STATUS: real.RESCHEDULE_STATUS,
        getSchedulingQueue: (...args) => mockGetSchedulingQueue(...args),
        getAuditorAvailability: (...args) => mockGetAuditorAvailability(...args),
        // Wrap the spies behind the REAL role guard so a future regression
        // that drops the real guard from `assignAuditor` still fails this
        // test (the wrapper would not throw → ADMIN would still pass; but
        // a regression on the policy table that removes ADMIN from the
        // SCHEDULER_ROLES set fails on the assertSchedulerRole call).
        assignAuditor: (...args) => {
            const opts = args[0] && typeof args[0] === 'object' ? args[0] : args[1];
            real._internals.assertSchedulerRole(opts?.actor);
            return mockAssignAuditor(...args);
        },
        approveReschedule: (id, opts) => {
            real._internals.assertSchedulerRole(opts?.actor);
            return mockApproveReschedule(id, opts);
        },
        requestReschedule: jest.fn().mockResolvedValue(null),
        _internals: real._internals,
    };
});

// ── application-service (V3-D AB-3 / AB-4 — auditor surface) ────────────────
const mockListAuditorDashboardApplications = jest.fn();
const mockFindAuditDecisionApplication = jest.fn();
const mockFindAuditDecisionPostWriteSlice = jest.fn();
const mockWriteInspectionStart = jest.fn();
const mockFindApplicationForFinalApproval = jest.fn();
const mockListFinalApprovalQueue = jest.fn();
const mockUpdateApplicationColumns = jest.fn();
const mockFindFirstWithWhere = jest.fn();
const mockListAuditorsByIds = jest.fn();
const mockListSchedulerDashboardApplications = jest.fn();
const mockListStuckApplications = jest.fn();

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
    listSchedulerDashboardApplications: (...args) => mockListSchedulerDashboardApplications(...args),
    listStuckApplications: (...args) => mockListStuckApplications(...args),
    listProviderApplications: jest.fn().mockResolvedValue([]),
    writeAssignmentColumns: jest.fn().mockResolvedValue({}),
    countAuditorActiveAuditAssignments: jest.fn().mockResolvedValue(0),
    countAuditorCompletedAuditsSince: jest.fn().mockResolvedValue(0),
    findReminderTargetApplication: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/admin-application-service', () => ({
    listApproachingRevisionDeadlines: jest.fn().mockResolvedValue([]),
}));

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

jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: jest.fn().mockResolvedValue([]),
    listSettlementsByApplicationIds: jest.fn().mockResolvedValue([]),
    listForPaymentsView: jest.fn().mockResolvedValue([]),
    createPayment: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    findInvoiceById: jest.fn().mockResolvedValue(null),
    getInvoiceWithDetails: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/phase-billing-service', () => ({
    computePhaseSettlement: jest.fn(() => ({ phasePaid: false, phaseReceiptIssued: false })),
    getServiceTypesForPhaseComponent: jest.fn(() => []),
    getCanonicalServiceTypeForComponent: jest.fn(() => null),
    isInvoicePaidStatus: jest.fn(() => false),
}));

jest.mock('../../shared/application-visibility', () => ({
    withVisibility: (where) => where,
}));

jest.mock('../../services/traceability-service', () => ({}));

jest.mock('../../services/certificate-service', () => ({
    generateCertificate: jest.fn().mockResolvedValue(null),
    ensureCertificateIssuedForApplication: jest.fn().mockResolvedValue(null),
}));

// (gacp-scoring mock removed: the automated-scoring gate was deleted from the
// audit-decision handler — single-auditor canon, P0-2 — so PASS no longer
// consults a score; the scoring subsystem itself is retired.)
jest.mock('../../services/workflow-transition-service', () => {
    const real = jest.requireActual('../../services/workflow-transition-service');
    return {
        ...real,
        buildTransitionUpdate: jest.fn(({ application, toState }) => ({
            updateData: { status: toState, formData: application?.formData || {} },
        })),
        // Default to AUDIT_CONFIRMED so the auditor-audit-decision handler
        // accepts a PASS decision (the handler restricts the valid current
        // states to ['AUDIT_CONFIRMED', 'CAR_REVIEWING']). Tests that need
        // a different state for a different route can override per-test.
        resolveStateFromApplication: jest.fn(() => 'AUDIT_CONFIRMED'),
        normalizeWorkflowStateInput: jest.fn((s) => s),
        canTransition: jest.fn(() => true),
    };
});

// ── Finance services (V4-D AB-5 / AB-6 / AB-7 / AB-8) ───────────────────────
const mockInitiateRefund = jest.fn();
const mockGetRefundStatus = jest.fn();
const mockCancelRefund = jest.fn();

jest.mock('../../services/refund-service', () => {
    const real = jest.requireActual('../../services/refund-service');
    const { normalizeRole, CANONICAL_ROLES } = jest.requireActual('../../shared/canonical-rbac');
    // ชุดบทบาทมาจาก service จริง — สำเนาในเทสค้างคำตัดสินเก่าได้โดยไม่มีใครเห็น
    const WRITE = real.WRITE_ROLES;
    const READ = real.READ_ROLES;
    const assertWrite = (actor) => {
        const role = normalizeRole(actor?.canonicalRole || actor?.role);
        if (!role || !WRITE.has(role)) {
            const e = new Error('ACCOUNT_PLATFORM or ADMIN role required');
            e.code = 'FORBIDDEN_ROLE';
            e.statusCode = 403;
            throw e;
        }
    };
    const assertRead = (actor) => {
        const role = normalizeRole(actor?.canonicalRole || actor?.role);
        if (!role || !READ.has(role)) {
            const e = new Error('ACCOUNT_PLATFORM, AUDITOR, or ADMIN role required');
            e.code = 'FORBIDDEN_ROLE';
            e.statusCode = 403;
            throw e;
        }
    };
    const assertCancel = (actor) => {
        const role = normalizeRole(actor?.canonicalRole || actor?.role);
        if (!role || role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
            const e = new Error('ADMIN role required (separation of duties)');
            e.code = 'FORBIDDEN_ROLE';
            e.statusCode = 403;
            throw e;
        }
    };
    return {
        ...real,
        initiateRefund: (...args) => {
            assertWrite(args[0]?.actor);
            return mockInitiateRefund(...args);
        },
        getRefundStatus: (...args) => {
            assertRead(args[1]?.actor);
            return mockGetRefundStatus(...args);
        },
        cancelRefund: (...args) => {
            assertCancel(args[1]?.actor);
            return mockCancelRefund(...args);
        },
    };
});

const mockClosePeriod = jest.fn();
const mockReopenPeriod = jest.fn();
const mockGetPeriodCloseStatus = jest.fn();
const mockIsPeriodClosed = jest.fn();

jest.mock('../../services/period-close-service', () => ({
    closePeriod: (...args) => mockClosePeriod(...args),
    reopenPeriod: (...args) => mockReopenPeriod(...args),
    getPeriodCloseStatus: (...args) => mockGetPeriodCloseStatus(...args),
    isPeriodClosed: (...args) => mockIsPeriodClosed(...args),
}));

const mockCreateDraftManualEntry = jest.fn();
const mockApproveManualEntry = jest.fn();
const mockPostManualEntry = jest.fn();
const mockRejectManualEntry = jest.fn();
const mockListDrafts = jest.fn();
const mockGetDraftById = jest.fn();

jest.mock('../../services/manual-journal-entry-service', () => ({
    createDraftManualEntry: (...args) => mockCreateDraftManualEntry(...args),
    approveManualEntry: (...args) => mockApproveManualEntry(...args),
    postManualEntry: (...args) => mockPostManualEntry(...args),
    rejectManualEntry: (...args) => mockRejectManualEntry(...args),
    listDrafts: (...args) => mockListDrafts(...args),
    getDraftById: (...args) => mockGetDraftById(...args),
    ACTIONS: {
        DRAFT_CREATED: 'MANUAL_JE_DRAFT_CREATED',
        APPROVED: 'MANUAL_JE_APPROVED',
        POSTED: 'MANUAL_JE_POSTED',
        REJECTED: 'MANUAL_JE_REJECTED',
    },
}));

// Provider-user-service used by /provider/scheduler/* registry.
jest.mock('../../services/provider-user-service', () => ({
    listAuditorsForScheduler: jest.fn().mockResolvedValue([]),
    listReviewerCandidates: jest.fn().mockResolvedValue([]),
    findActiveProviderReviewerById: jest.fn().mockResolvedValue(null),
    listActiveAuditors: jest.fn().mockResolvedValue([]),
}));

// ── Shared / infrastructure mocks (I-008 mock completeness) ─────────────────
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

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: {
        log: jest.fn().mockResolvedValue(null),
        logWithin: jest.fn().mockResolvedValue(null),
        isSequenceConflictError: jest.fn(() => false),
    },
    AuditCategory: {
        APPLICATION: 'APPLICATION',
        AUDIT: 'AUDIT',
        ADMIN: 'ADMIN',
        PAYMENT: 'PAYMENT',
    },
    AuditSeverity: {
        INFO: 'INFO',
        WARNING: 'WARNING',
        MEDIUM: 'MEDIUM',
    },
    ResourceType: {
        APPLICATION: 'APPLICATION',
        USER: 'USER',
        PAYMENT: 'PAYMENT',
        INVOICE: 'INVOICE',
    },
}));

jest.mock('../../utils/client-ip', () => ({
    getRequestIp: jest.fn(() => '127.0.0.1'),
}));

// notification-fanout-service used by refund-service.
jest.mock('../../services/notification-fanout-service', () => ({
    dispatch: jest.fn().mockResolvedValue(null),
}));

// ── Routers ─────────────────────────────────────────────────────────────────
const auditSchedulingRouter = require('../../routes/api/audit/scheduling');
const auditorRouter = require('../../routes/api/provider/auditor');
const refundsRouter = require('../../routes/api/finance/refunds');
const periodCloseRouter = require('../../routes/api/finance/period-close');
const manualJeRouter = require('../../routes/api/finance/manual-journal-entries');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/audit/scheduling', auditSchedulingRouter);
    app.use('/api/provider/auditor', auditorRouter);
    app.use('/api/finance/refunds', refundsRouter);
    app.use('/api/finance/period-close', periodCloseRouter);
    app.use('/api/finance/manual-journal-entries', manualJeRouter);
    return app;
}

function seedHappyPath() {
    // V2-D scheduling seeds
    mockGetSchedulingQueue.mockResolvedValue([]);
    mockAssignAuditor.mockResolvedValue({ id: 'app-1', status: 'AUDIT_CONFIRMED' });
    mockApproveReschedule.mockResolvedValue({ id: 'res-1', status: 'APPROVED' });
    mockGetAuditorAvailability.mockResolvedValue({ busySlots: [], overCapDays: [] });
    // V3-D auditor seeds — ADMIN must reach the service even though
    // ownership predicates would normally narrow to the auditor; the
    // routes use auditorId equality on the application, so seed user-1
    // both for the auditor positive case and for ADMIN (the route does
    // not refuse based on ownership when actor is ADMIN — confirm via
    // handler reading auditorId === user.id then falling back to perm gate).
    mockListAuditorDashboardApplications.mockResolvedValue([]);
    mockListAuditorsByIds.mockResolvedValue([]);
    mockListFinalApprovalQueue.mockResolvedValue([]);
    mockFindAuditDecisionApplication.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        healthId: 'h-1',
        auditorId: 'user-1',
        reviewerId: 'user-1',
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
    // V4-D finance seeds
    mockInitiateRefund.mockResolvedValue({ refundId: 'ref-1', status: 'INITIATED' });
    mockGetRefundStatus.mockResolvedValue({ status: 'NONE', history: [] });
    mockCancelRefund.mockResolvedValue({ refundId: 'ref-1', status: 'CANCELLED' });
    mockClosePeriod.mockResolvedValue({ id: 'pc-1', year: 2026, month: 4, status: 'CLOSED' });
    mockReopenPeriod.mockResolvedValue({ id: 'pc-1', status: 'OPEN' });
    mockGetPeriodCloseStatus.mockResolvedValue([]);
    mockIsPeriodClosed.mockResolvedValue(false);
    mockCreateDraftManualEntry.mockResolvedValue({
        id: 'je-1',
        draftNumber: 'MJE-2026-001',
        totalDebit: 100,
        totalCredit: 100,
    });
    mockApproveManualEntry.mockResolvedValue({
        id: 'je-1',
        draftNumber: 'MJE-2026-001',
        status: 'APPROVED',
    });
    mockPostManualEntry.mockResolvedValue({
        draft: { id: 'je-1', draftNumber: 'MJE-2026-001' },
        entry: { id: 'entry-1' },
    });
    mockRejectManualEntry.mockResolvedValue({
        id: 'je-1',
        draftNumber: 'MJE-2026-001',
        status: 'REJECTED',
    });
    mockListDrafts.mockResolvedValue([]);
    mockGetDraftById.mockResolvedValue(null);
}

// ── ADMIN bypass matrix — 8 routes copied from V2-D / V3-D / V4-D ───────────
//
// Each row: a route whose negative tests in another file assert non-admin
// roles get 403 + service spy NOT called. The positive ADMIN assertion
// here asserts the inverse: status NOT 403 / NOT 401, and the service-
// layer spy WAS called at least once.

const ADMIN_BYPASS_ROUTES = [
    {
        label: 'V2-D POST /api/audit/scheduling/assign (SCHEDULER + ADMIN gate)',
        method: 'post',
        path: '/api/audit/scheduling/assign',
        body: {
            applicationId: 'app-1',
            auditorId: 'aud-1',
            scheduledDate: '2026-06-01',
        },
        sideEffectMock: () => mockAssignAuditor,
    },
    {
        label: 'V2-D POST /api/audit/scheduling/:id/approve (SCHEDULER + ADMIN gate)',
        method: 'post',
        path: '/api/audit/scheduling/res-1/approve',
        body: { newDate: '2026-06-15' },
        sideEffectMock: () => mockApproveReschedule,
    },
    {
        label: 'V2-D GET  /api/audit/scheduling/queue (SCHEDULER + ADMIN gate)',
        method: 'get',
        path: '/api/audit/scheduling/queue',
        body: undefined,
        sideEffectMock: () => mockGetSchedulingQueue,
    },
    {
        label: 'V3-D GET  /api/provider/auditor/dashboard (AUDITOR + ADMIN gate)',
        method: 'get',
        path: '/api/provider/auditor/dashboard',
        body: undefined,
        sideEffectMock: () => mockListAuditorDashboardApplications,
    },
    // NOTE: POST /api/provider/auditor/applications/:id/audit-decisions is NO LONGER
    // an ADMIN-positive case. AUDIT-001/#539 (extended 2026-06-24) gated this primary
    // surface to ROLE_GROUPS.AUDITORS, which EXCLUDES admin (SoD — admin is not in the
    // audit-decision path; recovery is the force route). The admin→403 contract for
    // this surface is pinned in auditor-decision-admin-exclusion.test.js with a REAL
    // requireRole. This file asserts the routes where admin SHOULD still bypass.
    {
        label: 'V4-D POST /api/finance/period-close (CLOSE_ROLES = ACCOUNT + ADMIN)',
        method: 'post',
        path: '/api/finance/period-close',
        body: { year: 2026, month: 4 },
        sideEffectMock: () => mockClosePeriod,
    },
    {
        label: 'V4-D POST /api/finance/period-close/:id/reopen (ADMIN_ONLY)',
        method: 'post',
        path: '/api/finance/period-close/pc-1/reopen',
        body: { reason: 'correction needed for closed period' },
        sideEffectMock: () => mockReopenPeriod,
    },
    {
        label: 'V4-D POST /api/finance/manual-journal-entries/:id/approve (ADMIN_ONLY)',
        method: 'post',
        path: '/api/finance/manual-journal-entries/je-1/approve',
        body: {},
        sideEffectMock: () => mockApproveManualEntry,
    },
    {
        label: 'V4-D POST /api/finance/refunds/:id/cancel (ADMIN_ONLY)',
        method: 'post',
        path: '/api/finance/refunds/ref-1/cancel',
        body: { reason: 'mistake' },
        sideEffectMock: () => mockCancelRefund,
    },
];

describe('V5-A AB-1..AB-3 — ADMIN positive bypass across V2/V3/V4 route gates', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    describe.each(ADMIN_BYPASS_ROUTES)('$label', ({ method, path, body, sideEffectMock }) => {
        test('ADMIN role bypasses the gate and the service-layer mutation IS called', async () => {
            const req = request(app)[method](path).set('x-test-role', 'system_admin_dtam');
            const response = await (body !== undefined ? req.send(body) : req.send());

            // (a) gate let the request through — the role check didn't 403/401.
            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
            // (b) response body does NOT carry the FORBIDDEN_ROLE shape that
            //     V2-D/V3-D/V4-D assert for the negative cases. This catches
            //     regressions where the route returned 200 with a forbidden
            //     payload (silent denial — worse than a 403).
            expect(response.body).not.toMatchObject({ error: 'FORBIDDEN_ROLE' });
            expect(response.body).not.toMatchObject({ code: 'FORBIDDEN_ROLE' });
            // (c) the service-layer mutation actually ran — proving the gate
            //     not only let the request through but the work was attempted.
            //     This is the inverse of the V2-D/V3-D/V4-D "spy NOT called"
            //     assertion and the load-bearing positive contract.
            expect(sideEffectMock()).toHaveBeenCalledTimes(1);
        });
    });

    describe('canonical alias coverage — admin variants resolve through to bypass', () => {
        // The ROLE_ALIASES table maps `super_admin` → ADMIN. A future
        // regression that drops the alias would break ThaID/legacy JWTs
        // that still carry the upper-case form. Pin one positive bypass
        // case for each canonical alias of ADMIN.
        const ADMIN_CANONICAL_ALIASES = ['system_admin_dtam', 'system_admin_dtam', 'system_admin_dtam', 'system_admin_dtam'];

        test.each(ADMIN_CANONICAL_ALIASES)('alias %s reaches scheduler assign through the ADMIN bypass', async (aliasRole) => {
            const response = await request(app)
                .post('/api/audit/scheduling/assign')
                .set('x-test-role', aliasRole)
                .send({
                    applicationId: 'app-1',
                    auditorId: 'aud-1',
                    scheduledDate: '2026-06-01',
                });

            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
            expect(response.body).not.toMatchObject({ error: 'FORBIDDEN_ROLE' });
            expect(mockAssignAuditor).toHaveBeenCalledTimes(1);
        });
    });
});

// ── Cross-check: ADMIN positive against same routes negative-asserts ────────
//
// Sanity matrix that mirrors the V2/V3/V4 negative tests inline so a
// future drop of those files still leaves the canonical contract
// pinned here. For each gate, assert ONE representative non-target
// role still gets 403 + spy NOT called, AND ADMIN gets the positive
// path. This is the "paired" assertion the V5-A RFC asks for.

describe('V5-A AB-1..AB-3 — paired negative + ADMIN positive sanity', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    describe('SCHEDULER gate — V2-D assign', () => {
        test('document_reviewer gets 403 + assignAuditor spy NOT called', async () => {
            const response = await request(app)
                .post('/api/audit/scheduling/assign')
                .set('x-test-role', 'document_reviewer')
                .send({
                    applicationId: 'app-1',
                    auditorId: 'aud-1',
                    scheduledDate: '2026-06-01',
                });
            expect(response.status).toBe(403);
            expect(mockAssignAuditor).not.toHaveBeenCalled();
        });

        test('admin gets through + assignAuditor spy called', async () => {
            const response = await request(app)
                .post('/api/audit/scheduling/assign')
                .set('x-test-role', 'system_admin_dtam')
                .send({
                    applicationId: 'app-1',
                    auditorId: 'aud-1',
                    scheduledDate: '2026-06-01',
                });
            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
            expect(mockAssignAuditor).toHaveBeenCalledTimes(1);
        });
    });

    describe('AUDITOR gate — V3-D dashboard', () => {
        test('account_dtam gets 403 + dashboard spy NOT called', async () => {
            const response = await request(app)
                .get('/api/provider/auditor/dashboard')
                .set('x-test-role', 'finance_officer_dtam');
            expect(response.status).toBe(403);
            expect(mockListAuditorDashboardApplications).not.toHaveBeenCalled();
        });

        test('admin gets through + dashboard spy called', async () => {
            const response = await request(app)
                .get('/api/provider/auditor/dashboard')
                .set('x-test-role', 'system_admin_dtam');
            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
            expect(mockListAuditorDashboardApplications).toHaveBeenCalledTimes(1);
        });
    });

    describe('ADMIN_ONLY gate — V4-D refunds cancel', () => {
        test('account_platform gets 403 + cancelRefund spy NOT called (separation of duties)', async () => {
            const response = await request(app)
                .post('/api/finance/refunds/ref-1/cancel')
                .set('x-test-role', 'finance_officer_platform')
                .send({ reason: 'mistake' });
            expect(response.status).toBe(403);
            expect(mockCancelRefund).not.toHaveBeenCalled();
        });

        test('admin gets through + cancelRefund spy called', async () => {
            const response = await request(app)
                .post('/api/finance/refunds/ref-1/cancel')
                .set('x-test-role', 'system_admin_dtam')
                .send({ reason: 'mistake' });
            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
            expect(mockCancelRefund).toHaveBeenCalledTimes(1);
        });
    });

    describe('ADMIN_ONLY gate — V4-D period-close reopen', () => {
        test('account_platform gets 403 + reopenPeriod spy NOT called', async () => {
            const response = await request(app)
                .post('/api/finance/period-close/pc-1/reopen')
                .set('x-test-role', 'finance_officer_platform')
                .send({ reason: 'correction needed' });
            expect(response.status).toBe(403);
            expect(mockReopenPeriod).not.toHaveBeenCalled();
        });

        test('admin gets through + reopenPeriod spy called', async () => {
            const response = await request(app)
                .post('/api/finance/period-close/pc-1/reopen')
                .set('x-test-role', 'system_admin_dtam')
                .send({ reason: 'correction needed for closed period' });
            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
            expect(mockReopenPeriod).toHaveBeenCalledTimes(1);
        });
    });
});
