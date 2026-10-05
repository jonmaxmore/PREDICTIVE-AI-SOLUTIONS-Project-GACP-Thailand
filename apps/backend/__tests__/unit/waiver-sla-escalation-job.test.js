'use strict';

/**
 * Waiver decision-SLA escalation (stress-test mandate, owner directive
 * 2026-07-08): "leniency needs a decision SLA + appeal channel or the safety
 * valve is theoretical". A PENDING waiver-reopen request older than 5 WORKING
 * days (same Thai-holiday-aware engine as the farmer's deadline — symmetry)
 * escalates daily: the DTAM-side accountants get pinged again AND the
 * requesting inspector gets visibility that the case is stuck.
 */

const mockReqFindMany = jest.fn();
const mockUserFindMany = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        waiverReopenRequest: { findMany: (...a) => mockReqFindMany(...a) },
        user: { findMany: (...a) => mockUserFindMany(...a) },
    },
}));
jest.mock('../../services/tenant-context', () => ({
    withoutTenantScope: (fn) => fn(),
    getTenantContext: () => null,
}));
const mockSendNotification = jest.fn();
jest.mock('../../services/notification-service', () => ({
    sendNotification: (...a) => mockSendNotification(...a),
    NotifyType: { WAIVER_REOPEN_SLA_OVERDUE: 'WAIVER_REOPEN_SLA_OVERDUE' },
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { runWaiverSlaEscalation } = require('../../jobs/waiver-sla-escalation-job');

// March 2026: the only Thai holiday is 2026-03-03 (มาฆบูชา) — dates from the
// 16th onward are clean working weeks.
// STALE: created Mon 2026-03-16 → 5th working day ends Mon 2026-03-23
//        23:59:59.999 ICT (= 2026-03-23T16:59:59.999Z) < now.
// FRESH: created Fri 2026-03-20 → 5th working day ends Fri 2026-03-27 > now.
const NOW = new Date('2026-03-24T05:00:00Z'); // Tue 12:00 ICT

const STALE_REQ = {
    id: 'REQ-STALE',
    status: 'PENDING',
    createdAt: new Date('2026-03-16T03:00:00Z'),
    organizationId: 'org-1',
    requestedBy: 'rev-1',
    reasonCode: 'LENIENCY',
    application: { applicationNumber: 'GACP-STALE' },
};
const FRESH_REQ = {
    id: 'REQ-FRESH',
    status: 'PENDING',
    createdAt: new Date('2026-03-20T03:00:00Z'),
    organizationId: 'org-1',
    requestedBy: 'rev-2',
    reasonCode: 'LENIENCY',
    application: { applicationNumber: 'GACP-FRESH' },
};

beforeEach(() => {
    jest.clearAllMocks();
    mockSendNotification.mockResolvedValue({});
    mockUserFindMany.mockResolvedValue([{ id: 'acct-1' }, { id: 'acct-2' }]);
});

describe('waiver SLA escalation job', () => {
    test('escalates PENDING requests past 5 working days to the waiver approvers (both finance roles) + the requester', async () => {
        mockReqFindMany.mockResolvedValue([STALE_REQ, FRESH_REQ]);

        const summary = await runWaiverSlaEscalation({ now: NOW });

        expect(summary).toMatchObject({ checked: 2, stale: 1 });
        // Accountant lookup is org-scoped and ACTIVE. Migration 20260801000000
        // ran in production (zero legacy rows remain), so the role filter
        // matches the two canonical account-family values alone — the legacy
        // spellings it carried across the migration window can only ever match
        // nothing now.
        expect(mockUserFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                organizationId: 'org-1',
                status: 'ACTIVE',
                isDeleted: false,
            }),
        }));
        const roleFilter = mockUserFindMany.mock.calls[0][0].where.role.in;
        // operator 2026-09-27 (B) "การเงินได้ทั้งสองฝั่ง" — was ['finance_officer_dtam'] only
        expect([...roleFilter].sort()).toEqual(['finance_officer_dtam', 'finance_officer_platform']);
        // 2 accountants + the requesting inspector = 3 notifications, stale req only.
        expect(mockSendNotification).toHaveBeenCalledTimes(3);
        const recipients = mockSendNotification.mock.calls.map((c) => c[0]).sort();
        expect(recipients).toEqual(['acct-1', 'acct-2', 'rev-1']);
        for (const call of mockSendNotification.mock.calls) {
            expect(call[1]).toBe('WAIVER_REOPEN_SLA_OVERDUE');
            expect(call[2]).toMatchObject({ applicationNumber: 'GACP-STALE', requestId: 'REQ-STALE' });
        }
    });

    test('nothing stale → no notifications', async () => {
        mockReqFindMany.mockResolvedValue([FRESH_REQ]);

        const summary = await runWaiverSlaEscalation({ now: NOW });

        expect(summary).toMatchObject({ checked: 1, stale: 0, notified: 0 });
        expect(mockSendNotification).not.toHaveBeenCalled();
    });

    test('a notification failure is non-fatal and NOT counted — sendNotification returns null on failure (real contract, never throws)', async () => {
        // Mock-vs-reality guard (bug-hunt 7.2 class): the real
        // notification-service sendNotification catches internally and
        // RESOLVES NULL on failure — it never rejects. summary.notified must
        // count persisted notifications, not attempts.
        mockReqFindMany.mockResolvedValue([STALE_REQ]);
        mockSendNotification
            .mockResolvedValueOnce(null)
            .mockResolvedValue({ id: 'n1' });

        await expect(runWaiverSlaEscalation({ now: NOW }))
            .resolves.toMatchObject({ stale: 1, notified: 2 });
        expect(mockSendNotification).toHaveBeenCalledTimes(3);
    });

    // Mock-vs-reality guard (bug-hunt 7.2 class): the mocked NotifyType key
    // above must actually exist in the real notification-service, with a
    // template — otherwise the job would persist a type no template renders.
    test('real notification-service defines the WAIVER_REOPEN_SLA_OVERDUE type + template (static)', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'services', 'notification-service.js'), 'utf8',
        );
        expect(src).toMatch(/WAIVER_REOPEN_SLA_OVERDUE: 'WAIVER_REOPEN_SLA_OVERDUE'/);
        expect(src).toMatch(/\[NotifyType\.WAIVER_REOPEN_SLA_OVERDUE\]: \(data\) =>/);
    });
});
