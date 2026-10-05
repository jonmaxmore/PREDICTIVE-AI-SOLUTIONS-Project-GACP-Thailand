/**
 * V3-D RB-4 SCOPE CORRECTNESS — AUDITOR ownership-gate contract.
 *
 * Why this test exists:
 *   - V3-D RBAC matrix in `auditor-routes-rbac.test.js` proves cross-role
 *     denial (non-AUDITOR roles get 403 on /audit-decisions etc.). BUT
 *     V3 RFC §RB-4 calls out a *second*, distinct contract: an AUDITOR
 *     must not be able to touch ANOTHER auditor's assigned audit.
 *   - The user's worry was explicit ("ไม่มีการข้ามสิทธ์"). For an
 *     all-staff-canonical-role like AUDITOR the canonical permission
 *     check (`requireCanonicalPermission(APPLICATION_AUDIT_RECORD)`)
 *     is GLOBAL — it lets every AUDITOR through. The scope guard is the
 *     per-handler ownership check at:
 *       - auditor-audit-decision-handler.js:58-61 (`application.auditorId
 *         !== req.user.id` → 403 unless ADMIN)
 *       - auditor-inspection-start-handler.js:36-39 (same gate)
 *   - This test asserts the ownership gate with TWO distinct AUDITOR
 *     tokens: A (assigned) and B (not assigned). Application belongs
 *     to A. The test pins:
 *       1. AUDITOR B → 403 on /audit-decisions; writeApplicationStatus
 *          NOT called.
 *       2. AUDITOR B → 403 on /inspection-starts; writeInspectionStart
 *          NOT called.
 *       3. AUDITOR A → NOT 403 (gate lets them through).
 *       4. ADMIN → 403 (excluded from AUDITORS, no ownership bypass — SoD).
 *
 * Pattern: mirrors V2-D's cross-role-boundary.test.js. The auth-middleware
 * mock attaches req.user from headers; canonical-rbac stays REAL via
 * jest.requireActual; the service layer is mocked so we assert no
 * side-effect on the 403 path.
 *
 * See: docs/handoffs/iter-V3/00-rfc.md §V3-D / RB-4.
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

// ── Service-layer mocks ─────────────────────────────────────────────────────
// application-service: the handler under test calls
// findAuditDecisionApplication(idOrNumber) and we set up auditorId so
// auditor A owns the audit and auditor B does not. The downstream write
// methods are spied so we can assert "no side-effect on 403".
const AUDITOR_A_ID = 'auditor-a-id';
const AUDITOR_B_ID = 'auditor-b-id';

const mockFindAuditDecisionApplication = jest.fn();
const mockWriteInspectionStart = jest.fn();
const mockFindAuditDecisionPostWriteSlice = jest.fn();
const mockUpdateApplicationColumns = jest.fn();
const mockFindFirstWithWhere = jest.fn();
const mockListAuditorsByIds = jest.fn();
const mockListAuditorDashboardApplications = jest.fn();
const mockListFinalApprovalQueue = jest.fn();
const mockFindApplicationForFinalApproval = jest.fn();

jest.mock('../../services/application-service', () => ({
    findAuditDecisionApplication: (...args) => mockFindAuditDecisionApplication(...args),
    writeInspectionStart: (...args) => mockWriteInspectionStart(...args),
    findAuditDecisionPostWriteSlice: (...args) => mockFindAuditDecisionPostWriteSlice(...args),
    updateApplicationColumns: (...args) => mockUpdateApplicationColumns(...args),
    findFirstWithWhere: (...args) => mockFindFirstWithWhere(...args),
    listAuditorsByIds: (...args) => mockListAuditorsByIds(...args),
    listAuditorDashboardApplications: (...args) => mockListAuditorDashboardApplications(...args),
    listFinalApprovalQueue: (...args) => mockListFinalApprovalQueue(...args),
    findApplicationForFinalApproval: (...args) => mockFindApplicationForFinalApproval(...args),
}));

const mockWriteApplicationStatus = jest.fn();
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...args) => mockWriteApplicationStatus(...args),
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

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));

jest.mock('../../services/user-lookup-service', () => ({
    resolveUserIdFromHealthIdSecurely: jest.fn().mockResolvedValue('u-1'),
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(null), logWithin: jest.fn().mockResolvedValue(null) },
    AuditCategory: { APPLICATION: 'APPLICATION', AUDIT: 'AUDIT' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', MEDIUM: 'MEDIUM' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: jest.fn().mockResolvedValue([
        // Phase 2 receipt issued so inspection-start passes the
        // isPhase2ReceiptIssued gate (the gate after ownership check)
        // and the test focuses on ownership, not billing.
        { applicationId: 'app-1', serviceType: 'PHASE_2_STATE_FEE', status: 'PAID', receiptIssued: true },
    ]),
    listSettlementsByApplicationIds: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/phase-billing-service', () => ({
    computePhaseSettlement: jest.fn(() => ({ phasePaid: true, phaseReceiptIssued: true })),
    getServiceTypesForPhaseComponent: jest.fn(() => []),
    getCanonicalServiceTypeForComponent: jest.fn(() => null),
    isInvoicePaidStatus: jest.fn(() => true),
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
}));

// (gacp-scoring mock removed: PASS no longer consults an automated score —
// single-auditor canon, P0-2 — and the scoring subsystem is retired.)

// workflow-transition-service stays REAL so resolveStateFromApplication
// returns the canonical state for the seeded application.
jest.mock('../../services/workflow-transition-service', () => {
    const real = jest.requireActual('../../services/workflow-transition-service');
    return {
        ...real,
        buildTransitionUpdate: jest.fn(({ application, toState }) => ({
            updateData: { status: toState, formData: application?.formData || {} },
        })),
    };
});

function seedApplicationOwnedBy(auditorId) {
    // Application is in AUDIT_CONFIRMED, owned by `auditorId`. The
    // handler's currentState resolver inspects formData.workflowState if
    // present; supply it so resolveStateFromApplication returns
    // AUDIT_CONFIRMED (the only state where /inspection-starts is
    // allowed AND the only state where /audit-decisions accepts a PASS).
    mockFindAuditDecisionApplication.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        healthId: 'h-1',
        auditorId,
        status: 'AUDIT_CONFIRMED',
        formData: {
            workflowState: 'AUDIT_CONFIRMED',
            reviewedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        },
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
        status: 'AUDIT_CONFIRMED',
    });
    mockUpdateApplicationColumns.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        status: 'AUDIT_CONFIRMED',
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

// ── RB-4 scope-correctness on POST /audit-decisions ─────────────────────────

describe('V3-D RB-4 — AUDITOR B cannot record decision on AUDITOR A\'s audit', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Application is OWNED by auditor A.
        seedApplicationOwnedBy(AUDITOR_A_ID);
    });

    test('AUDITOR B → 403 with "not assigned" message (writeApplicationStatus NOT called)', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/audit-decisions')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', AUDITOR_B_ID)
            .send({ decision: 'PASS' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ success: false });
        // The exact message uses "not assigned to this auditor"; pin
        // the substring to detect copy regressions in the canonical
        // handler.
        expect(String(response.body.error || '')).toMatch(/not assigned/i);

        // LOAD-BEARING: the canonical writer MUST NOT have been called.
        // A 403 that still committed the status change would mean B can
        // poison A's audit even though the response says "forbidden".
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
    });

    test('AUDITOR A → NOT 403 (owns the audit, gate lets through)', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/audit-decisions')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', AUDITOR_A_ID)
            .send({ decision: 'PASS' });

        // Any non-403 / non-401 means the ownership gate let the
        // request through. Downstream may 200 (happy path) or 400
        // depending on body validity — we assert only that the scope
        // gate did not intercept.
        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
    });

    // AUDIT-001/#539 (extended 2026-06-24): admin is REMOVED from the audit-decision
    // path — there is no ownership bypass. requireRole is mocked no-op in THIS suite,
    // so this now exercises the unconditional ownership check (admin-id ≠ owner → 403);
    // the real AUDITORS-gate rejection is pinned in auditor-decision-admin-exclusion.test.js.
    test('ADMIN → 403 (excluded; no ownership bypass — AUDIT-001)', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/audit-decisions')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-user-id', 'admin-id')
            .send({ decision: 'PASS' });

        expect(response.status).toBe(403);
    });
});

// ── RB-4 scope-correctness on POST /inspection-starts ──────────────────────

describe('V3-D RB-4 — AUDITOR B cannot start inspection on AUDITOR A\'s audit', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedApplicationOwnedBy(AUDITOR_A_ID);
    });

    test('AUDITOR B → 403 with "not assigned" (writeInspectionStart NOT called)', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/inspection-starts')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', AUDITOR_B_ID)
            .send({});

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ success: false });
        expect(String(response.body.error || '')).toMatch(/not assigned/i);

        // LOAD-BEARING: the service-layer write MUST NOT have been called.
        expect(mockWriteInspectionStart).not.toHaveBeenCalled();
    });

    test('AUDITOR A → NOT 403 (owns the audit)', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/inspection-starts')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', AUDITOR_A_ID)
            .send({});

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
    });

    // provider-E2E carpet 2026-07-09 (LOW): inspection-start is now aligned with
    // its audit-decision sibling — admin is REMOVED from the auditor path (gated
    // to AUDITORS + the ADMIN ownership-bypass dropped). requireRole is mocked
    // no-op in THIS suite, so this exercises the unconditional ownership check
    // (admin-id ≠ owner → 403); the real AUDITORS-gate rejection lands the same
    // 403 in production before the handler body.
    test('ADMIN → 403 (excluded; no ownership bypass — SoD, matches audit-decisions)', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/inspection-starts')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-user-id', 'admin-id')
            .send({});

        expect(response.status).toBe(403);
    });
});

// ── RB-4 cross-ownership flip — same contract from the other side ──────────

describe('V3-D RB-4 — flip: if application is owned by B, then A is the intruder', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Flip: application is OWNED by B.
        seedApplicationOwnedBy(AUDITOR_B_ID);
    });

    test('AUDITOR A → 403 (decision on B\'s audit blocked)', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/audit-decisions')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', AUDITOR_A_ID)
            .send({ decision: 'PASS' });

        expect(response.status).toBe(403);
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
    });

    test('AUDITOR B → NOT 403 (owns the audit)', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/audit-decisions')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', AUDITOR_B_ID)
            .send({ decision: 'PASS' });

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
    });

    // AUDIT-001/#539 (extended 2026-06-24): admin is excluded regardless of owner.
    test('ADMIN → 403 (excluded regardless of owner — AUDIT-001)', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/audit-decisions')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-user-id', 'admin-id')
            .send({ decision: 'PASS' });

        expect(response.status).toBe(403);
    });
});
