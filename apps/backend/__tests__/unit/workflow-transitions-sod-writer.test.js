/**
 * Fix round 1 (HIGH): separation of duties at the status writer, so /workflow-transitions
 * (and `force`) cannot let a person who is both reviewer and inspector decide.
 */
const express = require('express');
const request = require('supertest');

let mockCurrentUser = null;
const mockWriteApplicationStatus = jest.fn();
const mockRevokeCertificateForApplication = jest.fn();
const mockBuildTransitionUpdate = jest.fn();
const mockGetById = jest.fn();
const mockFindFirstWithWhere = jest.fn();
const mockHandleCertificateIssuance = jest.fn();
const mockUpdate = jest.fn(async ({ data }) => ({ id: 'app-1', ...data }));
const mockFindUnique = jest.fn();
const mockTx = { application: { update: (...a) => mockUpdate(...a), findUnique: (...a) => mockFindUnique(...a) } };
const mockTransaction = jest.fn(async (cb) => cb(mockTx));

jest.mock('../../routes/api/provider/handlers/workflow-handler-deps', () => ({
    prisma: { $transaction: (...a) => mockTransaction(...a) },
    authenticateProvider: (req, _res, next) => { req.user = mockCurrentUser; next(); },
    requireCanonicalPermission: () => (_req, _res, next) => next(),
    logger: { error: jest.fn(), warn: jest.fn(), warn: jest.fn(), info: jest.fn() },
    PERMISSIONS: { APPLICATION_WORKFLOW_TRANSITION: 'perm' },
    obj: (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {}),
    arr: (x) => (Array.isArray(x) ? x : []),
    workflowTransitionService: {
        normalizeWorkflowStateInput: (s) => (s ? String(s).toUpperCase() : null),
        resolveStateFromApplication: (app) => app.status,
        buildTransitionUpdate: (...a) => mockBuildTransitionUpdate(...a),
    },
    getRequestIp: () => '127.0.0.1',
    auditLogger: { log: jest.fn() },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { APPLICATION: 'APPLICATION' },
    resolveUserIdFromHealthId: jest.fn().mockResolvedValue('health-user-1'),
    getRevisionDueAt: () => null,
    REVISION_SLA_DAYS: 5,
    addWorkingDays: (d) => d,
    loadHolidaySet: jest.fn().mockResolvedValue(new Set()),
    ensureCertificateIssuedForApplication: jest.fn().mockResolvedValue({ id: 'cert-x', certificateNumber: 'GACP-X' }),
}));

// REAL status writer on purpose: the separation-of-duties guard lives in it.
jest.mock('../../services/workflow-transition-service', () => ({
    canTransition: () => true,
    normalizeWorkflowStateInput: (v) => String(v || '').toUpperCase() || null,
}));

// H (full-system audit 2026-07-11): the handler now imports
// statusTransitionAuditHook directly to wire an in-tx audit row. Mock it so the
// test never pulls the real audit-logger → prisma-database (process.exit) chain.
const mockAuditHook = jest.fn().mockResolvedValue({});
const mockStatusTransitionAuditHook = jest.fn(() => mockAuditHook);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(), logWithin: jest.fn() },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { APPLICATION: 'APPLICATION' },
    statusTransitionAuditHook: (...a) => mockStatusTransitionAuditHook(...a),
}));

jest.mock('../../services/certificate-service', () => ({
    revokeCertificateForApplication: (...a) => mockRevokeCertificateForApplication(...a),
}));

// R2 M2/M3b: the handler mints its official letter inside the SAME tx as the
// status write (D-8). These cert-integrity cases drive force -> REJECTED, which
// is now a terminal-decision letter path; the letter itself is pinned by
// __tests__/unit/terminal-decision-letter.test.js. Stub the mint here so this
// file keeps testing exactly what it was written to test (cert void + cert
// mint), rather than the notification stack it does not model
// (`mockTx` is a bare handle with no notification delegate).
const mockMintTerminalDecisionLetter = jest.fn().mockResolvedValue({ id: 'letter-1' });
jest.mock('../../services/decision-letter-service', () => ({
    mintCorrectionLetter: jest.fn().mockResolvedValue({ id: 'letter-1' }),
    mintTerminalDecisionLetter: (...a) => mockMintTerminalDecisionLetter(...a),
    CORRECTION_LETTER_STAGE: { DOC_REVIEW: 'DOC_REVIEW', FIELD_AUDIT_CAR: 'FIELD_AUDIT_CAR' },
}));

jest.mock('../../shared/application-visibility', () => ({
    withVisibility: (where) => where,
}));

jest.mock('../../services/application-service', () => ({
    findFirstWithWhere: (...a) => mockFindFirstWithWhere(...a),
    getById: (...a) => mockGetById(...a),
    isApplicationCommentModelAvailable: () => false,
    createApplicationCommentIfAvailable: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/admin-application-service', () => ({
    bulkUpdateRevisionDeadlineStatus: jest.fn().mockResolvedValue(null),
    findRevisionDeadlineByApplicationId: jest.fn().mockResolvedValue(null),
    upsertRevisionDeadline: jest.fn().mockResolvedValue(null),
}));

// The onsite-evidence gate has its own suite; here it passes so the writer's
// separation-of-duties guard is what decides the outcome.
jest.mock('../../services/onsite-evidence-gate', () => ({
    assertOnsiteEvidenceForPass: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../routes/api/provider/handlers/workflow-side-effects', () => ({
    buildRevisionDeadlineFormData: ({ baseFormData }) => ({ formData: baseFormData, eventMetadata: {} }),
    handleRevisionDeadlines: jest.fn().mockResolvedValue(null),
    handleCertificateIssuance: (...a) => mockHandleCertificateIssuance(...a),
    sendTransitionNotifications: jest.fn().mockResolvedValue(null),
    logTransitionAudit: jest.fn().mockResolvedValue(null),
}));

const { applicationsWorkflowTransitions } = require('../../routes/api/provider/handlers/workflow-transitions-handler');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.post('/apps/:id/workflow-transitions', ...applicationsWorkflowTransitions);
    return app;
}

function setup({ status, next, reviewerId, auditorId }) {
    mockFindFirstWithWhere.mockResolvedValue({
        id: 'app-1', applicationNumber: 'APP-001', healthId: 'h-1', status,
        formData: {}, workflowHistory: [], reviewerId, auditorId,
    });
    mockGetById.mockResolvedValue({ id: 'app-1', applicationNumber: 'APP-001', status: next, formData: {} });
    mockFindUnique.mockResolvedValue({ reviewerId, auditorId, formData: {} });
    mockBuildTransitionUpdate.mockReturnValue({
        previousState: status, nextState: next, nextLegacyStatus: next,
        updateData: { status: next, formData: {}, workflowHistory: [] },
        transitionEvent: { metadata: {} },
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (cb) => cb(mockTx));
    mockHandleCertificateIssuance.mockResolvedValue(null);
});

const BOTH = { reviewerId: 'u-both', auditorId: 'u-both' };
const CASES = [
    ['DOC_APPROVED', 'DOC_REVIEW_IN_PROGRESS', 'u-both', 'document_reviewer'],
    ['REVISION_REQUESTED', 'DOC_REVIEW_IN_PROGRESS', 'u-both', 'document_reviewer'],
    ['AUDIT_PASSED', 'AUDIT_CONFIRMED', 'u-both', 'auditor'],
];

describe('workflow-transitions: reviewer == inspector may not decide (writer-level guard)', () => {
    test.each(CASES)('%s refused 403 without force', async (next, from, uid, role) => {
        mockCurrentUser = { id: uid, role, canonicalRole: role, providerId: 'p-1' };
        setup({ status: from, next, ...BOTH });
        const res = await request(buildApp()).post('/apps/app-1/workflow-transitions')
            .send({ toState: next, comment: 'x' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('DECISION_BY_REVIEWER_AND_INSPECTOR');
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    test.each(CASES)('%s refused 403 even WITH force', async (next, from, uid) => {
        mockCurrentUser = { id: uid, role: 'admin', canonicalRole: 'admin', providerId: 'p-1' };
        setup({ status: from, next, ...BOTH });
        const res = await request(buildApp()).post('/apps/app-1/workflow-transitions')
            .send({ toState: next, force: true, reasonCode: 'ADMIN_OVERRIDE', comment: 'emergency' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('DECISION_BY_REVIEWER_AND_INSPECTOR');
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('a different person on one side is not blocked (pin)', async () => {
        mockCurrentUser = { id: 'u-rev', role: 'document_reviewer', canonicalRole: 'document_reviewer', providerId: 'p-1' };
        setup({ status: 'DOC_REVIEW_IN_PROGRESS', next: 'DOC_APPROVED', reviewerId: 'u-rev', auditorId: 'u-aud' });
        const res = await request(buildApp()).post('/apps/app-1/workflow-transitions')
            .send({ toState: 'DOC_APPROVED', comment: 'ok' });
        expect(res.status).toBe(200);
        expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
});
