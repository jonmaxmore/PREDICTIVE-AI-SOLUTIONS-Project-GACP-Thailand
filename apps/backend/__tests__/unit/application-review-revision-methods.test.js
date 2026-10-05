/**
 * Unit tests for createApplicationReviewRevisionMethods → reviewApplication.
 *
 * Focus: revision deadline math.
 * Canonical rule (apps/backend/config/business-rules.js):
 *   - Revision deadline is N working days (Mon-Fri, excl. Thai holidays) in
 *     Asia/Bangkok timezone.
 *   - Revisions are unlimited; only the deadline gates the workflow.
 */

const {
    createApplicationReviewRevisionMethods,
} = require('../../services/application-service/application-review-revision-methods');
const { addWorkingDays } = require('../../utils/working-days');
const { PAYMENT } = require('../../config/business-rules');
const {
    writeApplicationStatus,
} = require('../../services/application-status-writer');
const {
    issueQuotationsForApplication,
} = require('../../services/quotation-service');
const {
    validateSubmissionPayload,
} = require('../../validation/application-submission-validator');

// reviewApplication now routes its status transition through the canonical
// writer (PR-WF-1). The mock captures the call args so the existing assertions
// can inspect `additionalData.formData` exactly the way they used to inspect
// `prisma.application.update`'s `data` payload.
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(),
}));
jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: jest.fn(async () => null),
}));
jest.mock('../../services/audit-trail', () => ({
    logAction: jest.fn(),
    ACTIONS: { APPROVE: 'APPROVE', REJECT: 'REJECT' },
    ENTITIES: { APPLICATION: 'APPLICATION' },
    SEVERITY: { INFO: 'INFO', WARNING: 'WARNING' },
}));
// F-REVISION-DOOR-NO-QUOTATION fix (task-3) — a DRAFT resubmit now fires the
// same fire-and-forget quotation issuance POST /applications/submit does.
jest.mock('../../services/quotation-service', () => ({
    issueQuotationsForApplication: jest.fn().mockResolvedValue(undefined),
}));
// MAJOR-2 fix (Ruling 7, task-3 fix round 1) — the shared completeness gate.
// Mocked here (this file's mocking style isolates each sibling dependency) so
// the existing two-hop mechanics tests below stay green regardless of real
// Zod rules; the gate itself is proven against real validators elsewhere
// (canonical-application-validator.test.js, m2a-doc-requirements-doors.test.js).
// Defaults to "complete" — only the dedicated 422 test overrides it.
jest.mock('../../validation/application-submission-validator', () => ({
    validateSubmissionPayload: jest.fn(),
}));

beforeEach(() => {
    writeApplicationStatus.mockReset();
    issueQuotationsForApplication.mockClear();
    validateSubmissionPayload.mockReset();
    validateSubmissionPayload.mockReturnValue({ isValid: true });
});

function buildPrismaMock(application) {
    const captured = {};
    // Reflect what writeApplicationStatus would persist so the returned row
    // looks like the production behaviour the caller code relies on
    // (rejectCount incremented, status set, fields merged).
    writeApplicationStatus.mockImplementation(async (args) => {
        captured.writerArgs = args;
        const data = args.additionalData || {};
        const incRejectCount = data.rejectCount && data.rejectCount.increment
            ? (application.rejectCount || 0) + data.rejectCount.increment
            : (application.rejectCount || 0) + 1;
        return {
            ...application,
            ...data,
            status: args.toStatus,
            rejectCount: incRejectCount,
        };
    });
    return {
        captured,
        prisma: {
            application: {
                findFirst: jest.fn(async () => application),
            },
        },
    };
}

describe('submitRevision — re-entry target (audit 2.9)', () => {
    function buildSubmitMock(application) {
        const captured = { deadlineUpdates: [] };
        writeApplicationStatus.mockImplementation(async (args) => {
            captured.writerArgs = args;
            return { ...application, status: args.toStatus };
        });
        const prisma = {
            application: {
                findFirst: jest.fn(async () => application),
                findUnique: jest.fn(async () => ({ ...application })),
            },
            revisionDeadline: {
                findUnique: jest.fn(async () => null),
                // Capture every updateMany payload so the scalar-column
                // PDPA assertion (submittedBy/updatedBy = UUID) can inspect it.
                updateMany: jest.fn(async (args) => {
                    captured.deadlineUpdates.push(args);
                    return { count: 1 };
                }),
            },
            user: { findMany: jest.fn(async () => []) },
            // R2 M7: submitRevision now wraps the formData write + append-only
            // snapshot in prisma.$transaction. No correction round is seeded here
            // (findFirst → null) so the snapshot is a no-op for these unit cases;
            // the append-only behaviour itself is covered by the M7 integration
            // test. The $transaction passthrough runs the callback with this mock.
            correctionRound: { findFirst: jest.fn(async () => null) },
            correctionSubmissionVersion: {
                create: jest.fn(async (args) => ({ id: 'csv-mock', ...args.data })),
            },
        };
        prisma.$transaction = jest.fn(async (fn) => fn(prisma));
        return { captured, prisma };
    }

    function methodsFor(prisma) {
        return createApplicationReviewRevisionMethods({
            prisma,
            feeService: { calculateApplicationFees: () => ({}) },
            sendNotification: jest.fn(),
            NotifyType: { NEW_APPLICATION: 'NEW_APPLICATION' },
            logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        });
    }

    const actor = { userId: 'u-1', healthId: 'h-1', actorIdentity: 'u-1', actorRole: 'HEALTH' };
    // A future due date so the deadline-expiry branch is not taken.
    const futureDue = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    it('routes a REVISION_REQUESTED resubmit back to ASSIGNED_FOR_REVIEW (not SUBMITTED)', async () => {
        const app = {
            id: 'app-1', applicationNumber: 'GACP-2026-0001', status: 'REVISION_REQUESTED',
            // requestRevision stamps formData.workflowState='REVISION_REQUESTED';
            // the resubmit must overwrite it (H1 desync regression below).
            healthId: 'h-1', formData: { revisionDueAt: futureDue, workflowState: 'REVISION_REQUESTED' }, workflowHistory: [],
        };
        const mock = buildSubmitMock(app);
        const methods = methodsFor(mock.prisma);

        await methods.submitRevision('app-1', { formData: {}, notes: 'fixed' }, actor);

        expect(writeApplicationStatus).toHaveBeenCalledTimes(1);
        expect(mock.captured.writerArgs.toStatus).toBe('ASSIGNED_FOR_REVIEW');
        expect(mock.captured.writerArgs.fromStatus).toBe('REVISION_REQUESTED');
        // The history row mirrors the corrected target (no SUBMITTED relapse).
        const hist = mock.captured.writerArgs.additionalData.workflowHistory;
        expect(hist[hist.length - 1].toStatus).toBe('ASSIGNED_FOR_REVIEW');
        // H1 regression: additionalData carries a formData key, which bypasses
        // the writer's workflowState auto-sync — so the resubmit MUST stamp
        // formData.workflowState itself, overwriting the stale REVISION_REQUESTED.
        // Without it, resolveStateFromApplication (prefers formData.workflowState)
        // makes the reviewer's next ASSIGNED_FOR_REVIEW→DOC_APPROVED 422.
        expect(mock.captured.writerArgs.additionalData.formData.workflowState).toBe('ASSIGNED_FOR_REVIEW');
        // F-REVISION-DOOR-NO-QUOTATION fix — this resubmit is not a first
        // submit; quotations must not be (re-)issued.
        expect(issueQuotationsForApplication).not.toHaveBeenCalled();
    });

    it('lands a DRAFT resubmit at PENDING_DOC_FEE via the two SSOT-legal hops, not bare SUBMITTED (F-REVISION-DOOR-NO-QUOTATION fix)', async () => {
        const app = {
            id: 'app-2', applicationNumber: 'GACP-2026-0002', status: 'DRAFT',
            healthId: 'h-1', formData: {}, workflowHistory: [],
        };
        const mock = buildSubmitMock(app);
        const methods = methodsFor(mock.prisma);

        await methods.submitRevision('app-2', { formData: {}, notes: 'submit' }, actor);

        // BOTH legal SSOT edges are walked (workflow-transition-service.js:48-49)
        // — the WF-F5 shortcut (a single hop straight to PENDING_DOC_FEE) is
        // exactly what /submit's own front door already named a defect once
        // (applications.js:762-773); this door must not repeat it.
        expect(writeApplicationStatus).toHaveBeenCalledTimes(2);
        const [hop1, hop2] = writeApplicationStatus.mock.calls.map(([callArgs]) => callArgs);
        expect(hop1).toMatchObject({ fromStatus: 'DRAFT', toStatus: 'SUBMITTED' });
        // Hop 2 is the SSOT's SYSTEM-owned auto-advance edge
        // (ROLE_TRANSITIONS.system "submit hop-2 auto-advance",
        // workflow-transition-service.js:172) — same actor role /submit uses.
        expect(hop2).toMatchObject({ fromStatus: 'SUBMITTED', toStatus: 'PENDING_DOC_FEE', actorRole: 'system' });
        // The illegal direct DRAFT→PENDING_DOC_FEE edge must never be written.
        expect(writeApplicationStatus.mock.calls.some(
            ([callArgs]) => callArgs.fromStatus === 'DRAFT' && callArgs.toStatus === 'PENDING_DOC_FEE',
        )).toBe(false);
    });

    it('issues both quotations once a DRAFT resubmit reaches PENDING_DOC_FEE (F-REVISION-DOOR-NO-QUOTATION fix)', async () => {
        const app = {
            id: 'app-2', applicationNumber: 'GACP-2026-0002', status: 'DRAFT',
            healthId: 'h-1', formData: {}, workflowHistory: [],
        };
        const mock = buildSubmitMock(app);
        const methods = methodsFor(mock.prisma);

        await methods.submitRevision('app-2', { formData: {}, notes: 'submit' }, actor);

        // Same fire-and-forget, idempotent-by-(applicationId, issuerType) call
        // POST /applications/submit makes on its own isInitialSubmit branch
        // (applications.js:983-990) — a DRAFT resubmitted through THIS door
        // must not stay unpayable (0 quotations) once it reaches PENDING_DOC_FEE.
        expect(issueQuotationsForApplication).toHaveBeenCalledWith('app-2', expect.objectContaining({ actorId: 'u-1' }));
    });

    it('422s an incomplete DRAFT through this door instead of letting it reach PENDING_DOC_FEE (Ruling 7 / MAJOR-2 fix)', async () => {
        // Before this fix, submitRevision ran NO completeness check on the
        // DRAFT leg — an incomplete filing sailed straight through to
        // PENDING_DOC_FEE and minted price-of-record quotations, a gate the
        // front door (POST /applications/submit) already enforces
        // (applications.js hasLegacyMasterStepPayload branch, 422
        // APPLICATION_INCOMPLETE). This pins the SAME refusal, reached via
        // the SAME shared validateSubmissionPayload function the front door
        // now also calls — not a second, independently-drifting copy.
        validateSubmissionPayload.mockReturnValueOnce({
            isValid: false,
            errorsByStep: { 5: ['farmData is required'] },
            missingFields: ['farmData'],
        });
        const app = {
            id: 'app-2', applicationNumber: 'GACP-2026-0002', status: 'DRAFT',
            healthId: 'h-1', formData: {}, workflowHistory: [],
        };
        const mock = buildSubmitMock(app);
        const methods = methodsFor(mock.prisma);

        const result = await methods.submitRevision('app-2', { formData: {}, notes: 'submit' }, actor);

        expect(result.status).toBe(422);
        expect(result.body).toMatchObject({
            success: false,
            error: 'APPLICATION_INCOMPLETE',
            errorsByStep: { 5: ['farmData is required'] },
            missingFields: ['farmData'],
        });
        // NO transition and NO quotation — the whole point of gating BEFORE
        // hop 1, not after.
        expect(writeApplicationStatus).not.toHaveBeenCalled();
        expect(issueQuotationsForApplication).not.toHaveBeenCalled();
    });

    // Item 5 (final-review round, 2026-08-18) — the DRAFT leg lands the
    // application at PENDING_DOC_FEE, exactly what the front door's own DRAFT
    // resubmit produces (RESUBMIT_TARGET.DRAFT, applications.js:709), so this
    // door owes the applicant the same nextRequiredAction + Thai payment copy
    // instead of a bare "will be reviewed again" that omits the payment step.
    it('the DRAFT leg carries nextRequiredAction PAY_PHASE_1 + the front door\'s DRAFT copy', async () => {
        const app = {
            id: 'app-2', applicationNumber: 'GACP-2026-0002', status: 'DRAFT',
            healthId: 'h-1', formData: {}, workflowHistory: [],
        };
        const mock = buildSubmitMock(app);
        const methods = methodsFor(mock.prisma);

        const result = await methods.submitRevision('app-2', { formData: {}, notes: 'submit' }, actor);

        expect(result.status).toBe(200);
        expect(result.body.nextRequiredAction).toBe('PAY_PHASE_1');
        expect(result.body.message).toBe('คำขอเลขที่ GACP-2026-0002 ถูกส่งเข้าระบบแล้ว กรุณาชำระงวดที่ 1 ค่าบริการตรวจสอบเอกสาร');
    });

    it('the REVISION_REQUESTED leg carries no nextRequiredAction and keeps its own message unchanged', async () => {
        const app = {
            id: 'app-1', applicationNumber: 'GACP-2026-0001', status: 'REVISION_REQUESTED',
            healthId: 'h-1', formData: { revisionDueAt: futureDue, workflowState: 'REVISION_REQUESTED' }, workflowHistory: [],
        };
        const mock = buildSubmitMock(app);
        const methods = methodsFor(mock.prisma);

        const result = await methods.submitRevision('app-1', { formData: {}, notes: 'fixed' }, actor);

        expect(result.status).toBe(200);
        expect(result.body.nextRequiredAction).toBeUndefined();
        expect(result.body.message).toBe('Revision submitted successfully. Your application will be reviewed again.');
    });

    // PDPA ROUND-6 — the scalar revision_deadlines.{submittedBy,updatedBy}
    // columns must receive the User UUID (actorUserId), NEVER actorIdentity
    // (which is the raw providerId || healthId plaintext national ID).
    it('stamps the User UUID (not the plaintext national ID) into revision_deadlines.submittedBy/updatedBy', async () => {
        const app = {
            id: 'app-3', applicationNumber: 'GACP-2026-0003', status: 'REVISION_REQUESTED',
            healthId: 'h-1', formData: { revisionDueAt: futureDue }, workflowHistory: [],
        };
        // actorIdentity is a plaintext 13-digit ID; actorUserId is the UUID.
        const PLAINTEXT_NATIONAL_ID = '1234567890123';
        const USER_UUID = '11111111-2222-3333-4444-555555555555';
        const pdpaActor = {
            userId: USER_UUID,
            healthId: 'h-1',
            actorIdentity: PLAINTEXT_NATIONAL_ID,
            actorRole: 'HEALTH',
        };
        const mock = buildSubmitMock(app);
        const methods = methodsFor(mock.prisma);

        await methods.submitRevision('app-3', { formData: {}, notes: 'fixed' }, pdpaActor);

        // The SUBMITTED revision-deadline update is the one carrying submittedBy.
        const submittedUpdate = mock.captured.deadlineUpdates
            .find((u) => u?.data?.status === 'SUBMITTED');
        expect(submittedUpdate).toBeTruthy();
        expect(submittedUpdate.data.submittedBy).toBe(USER_UUID);
        expect(submittedUpdate.data.updatedBy).toBe(USER_UUID);
        // Hard PDPA gate: the plaintext national ID must NOT appear in a scalar col.
        expect(submittedUpdate.data.submittedBy).not.toBe(PLAINTEXT_NATIONAL_ID);
        expect(submittedUpdate.data.updatedBy).not.toBe(PLAINTEXT_NATIONAL_ID);

        // The resubmit writeApplicationStatus stamps the scalar applications.updatedBy
        // → must be the UUID, not the plaintext national ID.
        expect(mock.captured.writerArgs.actorId).toBe(USER_UUID);
        expect(mock.captured.writerArgs.actorId).not.toBe(PLAINTEXT_NATIONAL_ID);
    });

    it('stamps the User UUID into revision_deadlines.updatedBy on the EXPIRED path', async () => {
        // A past due date forces the deadline-expiry branch (status FAILED).
        const pastDue = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const app = {
            id: 'app-4', applicationNumber: 'GACP-2026-0004', status: 'REVISION_REQUESTED',
            healthId: 'h-1', formData: { revisionDueAt: pastDue }, workflowHistory: [],
        };
        const PLAINTEXT_NATIONAL_ID = '9876543210987';
        const USER_UUID = '99999999-8888-7777-6666-555555555555';
        const pdpaActor = {
            userId: USER_UUID,
            healthId: 'h-1',
            actorIdentity: PLAINTEXT_NATIONAL_ID,
            actorRole: 'HEALTH',
        };
        const mock = buildSubmitMock(app);
        const methods = methodsFor(mock.prisma);

        const res = await methods.submitRevision('app-4', { formData: {}, notes: 'late' }, pdpaActor);
        expect(res.status).toBe(400); // expired

        const failedUpdate = mock.captured.deadlineUpdates
            .find((u) => u?.data?.status === 'FAILED');
        expect(failedUpdate).toBeTruthy();
        expect(failedUpdate.data.updatedBy).toBe(USER_UUID);
        expect(failedUpdate.data.updatedBy).not.toBe(PLAINTEXT_NATIONAL_ID);

        // The EXPIRED writeApplicationStatus also stamps the scalar
        // applications.updatedBy → must be the UUID, not the plaintext ID.
        expect(mock.captured.writerArgs.actorId).toBe(USER_UUID);
        expect(mock.captured.writerArgs.actorId).not.toBe(PLAINTEXT_NATIONAL_ID);
    });
});

