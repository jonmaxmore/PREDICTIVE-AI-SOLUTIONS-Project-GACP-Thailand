'use strict';

/**
 * External-services cleanup T1 — jobs/sla-processor.js
 * (spec: design note 2026-08-19-external-services-cleanup-design).
 *
 * checkSlaBreaches used to do TWO things per stale application: (1) write the
 * in-app SLA_BREACH fanout via notifySlaBreach (createBulkNotifications to
 * admins), (2) fire an E1 root-services ops email
 * (emailService.sendSLABreachNotification) to every SLA_ALERT_EMAILS
 * address. Operator decision 2026-08-13 (shared/notification-view.js:16-19)
 * sanctions deleting (2) — notifySlaBreach already writes the in-app rows in
 * the same block.
 *
 * Pins:
 *   1. in-app write — notifySlaBreach(app.id, daysStuck, app.applicationNumber)
 *      survives byte-identical for a stale application.
 *   2. removal pin — no E1 sendSLABreachNotification call fires even when
 *      SLA_ALERT_EMAILS is populated. RED against the pre-cleanup code
 *      (email IS sent today when the env var is set) → GREEN after T1
 *      deletes the block + the env read.
 */

process.env.SLA_ALERT_EMAILS = 'ops@example.com,ops2@example.com';

const mockAppFindMany = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: { application: { findMany: (...a) => mockAppFindMany(...a) } },
}));

jest.mock('../../services/tenant-context', () => ({
    runWithTenantContext: (_ctx, fn) => fn(),
    withoutTenantScope: (fn) => fn(),
}));

const mockNotifySlaBreach = jest.fn().mockResolvedValue(null);
jest.mock('../../services/notification-service', () => ({
    notifySlaBreach: (...a) => mockNotifySlaBreach(...a),
}));

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const checkSlaBreaches = require('../../jobs/sla-processor');

const STALE_APP = {
    id: 'app-stale-1',
    applicationNumber: 'GACP-2569-00099',
    status: 'SUBMITTED',
    updatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    organizationId: 'org-1',
    applicant: { firstName: 'สม', lastName: 'หญิง' },
};

beforeEach(() => {
    jest.clearAllMocks();
    mockAppFindMany.mockResolvedValue([STALE_APP]);
});

describe('cleanup T1 — checkSlaBreaches in-app write survives byte-identical', () => {
    it('calls notifySlaBreach(app.id, daysStuck, app.applicationNumber) for a stale application', async () => {
        const result = await checkSlaBreaches();

        expect(mockNotifySlaBreach).toHaveBeenCalledTimes(1);
        const [appId, daysStuck, appNumber] = mockNotifySlaBreach.mock.calls[0];
        expect(appId).toBe('app-stale-1');
        expect(daysStuck).toBeGreaterThanOrEqual(7);
        expect(appNumber).toBe('GACP-2569-00099');
        expect(result.processed).toBe(1);
    });
});

describe('cleanup T1 — removal pin (E1 SLA-breach ops email deleted)', () => {
    it('has no email transport to call at all, even with SLA_ALERT_EMAILS populated (operator 2026-09-15: no email in the system)', async () => {
        expect(process.env.SLA_ALERT_EMAILS).toBeTruthy(); // sanity: the old gate WOULD have fired
        await checkSlaBreaches();
        const fs = require('fs');
        const path = require('path');
        expect(fs.existsSync(path.join(__dirname, '..', '..', 'services', 'email-service.js'))).toBe(false);
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'jobs', 'sla-processor.js'), 'utf-8');
        expect(src).not.toMatch(/email-service|sendSLABreachNotification/);
    });
});
