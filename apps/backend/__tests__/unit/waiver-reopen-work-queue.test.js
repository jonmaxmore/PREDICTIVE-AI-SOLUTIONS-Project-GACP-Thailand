'use strict';

/**
 * Hardening batch 2026-07-09 — waiver reopen: WorkActivity queue item.
 *
 * A PENDING WaiverReopenRequest was invisible in the unified /provider/work
 * inbox: petition creation causes no status transition, so createForStage
 * never fires, and no stage_activity_config exists for EXPIRED (deliberate —
 * a config row would spawn an item on EVERY expiry, not just petitions).
 * Only notifications + the daily SLA job reached the DTAM accountants.
 *
 * Fix under test:
 *   (A) createReopenRequest spawns a WAIVER_APPROVAL work item BEST-EFFORT
 *       (queue-item failure must never block the farmer's petition);
 *   (B) both decide paths (approve inside _executeReopen's tx, deny) close
 *       the open item so it doesn't linger forever-overdue.
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockAppFindFirst = jest.fn();
const mockReqFindFirst = jest.fn();
const mockReqCreate = jest.fn();
const mockReqUpdateTx = jest.fn().mockResolvedValue({});
const mockDeadlineUpsertTx = jest.fn().mockResolvedValue({});
const mockReqUpdateRoot = jest.fn().mockResolvedValue({});
const mockUserFindFirst = jest.fn().mockResolvedValue({ id: 'row-ok' });
const mockWaCreate = jest.fn().mockResolvedValue({ id: 'WA-1' });
const mockWaFindFirst = jest.fn().mockResolvedValue(null);
const mockWaUpdateManyRoot = jest.fn().mockResolvedValue({ count: 1 });
const mockWaUpdateManyTx = jest.fn().mockResolvedValue({ count: 1 });

const TX = {};
const mockTransaction = jest.fn(async (cb) => {
    TX.waiverReopenRequest = { update: (...a) => mockReqUpdateTx(...a) };
    TX.revisionDeadline = { upsert: (...a) => mockDeadlineUpsertTx(...a) };
    TX.workActivity = { updateMany: (...a) => mockWaUpdateManyTx(...a) };
    return cb(TX);
});

jest.mock('../../services/tenant-context', () => ({
    getTenantContext: () => null,
    withoutTenantScope: (fn) => fn(),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findFirst: (...a) => mockAppFindFirst(...a) },
        invoice: { findMany: jest.fn().mockResolvedValue([]) },
        user: { findFirst: (...a) => mockUserFindFirst(...a) },
        workActivity: {
            create: (...a) => mockWaCreate(...a),
            findFirst: (...a) => mockWaFindFirst(...a),
            updateMany: (...a) => mockWaUpdateManyRoot(...a),
        },
        waiverReopenRequest: {
            findFirst: (...a) => mockReqFindFirst(...a),
            create: (...a) => mockReqCreate(...a),
            findMany: jest.fn().mockResolvedValue([]),
            update: (...a) => mockReqUpdateRoot(...a),
        },
        $transaction: (...a) => mockTransaction(...a),
    },
}));

const mockWriteApplicationStatus = jest.fn().mockResolvedValue({});
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
}));

const HOOK = () => {};
jest.mock('../../middleware/audit-logger', () => ({
    statusTransitionAuditHook: jest.fn(() => HOOK),
}));

const mockComputeSettlement = jest.fn().mockReturnValue({ phasePaid: true });
jest.mock('../../services/phase-billing-service', () => ({
    computePhaseSettlement: (...a) => mockComputeSettlement(...a),
}));
jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../services/finance/invoice-side', () => ({
    ISSUER_SIDE: Object.freeze({ DTAM: 'DTAM', PLATFORM: 'PLATFORM' }),
    resolveAllowedIssuerSides: (user) => {
        const role = String(user?.canonicalRole || user?.role || '').toLowerCase();
        if (role === 'finance_officer_dtam' || role === 'finance_officer_platform') { return ['DTAM']; }
        if (role === 'finance_officer_platform') { return ['PLATFORM']; }
        return [];
    },
    ISSUER_SIDE: { DTAM: 'DTAM', PLATFORM: 'PLATFORM' },
}));
jest.mock('../../utils/field-encryption', () => ({
    maskThaiIdsInText: (s) => s,
}));

const service = require('../../services/waiver-reopen-service');

const REVIEWER = { id: 'rev-1', canonicalRole: 'document_reviewer', organizationId: 'org-1' };
const DTAM = { id: 'acct-dtam-1', canonicalRole: 'finance_officer_dtam', organizationId: 'org-1' };

const EXPIRED_APP = {
    id: 'APP-1',
    applicationNumber: 'GACP-2026-0300',
    status: 'EXPIRED',
    organizationId: 'org-1',
    reviewerId: 'rev-1',
    auditorId: 'aud-9',
    version: 3,
    formData: { cancelReason: 'REVISION_OVERDUE' },
    workflowHistory: [
        { timestamp: 't1', action: 'AUTO_EXPIRED', fromStatus: 'REVISION_REQUESTED', toStatus: 'EXPIRED' },
    ],
};

const PENDING_REQ = {
    id: 'REQ-1',
    applicationId: 'APP-1',
    organizationId: 'org-1',
    status: 'PENDING',
    requestedBy: 'rev-1',
    expiredFromState: 'REVISION_REQUESTED',
    reasonCode: 'LENIENCY',
};

const VALID_REASON = 'เกษตรกรโทรติดต่อ 2026-07-09 ขอเปิดเคสอนุโลม เอกสารพร้อมแล้ว';

beforeEach(() => {
    jest.clearAllMocks();
    mockAppFindFirst.mockResolvedValue({ ...EXPIRED_APP });
    mockReqFindFirst.mockResolvedValue(null);
    mockReqCreate.mockImplementation(async ({ data }) => ({ id: 'REQ-1', ...data }));
    mockComputeSettlement.mockReturnValue({ phasePaid: true });
    mockWaFindFirst.mockResolvedValue(null);
});

describe('(A) petition spawns a WAIVER_APPROVAL queue item for the finance approver pool (both finance roles)', () => {
    test('createReopenRequest creates the work item (role-pool TODO, EXPIRED stage, org-scoped)', async () => {
        await service.createReopenRequest({ applicationId: 'APP-1', user: REVIEWER, reason: VALID_REASON });

        expect(mockWaCreate).toHaveBeenCalledTimes(1);
        const data = mockWaCreate.mock.calls[0][0].data;
        expect(data).toEqual(expect.objectContaining({
            applicationId: 'APP-1',
            workType: 'WAIVER_APPROVAL',
            // operator 2026-09-27 (B): the composite group of both finance roles
            // (shared/user-groups FINANCE_OFFICERS_GROUP) — was 'finance_officer_dtam'
            candidateGroup: 'finance_officers',
            state: 'TODO',
            assignedUserId: null, // pull model — any finance officer decides
            triggeredAtStage: 'EXPIRED',
            organizationId: 'org-1',
        }));
        // Decision SLA symmetric with waiver-sla-escalation-job (5 working days).
        expect(data.dueAt instanceof Date).toBe(true);
        expect(data.dueAt.getTime()).toBeGreaterThan(Date.now());
    });

    test('best-effort contract: queue-item failure does NOT block the petition', async () => {
        mockWaCreate.mockRejectedValueOnce(new Error('db hiccup'));
        const { request } = await service.createReopenRequest({ applicationId: 'APP-1', user: REVIEWER, reason: VALID_REASON });
        expect(request.id).toBe('REQ-1'); // petition still created
    });

    test('idempotency: an existing open item is not duplicated (returns cleanly, no P2002)', async () => {
        mockWaFindFirst.mockResolvedValueOnce({ id: 'WA-EXISTING' });
        await service.createReopenRequest({ applicationId: 'APP-1', user: REVIEWER, reason: VALID_REASON });
        expect(mockWaCreate).not.toHaveBeenCalled();
    });
});

describe('(B) decide closes the open queue item', () => {
    test('approve closes it to DONE inside the same tx as the decision', async () => {
        mockReqFindFirst.mockResolvedValue({ ...PENDING_REQ });
        await service.approveReopenRequest({ requestId: 'REQ-1', user: DTAM });

        expect(mockWaUpdateManyTx).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                applicationId: 'APP-1',
                workType: 'WAIVER_APPROVAL',
                triggeredAtStage: 'EXPIRED',
                state: { in: ['TODO', 'CLAIMED', 'IN_PROGRESS'] },
            }),
            data: expect.objectContaining({ state: 'DONE', completedBy: DTAM.id }),
        }));
    });

    test('deny closes it too (updateMany matching 0 rows = safe no-op for legacy requests)', async () => {
        mockReqFindFirst.mockResolvedValue({ ...PENDING_REQ });
        await service.denyReopenRequest({ requestId: 'REQ-1', user: DTAM, note: 'เอกสารหลักฐานไม่เพียงพอ' });

        expect(mockWaUpdateManyRoot).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                applicationId: 'APP-1',
                workType: 'WAIVER_APPROVAL',
                state: { in: ['TODO', 'CLAIMED', 'IN_PROGRESS'] },
            }),
            data: expect.objectContaining({ state: 'DONE', completedBy: DTAM.id }),
        }));
    });
});
