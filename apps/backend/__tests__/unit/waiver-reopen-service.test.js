'use strict';

/**
 * Waiver-reopen service (owner ruling 2026-07-08) — the full contract.
 *
 * Policy pins: non-refundable fees + once-per-application reopen reusing the
 * settled payment; assigned inspector initiates; a finance officer (either role, operator 2026-09-27)
 * approves (เท่านั้น); SYSTEM walks the EXPIRED→origin edge; atomic 6-leg
 * approval (miss a leg ⇒ instant re-expiry or phase-skip cert mint — risks
 * #1/#2 in docs/handoffs/waiver-reopen-decision-2026-07-08.md).
 */

const TX = { __tx: true, waiverReopenRequest: null, revisionDeadline: null };

const mockWriteApplicationStatus = jest.fn().mockResolvedValue({});
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
}));

const HOOK = jest.fn().mockResolvedValue({});
const mockHookFactory = jest.fn(() => HOOK);
jest.mock('../../middleware/audit-logger', () => ({
    statusTransitionAuditHook: (...a) => mockHookFactory(...a),
}));

// REAL contract of resolveAllowedIssuerSides (adversarial-verify MUST-1 —
// the previous mock returned new Set(['STATE']): wrong container AND wrong
// vocabulary; the real function returns an ARRAY of 'DTAM'|'PLATFORM'
// (payment-slip-service.js ISSUER_SIDE). Mirror it exactly so this suite can
// never green a .has()/'STATE' bug again.
const mockResolveSides = jest.fn((user) => {
    const role = String(user?.role || user?.canonicalRole || '').toLowerCase();
    if (role === 'finance_officer_dtam') { return ['DTAM']; }
    if (role === 'finance_officer_platform') { return ['PLATFORM']; }
    // 'finance_officer_platform' = the RAW DB spelling legacy seeds carry — the real
    // function normalizeRole()s it to 'finance_officer_platform' internally (staging drill
    // 2026-07-08 caught the mock diverging here).
    if (role === 'system_admin_dtam' || role === 'field_inspector' || role === 'finance_officer_platform' || role === 'finance_officer_platform') { return ['DTAM', 'PLATFORM']; }
    return [];
});
jest.mock('../../services/finance/invoice-side', () => ({
    ISSUER_SIDE: Object.freeze({ DTAM: 'DTAM', PLATFORM: 'PLATFORM' }),
    resolveAllowedIssuerSides: (...a) => mockResolveSides(...a),
}));

const mockComputeSettlement = jest.fn();
jest.mock('../../services/phase-billing-service', () => ({
    computePhaseSettlement: (...a) => mockComputeSettlement(...a),
}));
const mockListSettlements = jest.fn().mockResolvedValue([]);
jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: (...a) => mockListSettlements(...a),
}));

jest.mock('../../utils/field-encryption', () => ({
    maskThaiIdsInText: (s) => `MASKED(${s})`,
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockAppFindFirst = jest.fn();
const mockReqFindFirst = jest.fn();
const mockReqCreate = jest.fn();
const mockReqUpdateTx = jest.fn().mockResolvedValue({});
const mockDeadlineUpsertTx = jest.fn().mockResolvedValue({});
const mockReqUpdateRoot = jest.fn();
const mockReqDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
// Hardening batch: WAIVER_APPROVAL queue item (spawn on petition, close on decide).
const mockWaCreate = jest.fn().mockResolvedValue({ id: 'WA-1' });
const mockWaFindFirst = jest.fn().mockResolvedValue(null);
const mockWaUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
const mockTransaction = jest.fn(async (cb) => {
    TX.waiverReopenRequest = { update: (...a) => mockReqUpdateTx(...a) };
    TX.revisionDeadline = { upsert: (...a) => mockDeadlineUpsertTx(...a) };
    TX.workActivity = { updateMany: (...a) => mockWaUpdateMany(...a) };
    return cb(TX);
});

// SHOULD-7 (tenant wall): the service ANDs the bound tenant org into its
// application lookup. Mutable holder so individual tests can bind a context.
// withoutTenantScope: waiver-approvers.js wraps its User reads in it.
let mockTenantCtx = null;
jest.mock('../../services/tenant-context', () => ({
    getTenantContext: () => mockTenantCtx,
    withoutTenantScope: (fn) => fn(),
}));

const mockInvoiceFindMany = jest.fn().mockResolvedValue([]);
const mockWaiverFindMany = jest.fn().mockResolvedValue([]);
// Hardening batch: live User-row check (ACTIVE/not-deleted/DB-role) at decide +
// petition time. Defaults to "found" so pre-existing tests stay green.
const mockUserFindFirst = jest.fn().mockResolvedValue({ id: 'row-ok' });

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findFirst: (...a) => mockAppFindFirst(...a) },
        invoice: { findMany: (...a) => mockInvoiceFindMany(...a) },
        user: { findFirst: (...a) => mockUserFindFirst(...a) },
        workActivity: {
            create: (...a) => mockWaCreate(...a),
            findFirst: (...a) => mockWaFindFirst(...a),
            updateMany: (...a) => mockWaUpdateMany(...a),
        },
        waiverReopenRequest: {
            findFirst: (...a) => mockReqFindFirst(...a),
            create: (...a) => mockReqCreate(...a),
            findMany: (...a) => mockWaiverFindMany(...a),
            update: (...a) => mockReqUpdateRoot(...a),
            deleteMany: (...a) => mockReqDeleteMany(...a),
        },
        $transaction: (...a) => mockTransaction(...a),
    },
}));

const service = require('../../services/waiver-reopen-service');

const REVIEWER = { id: 'rev-1', canonicalRole: 'document_reviewer', organizationId: 'org-1' };
const AUDITOR = { id: 'aud-1', canonicalRole: 'field_inspector', organizationId: 'org-1' };
const DTAM = { id: 'acct-dtam-1', canonicalRole: 'finance_officer_dtam', organizationId: 'org-1' };
const PLATFORM_ACCT = { id: 'acct-plat-1', canonicalRole: 'finance_officer_platform', organizationId: 'org-1' };
const ADMIN = { id: 'admin-1', canonicalRole: 'system_admin_dtam', organizationId: 'org-1' };

const EXPIRED_FROM_REVISION = {
    id: 'APP-1',
    applicationNumber: 'GACP-2026-0200',
    status: 'EXPIRED',
    organizationId: 'org-1',
    reviewerId: 'rev-1',
    auditorId: 'aud-9',
    version: 7,
    formData: { cancelReason: 'REVISION_OVERDUE' },
    workflowHistory: [
        { timestamp: 't1', action: 'AUTO_EXPIRED', fromStatus: 'REVISION_REQUESTED', toStatus: 'EXPIRED' },
    ],
};
const EXPIRED_FROM_CAR = {
    ...EXPIRED_FROM_REVISION,
    id: 'APP-2',
    applicationNumber: 'GACP-2026-0201',
    formData: { cancelReason: 'CAR_OVERDUE' },
    workflowHistory: [
        { timestamp: 't1', action: 'AUTO_EXPIRED', previousStatus: 'CAR_PENDING', newStatus: 'EXPIRED' },
    ],
};

const VALID_REASON = 'เกษตรกรโทรติดต่อ 2026-07-08 ขอเปิดเคสอนุโลม เอกสารพร้อมแล้ว';

describe('waiver-reopen — createReopenRequest gates', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAppFindFirst.mockResolvedValue({ ...EXPIRED_FROM_REVISION });
        mockReqFindFirst.mockResolvedValue(null);
        mockReqCreate.mockImplementation(async ({ data }) => ({ id: 'REQ-1', ...data }));
    });

    test('assigned reviewer opens a request on a revision-expired app (origin snapshot server-derived)', async () => {
        const { request } = await service.createReopenRequest({
            applicationId: 'APP-1', user: REVIEWER, reason: VALID_REASON,
        });
        expect(request.expiredFromState).toBe('REVISION_REQUESTED');
        expect(request.status).toBe('PENDING');
        // PII invariant: reason masked at write.
        expect(mockReqCreate.mock.calls[0][0].data.reason).toContain('MASKED(');
        expect(mockReqCreate.mock.calls[0][0].data.organizationId).toBe('org-1');
    });

    test('CAR-expired app: only the ASSIGNED auditor may open (newStatus/previousStatus shape normalized)', async () => {
        mockAppFindFirst.mockResolvedValue({ ...EXPIRED_FROM_CAR, auditorId: 'aud-1' });
        const { request } = await service.createReopenRequest({
            applicationId: 'APP-2', user: AUDITOR, reason: VALID_REASON,
        });
        expect(request.expiredFromState).toBe('CAR_PENDING');
    });

    test('non-EXPIRED app → 409 WAIVER_NOT_EXPIRED', async () => {
        mockAppFindFirst.mockResolvedValue({ ...EXPIRED_FROM_REVISION, status: 'REVISION_REQUESTED' });
        await expect(service.createReopenRequest({ applicationId: 'APP-1', user: REVIEWER, reason: VALID_REASON }))
            .rejects.toMatchObject({ statusCode: 409, code: 'WAIVER_NOT_EXPIRED' });
    });

    test('unassigned reviewer → 403 WAIVER_NOT_ASSIGNED', async () => {
        mockAppFindFirst.mockResolvedValue({ ...EXPIRED_FROM_REVISION, reviewerId: 'someone-else' });
        await expect(service.createReopenRequest({ applicationId: 'APP-1', user: REVIEWER, reason: VALID_REASON }))
            .rejects.toMatchObject({ statusCode: 403, code: 'WAIVER_NOT_ASSIGNED' });
    });

    test('wrong role for origin (auditor on revision-expiry) → 403', async () => {
        await expect(service.createReopenRequest({ applicationId: 'APP-1', user: AUDITOR, reason: VALID_REASON }))
            .rejects.toMatchObject({ statusCode: 403, code: 'WAIVER_ROLE_FORBIDDEN' });
    });

    test('ADMIN cannot open (เท่านั้น — inspector path only)', async () => {
        await expect(service.createReopenRequest({ applicationId: 'APP-1', user: ADMIN, reason: VALID_REASON }))
            .rejects.toMatchObject({ statusCode: 403 });
    });

    test('once-only: APPROVED LENIENCY request already exists → 409 WAIVER_ALREADY_USED', async () => {
        const ROWS = [{ id: 'REQ-0', applicationId: 'APP-1', status: 'APPROVED', reasonCode: 'LENIENCY' }];
        mockReqFindFirst.mockImplementation(async ({ where = {} }) => ROWS.find((r) =>
            (!where.applicationId || r.applicationId === where.applicationId)
            && (!where.status || (where.status.in ? where.status.in.includes(r.status) : r.status === where.status))
            && (!where.reasonCode || r.reasonCode === where.reasonCode)) || null);
        await expect(service.createReopenRequest({ applicationId: 'APP-1', user: REVIEWER, reason: VALID_REASON }))
            .rejects.toMatchObject({ statusCode: 409, code: 'WAIVER_ALREADY_USED' });
    });

    test('Q1 lane separation: a WRONGFUL_EXPIRY reinstate does NOT consume the leniency once-only', async () => {
        // Owner ruling (Q1, 2026-07-08): platform-fault reinstates are a
        // separate lane — the farmer did nothing wrong, so their single
        // LENIENCY chance must remain intact. The once-only guard (service +
        // partial-unique) counts ONLY APPROVED LENIENCY rows.
        // Faithful row-store mock: applies whatever filter the service sends.
        const ROWS = [{ id: 'REQ-WF', applicationId: 'APP-1', status: 'APPROVED', reasonCode: 'WRONGFUL_EXPIRY' }];
        mockReqFindFirst.mockImplementation(async ({ where = {} }) => ROWS.find((r) =>
            (!where.applicationId || r.applicationId === where.applicationId)
            && (!where.status || (where.status.in ? where.status.in.includes(r.status) : r.status === where.status))
            && (!where.reasonCode || r.reasonCode === where.reasonCode)) || null);

        const { request } = await service.createReopenRequest({
            applicationId: 'APP-1', user: REVIEWER, reason: VALID_REASON,
        });
        expect(request.status).toBe('PENDING');
    });

    test('open PENDING already exists → 409 WAIVER_ALREADY_PENDING', async () => {
        mockReqFindFirst.mockResolvedValue({ id: 'REQ-0', status: 'PENDING' });
        await expect(service.createReopenRequest({ applicationId: 'APP-1', user: REVIEWER, reason: VALID_REASON }))
            .rejects.toMatchObject({ statusCode: 409, code: 'WAIVER_ALREADY_PENDING' });
    });

    test('reason too short → 400 (contact evidence is mandatory)', async () => {
        await expect(service.createReopenRequest({ applicationId: 'APP-1', user: REVIEWER, reason: 'สั้น' }))
            .rejects.toMatchObject({ statusCode: 400, code: 'WAIVER_REASON_REQUIRED' });
    });

    test('expired from a non-reopenable state → 409 WAIVER_ORIGIN_UNKNOWN', async () => {
        mockAppFindFirst.mockResolvedValue({
            ...EXPIRED_FROM_REVISION,
            formData: {},
            workflowHistory: [{ action: 'X', fromStatus: 'SUBMITTED', toStatus: 'EXPIRED' }],
        });
        await expect(service.createReopenRequest({ applicationId: 'APP-1', user: REVIEWER, reason: VALID_REASON }))
            .rejects.toMatchObject({ statusCode: 409, code: 'WAIVER_ORIGIN_UNKNOWN' });
    });
});

describe('waiver-reopen — approveReopenRequest (SoD + atomic legs)', () => {
    const PENDING_REQ = {
        id: 'REQ-1',
        applicationId: 'APP-1',
        organizationId: 'org-1',
        status: 'PENDING',
        requestedBy: 'rev-1',
        expiredFromState: 'REVISION_REQUESTED',
        reasonCode: 'LENIENCY',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockReqFindFirst.mockResolvedValue({ ...PENDING_REQ });
        mockAppFindFirst.mockResolvedValue({ ...EXPIRED_FROM_REVISION });
        mockComputeSettlement.mockReturnValue({ phasePaid: true });
    });

    test('DTAM-side accountant approves: atomic tx wires every leg', async () => {
        const { origin, dueAt } = await service.approveReopenRequest({ requestId: 'REQ-1', user: DTAM });
        expect(origin).toBe('REVISION_REQUESTED');

        // Leg 6a: request decided INSIDE the tx, where-clause PENDING-guarded
        // (MUST-2: a racing decide matches 0 rows -> P2025 -> full rollback;
        // without it a deny racing an approve could vacate the once-only
        // partial-unique). approverSide uses ISSUER_SIDE vocabulary ('DTAM').
        expect(mockReqUpdateTx).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'REQ-1', status: 'PENDING' },
            data: expect.objectContaining({ status: 'APPROVED', decidedBy: DTAM.id, approverSide: 'DTAM' }),
        }));

        // Legs 1/3: SYSTEM walks the strict edge with CAS.
        const w = mockWriteApplicationStatus.mock.calls[0][0];
        expect(w.prisma).toBe(TX);
        expect(w.fromStatus).toBe('EXPIRED');
        expect(w.toStatus).toBe('REVISION_REQUESTED');
        expect(w.actorRole).toBe('system');
        expect(w.assertTransition).toBe(true);
        expect(w.expectedVersion).toBe(7);
        expect(w.autoIssueCertificate).toBe(false);
        expect(w.onAudit).toBe(HOOK);
        expect(mockHookFactory).toHaveBeenCalledWith(expect.objectContaining({ tx: TX }));

        // Leg 4: fresh holiday-aware due stamps (both twins) + requestedAt reset.
        const fd = w.additionalData.formData;
        expect(fd.revisionDueAt).toBe(dueAt.toISOString());
        expect(fd.revision_due_at).toBe(dueAt.toISOString());
        expect(new Date(fd.revisionDueAt).getTime()).toBeGreaterThan(Date.now());

        // Leg 5: ALL FOUR reminder stamps re-armed + expiry residue cleared.
        expect(fd.revisionReminder24hSentAt).toBeNull();
        expect(fd.revisionReminder48hSentAt).toBeNull();
        expect(fd.carReminder24hSentAt).toBeNull();
        expect(fd.carReminder48hSentAt).toBeNull();
        expect(fd.cancelReason).toBeNull();
        expect(fd.canceledExpiredAt).toBeNull();

        // Leg 5b: RevisionDeadline re-seeded via upsert (never duplicate).
        expect(mockDeadlineUpsertTx).toHaveBeenCalledWith(expect.objectContaining({
            where: { applicationId: 'APP-1' },
            update: expect.objectContaining({ status: 'PENDING' }),
        }));
    });

    test('reinstate clears the checker-lane _autoExpired marker + guard-lane expiredAt/expiredReason residue (hardening batch)', async () => {
        // Residue from the two lanes _executeReopen previously missed:
        // jobs/revision-deadline-checker.js:197 stamps _autoExpired; the
        // revision-deadline-guard lane stamps expiredAt/expiredReason. Left
        // uncleared, a reinstated ACTIVE app permanently asserts a stale
        // auto-expiry (misleads the wrongful-expiry cohort script's
        // formData.expiredAt fallback + any future reader/forensics).
        mockAppFindFirst.mockResolvedValue({
            ...EXPIRED_FROM_REVISION,
            formData: {
                cancelReason: 'REVISION_OVERDUE',
                _autoExpired: {
                    expiredAt: '2026-07-01T00:00:00.000Z',
                    reason: 'REVISION_DEADLINE_EXCEEDED',
                    deadlineId: 'DL-OLD',
                    originalDeadline: '2026-06-24T00:00:00.000Z',
                },
                expiredAt: '2026-07-01T00:00:00.000Z',
                expiredReason: 'REVISION_OVERDUE',
            },
        });

        await service.approveReopenRequest({ requestId: 'REQ-1', user: DTAM });

        const fd = mockWriteApplicationStatus.mock.calls[0][0].additionalData.formData;
        expect(fd._autoExpired).toBeNull();
        expect(fd.expiredAt).toBeNull();
        expect(fd.expiredReason).toBeNull();
    });

    test('CAR-expired approval targets CAR_PENDING and asserts PHASE_2 settlement', async () => {
        mockReqFindFirst.mockResolvedValue({ ...PENDING_REQ, expiredFromState: 'CAR_PENDING' });
        mockAppFindFirst.mockResolvedValue({ ...EXPIRED_FROM_CAR });

        await service.approveReopenRequest({ requestId: 'REQ-1', user: DTAM });

        expect(mockComputeSettlement).toHaveBeenCalledWith(expect.anything(), 'PHASE_2');
        const w = mockWriteApplicationStatus.mock.calls[0][0];
        expect(w.toStatus).toBe('CAR_PENDING');
        expect(w.additionalData.formData.carDueAt).toBeTruthy();
    });

    test('fee not settled (HELD/FORFEITED/unpaid) → 409, nothing written', async () => {
        mockComputeSettlement.mockReturnValue({ phasePaid: false });
        await expect(service.approveReopenRequest({ requestId: 'REQ-1', user: DTAM }))
            .rejects.toMatchObject({ statusCode: 409, code: 'WAIVER_FEE_NOT_SETTLED' });
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
        expect(mockReqUpdateTx).not.toHaveBeenCalled();
    });

    // operator 2026-09-27 "การเงินได้ทั้งสองฝั่ง" — เดิม: PLATFORM → 403 WAIVER_DTAM_SIDE_ONLY
    test('PLATFORM-side accountant approves too — approverSide records PLATFORM truthfully', async () => {
        await service.approveReopenRequest({ requestId: 'REQ-1', user: PLATFORM_ACCT });
        expect(mockReqUpdateTx).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'REQ-1', status: 'PENDING' },
            data: expect.objectContaining({ status: 'APPROVED', decidedBy: PLATFORM_ACCT.id, approverSide: 'PLATFORM' }),
        }));
    });

    test('ADMIN → 403 WAIVER_APPROVER_ROLE (mirror AUDIT-001)', async () => {
        await expect(service.approveReopenRequest({ requestId: 'REQ-1', user: ADMIN }))
            .rejects.toMatchObject({ statusCode: 403, code: 'WAIVER_APPROVER_ROLE' });
    });

    test('AUDITOR → 403 WAIVER_APPROVER_ROLE (role allow-list — finance roles only)', async () => {
        await expect(service.approveReopenRequest({ requestId: 'REQ-1', user: AUDITOR }))
            .rejects.toMatchObject({ statusCode: 403, code: 'WAIVER_APPROVER_ROLE' });
    });

    test('requester cannot approve their own request → 403 WAIVER_SELF_APPROVAL', async () => {
        mockReqFindFirst.mockResolvedValue({ ...PENDING_REQ, requestedBy: 'acct-dtam-1' });
        await expect(service.approveReopenRequest({ requestId: 'REQ-1', user: DTAM }))
            .rejects.toMatchObject({ statusCode: 403, code: 'WAIVER_SELF_APPROVAL' });
    });

    test('application no longer EXPIRED (race with break-glass) → 409 WAIVER_STATE_DRIFT', async () => {
        mockAppFindFirst.mockResolvedValue({ ...EXPIRED_FROM_REVISION, status: 'REVISION_REQUESTED' });
        await expect(service.approveReopenRequest({ requestId: 'REQ-1', user: DTAM }))
            .rejects.toMatchObject({ statusCode: 409, code: 'WAIVER_STATE_DRIFT' });
    });

    test('already-decided request → 409 WAIVER_ALREADY_DECIDED', async () => {
        mockReqFindFirst.mockResolvedValue({ ...PENDING_REQ, status: 'DENIED' });
        await expect(service.approveReopenRequest({ requestId: 'REQ-1', user: DTAM }))
            .rejects.toMatchObject({ statusCode: 409, code: 'WAIVER_ALREADY_DECIDED' });
    });
});

describe('waiver-reopen — denyReopenRequest', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockReqFindFirst.mockResolvedValue({
            id: 'REQ-1', applicationId: 'APP-1', organizationId: 'org-1', status: 'PENDING', requestedBy: 'rev-1',
        });
        mockReqUpdateRoot.mockImplementation(async ({ data }) => ({ id: 'REQ-1', ...data }));
    });

    test('DTAM-side accountant denies with a mandatory note (masked)', async () => {
        const { request } = await service.denyReopenRequest({
            requestId: 'REQ-1', user: DTAM, note: 'เอกสารหลักฐานการติดต่อไม่เพียงพอ',
        });
        expect(request.status).toBe('DENIED');
        expect(mockReqUpdateRoot.mock.calls[0][0].data.decisionNote).toContain('MASKED(');
        // MUST-2: deny is PENDING-guarded too (deny-after-approve must P2025).
        expect(mockReqUpdateRoot.mock.calls[0][0].where).toEqual({ id: 'REQ-1', status: 'PENDING' });
    });

    test('deny without a note → 400', async () => {
        await expect(service.denyReopenRequest({ requestId: 'REQ-1', user: DTAM, note: '' }))
            .rejects.toMatchObject({ statusCode: 400, code: 'WAIVER_DENY_NOTE_REQUIRED' });
    });

    // operator 2026-09-27 — เดิม: PLATFORM-side cannot deny (403 WAIVER_DTAM_SIDE_ONLY)
    test('PLATFORM-side can deny too (same gate) — approverSide PLATFORM', async () => {
        const { request } = await service.denyReopenRequest({ requestId: 'REQ-1', user: PLATFORM_ACCT, note: 'เหตุผลยาวพอสมควร' });
        expect(request.status).toBe('DENIED');
        expect(mockReqUpdateRoot.mock.calls[0][0].data).toMatchObject({ decidedBy: PLATFORM_ACCT.id, approverSide: 'PLATFORM' });
    });
});

describe('carpet-bomb S3 — org walls fail CLOSED (never open) on unresolved organizationId', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockComputeSettlement.mockReturnValue({ phasePaid: true });
        mockInvoiceFindMany.mockResolvedValue([]);
    });

    test('listPendingReopenRequests without organizationId throws NO_ORGANIZATION (was: returned ALL orgs)', async () => {
        await expect(service.listPendingReopenRequests({}))
            .rejects.toMatchObject({ statusCode: 400, code: 'NO_ORGANIZATION' });
        expect(mockWaiverFindMany).not.toHaveBeenCalled();
    });

    test('approve by an approver with NO organizationId → 404 (org wall no longer short-circuits)', async () => {
        mockReqFindFirst.mockResolvedValue({
            id: 'REQ-1', applicationId: 'APP-1', organizationId: 'org-1', status: 'PENDING',
            requestedBy: 'rev-1', expiredFromState: 'REVISION_REQUESTED', reasonCode: 'LENIENCY',
        });
        const orglessDtam = { id: 'acct-dtam-9', canonicalRole: 'finance_officer_dtam' };
        await expect(service.approveReopenRequest({ requestId: 'REQ-1', user: orglessDtam }))
            .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    test('deny by an approver with NO organizationId → 404 (mirror)', async () => {
        mockReqFindFirst.mockResolvedValue({
            id: 'REQ-1', applicationId: 'APP-1', organizationId: 'org-1', status: 'PENDING', requestedBy: 'rev-1',
        });
        const orglessDtam = { id: 'acct-dtam-9', canonicalRole: 'finance_officer_dtam' };
        await expect(service.denyReopenRequest({ requestId: 'REQ-1', user: orglessDtam, note: 'เหตุผลยาวพอสมควร' }))
            .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });
});

describe('carpet-bomb S1 — settlement gate is REFUND-aware (a refunded fee is not reusable)', () => {
    // invoice.status stays 'paid' after a refund — refund state lives ONLY in
    // Invoice.metadata.refund (refund-service). computePhaseSettlement reads
    // status alone, so without this gate a farmer could get a platform refund
    // in REVISION_REQUESTED, let the app expire, then reopen REUSING the
    // refunded fee.
    beforeEach(() => {
        jest.clearAllMocks();
        mockComputeSettlement.mockReturnValue({ phasePaid: true });
        mockReqFindFirst.mockResolvedValue({
            id: 'REQ-1', applicationId: 'APP-1', organizationId: 'org-1', status: 'PENDING',
            requestedBy: 'rev-1', expiredFromState: 'REVISION_REQUESTED', reasonCode: 'LENIENCY',
        });
        mockAppFindFirst.mockResolvedValue({ ...EXPIRED_FROM_REVISION });
    });

    test('approve rejects WAIVER_FEE_NOT_SETTLED when an origin-phase invoice carries an active refund', async () => {
        mockInvoiceFindMany.mockResolvedValue([
            { serviceType: 'PHASE_1_STATE_FEE', metadata: {} },
            { serviceType: 'PHASE_1_PLATFORM_FEE', metadata: { refund: { status: 'COMPLETED' } } },
        ]);
        await expect(service.approveReopenRequest({ requestId: 'REQ-1', user: DTAM }))
            .rejects.toMatchObject({ statusCode: 409, code: 'WAIVER_FEE_NOT_SETTLED' });
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    test('a CANCELLED refund does not block reuse (only live refunds do)', async () => {
        mockInvoiceFindMany.mockResolvedValue([
            { serviceType: 'PHASE_1_STATE_FEE', metadata: { refund: { status: 'CANCELLED' } } },
            { serviceType: 'PHASE_1_PLATFORM_FEE', metadata: {} },
        ]);
        const { origin } = await service.approveReopenRequest({ requestId: 'REQ-1', user: DTAM });
        expect(origin).toBe('REVISION_REQUESTED');
    });
});

describe('hardening batch — live User-row ACTIVE checks (approver + requester)', () => {
    // The JWT asserts a role, but the User row is the record of truth: an
    // accountant suspended/demoted via a path that does not stamp
    // sessionsRevokedAt keeps a valid 12h token. The decide/petition gates must
    // verify the LIVE row (ACTIVE + not deleted + real DTAM DB role, same org)
    // — mirroring the batch lane's S2 check, which already does this.
    const PENDING_REQ = {
        id: 'REQ-1',
        applicationId: 'APP-1',
        organizationId: 'org-1',
        status: 'PENDING',
        requestedBy: 'rev-1',
        expiredFromState: 'REVISION_REQUESTED',
        reasonCode: 'LENIENCY',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockReqFindFirst.mockResolvedValue({ ...PENDING_REQ });
        mockAppFindFirst.mockResolvedValue({ ...EXPIRED_FROM_REVISION });
        mockComputeSettlement.mockReturnValue({ phasePaid: true });
    });

    test('T1 approve: JWT claims account_dtam but the live User row is missing/suspended → 403 WAIVER_APPROVER_NOT_ACTIVE, no reopen leg runs', async () => {
        mockUserFindFirst.mockResolvedValueOnce(null);
        await expect(service.approveReopenRequest({ requestId: 'REQ-1', user: DTAM }))
            .rejects.toMatchObject({ statusCode: 403, code: 'WAIVER_APPROVER_NOT_ACTIVE' });
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
        expect(mockReqUpdateTx).not.toHaveBeenCalled();
    });

    test('T2 deny: suspended approver cannot kill a petition either → 403, request not flipped', async () => {
        mockUserFindFirst.mockResolvedValueOnce(null);
        await expect(service.denyReopenRequest({ requestId: 'REQ-1', user: DTAM, note: 'เอกสารไม่ครบถ้วนตามเงื่อนไข' }))
            .rejects.toMatchObject({ statusCode: 403, code: 'WAIVER_APPROVER_NOT_ACTIVE' });
        expect(mockReqUpdateRoot).not.toHaveBeenCalled();
    });

    test('T3 petition: requester whose live User row is missing/suspended → 403 WAIVER_REQUESTER_NOT_ACTIVE, no request created', async () => {
        mockUserFindFirst.mockResolvedValueOnce(null);
        mockReqFindFirst.mockResolvedValue(null); // no pending/used rows
        await expect(service.createReopenRequest({ applicationId: 'APP-1', user: REVIEWER, reason: VALID_REASON }))
            .rejects.toMatchObject({ statusCode: 403, code: 'WAIVER_REQUESTER_NOT_ACTIVE' });
        expect(mockReqCreate).not.toHaveBeenCalled();
    });

    test('T4 approve happy path: the live-row query is fail-closed on DB role + org + ACTIVE + not-deleted', async () => {
        mockReqFindFirst.mockResolvedValueOnce({ ...PENDING_REQ });
        const { origin } = await service.approveReopenRequest({ requestId: 'REQ-1', user: DTAM });
        expect(origin).toBe('REVISION_REQUESTED');
        expect(mockUserFindFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: DTAM.id,
                organizationId: 'org-1',
                status: 'ACTIVE',
                isDeleted: false,
            }),
        }));

        // The role filter is the fail-closed part, so assert it precisely.
        //
        // Migration 20260801000000 ran in production (zero legacy rows
        // remain), so the filter matches the two canonical account-family
        // values ALONE. Every legacy casing this list used to carry
        // (ACCOUNT / ACCOUNTANT / ACCOUNT_DTAM / FINANCE / …) collapsed into
        // these two and can only ever match nothing.
        const roleFilter = mockUserFindFirst.mock.calls[0][0].where.role.in;
        // ฝั่งกรมเท่านั้น — คำเปล่า `account` ถูกปลดระวาง 2026-09-10 และการยุบมันเข้า
        // ฝั่งบริษัทจะให้การเงินของบริษัทอนุมัติคำผ่อนผันของกรมได้
        expect([...roleFilter].sort()).toEqual(['finance_officer_dtam']);
        // Fail-closed: nothing outside the account family is ever accepted.
        for (const spelling of ['system_admin_dtam', 'system_admin_dtam', 'field_inspector', 'field_inspector', 'HEALTH', 'health']) {
            expect(roleFilter).not.toContain(spelling);
        }
    });
});

describe('Q1 — batchReinstateWrongfulExpiry (platform-fault lane, no petition, no friction)', () => {
    const EXPIRED_A = { ...EXPIRED_FROM_REVISION, id: 'APP-A', applicationNumber: 'GACP-A' };
    const EXPIRED_B = { ...EXPIRED_FROM_CAR, id: 'APP-B', applicationNumber: 'GACP-B' };
    const APPROVER = { id: 'ops-approver-1', canonicalRole: 'finance_officer_dtam', organizationId: 'org-1', status: 'ACTIVE' };

    beforeEach(() => {
        jest.clearAllMocks();
        mockComputeSettlement.mockReturnValue({ phasePaid: true });
        mockReqFindFirst.mockResolvedValue(null);
        mockReqCreate.mockImplementation(async ({ data }) => ({ id: 'REQ-' + data.applicationId, ...data }));
        mockAppFindFirst.mockImplementation(async ({ where }) => {
            if (where?.id === 'APP-A' || where?.OR?.some?.((c) => c.id === 'APP-A' || c.applicationNumber === 'GACP-A')) { return { ...EXPIRED_A }; }
            if (where?.id === 'APP-B' || where?.OR?.some?.((c) => c.id === 'APP-B' || c.applicationNumber === 'GACP-B')) { return { ...EXPIRED_B }; }
            return null;
        });
    });

    test('reinstates a batch: WRONGFUL_EXPIRY rows created+APPROVED, SYSTEM transitions, batch audit trail', async () => {
        const report = await service.batchReinstateWrongfulExpiry({
            applicationIds: ['APP-A', 'APP-B'],
            approver: APPROVER,
            bugRef: 'BLOCKER-F-HOLIDAY-BLIND-#646',
        });

        expect(report.reinstated).toHaveLength(2);
        expect(report.skipped).toHaveLength(0);
        // Request rows carry the platform-fault lane + accountable batch approver.
        expect(mockReqCreate).toHaveBeenCalledTimes(2);
        const createData = mockReqCreate.mock.calls[0][0].data;
        expect(createData.reasonCode).toBe('WRONGFUL_EXPIRY');
        expect(createData.reason).toContain('BLOCKER-F-HOLIDAY-BLIND-#646');
        // Both transitions executed as SYSTEM with the audit hook.
        expect(mockWriteApplicationStatus).toHaveBeenCalledTimes(2);
        const w = mockWriteApplicationStatus.mock.calls[0][0];
        expect(w.actorRole).toBe('system');
        expect(w.onAudit).toBe(HOOK);
        expect(mockHookFactory).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({ batchRef: 'BLOCKER-F-HOLIDAY-BLIND-#646', approvedBy: APPROVER.id }),
        }));
        // Origins derived per app (never caller-chosen).
        const targets = mockWriteApplicationStatus.mock.calls.map((c) => c[0].toStatus).sort();
        expect(targets).toEqual(['CAR_PENDING', 'REVISION_REQUESTED']);
    });

    // L6 (security review 2026-09-27): the approver must belong to the application's organization
    test('L6: approver of org-1 cannot reinstate an org-2 application — skipped, nothing written', async () => {
        const report = await service.batchReinstateWrongfulExpiry({
            applicationIds: ['APP-A'],
            approver: { ...APPROVER, organizationId: 'org-2' },
            bugRef: 'BUG-ORG',
        });
        expect(report.reinstated).toHaveLength(0);
        expect(report.skipped).toEqual([expect.objectContaining({ code: 'WAIVER_BATCH_APPROVER_INVALID' })]);
        expect(mockReqCreate).not.toHaveBeenCalled();
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
    });

    test('L6: approver with no organizationId → skipped (fail closed)', async () => {
        const report = await service.batchReinstateWrongfulExpiry({
            applicationIds: ['APP-A'],
            approver: { ...APPROVER, organizationId: null },
            bugRef: 'BUG-ORG',
        });
        expect(report.reinstated).toHaveLength(0);
        expect(mockReqCreate).not.toHaveBeenCalled();
    });

    test('batch lane clears _autoExpired/expiredAt/expiredReason residue too (shared executor)', async () => {
        mockAppFindFirst.mockImplementation(async ({ where }) => {
            const matches = (key) => where?.id === key || where?.OR?.some?.((c) => c.id === key || c.applicationNumber === key);
            if (matches('APP-A')) {
                return {
                    ...EXPIRED_A,
                    formData: {
                        cancelReason: 'REVISION_OVERDUE',
                        _autoExpired: { expiredAt: '2026-07-01T00:00:00.000Z', reason: 'REVISION_DEADLINE_EXCEEDED' },
                        expiredAt: '2026-07-01T00:00:00.000Z',
                        expiredReason: 'REVISION_OVERDUE',
                    },
                };
            }
            return null;
        });

        await service.batchReinstateWrongfulExpiry({
            applicationIds: ['APP-A'],
            approver: APPROVER,
            bugRef: 'BUG-RESIDUE',
        });

        const fd = mockWriteApplicationStatus.mock.calls[0][0].additionalData.formData;
        expect(fd._autoExpired).toBeNull();
        expect(fd.expiredAt).toBeNull();
        expect(fd.expiredReason).toBeNull();
    });

    test('skips (does not throw batch-wide) non-EXPIRED and unsettled apps, with reasons', async () => {
        mockAppFindFirst.mockImplementation(async ({ where }) => {
            const matches = (key) => where?.id === key || where?.OR?.some?.((c) => c.id === key || c.applicationNumber === key);
            if (matches('APP-A')) { return { ...EXPIRED_A, status: 'CERTIFIED' }; }
            if (matches('APP-B')) { return { ...EXPIRED_B }; }
            return null;
        });
        mockComputeSettlement.mockReturnValue({ phasePaid: false });

        const report = await service.batchReinstateWrongfulExpiry({
            applicationIds: ['APP-A', 'APP-B', 'APP-MISSING'],
            approver: APPROVER,
            bugRef: 'BUG-X',
        });

        expect(report.reinstated).toHaveLength(0);
        expect(report.skipped).toHaveLength(3);
        expect(report.skipped.map((s) => s.code).sort()).toEqual(['NOT_FOUND', 'WAIVER_FEE_NOT_SETTLED', 'WAIVER_NOT_EXPIRED']);
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
    });

    test('requires an accountable approver + bugRef (audit-trail mandate)', async () => {
        await expect(service.batchReinstateWrongfulExpiry({ applicationIds: ['APP-A'], approver: null, bugRef: 'X' }))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(service.batchReinstateWrongfulExpiry({ applicationIds: ['APP-A'], approver: APPROVER, bugRef: '' }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    test('MUST-1: createReopenRequest rejects caller-supplied WRONGFUL_EXPIRY (petition lane is LENIENCY-only)', async () => {
        // The route forwards req.body.reasonCode; without this guard an
        // inspector could reopen forever via the platform-fault lane after
        // the leniency is spent (the 060000 migration removed the DB
        // backstop for repeated WRONGFUL_EXPIRY approvals).
        await expect(service.createReopenRequest({
            applicationId: 'APP-1', user: REVIEWER, reason: VALID_REASON, reasonCode: 'WRONGFUL_EXPIRY',
        })).rejects.toMatchObject({ statusCode: 400, code: 'WAIVER_REASON_CODE_INVALID' });
        expect(mockReqCreate).not.toHaveBeenCalled();
    });

    test('S2: batch rejects an approver who is not an ACTIVE finance officer (truthful approverSide)', async () => {
        await expect(service.batchReinstateWrongfulExpiry({
            applicationIds: ['APP-A'],
            approver: { id: 'admin-9', canonicalRole: 'system_admin_platform', status: 'ACTIVE' },
            bugRef: 'BUG-X',
        })).rejects.toMatchObject({ statusCode: 403, code: 'WAIVER_BATCH_APPROVER_INVALID' });
        await expect(service.batchReinstateWrongfulExpiry({
            applicationIds: ['APP-A'],
            approver: { id: 'acct-dtam-9', canonicalRole: 'finance_officer_dtam', status: 'SUSPENDED' },
            bugRef: 'BUG-X',
        })).rejects.toMatchObject({ statusCode: 403, code: 'WAIVER_BATCH_APPROVER_INVALID' });
        expect(mockReqCreate).not.toHaveBeenCalled();
    });

    test('S2-wiring: รูปแบบ approver ดิบที่ ops CLI ส่งมา ({id, role, status, organizationId}) ถูกรับ', async () => {
        // CLI อ่าน {id, role, status, organizationId} จากตาราง users ตรง ๆ — `role` มาเป็นค่าดิบ
        // ในคอลัมน์ ไม่ใช่ canonicalRole · การส่งแค่ {id} เคยได้ 403 ตอนซ้อมบน staging จริง
        // เทสนี้ตรึงสัญญาที่ CLI พึ่งพา · organizationId เพิ่ม 2026-09-27 (L6 — ผูกผู้อนุมัติกับองค์กร)
        const report = await service.batchReinstateWrongfulExpiry({
            applicationIds: ['APP-A'],
            approver: { id: 'acct-dtam-1', role: 'finance_officer_dtam', status: 'ACTIVE', organizationId: 'org-1' },
            bugRef: 'BUG-Y',
        });
        expect(report.reinstated).toHaveLength(1);
        expect(report.skipped).toHaveLength(0);
    });

    test('S1: a failed reopen leg cleans up its own PENDING row (no orphan wedging the app)', async () => {
        // _executeReopen's tx throws (e.g. CAS conflict) AFTER the PENDING
        // row was created — without cleanup that orphan blocks batch retry,
        // the farmer's leniency petition, and pings the SLA job forever.
        mockTransaction.mockRejectedValueOnce(Object.assign(new Error('version conflict'), { code: 'CONCURRENCY_CONFLICT' }));

        const report = await service.batchReinstateWrongfulExpiry({
            applicationIds: ['APP-A'], approver: APPROVER, bugRef: 'BUG-X',
        });

        expect(report.reinstated).toHaveLength(0);
        expect(report.skipped).toHaveLength(1);
        expect(mockReqDeleteMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: 'REQ-APP-A', status: 'PENDING' }),
        }));
    });

    test('S3: same bugRef already remediated for an application → skipped WAIVER_BUGREF_ALREADY_REMEDIATED (idempotent re-run)', async () => {
        const ROWS = [{
            id: 'REQ-OLD', applicationId: 'APP-A', status: 'APPROVED',
            reasonCode: 'WRONGFUL_EXPIRY', decisionNote: 'BATCH:BUG-X',
        }];
        mockReqFindFirst.mockImplementation(async ({ where = {} }) => ROWS.find((r) =>
            (!where.applicationId || r.applicationId === where.applicationId)
            && (!where.status || (where.status.in ? where.status.in.includes(r.status) : r.status === where.status))
            && (!where.reasonCode || r.reasonCode === where.reasonCode)
            && (!where.decisionNote || r.decisionNote === where.decisionNote)) || null);

        const report = await service.batchReinstateWrongfulExpiry({
            applicationIds: ['APP-A'], approver: APPROVER, bugRef: 'BUG-X',
        });
        expect(report.reinstated).toHaveLength(0);
        expect(report.skipped[0]).toMatchObject({ code: 'WAIVER_BUGREF_ALREADY_REMEDIATED' });

        // A DIFFERENT bug on the same app still reinstates (owner: unlimited
        // for different platform faults).
        const report2 = await service.batchReinstateWrongfulExpiry({
            applicationIds: ['APP-B'], approver: APPROVER, bugRef: 'BUG-X',
        });
        expect(report2.reinstated).toHaveLength(1);
    });

    test('S7: a bound tenant context walls the application lookup (org mismatch → skipped NOT_FOUND)', async () => {
        mockTenantCtx = { organizationId: 'org-2' };
        try {
            mockAppFindFirst.mockImplementation(async ({ where }) => {
                // Faithful: apply the org filter the service sends.
                if (where?.organizationId && where.organizationId !== 'org-1') { return null; }
                return { ...EXPIRED_A };
            });
            const report = await service.batchReinstateWrongfulExpiry({
                applicationIds: ['APP-A'], approver: APPROVER, bugRef: 'BUG-X',
            });
            expect(report.reinstated).toHaveLength(0);
            expect(report.skipped[0]).toMatchObject({ code: 'NOT_FOUND' });
        } finally {
            mockTenantCtx = null;
        }
    });

    test('dryRun: runs the SAME gates but writes NOTHING (ops preview)', async () => {
        mockComputeSettlement.mockImplementation((invoices, phase) => ({ phasePaid: phase === 'PHASE_1' }));

        const report = await service.batchReinstateWrongfulExpiry({
            applicationIds: ['APP-A', 'APP-B', 'APP-MISSING'],
            approver: APPROVER,
            bugRef: 'BUG-X',
            dryRun: true,
        });

        // APP-A (revision origin, PHASE_1 settled) would reinstate; APP-B fails
        // the PHASE_2 settlement gate; APP-MISSING not found.
        expect(report.dryRun).toBe(true);
        expect(report.reinstated).toHaveLength(0);
        expect(report.wouldReinstate).toEqual([
            expect.objectContaining({ applicationNumber: 'GACP-A', origin: 'REVISION_REQUESTED' }),
        ]);
        expect(report.skipped.map((s) => s.code).sort()).toEqual(['NOT_FOUND', 'WAIVER_FEE_NOT_SETTLED']);
        // No writes of any kind.
        expect(mockReqCreate).not.toHaveBeenCalled();
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
        expect(mockTransaction).not.toHaveBeenCalled();
    });
});
