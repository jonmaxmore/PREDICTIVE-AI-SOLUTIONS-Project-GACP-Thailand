'use strict';

/**
 * Blocker I (full-system audit 2026-07-07, area I — BROKEN) + top-5 #4.
 *
 * Four confirmed defects, all farmer-/compliance-facing:
 *
 *  I-1 enum-miss class: callers reference NotifyType keys that DO NOT EXIST
 *      (undefined) → sendNotification resolves no template → the farmer gets
 *      the generic "การแจ้งเตือนใหม่" instead of the real message. Swept
 *      repo-wide: APPLICATION_EXPIRED (revision-deadline-checker.js:233 — the
 *      auto-cancel notice, farmer loses 5,535 THB unexplained),
 *      REVISION_DEADLINE_EXPIRED (:258 staff notice), CAR_REVIEWING
 *      (applications-car.js:190 sticky-return signal), CERTIFICATE_EXPIRING
 *      (jobs/scheduler.js:82), DEADLINE_REMINDER (domain-helpers.js:241),
 *      NEW_APPLICATION (application-review-revision-methods.js:421).
 *
 *  I-2 hours-labelled-days: notifyRevisionDeadlineApproaching(id, remaining)
 *      takes TWO params; routes/api/system/cron.js:195-202 passes
 *      reminderBucketHours (24/48) plus an IGNORED third arg {unit:'hours'} →
 *      the farmer reads "ใกล้ครบกำหนดแก้ไขในอีก 24 วัน" for a 24-HOUR deadline.
 *
 *  I-3 stamp-on-fail: the helper swallows its own errors (catch → log →
 *      undefined) so cron.js:204-212 stamps reminderField as sent even when
 *      nothing was delivered — the reminder is永ever retried.
 *
 *  I-4 the HTTP cron EXPIRED branch (cron.js:227-285) flips the application
 *      to EXPIRED and notifies NOBODY at all.
 *
 * RED (pre-fix): every describe below fails.
 */

const { NotifyType, NotifyTemplates } = require('../../services/notification-service');

describe('I-1 — enum-miss class: every referenced NotifyType key exists with a real Thai template', () => {
    const REQUIRED_KEYS = [
        'APPLICATION_EXPIRED',
        'REVISION_DEADLINE_EXPIRED',
        'CAR_REVIEWING',
        'CERTIFICATE_EXPIRING',
        'DEADLINE_REMINDER',
        'NEW_APPLICATION',
    ];

    test.each(REQUIRED_KEYS)('NotifyType.%s is defined (callers currently pass undefined)', (key) => {
        expect(NotifyType[key]).toBe(key);
    });

    test.each(REQUIRED_KEYS)('NotifyTemplates resolves a non-generic Thai template for %s', (key) => {
        const template = NotifyTemplates[NotifyType[key]];
        expect(typeof template).toBe('function');
        const out = template({ applicationNumber: 'GACP-2026-0001', reason: 'ทดสอบ', certificateNumber: 'CERT-1' });
        expect(out.title).toBeTruthy();
        expect(out.message).toBeTruthy();
        expect(out.title).not.toBe('การแจ้งเตือนใหม่');
        // Thai-100% invariant: the farmer-facing copy must contain Thai script.
        expect(`${out.title}${out.message}`).toMatch(/[฀-๿]/);
    });

    test('APPLICATION_EXPIRED template states the consequence (ยื่นใหม่ + ชำระใหม่)', () => {
        const out = NotifyTemplates[NotifyType.APPLICATION_EXPIRED]({
            applicationNumber: 'GACP-2026-0001',
            reason: 'ไม่ส่งงานแก้ไขภายใน 5 วันทำการ',
        });
        expect(out.message).toContain('GACP-2026-0001');
        // The farmer must be told they have to re-apply (and pay งวด 1 again).
        expect(out.message).toMatch(/ยื่น(คำขอ)?ใหม่/);
    });
});

describe('I-2/I-3 — notifyRevisionDeadlineApproaching: unit-aware copy + success signal', () => {
    let helpers;
    let mockCreateNotification;
    let mockFindUnique;

    beforeEach(() => {
        jest.resetModules();
        mockCreateNotification = jest.fn().mockResolvedValue({ id: 'notif-1' });
        mockFindUnique = jest.fn().mockResolvedValue({
            id: 'APP-1',
            applicationNumber: 'GACP-2026-0001',
            applicant: { id: 'user-1' },
        });
        jest.doMock('../../services/prisma-database', () => ({
            prisma: { application: { findUnique: (...a) => mockFindUnique(...a) }, user: { findMany: jest.fn().mockResolvedValue([]) } },
        }));
        jest.doMock('../../shared/logger', () => {
            const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            return { ...l, createLogger: jest.fn(() => l) };
        });
        jest.doMock('../../services/notification-service', () => ({
            createNotification: (...a) => mockCreateNotification(...a),
            createBulkNotifications: jest.fn(),
            NotifyType: new Proxy({}, { get: (_t, k) => String(k) }),
        }));
        helpers = require('../../services/notification/domain-helpers');
    });

    test("unit:'hours' → message says ชั่วโมง, NOT '24 วัน' (I-2)", async () => {
        await helpers.notifyRevisionDeadlineApproaching('APP-1', 24, { unit: 'hours' });
        expect(mockCreateNotification).toHaveBeenCalledTimes(1);
        const arg = mockCreateNotification.mock.calls[0][0];
        expect(arg.message).toContain('ชั่วโมง');
        expect(arg.message).not.toContain('24 วัน');
    });

    test('default (days) copy is unchanged', async () => {
        await helpers.notifyRevisionDeadlineApproaching('APP-1', 3);
        const arg = mockCreateNotification.mock.calls[0][0];
        expect(arg.message).toContain('3 วัน');
    });

    test('returns truthy on delivered, null on failure — so cron can stamp only on success (I-3)', async () => {
        const ok = await helpers.notifyRevisionDeadlineApproaching('APP-1', 24, { unit: 'hours' });
        expect(ok).toBeTruthy();

        mockCreateNotification.mockRejectedValueOnce(new Error('db down'));
        const failed = await helpers.notifyRevisionDeadlineApproaching('APP-1', 24, { unit: 'hours' });
        expect(failed).toBeFalsy();

        mockFindUnique.mockResolvedValueOnce(null);
        const noApp = await helpers.notifyRevisionDeadlineApproaching('APP-MISSING', 24, { unit: 'hours' });
        expect(noApp).toBeFalsy();
    });
});

describe('I-3/I-4 — GET /cron/auto-cancel: EXPIRED notifies the applicant; reminders stamp only on success', () => {
    let request;
    let express;
    let mockSendNotification;
    let mockNotifyApproaching;
    let mockApplicationFindMany;
    let mockApplicationUpdate;
    let mockUserFindFirst;
    let mockWriteApplicationStatus;

    const DUE_PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const DUE_IN_12H = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

    beforeEach(() => {
        jest.resetModules();
        process.env.CRON_SECRET = 'test-secret';

        express = require('express');
        request = require('supertest');

        mockSendNotification = jest.fn().mockResolvedValue({ id: 'n-1' });
        mockNotifyApproaching = jest.fn().mockResolvedValue({ id: 'n-2' });
        mockApplicationFindMany = jest.fn();
        mockApplicationUpdate = jest.fn().mockResolvedValue({});
        mockUserFindFirst = jest.fn().mockResolvedValue({ id: 'applicant-user-1' });
        mockWriteApplicationStatus = jest.fn().mockResolvedValue({});

        jest.doMock('../../shared/logger', () => {
            const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            return { ...l, createLogger: jest.fn(() => l) };
        });
        jest.doMock('../../services/prisma-database', () => ({
            prisma: {
                application: {
                    findMany: (...a) => mockApplicationFindMany(...a),
                    update: (...a) => mockApplicationUpdate(...a),
                },
                user: { findFirst: (...a) => mockUserFindFirst(...a) },
                revisionDeadline: { updateMany: jest.fn().mockResolvedValue({}) },
                $transaction: jest.fn(async (cb) => cb({
                    application: { update: (...a) => mockApplicationUpdate(...a) },
                    revisionDeadline: { updateMany: jest.fn().mockResolvedValue({}) },
                })),
            },
        }));
        jest.doMock('../../services/working-days-service', () => ({
            loadHolidaySet: jest.fn().mockResolvedValue(new Set()),
            countWorkingDays: jest.fn(() => 1),
            addWorkingDays: jest.fn((d) => d),
        }));
        jest.doMock('../../services/application-status-writer', () => ({
            writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
        }));
        jest.doMock('../../services/notification-service', () => ({
            sendNotification: (...a) => mockSendNotification(...a),
            notifyRevisionDeadlineApproaching: (...a) => mockNotifyApproaching(...a),
            NotifyType: new Proxy({}, { get: (_t, k) => String(k) }),
        }));
    });

    function buildApp() {
        const app = express();
        app.use('/cron', require('../../routes/api/system/cron'));
        return app;
    }

    test('EXPIRED branch notifies the applicant with APPLICATION_EXPIRED (I-4)', async () => {
        mockApplicationFindMany.mockResolvedValue([{
            id: 'APP-EXP',
            applicationNumber: 'GACP-2026-0009',
            status: 'REVISION_REQUESTED',
            healthId: 'tok-9',
            formData: { revisionDueAt: DUE_PAST },
            workflowHistory: [],
            revisionDeadline: null,
        }]);

        const res = await request(buildApp()).get('/cron/auto-cancel').set('x-cron-secret', 'test-secret');

        expect(res.status).toBe(200);
        expect(mockWriteApplicationStatus).toHaveBeenCalledWith(
            expect.objectContaining({ toStatus: 'EXPIRED' }),
        );
        // THE BLOCKER: the farmer must be told their application auto-expired.
        expect(mockSendNotification).toHaveBeenCalledWith(
            'applicant-user-1',
            'APPLICATION_EXPIRED',
            expect.objectContaining({ applicationNumber: 'GACP-2026-0009' }),
        );
    });

    test('reminder stamps reminderField ONLY when delivery succeeded (I-3)', async () => {
        mockApplicationFindMany.mockResolvedValue([{
            id: 'APP-REM',
            applicationNumber: 'GACP-2026-0010',
            status: 'REVISION_REQUESTED',
            healthId: 'tok-10',
            formData: { revisionDueAt: DUE_IN_12H },
            workflowHistory: [],
            revisionDeadline: null,
        }]);
        // Delivery FAILS (helper resolves falsy) → must NOT stamp.
        mockNotifyApproaching.mockResolvedValueOnce(null);

        const res = await request(buildApp()).get('/cron/auto-cancel').set('x-cron-secret', 'test-secret');

        expect(res.status).toBe(200);
        expect(mockNotifyApproaching).toHaveBeenCalled();
        // No stamp write when the reminder was not delivered → next run retries.
        expect(mockApplicationUpdate).not.toHaveBeenCalled();
    });
});
