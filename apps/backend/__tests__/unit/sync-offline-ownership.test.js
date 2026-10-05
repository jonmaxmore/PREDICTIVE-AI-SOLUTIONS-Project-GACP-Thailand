/**
 * SEC-SYS-001 regression — POST /api/sync/offline `save_draft` must scope the
 * write to the authenticated applicant. A HEALTH user must NOT be able to
 * overwrite another applicant's application formData by supplying its id
 * (cross-tenant IDOR write).
 *
 * The controller responds with { success, message, data: results } where
 * results = { processed, failed, errors[], successfulActionIds[] }.
 *
 * See docs/handoffs/audit-2026-05-31/security/SEC-SYS.md (SEC-SYS-001).
 *
 * Ownership was never the whole gate. The same `save_draft` action replaced
 * `formData` WHOLESALE (`data: { formData: payload.formData }`), and formData
 * is one blob shared with the server: fees, workflowState, reviewer and
 * assignment records, audit results, and `onsiteAuditId` — the pin naming
 * which audit's photographs a certificate is issued against. So the owner of a
 * filing could hand themselves an audit. This suite now also pins:
 *   • the write goes through the SAME allowlist as POST /applications/draft
 *     (pickWizardOwnedFormData), merged onto the stored blob;
 *   • a save against a filing that is no longer applicant-editable is refused
 *     rather than silently accepted.
 */
'use strict';

jest.mock('../../services/prisma-database', () => {
    const tx = { application: { findUnique: jest.fn(), update: jest.fn() } };
    return {
        prisma: {
            __tx: tx,
            $transaction: jest.fn(async (cb) => cb(tx)),
        },
    };
});
jest.mock('../../services/application-status-writer', () => ({ writeApplicationStatus: jest.fn() }));
jest.mock('../../shared/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { prisma } = require('../../services/prisma-database');
const SyncController = require('../../controllers/sync-controller');
const tx = prisma.__tx;

function mockRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
}

const buildReq = (user, actions) => ({ body: { actions }, user });

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('SyncController save_draft ownership (SEC-SYS-001)', () => {
    test('rejects save_draft for an application the caller does not own', async () => {
        tx.application.findUnique.mockResolvedValue({ healthId: 'owner-A', status: 'DRAFT', formData: {} });
        const req = buildReq({ healthId: 'attacker-B', role: 'health' }, [
            { id: 'act-1', action: 'save_draft', payload: { applicationId: 'app-1', formData: { tampered: true } } },
        ]);
        const res = mockRes();

        await SyncController.processOfflineSync(req, res);

        expect(res.body.data.processed).toBe(0);
        expect(res.body.data.failed).toBe(1);
        expect(res.body.data.errors[0].error).toMatch(/Forbidden/);
        expect(tx.application.update).not.toHaveBeenCalled();
    });

    test('allows save_draft for the owning applicant, writing the wizard answers it sent', async () => {
        tx.application.findUnique.mockResolvedValue({ healthId: 'owner-A', status: 'DRAFT', formData: {} });
        const req = buildReq({ healthId: 'owner-A', role: 'health' }, [
            {
                id: 'act-2',
                action: 'save_draft',
                payload: { applicationId: 'app-1', formData: { farmData: { name: 'ไร่ทดสอบ' } } },
            },
        ]);
        const res = mockRes();

        await SyncController.processOfflineSync(req, res);

        expect(res.body.data.processed).toBe(1);
        expect(res.body.data.failed).toBe(0);
        expect(tx.application.update).toHaveBeenCalledWith({
            where: { id: 'app-1' },
            data: { formData: { farmData: { name: 'ไร่ทดสอบ' } } },
        });
    });

    test('rejects save_draft when the caller has no healthId (e.g. provider token)', async () => {
        const req = buildReq({ role: 'auditor' }, [
            { id: 'act-3', action: 'save_draft', payload: { applicationId: 'app-1', formData: {} } },
        ]);
        const res = mockRes();

        await SyncController.processOfflineSync(req, res);

        expect(res.body.data.failed).toBe(1);
        expect(res.body.data.errors[0].error).toMatch(/authenticated applicant/);
        expect(tx.application.findUnique).not.toHaveBeenCalled();
        expect(tx.application.update).not.toHaveBeenCalled();
    });
});

describe('SyncController save_draft formData allowlist (offline door, F-G4-14 parity)', () => {
    // What the SERVER had already written into the shared blob before the
    // offline client replayed its queue.
    const storedFormData = Object.freeze({
        farmData: { name: 'ไร่เดิม' },
        onsiteAuditId: 'audit-real-001',
        fees: { docFee: 5000, auditFee: 25000, currency: 'THB' },
        workflowState: 'AUDIT_CONFIRMED',
        auditResult: 'FAIL',
        auditedAt: '2026-08-20T03:00:00.000Z',
        uploadedDocuments: [{ filePath: '/srv/uploads/real.pdf' }],
        reviewerName: 'ผู้ตรวจ ก',
    });

    function writtenFormData() {
        expect(tx.application.update).toHaveBeenCalledTimes(1);
        return tx.application.update.mock.calls[0][0].data.formData;
    }

    test('a payload carrying onsiteAuditId, fees and workflowState writes NONE of them', async () => {
        tx.application.findUnique.mockResolvedValue({
            healthId: 'owner-A',
            status: 'DRAFT',
            formData: { ...storedFormData },
        });
        const req = buildReq({ healthId: 'owner-A', role: 'health' }, [
            {
                id: 'act-forge',
                action: 'save_draft',
                payload: {
                    applicationId: 'app-1',
                    formData: {
                        // The wizard answer this save legitimately carries.
                        farmData: { name: 'ไร่ใหม่' },
                        // Everything below is the server's to write, not the applicant's.
                        onsiteAuditId: 'audit-forged-by-applicant',
                        fees: { docFee: 0, auditFee: 0, currency: 'THB' },
                        workflowState: 'CERTIFIED',
                        auditResult: 'PASS',
                        auditedAt: '2026-01-01T00:00:00.000Z',
                        uploadedDocuments: [{ filePath: '../../../etc/passwd' }],
                        reviewerName: 'ตัวเอง',
                        status: 'CERTIFIED',
                        submittedAt: '2026-01-01T00:00:00.000Z',
                    },
                },
            },
        ]);
        const res = mockRes();

        await SyncController.processOfflineSync(req, res);

        expect(res.body.data.failed).toBe(0);
        const written = writtenFormData();
        // The applicant's own answer landed …
        expect(written.farmData).toEqual({ name: 'ไร่ใหม่' });
        // … and every server-owned key still holds what the SERVER wrote.
        expect(written.onsiteAuditId).toBe('audit-real-001');
        expect(written.fees).toEqual(storedFormData.fees);
        expect(written.workflowState).toBe('AUDIT_CONFIRMED');
        expect(written.auditResult).toBe('FAIL');
        expect(written.auditedAt).toBe('2026-08-20T03:00:00.000Z');
        expect(written.uploadedDocuments).toEqual([{ filePath: '/srv/uploads/real.pdf' }]);
        expect(written.reviewerName).toBe('ผู้ตรวจ ก');
        // Keys the client invented are not smuggled in either (allowlist, not denylist).
        expect(written).not.toHaveProperty('status');
        expect(written).not.toHaveProperty('submittedAt');
    });

    test('an empty application blob cannot erase what the server stored', async () => {
        // The offline queue posting {} used to blank the whole row.
        tx.application.findUnique.mockResolvedValue({
            healthId: 'owner-A',
            status: 'DRAFT',
            formData: { ...storedFormData },
        });
        const req = buildReq({ healthId: 'owner-A', role: 'health' }, [
            { id: 'act-empty', action: 'save_draft', payload: { applicationId: 'app-1', formData: {} } },
        ]);
        const res = mockRes();

        await SyncController.processOfflineSync(req, res);

        expect(res.body.data.failed).toBe(0);
        expect(writtenFormData()).toEqual(storedFormData);
    });

    test('an emptied wizard list is still an edit ([] and false are answers)', async () => {
        tx.application.findUnique.mockResolvedValue({
            healthId: 'owner-A',
            status: 'DRAFT',
            formData: { plots: [{ id: 'p1' }], consentedPDPA: true },
        });
        const req = buildReq({ healthId: 'owner-A', role: 'health' }, [
            {
                id: 'act-clear',
                action: 'save_draft',
                payload: { applicationId: 'app-1', formData: { plots: [], consentedPDPA: false } },
            },
        ]);
        const res = mockRes();

        await SyncController.processOfflineSync(req, res);

        expect(res.body.data.failed).toBe(0);
        expect(writtenFormData()).toEqual({ plots: [], consentedPDPA: false });
    });

    test('a non-object formData writes nothing but leaves the stored blob intact', async () => {
        tx.application.findUnique.mockResolvedValue({
            healthId: 'owner-A',
            status: 'DRAFT',
            formData: { ...storedFormData },
        });
        const req = buildReq({ healthId: 'owner-A', role: 'health' }, [
            { id: 'act-string', action: 'save_draft', payload: { applicationId: 'app-1', formData: 'not-an-object' } },
        ]);
        const res = mockRes();

        await SyncController.processOfflineSync(req, res);

        expect(res.body.data.failed).toBe(0);
        expect(writtenFormData()).toEqual(storedFormData);
    });
});

describe('SyncController save_draft status gate (Bug 2.3 parity on the offline door)', () => {
    test.each(['SUBMITTED', 'ASSIGNED_FOR_REVIEW', 'AUDIT_PASSED', 'CERTIFIED', 'REJECTED'])(
        'refuses a replayed draft save against a %s filing the caller owns',
        async (status) => {
            tx.application.findUnique.mockResolvedValue({
                healthId: 'owner-A',
                status,
                formData: { farmData: { name: 'ไร่ที่ยื่นแล้ว' } },
            });
            const req = buildReq({ healthId: 'owner-A', role: 'health' }, [
                {
                    id: 'act-late',
                    action: 'save_draft',
                    payload: { applicationId: 'app-1', formData: { farmData: { name: 'แก้ทีหลัง' } } },
                },
            ]);
            const res = mockRes();

            await SyncController.processOfflineSync(req, res);

            expect(res.body.data.processed).toBe(0);
            expect(res.body.data.failed).toBe(1);
            expect(res.body.data.errors[0].error).toMatch(/not editable/i);
            expect(tx.application.update).not.toHaveBeenCalled();
        },
    );

    test.each(['DRAFT', 'REVISION_REQUESTED', 'CAR_PENDING'])(
        'still accepts a draft save while the filing is applicant-editable (%s)',
        async (status) => {
            tx.application.findUnique.mockResolvedValue({ healthId: 'owner-A', status, formData: {} });
            const req = buildReq({ healthId: 'owner-A', role: 'health' }, [
                {
                    id: 'act-ok',
                    action: 'save_draft',
                    payload: { applicationId: 'app-1', formData: { farmData: { name: 'ไร่ทดสอบ' } } },
                },
            ]);
            const res = mockRes();

            await SyncController.processOfflineSync(req, res);

            expect(res.body.data.processed).toBe(1);
            expect(tx.application.update).toHaveBeenCalledTimes(1);
        },
    );
});

describe('PENTEST R6-1 — offline submit_audit is disabled (state-machine bypass closed)', () => {
    const { writeApplicationStatus } = require('../../services/application-status-writer');

    test('submit_audit is refused (410) and writes NO application status, for any auditor/app/state', async () => {
        // Before the fix, this wrote status=REJECTED with assertTransition:false and no
        // ownership/state/edge check — any AUDITOR could force ANY app to a terminal state.
        const req = buildReq({ id: 'auditor-x', role: 'auditor' }, [
            { id: 'act-audit', action: 'submit_audit', payload: { applicationId: 'victim-app', passed: false } },
        ]);
        const res = mockRes();

        await SyncController.processOfflineSync(req, res);

        expect(res.body.data.processed).toBe(0);
        expect(res.body.data.failed).toBe(1);
        expect(res.body.data.errors[0].error).toMatch(/disabled/i);
        expect(writeApplicationStatus).not.toHaveBeenCalled();
        expect(tx.application.update).not.toHaveBeenCalled();
    });
});
