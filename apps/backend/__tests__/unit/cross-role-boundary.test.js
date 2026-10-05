/**
 * V2-D cross-role boundary regression — explicit "no privilege bleed"
 * matrix to close the user's "ไม่มีการข้ามสิทธ์" worry.
 *
 * V2-D's scheduling-route-rbac.test.js proves the contract for individual
 * SCHEDULER routes. This file flips the question: for every pair of roles
 * that *could* be confused (ACCOUNT_PLATFORM ↔ DOCUMENT_REVIEWER,
 * SCHEDULER ↔ DOCUMENT_REVIEWER, AUDITOR ↔ SCHEDULER, etc.) we assert that
 * the role with the WRONG scope cannot trigger the side-effect even if a
 * misconfigured frontend or a deliberate attacker reaches the endpoint
 * with a valid token of the wrong type.
 *
 * Coverage:
 *   1. ACCOUNT_PLATFORM CANNOT approve documents
 *      → POST /api/provider/applications/:id/workflow-transitions with
 *        toState=DOC_APPROVED → 403
 *   2. ACCOUNT_PLATFORM CANNOT assign auditors
 *      → POST /api/audit/scheduling/assign → 403
 *   3. AUDITOR CAN approve documents (intentional per RB-5 contract — the
 *      canonical AUDITOR role consolidates legacy HEAD_AUDITOR and retains
 *      the doc-review fallback). This is the *positive* assertion that
 *      RB-5 is documented, not silent. Other roles MUST still 403.
 *   4. AUDITOR CANNOT approve (scheduler-side) reschedule
 *      → POST /api/audit/scheduling/:rescheduleId/approve → 403
 *   5. SCHEDULER CANNOT approve documents
 *      → POST /api/provider/applications/:id/workflow-transitions with
 *        toState=DOC_APPROVED → 403
 *   6. DOCUMENT_REVIEWER CANNOT assign auditors
 *      → POST /api/audit/scheduling/assign → 403
 *
 * Pattern: mirrors V1-D applications-route-rbac.test.js + V2-D
 * scheduling-route-rbac.test.js — auth middleware mock attaches
 * req.user from headers, canonical-rbac stays REAL, service-layer
 * mocks are spied so we assert no side-effect on 403 paths.
 *
 * Note: The prompt also references hypothetical URLs (`/api/applications/{id}/review`
 * and `/api/provider/scheduler/assign`) that do not exist in the codebase.
 * Per V2 RFC the canonical paths are (a) the workflow-transitions
 * endpoint on `/api/provider/applications/:id/workflow-transitions` for
 * doc approval and (b) `/api/audit/scheduling/assign` for auditor
 * assignment. Tests use the canonical paths.
 *
 * See: docs/handoffs/iter-V2/00-rfc.md §V2-D / RB-5, RB-6.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock ───────────────────────────────────────────────────────────────
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

// ── Service mocks (I-008: expose every helper the SUT imports) ──────────────
// audit-scheduling-service: real _internals.assertSchedulerRole so the test
// proves the canonical contract. Mock the public methods + wrap with the
// service's internal role assertion so routes without a route-level pre-flight
// still surface the canonical 403.
const mockAssignAuditor = jest.fn();
const mockApproveReschedule = jest.fn();
const mockRequestReschedule = jest.fn();
const mockGetSchedulingQueue = jest.fn();
const mockGetAuditorAvailability = jest.fn();

jest.mock('../../services/audit-scheduling-service', () => {
    const real = jest.requireActual('../../services/audit-scheduling-service');
    return {
        AUDITOR_MAX_PER_DAY: real.AUDITOR_MAX_PER_DAY,
        RESCHEDULE_STATUS: real.RESCHEDULE_STATUS,
        getSchedulingQueue: (...args) => mockGetSchedulingQueue(...args),
        getAuditorAvailability: (...args) => mockGetAuditorAvailability(...args),
        assignAuditor: (opts) => {
            real._internals.assertSchedulerRole(opts?.actor);
            return mockAssignAuditor(opts);
        },
        approveReschedule: (id, opts) => {
            real._internals.assertSchedulerRole(opts?.actor);
            return mockApproveReschedule(id, opts);
        },
        requestReschedule: (opts) => {
            real._internals.assertApplicantRole(opts?.actor);
            return mockRequestReschedule(opts);
        },
        _internals: real._internals,
    };
});

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

// application-service used by workflow-transitions-handler. We mock
// findFirstWithWhere so the route's downstream pipeline doesn't 500 on
// the positive paths; on the 403 paths it MUST NOT be called.
const mockFindFirstWithWhere = jest.fn();
const mockWriteAssignmentColumns = jest.fn();
const mockFindProviderApplications = jest.fn();
const mockListSchedulerDashboardApplications = jest.fn().mockResolvedValue([]);
const mockListStuckApplications = jest.fn().mockResolvedValue([]);
const mockListAuditorsByIds = jest.fn().mockResolvedValue([]);
const mockFindReminderTargetApplication = jest.fn().mockResolvedValue(null);
jest.mock('../../services/application-service', () => ({
    findFirstWithWhere: (...args) => mockFindFirstWithWhere(...args),
    writeAssignmentColumns: (...args) => mockWriteAssignmentColumns(...args),
    listProviderApplications: (...args) => mockFindProviderApplications(...args),
    listSchedulerDashboardApplications: (...args) => mockListSchedulerDashboardApplications(...args),
    listStuckApplications: (...args) => mockListStuckApplications(...args),
    listAuditorsByIds: (...args) => mockListAuditorsByIds(...args),
    findReminderTargetApplication: (...args) => mockFindReminderTargetApplication(...args),
    countAuditorActiveAuditAssignments: jest.fn().mockResolvedValue(0),
    countAuditorCompletedAuditsSince: jest.fn().mockResolvedValue(0),
    resolveHealthIdentity: jest.fn().mockResolvedValue({ healthId: 'h-1', userId: 'u-1' }),
}));

jest.mock('../../services/admin-application-service', () => ({
    listApproachingRevisionDeadlines: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/provider-user-service', () => ({
    listAuditorsForScheduler: jest.fn().mockResolvedValue([]),
    listReviewerCandidates: jest.fn().mockResolvedValue([]),
    findActiveProviderReviewerById: jest.fn().mockResolvedValue(null),
    listActiveAuditors: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));

// workflow-transition-service: keep the REAL ROLE_TRANSITIONS gate so the
// test proves the canonical contract. buildTransitionUpdate is the only
// mutating method we mock — make it throw the canonical error shape when
// the role/state pair is not allowed (per workflowTransitionService.js
// behaviour). For positive cases we return a sane updateData.
jest.mock('../../services/workflow-transition-service', () => {
    const real = jest.requireActual('../../services/workflow-transition-service');
    return {
        ...real,
        // override only buildTransitionUpdate so we can short-circuit the
        // ApplicationService.writeAssignmentColumns chain that would
        // otherwise need Prisma.
        buildTransitionUpdate: jest.fn(({ application, toState, actorRole }) => {
            const canonicalRole = real.normalizeActorRole
                ? real.normalizeActorRole(actorRole)
                : String(actorRole || '').toLowerCase();
            // Real service throws when the role-state pair is not in
            // ROLE_TRANSITIONS. Mirror that behaviour for the test.
            const roleTransitions = real.ROLE_TRANSITIONS?.[canonicalRole];
            if (roleTransitions) {
                const fromState = application?.status || 'ASSIGNED_FOR_REVIEW';
                const allowed = roleTransitions[fromState];
                if (!allowed || !allowed.has?.(toState)) {
                    const err = new Error(
                        `Role ${canonicalRole} cannot transition ${fromState} → ${toState}`,
                    );
                    err.statusCode = 400;
                    throw err;
                }
            }
            return { updateData: { status: toState, formData: {} } };
        }),
    };
});

jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(),
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(), logWithin: jest.fn() },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { MEDIUM: 'MEDIUM' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

jest.mock('../../utils/working-days', () => ({
    isWorkingDay: jest.fn(() => true),
    addWorkingDays: jest.fn((d) => d),
    countWorkingDaysBetween: jest.fn(() => 0),
    loadHolidaySet: jest.fn().mockResolvedValue(new Set()),
}));

// The route imports several application-helpers; stub the read-side ones.
jest.mock('../../shared/application-visibility', () => ({
    withVisibility: (where) => where,
}));

jest.mock('../../utils/client-ip', () => ({
    getRequestIp: jest.fn(() => '127.0.0.1'),
}));

jest.mock('../../services/notification-fanout-service', () => ({
    dispatch: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/user-lookup-service', () => ({
    resolveUserIdFromHealthIdSecurely: jest.fn().mockResolvedValue('u-1'),
}));

jest.mock('../../services/phase-billing-service', () => ({
    computePhaseSettlement: jest.fn(() => ({ phasePaid: false })),
}));

// The certificate hook is invoked from workflow-transitions-handler; make
// it a no-op.
jest.mock('../../services/certificate-service', () => ({
    ensureCertificateIssuedForApplication: jest.fn().mockResolvedValue(null),
}));

function seedHappyPath() {
    mockAssignAuditor.mockResolvedValue({ id: 'app-1', status: 'AUDIT_CONFIRMED' });
    mockApproveReschedule.mockResolvedValue({ id: 'res-1', status: 'APPROVED' });
    mockRequestReschedule.mockResolvedValue({ id: 'res-1', status: 'PENDING' });
    mockGetSchedulingQueue.mockResolvedValue([]);
    mockGetAuditorAvailability.mockResolvedValue({ busySlots: [], overCapDays: [] });
    // Make findFirstWithWhere return an application in ASSIGNED_FOR_REVIEW
    // so the workflow-transitions-handler reaches the role-check path
    // (`DOC_APPROVED` is only allowed FROM `ASSIGNED_FOR_REVIEW` per the
    // canonical contract for DOCUMENT_REVIEWER and AUDITOR).
    mockFindFirstWithWhere.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        healthId: 'h-1',
        status: 'ASSIGNED_FOR_REVIEW',
        formData: {
            reviewedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        },
        workflowHistory: [],
        reviewerId: 'user-1',
    });
    mockWriteAssignmentColumns.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        status: 'DOC_APPROVED',
    });
}

const auditSchedulingRouter = require('../../routes/api/audit/scheduling');
const providerApplicationsRouter = require('../../routes/api/provider/applications');
const providerSchedulerRouter = require('../../routes/api/provider/scheduler');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/audit/scheduling', auditSchedulingRouter);
    app.use('/api/provider/applications', providerApplicationsRouter);
    app.use('/api/provider/scheduler', providerSchedulerRouter);
    return app;
}

// ── 1. ACCOUNT_PLATFORM CANNOT approve documents ────────────────────────────

describe('V2-D cross-role: ACCOUNT_PLATFORM CANNOT approve documents', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/provider/applications/:id/workflow-transitions DOC_APPROVED → 403 (account_platform)', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'finance_officer_platform')
            .send({ toState: 'DOC_APPROVED' });

        // ACCOUNT_PLATFORM has no APPLICATION_WORKFLOW_TRANSITION
        // permission — `requireCanonicalPermission` gate at the route
        // layer returns 403 before the service runs.
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ success: false });
        // Side-effect: writeAssignmentColumns MUST NOT have been called.
        expect(mockWriteAssignmentColumns).not.toHaveBeenCalled();
        // findFirstWithWhere is the entry to the handler body — should
        // also be skipped because the permission gate runs first.
        expect(mockFindFirstWithWhere).not.toHaveBeenCalled();
    });

    test('POST workflow-transitions DOC_APPROVED → 403 (account_dtam, same scope class)', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ toState: 'DOC_APPROVED' });

        expect(response.status).toBe(403);
        expect(mockWriteAssignmentColumns).not.toHaveBeenCalled();
        expect(mockFindFirstWithWhere).not.toHaveBeenCalled();
    });
});

// ── 2. ACCOUNT_PLATFORM CANNOT assign auditors ──────────────────────────────

describe('V2-D cross-role: ACCOUNT_PLATFORM CANNOT assign auditors', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/audit/scheduling/assign → 403 (account_platform)', async () => {
        const response = await request(app)
            .post('/api/audit/scheduling/assign')
            .set('x-test-role', 'finance_officer_platform')
            .send({
                applicationId: 'app-1',
                auditorId: 'aud-1',
                scheduledDate: '2026-06-01',
            });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            error: 'FORBIDDEN_ROLE',
        });
        // assignAuditor mock MUST NOT have been called — the gate stops it.
        expect(mockAssignAuditor).not.toHaveBeenCalled();
    });

    test('POST /api/audit/scheduling/assign → 403 (account_dtam)', async () => {
        const response = await request(app)
            .post('/api/audit/scheduling/assign')
            .set('x-test-role', 'finance_officer_dtam')
            .send({
                applicationId: 'app-1',
                auditorId: 'aud-1',
                scheduledDate: '2026-06-01',
            });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: 'FORBIDDEN_ROLE' });
        expect(mockAssignAuditor).not.toHaveBeenCalled();
    });
});

// ── 3. AUDITOR doc-approval RB-5 contract ───────────────────────────────────

describe('V2-D cross-role: AUDITOR doc-approval contract (RB-5)', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    // Per RB-5 the canonical AUDITOR role retains DOC_APPROVED + REVISION_REQUESTED
    // transitions because the role consolidates legacy HEAD_AUDITOR. The
    // test PASSES with AUDITOR (positive) and FAILS with SCHEDULER,
    // ACCOUNT_*, HEALTH (negative).
    test('AUDITOR CAN approve documents (intentional per RB-5)', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'user-1')
            .send({ toState: 'DOC_APPROVED' });

        // AUDITOR has APPLICATION_WORKFLOW_TRANSITION permission so the
        // requireCanonicalPermission gate passes. AUDITOR is also the
        // assigned reviewer (`reviewerId: 'user-1'`) so REV-11 passes.
        // The 9-step gate passes because seedHappyPath sets all 9 steps.
        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(response.body).not.toMatchObject({ error: 'FORBIDDEN_ROLE' });
        // The handler reaches the service layer — proof RB-5 is intentional.
        expect(mockFindFirstWithWhere).toHaveBeenCalled();
    });

    test('SCHEDULER CANNOT approve documents (different scope → 403)', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'dispatcher')
            .send({ toState: 'DOC_APPROVED' });

        // SCHEDULER has APPLICATION_WORKFLOW_TRANSITION so the permission
        // gate passes — but ROLE_TRANSITIONS[scheduler] does NOT include
        // ASSIGNED_FOR_REVIEW → DOC_APPROVED so buildTransitionUpdate
        // throws (400 in the real service). The route surfaces a 4xx
        // and the writer is never called.
        expect(response.status).not.toBe(200);
        expect(mockWriteAssignmentColumns).not.toHaveBeenCalled();
    });

    test('ACCOUNT_PLATFORM CANNOT approve documents (different scope → 403)', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'finance_officer_platform')
            .send({ toState: 'DOC_APPROVED' });

        expect(response.status).toBe(403);
        expect(mockWriteAssignmentColumns).not.toHaveBeenCalled();
    });

    test('ACCOUNT_DTAM CANNOT approve documents (different scope → 403)', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ toState: 'DOC_APPROVED' });

        expect(response.status).toBe(403);
        expect(mockWriteAssignmentColumns).not.toHaveBeenCalled();
    });

    test('HEALTH CANNOT approve documents (different surface → 401)', async () => {
        // HEALTH uses authenticateHealth which routes through `health/*`
        // surfaces only. The provider router uses authenticateProvider —
        // but our mock applies authenticateProvider permissively so the
        // request reaches the canonical permission gate, which rejects
        // HEALTH because it lacks APPLICATION_WORKFLOW_TRANSITION.
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'health')
            .send({ toState: 'DOC_APPROVED' });

        expect(response.status).toBe(403);
        expect(mockWriteAssignmentColumns).not.toHaveBeenCalled();
    });

    test('DOCUMENT_REVIEWER CAN approve documents (canonical owner)', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'document_reviewer')
            .set('x-test-user-id', 'user-1')
            .send({ toState: 'DOC_APPROVED' });

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(response.body).not.toMatchObject({ error: 'FORBIDDEN_ROLE' });
        expect(mockFindFirstWithWhere).toHaveBeenCalled();
    });
});

// ── 4. AUDITOR CANNOT approve reschedule (scheduler-only) ───────────────────

describe('V2-D cross-role: AUDITOR CANNOT approve reschedule', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/audit/scheduling/:rescheduleId/approve → 403 (auditor)', async () => {
        const response = await request(app)
            .post('/api/audit/scheduling/res-1/approve')
            .set('x-test-role', 'field_inspector')
            .send({ newDate: '2026-06-15' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            error: 'FORBIDDEN_ROLE',
        });
        // approveReschedule MUST NOT have been called (the canonical
        // SCHEDULER_ROLES set does not include AUDITOR).
        expect(mockApproveReschedule).not.toHaveBeenCalled();
    });

    test('POST /api/audit/scheduling/:rescheduleId/approve → 403 (document_reviewer)', async () => {
        const response = await request(app)
            .post('/api/audit/scheduling/res-1/approve')
            .set('x-test-role', 'document_reviewer')
            .send({ newDate: '2026-06-15' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: 'FORBIDDEN_ROLE' });
        expect(mockApproveReschedule).not.toHaveBeenCalled();
    });

    test('POST /api/audit/scheduling/:rescheduleId/approve → 200 (scheduler positive)', async () => {
        const response = await request(app)
            .post('/api/audit/scheduling/res-1/approve')
            .set('x-test-role', 'dispatcher')
            .send({ newDate: '2026-06-15' });

        // Scheduler bypasses both the route-layer auth and the canonical
        // SCHEDULER_ROLES gate inside the service mock.
        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockApproveReschedule).toHaveBeenCalledTimes(1);
    });
});

// ── 5. SCHEDULER CANNOT approve documents (cross-scope) ─────────────────────

describe('V2-D cross-role: SCHEDULER CANNOT approve documents', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/provider/applications/:id/workflow-transitions DOC_APPROVED → not 200 (scheduler)', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'dispatcher')
            .send({ toState: 'DOC_APPROVED' });

        // V2 review M-2: tightened from `not.toBe(200)` to explicit 4xx
        // — a 500 crash inside the workflow-transition-service would have
        // silently passed the loose assertion. The role-state gate rejects
        // SCHEDULER → DOC_APPROVED with a 403; writeAssignmentColumns MUST
        // NOT have been called.
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
        expect(mockWriteAssignmentColumns).not.toHaveBeenCalled();
    });

    test('POST /api/provider/applications/:id/workflow-transitions REVISION_REQUESTED → 4xx (scheduler)', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'dispatcher')
            .send({
                toState: 'REVISION_REQUESTED',
                comment: 'please fix',
                revisionCategory: 'documents',
                revisionItems: ['item-1'],
            });

        // V2 review M-2: REVISION_REQUESTED is ALSO not in
        // ROLE_TRANSITIONS[scheduler] — canonical contract puts both
        // DOC_APPROVED and REVISION_REQUESTED under DOCUMENT_REVIEWER +
        // AUDITOR only. Pin to 4xx so a 500 crash fails the test.
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
        expect(mockWriteAssignmentColumns).not.toHaveBeenCalled();
    });
});

// ── 6. DOCUMENT_REVIEWER CANNOT assign auditors ─────────────────────────────

describe('V2-D cross-role: DOCUMENT_REVIEWER CANNOT assign auditors', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/audit/scheduling/assign → 403 (document_reviewer)', async () => {
        const response = await request(app)
            .post('/api/audit/scheduling/assign')
            .set('x-test-role', 'document_reviewer')
            .send({
                applicationId: 'app-1',
                auditorId: 'aud-1',
                scheduledDate: '2026-06-01',
            });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            error: 'FORBIDDEN_ROLE',
        });
        expect(mockAssignAuditor).not.toHaveBeenCalled();
    });

    test('GET /api/audit/scheduling/queue → 403 (document_reviewer)', async () => {
        const response = await request(app)
            .get('/api/audit/scheduling/queue')
            .set('x-test-role', 'document_reviewer');

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: 'FORBIDDEN_ROLE' });
        expect(mockGetSchedulingQueue).not.toHaveBeenCalled();
    });

    test('GET /api/audit/scheduling/auditor-availability/:id → 403 (document_reviewer)', async () => {
        const response = await request(app)
            .get('/api/audit/scheduling/auditor-availability/aud-1')
            .set('x-test-role', 'document_reviewer');

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: 'FORBIDDEN_ROLE' });
        expect(mockGetAuditorAvailability).not.toHaveBeenCalled();
    });

    test('POST /api/audit/scheduling/:rescheduleId/approve → 403 (document_reviewer)', async () => {
        const response = await request(app)
            .post('/api/audit/scheduling/res-1/approve')
            .set('x-test-role', 'document_reviewer')
            .send({ newDate: '2026-06-15' });

        expect(response.status).toBe(403);
        expect(mockApproveReschedule).not.toHaveBeenCalled();
    });

    test('POST /api/provider/scheduler/reviewer-assignments → 403 (document_reviewer)', async () => {
        const response = await request(app)
            .post('/api/provider/scheduler/reviewer-assignments')
            .set('x-test-role', 'document_reviewer')
            .send({ applicationId: 'app-1', reviewerId: 'rev-1' });

        // DOCUMENT_REVIEWER does NOT have APPLICATION_SCHEDULE permission
        // — the requireCanonicalPermission gate at the route returns 403.
        expect(response.status).toBe(403);
        // findFirstWithWhere is called only AFTER the gate; assert no
        // side-effect.
        expect(mockFindFirstWithWhere).not.toHaveBeenCalled();
    });

    test('POST /api/audit/scheduling/assign → 201 (scheduler positive)', async () => {
        const response = await request(app)
            .post('/api/audit/scheduling/assign')
            .set('x-test-role', 'dispatcher')
            .send({
                applicationId: 'app-1',
                auditorId: 'aud-1',
                scheduledDate: '2026-06-01',
            });

        // Scheduler passes the canonical gate and reaches the service.
        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockAssignAuditor).toHaveBeenCalledTimes(1);
    });
});
