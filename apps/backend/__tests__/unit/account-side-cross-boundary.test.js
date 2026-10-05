/**
 * V4-D account-side cross-boundary regression — explicit "no privilege
 * bleed" matrix for the two new split accounting roles.
 *
 * Why this test exists:
 *   - Loop V Iter 4 split the legacy ACCOUNT role into ACCOUNT_DTAM
 *     (state-fee side) and ACCOUNT_PLATFORM (platform-fee + subscriptions
 *     + period-close + manual-JE + refunds + purchase-invoices + WHT).
 *   - The two-money-flow wall (RFC §V4-C / TM-1..TM-7) lives inside the
 *     services. THIS file tests the COMPLEMENTARY cross-role boundary:
 *     neither split role can reach DOCUMENT_REVIEWER mutations, SCHEDULER
 *     mutations, AUDITOR mutations, or ADMIN-only mutations (period-
 *     reopen, manual-JE-approve/post/reject, refund-cancel,
 *     certificate-revocation).
 *   - Inverse symmetry: ACCOUNT_DTAM cannot do PLATFORM-only finance
 *     operations (refund/credit-note/manual-JE/period-close/purchase-
 *     invoice/WHT) and ACCOUNT_PLATFORM cannot do DTAM-only operations
 *     (currently DTAM has no exclusive routes — the asymmetry is by
 *     design per RFC §V4-RFC context: DTAM is review-only, no JE/refund/
 *     period-close power).
 *
 * Pattern: copied from V2-D cross-role-boundary.test.js + V3-D
 * auditor-routes-rbac.test.js — auth middleware mock attaches
 * req.user from x-test-role headers; canonical-rbac stays REAL;
 * service-layer methods are spied so each 403 is paired with a
 * `not.toHaveBeenCalled()` assertion (so a 403 truly means
 * "no work done").
 *
 * Coverage per RFC §V4-D / RB-2..RB-5 + RB-6/7/8/9:
 *   1. ACCOUNT_DTAM CANNOT review documents
 *      → /api/provider/applications/:id/workflow-transitions DOC_APPROVED
 *   2. ACCOUNT_DTAM CANNOT assign auditors
 *      → /api/audit/scheduling/assign
 *   3. ACCOUNT_DTAM CANNOT record audit decisions
 *      → /api/provider/auditor/applications/:id/audit-decisions
 *   4. ACCOUNT_DTAM CANNOT do PLATFORM-only finance operations
 *      → /api/finance/refunds /credit-notes /period-close /manual-JE
 *        /purchase-invoices /wht — all 403
 *   5. ACCOUNT_DTAM CANNOT do admin-only operations
 *      → POST /api/finance/period-close/:id/reopen — ADMIN_ONLY
 *      → POST /api/finance/manual-journal-entries/:id/approve — ADMIN_ONLY
 *      → POST /api/finance/refunds/:id/cancel — ADMIN_ONLY
 *   6. Same symmetric matrix for ACCOUNT_PLATFORM (cannot reach
 *      review/scheduling/audit/admin) — narrower since PLATFORM has all
 *      finance writes already.
 *
 * I-008 applied: every helper the SUT imports is in the mock surface.
 *
 * See: docs/handoffs/iter-V4/00-rfc.md §V4-D / RB-2..RB-9.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock (V1-D / V2-D / V3-D pattern) ──────────────────────────────────
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

// canonical-rbac stays REAL — the test proves the canonical contract.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// ── Service-layer mocks ─────────────────────────────────────────────────────
//
// Workflow + scheduling + auditor service mocks (cross-role half).
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

const mockFindFirstWithWhere = jest.fn();
const mockWriteAssignmentColumns = jest.fn();
const mockFindAuditDecisionApplication = jest.fn();
const mockFindAuditDecisionPostWriteSlice = jest.fn();
const mockWriteInspectionStart = jest.fn();
const mockListAuditorDashboardApplications = jest.fn();
const mockListAuditorsByIds = jest.fn().mockResolvedValue([]);
const mockUpdateApplicationColumns = jest.fn();
const mockFindApplicationForFinalApproval = jest.fn();
const mockListFinalApprovalQueue = jest.fn();
const mockListProviderApplications = jest.fn().mockResolvedValue([]);
const mockListSchedulerDashboardApplications = jest.fn().mockResolvedValue([]);
const mockListStuckApplications = jest.fn().mockResolvedValue([]);
const mockFindReminderTargetApplication = jest.fn().mockResolvedValue(null);

jest.mock('../../services/application-service', () => ({
    findFirstWithWhere: (...args) => mockFindFirstWithWhere(...args),
    writeAssignmentColumns: (...args) => mockWriteAssignmentColumns(...args),
    findAuditDecisionApplication: (...args) => mockFindAuditDecisionApplication(...args),
    findAuditDecisionPostWriteSlice: (...args) => mockFindAuditDecisionPostWriteSlice(...args),
    writeInspectionStart: (...args) => mockWriteInspectionStart(...args),
    listAuditorDashboardApplications: (...args) => mockListAuditorDashboardApplications(...args),
    listAuditorsByIds: (...args) => mockListAuditorsByIds(...args),
    updateApplicationColumns: (...args) => mockUpdateApplicationColumns(...args),
    findApplicationForFinalApproval: (...args) => mockFindApplicationForFinalApproval(...args),
    listFinalApprovalQueue: (...args) => mockListFinalApprovalQueue(...args),
    listProviderApplications: (...args) => mockListProviderApplications(...args),
    listSchedulerDashboardApplications: (...args) => mockListSchedulerDashboardApplications(...args),
    listStuckApplications: (...args) => mockListStuckApplications(...args),
    findReminderTargetApplication: (...args) => mockFindReminderTargetApplication(...args),
    countAuditorActiveAuditAssignments: jest.fn().mockResolvedValue(0),
    countAuditorCompletedAuditsSince: jest.fn().mockResolvedValue(0),
    resolveHealthIdentity: jest.fn().mockResolvedValue({ healthId: 'h-1', userId: 'u-1' }),
}));

const mockWriteApplicationStatus = jest.fn();
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...args) => mockWriteApplicationStatus(...args),
}));

jest.mock('../../services/admin-application-service', () => ({
    listApproachingRevisionDeadlines: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: jest.fn().mockResolvedValue([]),
    listSettlementsByApplicationIds: jest.fn().mockResolvedValue([]),
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

jest.mock('../../services/notification-fanout-service', () => ({
    dispatch: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/user-lookup-service', () => ({
    resolveUserIdFromHealthIdSecurely: jest.fn().mockResolvedValue('u-1'),
}));

jest.mock('../../services/workflow-transition-service', () => {
    const real = jest.requireActual('../../services/workflow-transition-service');
    return {
        ...real,
        buildTransitionUpdate: jest.fn(({ application, toState, actorRole }) => {
            const canonicalRole = real.normalizeActorRole
                ? real.normalizeActorRole(actorRole)
                : String(actorRole || '').toLowerCase();
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

jest.mock('../../services/certificate-service', () => ({
    ensureCertificateIssuedForApplication: jest.fn().mockResolvedValue(null),
    generateCertificate: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/phase-billing-service', () => ({
    computePhaseSettlement: jest.fn(() => ({ phasePaid: false, phaseReceiptIssued: false })),
    getServiceTypesForPhaseComponent: jest.fn(() => []),
    getCanonicalServiceTypeForComponent: jest.fn(() => null),
    isInvoicePaidStatus: jest.fn(() => false),
}));

jest.mock('../../services/traceability-service', () => ({}));

jest.mock('../../utils/working-days', () => ({
    isWorkingDay: jest.fn(() => true),
    addWorkingDays: jest.fn((d) => d),
    countWorkingDaysBetween: jest.fn(() => 0),
    loadHolidaySet: jest.fn().mockResolvedValue(new Set()),
}));

jest.mock('../../shared/application-visibility', () => ({
    withVisibility: (where) => where,
}));

jest.mock('../../utils/client-ip', () => ({
    getRequestIp: jest.fn(() => '127.0.0.1'),
}));

// ── Finance service mocks (split-side admin-only operations) ────────────────

const mockInitiateRefund = jest.fn();
const mockCancelRefund = jest.fn();
const mockGetRefundStatus = jest.fn();

jest.mock('../../services/refund-service', () => {
    const real = jest.requireActual('../../services/refund-service');
    const { normalizeRole, CANONICAL_ROLES } = jest.requireActual('../../shared/canonical-rbac');
    // ชุดบทบาทมาจาก service จริง — สำเนาในเทสเคยค้างคำตัดสินเก่าได้โดยไม่มีใครเห็น
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
            const e = new Error('ADMIN role required to cancel a refund');
            e.code = 'FORBIDDEN_ROLE';
            e.statusCode = 403;
            throw e;
        }
    };
    return {
        ...real,
        initiateRefund: (args) => {
            assertWrite(args?.actor);
            return mockInitiateRefund(args);
        },
        getRefundStatus: (id, opts) => {
            assertRead(opts?.actor);
            return mockGetRefundStatus(id, opts);
        },
        cancelRefund: (id, opts) => {
            assertCancel(opts?.actor);
            return mockCancelRefund(id, opts);
        },
    };
});

const mockClosePeriod = jest.fn();
const mockReopenPeriod = jest.fn();
const mockGetPeriodCloseStatus = jest.fn().mockResolvedValue([]);
const mockIsPeriodClosed = jest.fn().mockResolvedValue(false);

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
const mockListDrafts = jest.fn().mockResolvedValue([]);
const mockGetDraftById = jest.fn().mockResolvedValue(null);

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

const mockApprovePurchaseInvoice = jest.fn();
const mockCreatePurchaseInvoice = jest.fn();
const mockListPurchaseInvoices = jest.fn();

jest.mock('../../services/purchase-invoice-service', () => {
    const real = jest.requireActual('../../services/purchase-invoice-service');
    const { normalizeRole } = jest.requireActual('../../shared/canonical-rbac');
    // ชุดบทบาทมาจาก service จริง — สำเนาในเทสเคยค้างคำตัดสินเก่าได้โดยไม่มีใครเห็น
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
    return {
        ...real,
        // ประตูสร้างมีด่านบทบาทแล้ว (operator 2026-09-27) — mock ต้องเดินด่านเดียวกับของจริง
        createPurchaseInvoice: (args) => {
            assertWrite(args?.actor);
            return mockCreatePurchaseInvoice(args);
        },
        approvePurchaseInvoice: (id, opts) => {
            assertWrite(opts?.actor);
            return mockApprovePurchaseInvoice(id, opts);
        },
        rejectPurchaseInvoice: jest.fn(),
        markAsPaid: jest.fn(),
        listPurchaseInvoices: (opts) => {
            assertRead(opts?.actor);
            return mockListPurchaseInvoices(opts);
        },
        findPurchaseInvoiceById: (id, opts) => {
            assertRead(opts?.actor);
            return jest.fn()(id, opts);
        },
    };
});

const mockRecordWhtCertificate = jest.fn();
const mockListWhtCertificates = jest.fn();

jest.mock('../../services/wht-service', () => {
    const real = jest.requireActual('../../services/wht-service');
    return {
        ...real,
        recordWhtCertificate: (...args) => mockRecordWhtCertificate(...args),
        listWhtCertificates: (...args) => mockListWhtCertificates(...args),
        isWhtApplicableForInvoice: jest.fn().mockResolvedValue({ applicable: false }),
        assertWriteRole: real.assertWriteRole,
        assertReadRole: real.assertReadRole,
    };
});

const mockCreateCreditNote = jest.fn();
const mockPostCreditNote = jest.fn();

jest.mock('../../services/credit-note-service', () => {
    const real = jest.requireActual('../../services/credit-note-service');
    const { normalizeRole, CANONICAL_ROLES } = jest.requireActual('../../shared/canonical-rbac');
    const WRITE = new Set([CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM, CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]);
    const assertWrite = (actor) => {
        const role = normalizeRole(actor?.canonicalRole || actor?.role);
        if (!role || !WRITE.has(role)) {
            const e = new Error('ACCOUNT_PLATFORM or ADMIN role required');
            e.code = 'FORBIDDEN_ROLE';
            e.statusCode = 403;
            throw e;
        }
    };
    return {
        ...real,
        createCreditNote: (args) => {
            assertWrite(args?.actor);
            return mockCreateCreditNote(args);
        },
        issueCreditNote: jest.fn(),
        postCreditNote: (id, opts) => {
            assertWrite(opts?.actor);
            return mockPostCreditNote(id, opts);
        },
        cancelCreditNote: jest.fn(),
        listCreditNotesForInvoice: jest.fn().mockResolvedValue([]),
        listCreditNotes: jest.fn().mockResolvedValue([]),
        findCreditNoteById: jest.fn().mockResolvedValue(null),
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

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: {
        log: jest.fn().mockResolvedValue(null),
        logWithin: jest.fn().mockResolvedValue(null),
    },
    AuditCategory: { APPLICATION: 'APPLICATION', AUDIT: 'AUDIT', PAYMENT: 'PAYMENT' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', MEDIUM: 'MEDIUM' },
    ResourceType: { APPLICATION: 'APPLICATION', PAYMENT: 'PAYMENT', INVOICE: 'INVOICE' },
}));

function seedHappyPath() {
    mockAssignAuditor.mockResolvedValue({ id: 'app-1', status: 'AUDIT_CONFIRMED' });
    mockApproveReschedule.mockResolvedValue({ id: 'res-1', status: 'APPROVED' });
    mockGetSchedulingQueue.mockResolvedValue([]);
    mockGetAuditorAvailability.mockResolvedValue({ busySlots: [], overCapDays: [] });
    mockFindFirstWithWhere.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        healthId: 'h-1',
        status: 'ASSIGNED_FOR_REVIEW',
        formData: { reviewedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
        workflowHistory: [],
        reviewerId: 'user-1',
        auditorId: 'user-1',
    });
    mockWriteAssignmentColumns.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        status: 'DOC_APPROVED',
    });
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
    mockWriteInspectionStart.mockResolvedValue({ id: 'app-1', applicationNumber: 'APP-001' });
    mockUpdateApplicationColumns.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        status: 'APPROVED',
        updatedAt: new Date().toISOString(),
    });
    mockListAuditorDashboardApplications.mockResolvedValue([]);
    mockListFinalApprovalQueue.mockResolvedValue([]);
    mockWriteApplicationStatus.mockResolvedValue({
        id: 'app-1', applicationNumber: 'APP-001', status: 'AUDIT_PASSED',
    });
    mockInitiateRefund.mockResolvedValue({ refundId: 'ref-1', status: 'INITIATED' });
    mockGetRefundStatus.mockResolvedValue({ status: 'NONE', history: [] });
    mockCancelRefund.mockResolvedValue({ refundId: 'ref-1', status: 'CANCELLED' });
    mockClosePeriod.mockResolvedValue({ id: 'pc-1', year: 2026, month: 4, status: 'CLOSED' });
    mockReopenPeriod.mockResolvedValue({ id: 'pc-1', status: 'OPEN' });
    mockCreateDraftManualEntry.mockResolvedValue({
        id: 'je-1', draftNumber: 'MJE-2026-001', totalDebit: 100, totalCredit: 100,
    });
    mockApproveManualEntry.mockResolvedValue({ id: 'je-1', draftNumber: 'MJE-2026-001', status: 'APPROVED' });
    mockPostManualEntry.mockResolvedValue({
        draft: { id: 'je-1', draftNumber: 'MJE-2026-001' },
        entry: { id: 'entry-1' },
    });
    mockRejectManualEntry.mockResolvedValue({ id: 'je-1', draftNumber: 'MJE-2026-001', status: 'REJECTED' });
    mockCreateCreditNote.mockResolvedValue({ id: 'cn-1', status: 'DRAFT' });
    mockPostCreditNote.mockResolvedValue({ id: 'cn-1', status: 'POSTED' });
    mockApprovePurchaseInvoice.mockResolvedValue({ id: 'pi-1', status: 'APPROVED' });
    mockCreatePurchaseInvoice.mockResolvedValue({ id: 'pi-1' });
    mockListPurchaseInvoices.mockResolvedValue([]);
    mockRecordWhtCertificate.mockResolvedValue({ id: 'wht-1' });
    mockListWhtCertificates.mockResolvedValue([]);
}

const auditSchedulingRouter = require('../../routes/api/audit/scheduling');
const providerApplicationsRouter = require('../../routes/api/provider/applications');
const providerSchedulerRouter = require('../../routes/api/provider/scheduler');
const providerAuditorRouter = require('../../routes/api/provider/auditor');
const refundsRouter = require('../../routes/api/finance/refunds');
const periodCloseRouter = require('../../routes/api/finance/period-close');
const manualJeRouter = require('../../routes/api/finance/manual-journal-entries');
const purchaseInvoicesRouter = require('../../routes/api/finance/purchase-invoices');
const whtRouter = require('../../routes/api/finance/wht');
const creditNotesRouter = require('../../routes/api/finance/credit-notes');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/audit/scheduling', auditSchedulingRouter);
    app.use('/api/provider/applications', providerApplicationsRouter);
    app.use('/api/provider/scheduler', providerSchedulerRouter);
    app.use('/api/provider/auditor', providerAuditorRouter);
    app.use('/api/finance/refunds', refundsRouter);
    app.use('/api/finance/period-close', periodCloseRouter);
    app.use('/api/finance/manual-journal-entries', manualJeRouter);
    app.use('/api/finance/purchase-invoices', purchaseInvoicesRouter);
    app.use('/api/finance/wht', whtRouter);
    app.use('/api/finance/credit-notes', creditNotesRouter);
    return app;
}

// ── 1. ACCOUNT_DTAM CANNOT reach DOCUMENT_REVIEWER routes ───────────────────

describe('V4-D account_dtam CANNOT review documents (RB-2)', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/provider/applications/:id/workflow-transitions DOC_APPROVED → 403', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ toState: 'DOC_APPROVED' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ success: false });
        expect(mockWriteAssignmentColumns).not.toHaveBeenCalled();
        expect(mockFindFirstWithWhere).not.toHaveBeenCalled();
    });

    test('POST /api/provider/applications/:id/workflow-transitions REVISION_REQUESTED → 403', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'finance_officer_dtam')
            .send({
                toState: 'REVISION_REQUESTED',
                comment: 'please fix',
                revisionCategory: 'documents',
                revisionItems: ['item-1'],
            });

        expect(response.status).toBe(403);
        expect(mockWriteAssignmentColumns).not.toHaveBeenCalled();
    });
});

// ── 2. ACCOUNT_DTAM CANNOT reach SCHEDULER routes ───────────────────────────

describe('V4-D account_dtam CANNOT reach SCHEDULER routes (RB-3)', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/audit/scheduling/assign → 403 (FORBIDDEN_ROLE)', async () => {
        const response = await request(app)
            .post('/api/audit/scheduling/assign')
            .set('x-test-role', 'finance_officer_dtam')
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

    test('GET /api/audit/scheduling/queue → 403', async () => {
        const response = await request(app)
            .get('/api/audit/scheduling/queue')
            .set('x-test-role', 'finance_officer_dtam');

        expect(response.status).toBe(403);
        expect(mockGetSchedulingQueue).not.toHaveBeenCalled();
    });

    test('POST /api/audit/scheduling/:id/approve → 403', async () => {
        const response = await request(app)
            .post('/api/audit/scheduling/res-1/approve')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ newDate: '2026-06-15' });

        expect(response.status).toBe(403);
        expect(mockApproveReschedule).not.toHaveBeenCalled();
    });
});

// ── 3. ACCOUNT_DTAM CANNOT reach AUDITOR routes ─────────────────────────────

describe('V4-D account_dtam CANNOT reach AUDITOR routes (RB-4)', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('GET /api/provider/auditor/dashboard → 403', async () => {
        const response = await request(app)
            .get('/api/provider/auditor/dashboard')
            .set('x-test-role', 'finance_officer_dtam');

        expect(response.status).toBe(403);
        expect(mockListAuditorDashboardApplications).not.toHaveBeenCalled();
    });

    test('POST /api/provider/auditor/applications/:id/audit-decisions → 403', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/audit-decisions')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ decision: 'PASS' });

        expect(response.status).toBe(403);
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
    });

    test('POST /api/provider/auditor/applications/:id/final-approvals → 403', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/final-approvals')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ comment: 'ok' });

        expect(response.status).toBe(403);
        expect(mockUpdateApplicationColumns).not.toHaveBeenCalled();
    });
});

// ── 4. ACCOUNT_DTAM CANNOT do PLATFORM-only finance operations ──────────────

describe('V4-D account_dtam CANNOT do PLATFORM-only finance operations', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/finance/refunds/:id/initiate → 403 FORBIDDEN_ROLE', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/inv-1/initiate')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ reason: 'test', reasonCode: 'CANCELLATION' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            error: 'FORBIDDEN_ROLE',
        });
        expect(mockInitiateRefund).not.toHaveBeenCalled();
    });

    test('POST /api/finance/credit-notes → 403 FORBIDDEN_ROLE', async () => {
        const response = await request(app)
            .post('/api/finance/credit-notes')
            .set('x-test-role', 'finance_officer_dtam')
            .send({
                originalInvoiceId: 'inv-1',
                reasonCode: 'CANCELLATION',
                reason: 'test',
                subtotal: 100,
                vat: 7,
            });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: 'FORBIDDEN_ROLE' });
        expect(mockCreateCreditNote).not.toHaveBeenCalled();
    });

    test('POST /api/finance/period-close (close) → 403 PERIOD_CLOSE_FORBIDDEN', async () => {
        const response = await request(app)
            .post('/api/finance/period-close')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ year: 2026, month: 4 });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            code: 'PERIOD_CLOSE_FORBIDDEN',
        });
        expect(mockClosePeriod).not.toHaveBeenCalled();
    });

    test('POST /api/finance/manual-journal-entries → 403 MANUAL_JE_CREATE_FORBIDDEN', async () => {
        const response = await request(app)
            .post('/api/finance/manual-journal-entries')
            .set('x-test-role', 'finance_officer_dtam')
            .send({
                description: 'test',
                lines: [
                    { accountCode: '1000', debit: 100, credit: 0 },
                    { accountCode: '2000', debit: 0, credit: 100 },
                ],
            });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            code: 'MANUAL_JE_CREATE_FORBIDDEN',
        });
        expect(mockCreateDraftManualEntry).not.toHaveBeenCalled();
    });

    test('POST /api/finance/purchase-invoices/:id/approve → 403 FORBIDDEN_ROLE', async () => {
        const response = await request(app)
            .post('/api/finance/purchase-invoices/pi-1/approve')
            .set('x-test-role', 'finance_officer_dtam')
            .send({});

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: 'FORBIDDEN_ROLE' });
        expect(mockApprovePurchaseInvoice).not.toHaveBeenCalled();
    });

    test('POST /api/finance/wht/certificate → 403 FORBIDDEN_ROLE', async () => {
        const response = await request(app)
            .post('/api/finance/wht/certificate')
            .set('x-test-role', 'finance_officer_dtam')
            .send({
                invoiceId: 'inv-1',
                certificateNumber: 'C-001',
                issuedByTaxId: '1234567890123',
                issuedByName: 'Acme',
                certificateDate: '2026-05-01',
                whtAmount: 3,
            });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: 'FORBIDDEN_ROLE' });
        expect(mockRecordWhtCertificate).not.toHaveBeenCalled();
    });
});

// ── 4b. ACCOUNT_DTAM อ่านได้เท่ากับ ACCOUNT_PLATFORM (operator 2026-09-11) ─────────
// เดิมสามเทสนี้ยืนยันว่าการเงินฝั่งกรมถูก 403 ที่ประตูอ่าน (DTAM not in READ_ROLES)
// คำตัดสิน "finance ต้องเห็นเหมือนกัน" กลับข้อนั้นสำหรับการอ่านเท่านั้น — เทสเขียนข้างบนคงเดิม

describe('account_dtam อ่านข้อมูลบัญชีได้เหมือน account_platform', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('GET /api/finance/refunds/:id/status → 200 (READ_ROLES มีการเงินทั้งสองบทบาท)', async () => {
        mockGetRefundStatus.mockResolvedValue({ invoiceId: 'inv-1', refunds: [] });
        const response = await request(app)
            .get('/api/finance/refunds/inv-1/status')
            .set('x-test-role', 'finance_officer_dtam');

        expect(response.status).toBe(200);
        expect(mockGetRefundStatus).toHaveBeenCalledTimes(1);
    });

    test('GET /api/finance/wht/certificates → 200 (READ_ROLES มีการเงินทั้งสองบทบาท)', async () => {
        mockListWhtCertificates.mockResolvedValue([]);
        const response = await request(app)
            .get('/api/finance/wht/certificates')
            .set('x-test-role', 'finance_officer_dtam');

        expect(response.status).toBe(200);
        expect(mockListWhtCertificates).toHaveBeenCalledTimes(1);
    });

    test('GET /api/finance/purchase-invoices → 200 (READ_ROLES มีการเงินทั้งสองบทบาท)', async () => {
        mockListPurchaseInvoices.mockResolvedValue([]);
        const response = await request(app)
            .get('/api/finance/purchase-invoices')
            .set('x-test-role', 'finance_officer_dtam');

        expect(response.status).toBe(200);
        expect(mockListPurchaseInvoices).toHaveBeenCalledTimes(1);
    });
});

// ── 5. ACCOUNT_DTAM CANNOT do admin-only operations ─────────────────────────

describe('V4-D account_dtam CANNOT do admin-only operations', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/finance/period-close/:id/reopen → 403 PERIOD_REOPEN_FORBIDDEN', async () => {
        const response = await request(app)
            .post('/api/finance/period-close/pc-1/reopen')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ reason: 'correction' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            code: 'PERIOD_REOPEN_FORBIDDEN',
        });
        expect(mockReopenPeriod).not.toHaveBeenCalled();
    });

    test('POST /api/finance/manual-journal-entries/:id/approve → 403 MANUAL_JE_APPROVE_FORBIDDEN', async () => {
        const response = await request(app)
            .post('/api/finance/manual-journal-entries/je-1/approve')
            .set('x-test-role', 'finance_officer_dtam')
            .send({});

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            code: 'MANUAL_JE_APPROVE_FORBIDDEN',
        });
        expect(mockApproveManualEntry).not.toHaveBeenCalled();
    });

    test('POST /api/finance/manual-journal-entries/:id/post → 403 MANUAL_JE_POST_FORBIDDEN', async () => {
        const response = await request(app)
            .post('/api/finance/manual-journal-entries/je-1/post')
            .set('x-test-role', 'finance_officer_dtam')
            .send({});

        expect(response.status).toBe(403);
        expect(mockPostManualEntry).not.toHaveBeenCalled();
    });

    test('POST /api/finance/manual-journal-entries/:id/reject → 403 MANUAL_JE_REJECT_FORBIDDEN', async () => {
        const response = await request(app)
            .post('/api/finance/manual-journal-entries/je-1/reject')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ reason: 'invalid' });

        expect(response.status).toBe(403);
        expect(mockRejectManualEntry).not.toHaveBeenCalled();
    });

    test('POST /api/finance/refunds/:id/cancel → 403 FORBIDDEN_ROLE (ADMIN-only)', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/ref-1/cancel')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ reason: 'mistake' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: 'FORBIDDEN_ROLE' });
        expect(mockCancelRefund).not.toHaveBeenCalled();
    });
});

// ── 6. ACCOUNT_PLATFORM CANNOT reach DOCUMENT_REVIEWER routes ───────────────

describe('V4-D account_platform CANNOT review documents (RB-2)', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/provider/applications/:id/workflow-transitions DOC_APPROVED → 403', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'finance_officer_platform')
            .send({ toState: 'DOC_APPROVED' });

        expect(response.status).toBe(403);
        expect(mockWriteAssignmentColumns).not.toHaveBeenCalled();
        expect(mockFindFirstWithWhere).not.toHaveBeenCalled();
    });

    test('POST /api/provider/applications/:id/workflow-transitions REVISION_REQUESTED → 403', async () => {
        const response = await request(app)
            .post('/api/provider/applications/app-1/workflow-transitions')
            .set('x-test-role', 'finance_officer_platform')
            .send({
                toState: 'REVISION_REQUESTED',
                comment: 'please fix',
                revisionCategory: 'documents',
                revisionItems: ['item-1'],
            });

        expect(response.status).toBe(403);
        expect(mockWriteAssignmentColumns).not.toHaveBeenCalled();
    });
});

// ── 7. ACCOUNT_PLATFORM CANNOT reach SCHEDULER routes ───────────────────────

describe('V4-D account_platform CANNOT reach SCHEDULER routes (RB-3)', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/audit/scheduling/assign → 403 (FORBIDDEN_ROLE)', async () => {
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
        expect(mockAssignAuditor).not.toHaveBeenCalled();
    });

    test('POST /api/audit/scheduling/:id/approve → 403', async () => {
        const response = await request(app)
            .post('/api/audit/scheduling/res-1/approve')
            .set('x-test-role', 'finance_officer_platform')
            .send({ newDate: '2026-06-15' });

        expect(response.status).toBe(403);
        expect(mockApproveReschedule).not.toHaveBeenCalled();
    });

    test('GET /api/audit/scheduling/queue → 403', async () => {
        const response = await request(app)
            .get('/api/audit/scheduling/queue')
            .set('x-test-role', 'finance_officer_platform');

        expect(response.status).toBe(403);
        expect(mockGetSchedulingQueue).not.toHaveBeenCalled();
    });
});

// ── 8. ACCOUNT_PLATFORM CANNOT reach AUDITOR routes ─────────────────────────

describe('V4-D account_platform CANNOT reach AUDITOR routes (RB-4)', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('GET /api/provider/auditor/dashboard → 403', async () => {
        const response = await request(app)
            .get('/api/provider/auditor/dashboard')
            .set('x-test-role', 'finance_officer_platform');

        expect(response.status).toBe(403);
        expect(mockListAuditorDashboardApplications).not.toHaveBeenCalled();
    });

    test('POST /api/provider/auditor/applications/:id/audit-decisions → 403', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/audit-decisions')
            .set('x-test-role', 'finance_officer_platform')
            .send({ decision: 'PASS' });

        expect(response.status).toBe(403);
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
    });

    test('POST /api/provider/auditor/applications/:id/final-approvals → 403', async () => {
        const response = await request(app)
            .post('/api/provider/auditor/applications/app-1/final-approvals')
            .set('x-test-role', 'finance_officer_platform')
            .send({ comment: 'ok' });

        expect(response.status).toBe(403);
        expect(mockUpdateApplicationColumns).not.toHaveBeenCalled();
    });
});

// ── 9. ACCOUNT_PLATFORM CANNOT do admin-only operations ─────────────────────

describe('V4-D account_platform CANNOT do admin-only operations', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/finance/period-close/:id/reopen → 403 (ADMIN_ONLY separation)', async () => {
        const response = await request(app)
            .post('/api/finance/period-close/pc-1/reopen')
            .set('x-test-role', 'finance_officer_platform')
            .send({ reason: 'correction' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            code: 'PERIOD_REOPEN_FORBIDDEN',
        });
        expect(mockReopenPeriod).not.toHaveBeenCalled();
    });

    test('POST /api/finance/manual-journal-entries/:id/approve → 403 (ADMIN_ONLY separation)', async () => {
        const response = await request(app)
            .post('/api/finance/manual-journal-entries/je-1/approve')
            .set('x-test-role', 'finance_officer_platform')
            .send({});

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            code: 'MANUAL_JE_APPROVE_FORBIDDEN',
        });
        expect(mockApproveManualEntry).not.toHaveBeenCalled();
    });

    test('POST /api/finance/manual-journal-entries/:id/post → 403 (ADMIN_ONLY)', async () => {
        const response = await request(app)
            .post('/api/finance/manual-journal-entries/je-1/post')
            .set('x-test-role', 'finance_officer_platform')
            .send({});

        expect(response.status).toBe(403);
        expect(mockPostManualEntry).not.toHaveBeenCalled();
    });

    test('POST /api/finance/refunds/:id/cancel → 403 (ADMIN_ONLY)', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/ref-1/cancel')
            .set('x-test-role', 'finance_officer_platform')
            .send({ reason: 'mistake' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: 'FORBIDDEN_ROLE' });
        expect(mockCancelRefund).not.toHaveBeenCalled();
    });
});

// ── 10. ACCOUNT_PLATFORM positive — owns PLATFORM finance writes ────────────

describe('V4-D account_platform CAN do PLATFORM finance writes (positive)', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/finance/refunds/:id/initiate → non-403 (positive)', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/inv-1/initiate')
            .set('x-test-role', 'finance_officer_platform')
            .send({ reason: 'test', reasonCode: 'CANCELLATION' });

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockInitiateRefund).toHaveBeenCalledTimes(1);
    });

    test('POST /api/finance/period-close → non-403 (positive)', async () => {
        const response = await request(app)
            .post('/api/finance/period-close')
            .set('x-test-role', 'finance_officer_platform')
            .send({ year: 2026, month: 4 });

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockClosePeriod).toHaveBeenCalledTimes(1);
    });

    test('POST /api/finance/manual-journal-entries → non-403 (positive)', async () => {
        const response = await request(app)
            .post('/api/finance/manual-journal-entries')
            .set('x-test-role', 'finance_officer_platform')
            .send({
                description: 'test',
                lines: [
                    { accountCode: '1000', debit: 100, credit: 0 },
                    { accountCode: '2000', debit: 0, credit: 100 },
                ],
            });

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockCreateDraftManualEntry).toHaveBeenCalledTimes(1);
    });

    test('POST /api/finance/purchase-invoices/:id/approve → non-403 (positive)', async () => {
        const response = await request(app)
            .post('/api/finance/purchase-invoices/pi-1/approve')
            .set('x-test-role', 'finance_officer_platform')
            .send({});

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockApprovePurchaseInvoice).toHaveBeenCalledTimes(1);
    });

    test('POST /api/finance/wht/certificate → non-403 (positive)', async () => {
        const response = await request(app)
            .post('/api/finance/wht/certificate')
            .set('x-test-role', 'finance_officer_platform')
            .send({
                invoiceId: 'inv-1',
                certificateNumber: 'C-001',
                issuedByTaxId: '1234567890123',
                issuedByName: 'Acme',
                certificateDate: '2026-05-01',
                whtAmount: 3,
            });

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockRecordWhtCertificate).toHaveBeenCalledTimes(1);
    });
});

// ── 11. ADMIN bypass — all operations succeed ───────────────────────────────

describe('V4-D admin role bypasses all gates (positive smoke)', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('POST /api/finance/refunds/:id/cancel → non-403 (admin)', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/ref-1/cancel')
            .set('x-test-role', 'system_admin_dtam')
            .send({ reason: 'mistake' });

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockCancelRefund).toHaveBeenCalledTimes(1);
    });

    test('POST /api/finance/period-close/:id/reopen → non-403 (admin)', async () => {
        const response = await request(app)
            .post('/api/finance/period-close/pc-1/reopen')
            .set('x-test-role', 'system_admin_dtam')
            .send({ reason: 'correction' });

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockReopenPeriod).toHaveBeenCalledTimes(1);
    });

    test('POST /api/finance/manual-journal-entries/:id/approve → non-403 (admin)', async () => {
        const response = await request(app)
            .post('/api/finance/manual-journal-entries/je-1/approve')
            .set('x-test-role', 'system_admin_dtam')
            .send({});

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockApproveManualEntry).toHaveBeenCalledTimes(1);
    });
});
