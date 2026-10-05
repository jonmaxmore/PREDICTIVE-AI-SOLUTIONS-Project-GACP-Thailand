/**
 * scheduler-renewal-job unit tests — Iter R2 (R2-C).
 *
 * Verifies that `jobs/scheduler.js` registers the renewal-reminder cron
 * with the correct shape:
 *   - cron string `'0 9 * * *'` with `{ timezone: 'Asia/Bangkok' }`
 *   - callback awaits `renewalReminderCron.run()`
 *   - success path logs the summary via `logger.info`
 *   - failure path is swallowed and logged via `logger.error`
 *
 * Pattern note: `node-cron` is mocked so we capture the registration
 * arguments without actually scheduling anything (and without firing the
 * boot-time `start()` against a real cron daemon).
 */

'use strict';

const path = require('path');

const mockCronSchedule = jest.fn(() => ({ stop: jest.fn() }));
const mockRenewalRun = jest.fn(async () => ({ ranAt: '2026-05-17T02:00:00.000Z', totals: { found: 0, sent: 0, skipped: 0, failed: 0 } }));
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

jest.mock('node-cron', () => ({
    schedule: (...args) => mockCronSchedule(...args),
}));
jest.mock('../../shared/logger', () => mockLogger);
jest.mock('../../jobs/revision-deadline-checker', () => ({
    checkExpiredDeadlines: jest.fn(async () => ({})),
}));
jest.mock('../../jobs/work-activity-sla-monitor', () => ({
    checkOverdueActivities: jest.fn(async () => ({})),
}));
jest.mock('../../cron/renewal-reminder-cron', () => ({
    run: (...args) => mockRenewalRun(...args),
}));

const schedulerPath = path.resolve(__dirname, '../../jobs/scheduler.js');

function loadScheduler() {
    jest.resetModules();
    jest.doMock('node-cron', () => ({
        schedule: (...args) => mockCronSchedule(...args),
    }));
    jest.doMock('../../shared/logger', () => mockLogger);
    jest.doMock('../../jobs/revision-deadline-checker', () => ({
        checkExpiredDeadlines: jest.fn(async () => ({})),
    }));
    jest.doMock('../../jobs/work-activity-sla-monitor', () => ({
        checkOverdueActivities: jest.fn(async () => ({})),
    }));
    jest.doMock('../../cron/renewal-reminder-cron', () => ({
        run: (...args) => mockRenewalRun(...args),
    }));
    return require(schedulerPath);
}

describe('scheduler — renewal-reminder cron registration (R2-C)', () => {
    beforeEach(() => {
        mockCronSchedule.mockClear();
        mockRenewalRun.mockClear();
        mockLogger.info.mockClear();
        mockLogger.warn.mockClear();
        mockLogger.error.mockClear();
        mockLogger.debug.mockClear();
    });

    test('registers exactly one renewal-reminder block with 0 9 * * * Asia/Bangkok', () => {
        const scheduler = loadScheduler();
        scheduler.start();

        // 12 cron entries total. Was 13 until M3 (operator 2026-08-23,
        // "ไม่มีค่าสมาชิก") deleted block 7, the subscription auto-renewal
        // cron that re-billed a membership fee. The rest: 5 remaining
        // pre-existing blocks + the renewal-reminder block + the B-JOB-10 PDPA
        // retention sweep + the audit gap #14 hash-chain integrity verify
        // (daily 03:15 BKK) + the waiver decision-SLA escalation (daily 09:30
        // BKK) + the W3-41 payment-reminder sweep (daily 09:00 BKK) + the R2 M5
        // payment-closure sweep (daily 03:00 BKK) + the Task 5
        // settlement-reconcile (every 10 min) + the G1 item 4 DTAM remittance
        // batch (monthly, 1st 02:00 BKK).
        // 2026-09-06: the Slip SLA Monitor cron was removed with the slip subsystem
        // (Stripe-only), so the count drops by one.
        // 11 ตั้งแต่ 2026-09-11 — งาน Subscription Expiry ถูกลบพร้อมพื้นผิวแพ็กเกจสมาชิก
        // 11 since 2026-09-29: +1 stale PENDING pre-check sweep (every 5 min), −1 DTAM remittance
        // monthly batch (removed; operator 2026-09-11 "ถอดออกทั้งระบบ").
        expect(mockCronSchedule).toHaveBeenCalledTimes(11);

        const renewalCalls = mockCronSchedule.mock.calls.filter((call) => {
            const opts = call[2];
            return call[0] === '0 9 * * *' && opts && opts.timezone === 'Asia/Bangkok';
        });
        // Two daily 09:00 Asia/Bangkok blocks exist — the renewal reminder
        // (block 8) and the W3-41 payment-reminder sweep (block 13). The third,
        // subscription auto-renewal, went with M3.
        expect(renewalCalls.length).toBeGreaterThanOrEqual(2);

        scheduler.stop();
    });

    test('callback awaits renewalReminderCron.run() and logs the summary', async () => {
        const scheduler = loadScheduler();
        scheduler.start();

        // Identify the cron callback that triggers renewalReminderCron.run().
        // It is the FIRST 09:00 Asia/Bangkok block (block 8) since M3 deleted
        // block 7 (subscription auto-renewal); block 13 (W3-41 payment-reminder
        // sweep) registers after it.
        const dailyMorningCallbacks = mockCronSchedule.mock.calls.filter((call) => {
            const opts = call[2];
            return call[0] === '0 9 * * *' && opts && opts.timezone === 'Asia/Bangkok';
        });
        expect(dailyMorningCallbacks.length).toBe(2);

        // Block 8 is the FIRST registered 0 9 * * * call (registration order:
        // block 8 → block 13).
        const renewalCallback = dailyMorningCallbacks[0][1];
        await renewalCallback();

        expect(mockRenewalRun).toHaveBeenCalledTimes(1);
        const summaryInfo = mockLogger.info.mock.calls.find(
            ([msg]) => msg === '[Cron] Renewal Reminder result:',
        );
        expect(summaryInfo).toBeDefined();

        scheduler.stop();
    });

    test('failure path is swallowed and routed through logger.error', async () => {
        const boom = new Error('boom');
        mockRenewalRun.mockRejectedValueOnce(boom);

        const scheduler = loadScheduler();
        scheduler.start();

        const dailyMorningCallbacks = mockCronSchedule.mock.calls.filter((call) => {
            const opts = call[2];
            return call[0] === '0 9 * * *' && opts && opts.timezone === 'Asia/Bangkok';
        });
        // First 0 9 * * * registration = the renewal-reminder block (see above).
        const renewalCallback = dailyMorningCallbacks[0][1];

        await expect(renewalCallback()).resolves.toBeUndefined();

        const errorCall = mockLogger.error.mock.calls.find(
            ([msg]) => msg === '[Cron] Renewal Reminder failed:',
        );
        expect(errorCall).toBeDefined();
        expect(errorCall[1]).toBe(boom);

        scheduler.stop();
    });
});
