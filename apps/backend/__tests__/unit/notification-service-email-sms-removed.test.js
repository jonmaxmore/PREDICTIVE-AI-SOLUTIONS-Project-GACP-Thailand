'use strict';

/**
 * External-services cleanup T1 (spec: design notes
 * 2026-08-19-external-services-cleanup-design.md) — Path A off-email/SMS.
 *
 * Operator decision (2026-08-13, shared/notification-view.js:16-19): the
 * in-app inbox is the ONLY business-notification channel. Every business
 * notify site already writes the in-app row, so removing the email/SMS
 * dispatch legs from services/notification-service.js loses no in-app
 * notification. Pins both directions:
 *
 *   1. in-app write survives byte-identical for an EMAIL_MAP type (used to
 *      trigger email) and a HIGH-priority type (used to trigger SMS).
 *   2. removal pins — the source no longer requires either the E2
 *      (services/email/email-service.js) or S1 (services/sms/sms-service.js)
 *      module. RED against the pre-cleanup code (email/SMS legs still
 *      present) → GREEN after.
 *
 * External-services cleanup T3 (2026-08-19) deleted the E2 and S1 modules
 * outright (their zero remaining callers — notification-service.js already
 * dropped the require in T1). This suite no longer jest.mocks those paths
 * (a jest.mock of a nonexistent path throws without {virtual:true}); the
 * "no email/SMS call happens" guarantee now holds structurally — there is
 * nothing left to call.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../../shared/logger', () => ({
    ...mockLogger,
    createLogger: jest.fn(() => mockLogger),
}));

jest.mock('../../services/tenant-context', () => ({
    getTenantContext: () => null,
    withoutTenantScope: (fn) => fn(),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        notification: { create: jest.fn(), createMany: jest.fn() },
    },
}));

const fs = require('fs');
const path = require('path');
const { prisma } = require('../../services/prisma-database');
const notificationService = require('../../services/notification-service');

const USER_ID = 'user-1';

beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        notificationSettings: null,
        email: 'farmer@example.com',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        phoneNumber: '0812345678',
    });
    prisma.notification.create.mockImplementation(async ({ data }) => ({ id: 'notif-1', ...data }));
});

describe('cleanup T1 — in-app write survives byte-identical', () => {
    it('QUOTE_RECEIVED (an EMAIL_MAP type) still writes the in-app row with the same args', async () => {
        const result = await notificationService.sendNotification(
            USER_ID, notificationService.NotifyType.QUOTE_RECEIVED,
            { quoteNumber: 'Q-1', amount: 1000 },
        );
        expect(prisma.notification.create).toHaveBeenCalledTimes(1);
        const data = prisma.notification.create.mock.calls[0][0].data;
        expect(data).toMatchObject({
            userId: USER_ID,
            type: notificationService.NotifyType.QUOTE_RECEIVED,
            title: 'ได้รับใบเสนอราคา',
            isRead: false,
        });
        expect(result).toMatchObject({ id: 'notif-1' });
    });

    it('a HIGH-priority notification (old SMS-eligible gate) still writes the in-app row', async () => {
        await notificationService.sendNotification(
            USER_ID, notificationService.NotifyType.AUDIT_SCHEDULED,
            { scheduledDate: '2026-09-01', scheduledTime: '09:00' },
            { priority: 'HIGH' },
        );
        expect(prisma.notification.create).toHaveBeenCalledTimes(1);
        expect(prisma.notification.create.mock.calls[0][0].data).toMatchObject({
            priority: 2, // HIGH
        });
    });
});

describe('cleanup T1/T3 — removal pins (email/SMS legs + modules deleted)', () => {
    it('source no longer requires the E2 email-service or S1 sms-service modules', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'services', 'notification-service.js'),
            'utf8',
        );
        expect(src).not.toMatch(/require\(['"]\.\/email\/email-service['"]\)/);
        expect(src).not.toMatch(/require\(['"]\.\/sms\/sms-service['"]\)/);
    });

    it('the E2 email-service and S1 sms-service module files no longer exist on disk', () => {
        const e2Path = path.join(__dirname, '..', '..', 'services', 'email', 'email-service.js');
        const s1Path = path.join(__dirname, '..', '..', 'services', 'sms', 'sms-service.js');
        expect(fs.existsSync(e2Path)).toBe(false);
        expect(fs.existsSync(s1Path)).toBe(false);
    });
});
