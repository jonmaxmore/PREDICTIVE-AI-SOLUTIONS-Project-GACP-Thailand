'use strict';
/**
 * R3 — issuing the quotation at submit must be awaited and must fail loudly.
 *
 * Today both call sites are fire-and-forget with a `.catch` that writes a
 * logger.warn and nothing else (applications.js:1211-1219,
 * application-review-revision-methods.js:317-325). the backlog already
 * carries this debt. With the acceptance gate fail-closed, a swallowed issuance
 * failure stops being a tidiness problem and becomes an applicant who cannot pay
 * at all — and nobody is told.
 *
 * The submitted status is NOT rolled back: it is already committed by the
 * status writer, which is on the no-touch list.
 */
const mockIssue = jest.fn();
jest.mock('../../services/quotation-service', () => ({
    issueQuotationsForApplication: (...a) => mockIssue(...a),
}));
const mockNotifyAdmin = jest.fn(async () => {});
jest.mock('../../services/notification/domain-helpers', () => {
    const actual = jest.requireActual('../../services/notification/domain-helpers');
    return { ...actual, notifyAdminQuotationIssueFailed: (...a) => mockNotifyAdmin(...a) };
});
const mockAuditLog = jest.fn(async () => ({}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAuditLog(...a) },
    AuditCategory: { APPLICATION: 'APPLICATION', PAYMENT: 'PAYMENT' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

const { issueQuotationOnSubmit } = require('../../services/quotation-issuance-on-submit');

const APP = { id: 'app-1', applicationNumber: 'APP-2026-000001', organizationId: 'org-1' };

beforeEach(() => jest.clearAllMocks());

test('a successful issue reports issued:true and writes no failure record', async () => {
    mockIssue.mockResolvedValue({ company: { id: 'qt-1' }, dtam: null, platform: { id: 'qt-1' } });
    const out = await issueQuotationOnSubmit({ application: APP, actorId: 'user-1' });
    expect(out).toEqual({ issued: true });
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(mockNotifyAdmin).not.toHaveBeenCalled();
});

test('it AWAITS the issue: the result is not reported before the call resolves', async () => {
    let resolved = false;
    mockIssue.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        resolved = true;
        return { company: { id: 'qt-1' } };
    });
    await issueQuotationOnSubmit({ application: APP, actorId: 'user-1' });
    expect(resolved).toBe(true);
});

test('a failure is reported, audited and pushed to the admin queue, and never rethrown', async () => {
    mockIssue.mockRejectedValue(Object.assign(new Error('receipt sequence locked'), { code: 'SEQ_LOCK' }));
    const out = await issueQuotationOnSubmit({ application: APP, actorId: 'user-1' });
    expect(out).toEqual({ issued: false, error: 'QUOTATION_ISSUE_FAILED' });
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'QUOTATION_ISSUE_FAILED',
        resourceId: 'app-1',
    }));
    expect(mockNotifyAdmin).toHaveBeenCalledWith(expect.objectContaining({
        applicationId: 'app-1', applicationNumber: 'APP-2026-000001',
    }));
});

/**
 * AuditLog.actorRole is NOT NULL (prisma/schema/audit.prisma:25) and
 * audit-logger persists whatever it is given verbatim (`actorRole ?? null`,
 * audit-logger.js:388). An omitted role therefore does not produce a row with a
 * blank role — it produces NO ROW, swallowed by this helper's own best-effort
 * catch. renewal-service.js:478-484 records that exact failure, found by a real
 * press and not by a unit test. A loud failure that leaves no audit row is not
 * loud, so the role travels with the call.
 */
test('the failure record carries a non-null actorRole, or the audit row never lands', async () => {
    mockIssue.mockRejectedValue(new Error('boom'));
    await issueQuotationOnSubmit({ application: APP, actorId: 'user-1', actorRole: 'HEALTH' });
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actorRole: 'HEALTH' }));

    mockAuditLog.mockClear();
    await issueQuotationOnSubmit({ application: APP, actorId: 'user-1' });
    const [entry] = mockAuditLog.mock.calls[0];
    expect(entry.actorRole).toEqual(expect.any(String));
    expect(entry.actorRole).not.toBe('');
});

test('a failing audit sink does not turn a submitted application into a 500', async () => {
    mockIssue.mockRejectedValue(new Error('boom'));
    mockAuditLog.mockRejectedValueOnce(new Error('audit sink down'));
    await expect(issueQuotationOnSubmit({ application: APP, actorId: 'user-1' }))
        .resolves.toEqual({ issued: false, error: 'QUOTATION_ISSUE_FAILED' });
});
