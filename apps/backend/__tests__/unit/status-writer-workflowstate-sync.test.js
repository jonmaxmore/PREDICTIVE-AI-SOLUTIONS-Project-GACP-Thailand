'use strict';

/**
 * Bug 3.1 [HIGH] — Admin force/revert + batch-action desync status column vs
 * formData.workflowState → next reviewer transition 422s (app stuck).
 *
 * Root cause: writeApplicationStatus SKIPPED the H1 workflowState sync entirely
 * whenever `additionalData` carried a `formData` key. Admin force / revert /
 * provider batch-action all pass an explicit formData (WITHOUT a workflowState
 * key) → the status COLUMN advanced but formData.workflowState stayed frozen →
 * the next reviewer transition builds from the stale state → canTransition
 * returns false → 422, app stuck.
 *
 * Fix (single point in the writer): when additionalData.formData is present but
 * does NOT already carry a `workflowState` key, MERGE the canonical
 * workflowState (+ workflowStateUpdatedAt) onto it. Only skip stamping when the
 * caller's formData ALREADY set workflowState intentionally.
 *
 * These tests use the REAL workflow-transition-service (so we exercise the
 * canonical normalizer + canTransition + WORKFLOW_STATES contract). Certificate
 * / audit modules are lazily required inside the writer — mocked to avoid the
 * heavy prisma + crypto dependency tree (per the project rules: mock DB-importing
 * modules before requiring).
 */

const path = require('path');

const {
    WORKFLOW_STATES,
    canTransition,
} = require('../../services/workflow-transition-service');

// certificate-service + audit-logger are lazily required inside the writer.
// Mock them so we never touch the real prisma/crypto tree.
jest.mock('../../services/certificate-service', () => ({
    findCertificateForApplication: jest.fn(async () => null),
    generateCertificate: jest.fn(async () => ({ id: 'cert-x', certificateNumber: 'GACP-TEST' })),
}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { logWithin: jest.fn(async () => ({})), log: jest.fn(async () => ({})) },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { WARNING: 'WARNING', INFO: 'INFO' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

const writerPath = path.resolve(__dirname, '../../services/application-status-writer.js');

function loadWriter() {
    jest.resetModules();
    return require(writerPath);
}

function makePrisma(currentFormData) {
    return {
        application: {
            findUnique: jest.fn(async () => ({ formData: currentFormData || {} })),
            update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        },
    };
}

describe('Bug 3.1 — writer stamps workflowState even when caller supplies formData without one', () => {
    // Sanity: canonical strings actually exist in the workflow state list, so
    // the desync/422 scenario below is exercised against real state names.
    test('WORKFLOW_STATES contains the states used here (contract lock)', () => {
        expect(WORKFLOW_STATES).toEqual(expect.arrayContaining([
            'DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED',
        ]));
    });

    test('(a) explicit formData with a STALE workflowState (spread from the persisted row) → RE-STAMPED to the new status', async () => {
        const { writeApplicationStatus } = loadWriter();
        // The REAL admin force / revert / batch-action shape: the caller spreads
        // the persisted row's formData — which ALREADY carries a STALE
        // workflowState from the prior transition (here 'DOC_FEE_PAID'). Keying on
        // mere presence would treat that stale value as intentional and skip the
        // re-stamp (the Bug-3.1 false-fix). The writer MUST correct it.
        const prisma = makePrisma({ workflowState: 'DOC_FEE_PAID', keepMe: 'yes' });

        await writeApplicationStatus({
            prisma,
            applicationId: 'app-desync',
            fromStatus: 'DOC_FEE_PAID',
            toStatus: 'ASSIGNED_FOR_REVIEW',
            actorId: 'admin-1',
            actorRole: 'admin',
            autoIssueCertificate: false,
            additionalData: {
                updatedBy: 'admin-1',
                formData: { workflowState: 'DOC_FEE_PAID', keepMe: 'yes', adminOverrides: [{ x: 1 }] },
            },
        });

        const data = prisma.application.update.mock.calls[0][0].data;
        expect(data.status).toBe('ASSIGNED_FOR_REVIEW');
        // The bug: a stale workflowState used to survive → 422 on the next
        // transition. Now it must track the column.
        expect(data.formData.workflowState).toBe('ASSIGNED_FOR_REVIEW');
        expect(data.formData.workflowStateUpdatedAt).toEqual(expect.any(String));
        // Caller-supplied keys are preserved (merge, not replace).
        expect(data.formData.keepMe).toBe('yes');
        expect(data.formData.adminOverrides).toEqual([{ x: 1 }]);
    });

    test('(b) formData that ALREADY has a workflowState → the caller value is preserved (not clobbered)', async () => {
        const { writeApplicationStatus } = loadWriter();
        const prisma = makePrisma();

        await writeApplicationStatus({
            prisma,
            applicationId: 'app-explicit',
            fromStatus: 'AUDIT_PASSED',
            toStatus: 'AUDIT_PASSED',
            actorId: 'system',
            autoIssueCertificate: false,
            additionalData: { formData: { workflowState: 'AUDIT_PASSED', x: 1 } },
        });

        const data = prisma.application.update.mock.calls[0][0].data;
        expect(data.formData).toEqual({ workflowState: 'AUDIT_PASSED', x: 1 });
        // Caller already set workflowState → no pre-read needed for the merge.
        // (AUDIT_PASSED also reads the two assignee ids for the separation-of-duties guard; that
        // read never selects formData.)
        expect(prisma.application.findUnique.mock.calls.filter(([a]) => a.select && a.select.formData)).toHaveLength(0);
    });

    test('(c) NO formData supplied → existing H1 behaviour unchanged (still stamps from pre-read)', async () => {
        const { writeApplicationStatus } = loadWriter();
        const prisma = makePrisma({ workflowState: 'PENDING_DOC_FEE', someKey: 'keep' });

        await writeApplicationStatus({
            prisma,
            applicationId: 'app-noform',
            fromStatus: 'PENDING_DOC_FEE',
            toStatus: 'DOC_FEE_PAID',
            actorId: 'acct-1',
            actorRole: 'account',
            additionalData: { phase1Status: 'PAID' },
        });

        const data = prisma.application.update.mock.calls[0][0].data;
        expect(data.status).toBe('DOC_FEE_PAID');
        expect(data.formData.workflowState).toBe('DOC_FEE_PAID');
        expect(data.formData.someKey).toBe('keep');
        expect(data.phase1Status).toBe('PAID');
    });

    test('(integration) admin force DOC_FEE_PAID→ASSIGNED_FOR_REVIEW then reviewer ASSIGNED_FOR_REVIEW→DOC_APPROVED SUCCEEDS (no 422 desync)', async () => {
        const { writeApplicationStatus } = loadWriter();
        // Start: formData mirrors the column at DOC_FEE_PAID.
        const prisma = makePrisma({ workflowState: 'DOC_FEE_PAID' });

        // 1) Admin batch-action / force passes formData WITHOUT workflowState.
        const forced = await writeApplicationStatus({
            prisma,
            applicationId: 'app-int',
            fromStatus: 'DOC_FEE_PAID',
            toStatus: 'ASSIGNED_FOR_REVIEW',
            actorId: 'admin-1',
            actorRole: 'admin',
            autoIssueCertificate: false,
            additionalData: {
                formData: { PROVIDERAssignment: { reviewerId: 'rev-1' } },
            },
        });

        // The written formData.workflowState now tracks the column (the fix).
        const persistedState = forced.formData.workflowState;
        expect(persistedState).toBe('ASSIGNED_FOR_REVIEW');

        // 2) The next reviewer transition builds `from` off formData.workflowState.
        //    Before the fix this was stale ('DOC_FEE_PAID') → canTransition false → 422.
        //    After the fix it is 'ASSIGNED_FOR_REVIEW' → the reviewer transition is legal.
        expect(canTransition(persistedState, 'DOC_APPROVED', { actorRole: 'document_reviewer' }))
            .toBe(true);
    });
});
