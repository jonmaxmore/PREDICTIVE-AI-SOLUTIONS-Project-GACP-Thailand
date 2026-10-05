'use strict';

/**
 * Q2-D2 (W3-41) — payment reminder sweep job.
 *
 * Operator ground truth under test:
 *   - Three reminder types (PRE_DUE / DUE_DATE / OVERDUE_NOTICE); the send
 *     day is the SHIFTED working day from checkout-schedule-service's
 *     computeReminderDates — the REAL schedule service runs here (not
 *     mocked), so the working-day shift is proven, not simulated.
 *   - Durable dedup on (invoiceId, reminderType, intendedDate), insert-first:
 *     the unique constraint is the last line of defense — P2002 = already
 *     sent, skip silently.
 *   - Collision rule: DUE_DATE and OVERDUE_NOTICE landing on the same
 *     working day BOTH go out (different types).
 *   - The sweep NEVER writes invoice/payment state of any kind — OVERDUE is
 *     derived-only (operator command; money-state writes are forbidden).
 *   - Scope: serviceType CERTIFICATION_CHECKOUT + status 'pending' only
 *     (legacy slip invoices are out of scope — never reminded here).
 *   - One broken invoice must not sink the sweep (log and continue).
 *
 * Fixture days are hand-derived from the canonical calendar in
 * utils/working-days.js (same fixtures as checkout-schedule-service.test.js):
 *   - due Tue 2026-08-11 → PRE_DUE 08-06, DUE_DATE 08-11, OVERDUE_NOTICE
 *     08-13 (Wed 08-12 is วันแม่แห่งชาติ — the shift case).
 *   - due Sat 2026-08-08 → DUE_DATE and OVERDUE_NOTICE both shift onto
 *     Mon 08-10 (the collision case).
 */

const fs = require('fs');
const path = require('path');

const mockInvoiceFindMany = jest.fn();
const mockInvoiceUpdate = jest.fn();
const mockInvoiceUpdateMany = jest.fn();
const mockInvoiceUpsert = jest.fn();
const mockReminderCreate = jest.fn();
const mockReminderUpdate = jest.fn();
const mockCheckoutOrderUpdate = jest.fn();
const mockPaymentTransactionUpdate = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        invoice: {
            findMany: (...a) => mockInvoiceFindMany(...a),
            update: (...a) => mockInvoiceUpdate(...a),
            updateMany: (...a) => mockInvoiceUpdateMany(...a),
            upsert: (...a) => mockInvoiceUpsert(...a),
        },
        paymentReminderLog: {
            create: (...a) => mockReminderCreate(...a),
            update: (...a) => mockReminderUpdate(...a),
        },
        checkoutOrder: { update: (...a) => mockCheckoutOrderUpdate(...a) },
        paymentTransaction: { update: (...a) => mockPaymentTransactionUpdate(...a) },
    },
}));
jest.mock('../../services/tenant-context', () => ({
    withoutTenantScope: (fn) => fn(),
    getTenantContext: () => null,
}));
const mockSendNotification = jest.fn();
jest.mock('../../services/notification-service', () => ({
    sendNotification: (...a) => mockSendNotification(...a),
    NotifyType: { PAYMENT_REMINDER: 'PAYMENT_REMINDER' },
}));
const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../../shared/logger', () => ({ ...mockLogger, createLogger: jest.fn(() => mockLogger) }));

// The REAL schedule service + calendar (operator rule: do not mock the shift).
const { getZonedParts } = require('../../utils/working-days');
const { computeReminderDates } = require('../../services/checkout/checkout-schedule-service');
const { runPaymentReminderSweep } = require('../../jobs/payment-reminder-job');

const JOB_FILE = path.join(__dirname, '..', '..', 'jobs', 'payment-reminder-job.js');

/** 10:00 Asia/Bangkok on the given calendar day. */
function ictMorning(isoDate) {
    return new Date(`${isoDate}T03:00:00.000Z`);
}

/** Asia/Bangkok calendar day of an instant. */
function dayOf(date) {
    return getZonedParts(date).isoDate;
}

function p2002() {
    const err = new Error('Unique constraint failed on (invoiceId, reminderType, intendedDate)');
    err.code = 'P2002';
    return err;
}

// Due Tue 2026-08-11 → PRE_DUE Thu 08-06, DUE_DATE Tue 08-11,
// OVERDUE_NOTICE Thu 08-13 (Wed 08-12 = วันแม่แห่งชาติ).
const DUE_TUE = ictMorning('2026-08-11');
// Due Sat 2026-08-08 → DUE_DATE + OVERDUE_NOTICE both land Mon 08-10.
const DUE_SAT = ictMorning('2026-08-08');

const INVOICE_A = {
    id: 'inv-a',
    invoiceNumber: 'INV-CO-AAAA-M1',
    dueDate: DUE_TUE,
    organizationId: 'org-1',
    applicant: { id: 'user-a' },
};
const INVOICE_B = {
    id: 'inv-b',
    invoiceNumber: 'INV-CO-BBBB-M1',
    dueDate: DUE_TUE,
    organizationId: 'org-2',
    applicant: { id: 'user-b' },
};
const INVOICE_SAT = {
    id: 'inv-sat',
    invoiceNumber: 'INV-CO-CCCC-M2',
    dueDate: DUE_SAT,
    organizationId: 'org-1',
    applicant: { id: 'user-sat' },
};

beforeEach(() => {
    jest.clearAllMocks();
    mockInvoiceFindMany.mockResolvedValue([]);
    mockReminderCreate.mockImplementation(async ({ data }) => ({
        id: `prl-${mockReminderCreate.mock.calls.length}`,
        sentAt: null,
        ...data,
    }));
    mockReminderUpdate.mockResolvedValue({});
    mockSendNotification.mockResolvedValue({ id: 'n1' });
});

// Operator command — the sweep must never touch invoice / money state.
// Enforced after EVERY test in this file, whatever the scenario did.
afterEach(() => {
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
    expect(mockInvoiceUpdateMany).not.toHaveBeenCalled();
    expect(mockInvoiceUpsert).not.toHaveBeenCalled();
    expect(mockCheckoutOrderUpdate).not.toHaveBeenCalled();
    expect(mockPaymentTransactionUpdate).not.toHaveBeenCalled();
});

describe('sweep scope — checkout invoices only, where-clause pin', () => {
    test('queries the checkout serviceType by PREFIX (legacy + milestone-dimensioned) + status pending, not soft-deleted', async () => {
        // F-CHECKOUT-M2 (2026-08-18): equality on the legacy literal would
        // silently stop matching every _M1/_M2 invoice minted after the
        // unblock — startsWith covers legacy + both milestones.
        await runPaymentReminderSweep(ictMorning('2026-08-06'));

        expect(mockInvoiceFindMany).toHaveBeenCalledTimes(1);
        expect(mockInvoiceFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                serviceType: { startsWith: 'CERTIFICATION_CHECKOUT' },
                status: 'pending',
                isDeleted: false,
            }),
        }));
    });

    test('prefix match sweeps BOTH a legacy CERTIFICATION_CHECKOUT invoice and a CERTIFICATION_CHECKOUT_M2 invoice', async () => {
        const legacyInvoice = { ...INVOICE_A, id: 'inv-legacy', serviceType: 'CERTIFICATION_CHECKOUT' };
        const m2Invoice = {
            ...INVOICE_A, id: 'inv-m2', serviceType: 'CERTIFICATION_CHECKOUT_M2', applicant: { id: 'user-m2' },
        };
        mockInvoiceFindMany.mockResolvedValue([legacyInvoice, m2Invoice]);

        const summary = await runPaymentReminderSweep(ictMorning('2026-08-06'));

        expect(summary).toMatchObject({ checked: 2, matched: 2, sent: 2, failed: 0 });
        const remindedIds = mockReminderCreate.mock.calls.map((c) => c[0].data.invoiceId).sort();
        expect(remindedIds).toEqual(['inv-legacy', 'inv-m2']);
    });
});

describe('three reminder types — send day is the SHIFTED day, ICT date-equality', () => {
    test.each([
        ['2026-08-06', 'PRE_DUE'],
        ['2026-08-11', 'DUE_DATE'],
        ['2026-08-13', 'OVERDUE_NOTICE'],
    ])('run on %s dispatches %s for the due-Tue-2026-08-11 invoice', async (runDay, type) => {
        mockInvoiceFindMany.mockResolvedValue([INVOICE_A]);

        const summary = await runPaymentReminderSweep(ictMorning(runDay));

        expect(mockReminderCreate).toHaveBeenCalledTimes(1);
        const created = mockReminderCreate.mock.calls[0][0].data;
        expect(created).toMatchObject({
            invoiceId: 'inv-a',
            reminderType: type,
            organizationId: 'org-1', // copied from the invoice (tenant pattern)
        });
        // intendedDate is EXACTLY the schedule service's shifted instant.
        expect(created.intendedDate.getTime())
            .toBe(computeReminderDates(DUE_TUE)[type].getTime());
        expect(dayOf(created.intendedDate)).toBe(runDay);

        // Notification goes to the invoice's applicant via the existing service.
        expect(mockSendNotification).toHaveBeenCalledTimes(1);
        expect(mockSendNotification).toHaveBeenCalledWith(
            'user-a',
            'PAYMENT_REMINDER',
            expect.objectContaining({
                invoiceId: 'inv-a',
                invoiceNumber: 'INV-CO-AAAA-M1',
                reminderType: type,
            }),
        );

        // sentAt stamped on the freshly inserted row.
        expect(mockReminderUpdate).toHaveBeenCalledTimes(1);
        expect(mockReminderUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: expect.any(String) },
            data: expect.objectContaining({ sentAt: expect.any(Date) }),
        }));

        expect(summary).toMatchObject({ checked: 1, matched: 1, sent: 1, deduped: 0, failed: 0 });
    });

    test('a day that is no reminder day sends nothing (Fri 2026-08-07)', async () => {
        mockInvoiceFindMany.mockResolvedValue([INVOICE_A]);

        const summary = await runPaymentReminderSweep(ictMorning('2026-08-07'));

        expect(mockReminderCreate).not.toHaveBeenCalled();
        expect(mockSendNotification).not.toHaveBeenCalled();
        expect(summary).toMatchObject({ checked: 1, matched: 0, sent: 0 });
    });
});

describe('durable dedup — insert-first, unique constraint is the last line', () => {
    test('same-day re-run: P2002 on the insert → skip silently, no second send', async () => {
        mockInvoiceFindMany.mockResolvedValue([INVOICE_A]);

        const first = await runPaymentReminderSweep(ictMorning('2026-08-11'));
        expect(first).toMatchObject({ sent: 1, deduped: 0, failed: 0 });
        expect(mockSendNotification).toHaveBeenCalledTimes(1);

        // Second run the same day: the durable unique key already holds a row.
        mockReminderCreate.mockRejectedValueOnce(p2002());
        const second = await runPaymentReminderSweep(ictMorning('2026-08-11'));

        expect(second).toMatchObject({ matched: 1, sent: 0, deduped: 1, failed: 0 });
        // Still exactly ONE send + ONE sentAt stamp across both runs.
        expect(mockSendNotification).toHaveBeenCalledTimes(1);
        expect(mockReminderUpdate).toHaveBeenCalledTimes(1);
    });
});

describe('collision — DUE_DATE and OVERDUE_NOTICE on the same working day', () => {
    test('due Sat 2026-08-08: both reminders go out on Mon 08-10, one per type', async () => {
        // Sanity-pin the fixture against the real calendar first.
        const r = computeReminderDates(DUE_SAT);
        expect(dayOf(r.DUE_DATE)).toBe('2026-08-10');
        expect(dayOf(r.OVERDUE_NOTICE)).toBe('2026-08-10');

        mockInvoiceFindMany.mockResolvedValue([INVOICE_SAT]);

        const summary = await runPaymentReminderSweep(ictMorning('2026-08-10'));

        expect(mockReminderCreate).toHaveBeenCalledTimes(2);
        const types = mockReminderCreate.mock.calls.map((c) => c[0].data.reminderType).sort();
        expect(types).toEqual(['DUE_DATE', 'OVERDUE_NOTICE']);
        expect(mockSendNotification).toHaveBeenCalledTimes(2);
        expect(summary).toMatchObject({ matched: 2, sent: 2, deduped: 0, failed: 0 });
    });
});

describe('working-day shift — real calendar, no send on the holiday', () => {
    test('intended OVERDUE_NOTICE lands on วันแม่ (Wed 2026-08-12): holiday run sends nothing, next working day does', async () => {
        mockInvoiceFindMany.mockResolvedValue([INVOICE_A]);

        // Job runs ON the holiday: the shifted intended day is 08-13, so
        // nothing matches today.
        const holidayRun = await runPaymentReminderSweep(ictMorning('2026-08-12'));
        expect(holidayRun).toMatchObject({ matched: 0, sent: 0 });
        expect(mockReminderCreate).not.toHaveBeenCalled();
        expect(mockSendNotification).not.toHaveBeenCalled();

        // Next working day: the shifted OVERDUE_NOTICE goes out.
        const workdayRun = await runPaymentReminderSweep(ictMorning('2026-08-13'));
        expect(workdayRun).toMatchObject({ matched: 1, sent: 1 });
        expect(mockReminderCreate).toHaveBeenCalledTimes(1);
        expect(mockReminderCreate.mock.calls[0][0].data.reminderType).toBe('OVERDUE_NOTICE');
    });
});

describe('fault isolation — one broken invoice never sinks the sweep', () => {
    test('non-P2002 insert failure on invoice 1 is logged; invoice 2 still gets its reminder', async () => {
        mockInvoiceFindMany.mockResolvedValue([INVOICE_A, INVOICE_B]);
        mockReminderCreate.mockRejectedValueOnce(new Error('db down'));

        const summary = await runPaymentReminderSweep(ictMorning('2026-08-11'));

        expect(summary).toMatchObject({ checked: 2, failed: 1, sent: 1 });
        expect(mockSendNotification).toHaveBeenCalledTimes(1);
        expect(mockSendNotification.mock.calls[0][0]).toBe('user-b');
        expect(mockLogger.error).toHaveBeenCalled();
    });

    test('a notification that does not persist (null) leaves sentAt unstamped and is not counted as sent', async () => {
        // Real sendNotification contract: catches internally, resolves null on
        // failure — never throws (same pin as the waiver SLA job).
        mockInvoiceFindMany.mockResolvedValue([INVOICE_A]);
        mockSendNotification.mockResolvedValueOnce(null);

        const summary = await runPaymentReminderSweep(ictMorning('2026-08-11'));

        expect(summary).toMatchObject({ matched: 1, sent: 0, failed: 0 });
        expect(mockReminderUpdate).not.toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalled();
    });
});

describe('source pins — derived-only stays derived-only', () => {
    const src = fs.readFileSync(JOB_FILE, 'utf8');

    test('no stored-overdue literal, no invoice mutation call in the job source', () => {
        expect(src).not.toMatch(/['"`]overdue['"`]/i);
        expect(src).not.toMatch(/invoice\.(update|updateMany|upsert|delete)/);
    });

    test('no calendar or reminder-window data of its own — schedule service + config own those', () => {
        expect(src).not.toMatch(/HOLIDAY/i);
        expect(src).not.toMatch(/['"]\d{2}-\d{2}['"]/);
        expect(src).toMatch(/require\('\.\.\/services\/checkout\/checkout-schedule-service'\)/);
    });

    // Mock-vs-reality guard (waiver-job idiom): the NotifyType mocked above
    // must exist in the real notification-service WITH a template.
    test('real notification-service defines PAYMENT_REMINDER + template (static)', () => {
        const notifSrc = fs.readFileSync(
            path.join(__dirname, '..', '..', 'services', 'notification-service.js'), 'utf8',
        );
        expect(notifSrc).toMatch(/PAYMENT_REMINDER: 'PAYMENT_REMINDER'/);
        expect(notifSrc).toMatch(/\[NotifyType\.PAYMENT_REMINDER\]: \(data\) =>/);
    });
});

describe('scheduler registration — daily 09:00 Asia/Bangkok, additive block', () => {
    const mockCronSchedule = jest.fn(() => ({ stop: jest.fn() }));
    const mockSweep = jest.fn(async () => ({ checked: 0, matched: 0, sent: 0, deduped: 0, failed: 0 }));

    function loadScheduler() {
        jest.resetModules();
        jest.doMock('node-cron', () => ({ schedule: (...args) => mockCronSchedule(...args) }));
        jest.doMock('../../shared/logger', () => ({ ...mockLogger, createLogger: jest.fn(() => mockLogger) }));
        jest.doMock('../../jobs/revision-deadline-checker', () => ({
            checkExpiredDeadlines: jest.fn(async () => ({})),
        }));
        jest.doMock('../../jobs/work-activity-sla-monitor', () => ({
            checkOverdueActivities: jest.fn(async () => ({})),
        }));
        jest.doMock('../../cron/renewal-reminder-cron', () => ({
            run: jest.fn(async () => ({})),
        }));
        // The scheduler block lazy-requires the job (light-mocks idiom) —
        // intercept it so the callback probe below observes the call.
        jest.doMock('../../jobs/payment-reminder-job', () => ({
            runPaymentReminderSweep: (...args) => mockSweep(...args),
        }));
        return require(path.resolve(__dirname, '../../jobs/scheduler.js'));
    }

    beforeEach(() => {
        mockCronSchedule.mockClear();
        mockSweep.mockClear();
    });

    test('registers the payment-reminder block: 11 blocks total, last 0 9 * * * Asia/Bangkok drives the sweep', async () => {
        const scheduler = loadScheduler();
        scheduler.start();

        // 9 pre-existing blocks + the W3-41 payment-reminder block + the R2 M5
        // payment-closure block (daily 03:00 BKK — not a 09:00 morning call) +
        // the Task 5 settlement-reconcile block (every 10 min — not a 09:00
        // morning call either) + the G1 item 4 DTAM remittance batch (monthly,
        // 1st 02:00 BKK — not a morning call either). Was 13, then 12 when M3
        // (operator 2026-08-23, "ไม่มีค่าสมาชิก") deleted the subscription
        // auto-renewal block, and 13 again since the remittance batch landed.
        // 12 since the Slip SLA Monitor cron was removed with the slip subsystem (2026-09-06).
        // 11 ตั้งแต่ 2026-09-11 — งาน Subscription Expiry ถูกลบพร้อมพื้นผิวแพ็กเกจสมาชิก
        // ทั้งชุด (operator: แพลตฟอร์มไม่มีบริการนี้) ตาราง subscriptions ถูก drop ใน
        // 20260911140000_retire_subscriptions_and_slips จึงไม่มีแถวให้หมดอายุอีก
        // 11 since 2026-09-29: +1 stale PENDING pre-check sweep (every 5 min), −1 DTAM remittance
        // monthly batch (removed; operator 2026-09-11 "ถอดออกทั้งระบบ").
        expect(mockCronSchedule).toHaveBeenCalledTimes(11);

        const morningCalls = mockCronSchedule.mock.calls.filter((call) => {
            const opts = call[2];
            return call[0] === '0 9 * * *' && opts && opts.timezone === 'Asia/Bangkok';
        });
        // Renewal reminder + payment reminder. Subscription auto-renewal was
        // the third until M3 deleted it.
        expect(morningCalls.length).toBe(2);

        // The payment-reminder block is registered LAST (appended, additive).
        const callback = morningCalls[morningCalls.length - 1][1];
        await callback();
        expect(mockSweep).toHaveBeenCalledTimes(1);

        scheduler.stop();
    });

    test('sweep failure is swallowed and logged — the cron never throws', async () => {
        mockSweep.mockRejectedValueOnce(new Error('boom'));
        const scheduler = loadScheduler();
        scheduler.start();

        const morningCalls = mockCronSchedule.mock.calls.filter((call) => {
            const opts = call[2];
            return call[0] === '0 9 * * *' && opts && opts.timezone === 'Asia/Bangkok';
        });
        const callback = morningCalls[morningCalls.length - 1][1];

        await expect(callback()).resolves.toBeUndefined();
        expect(mockLogger.error).toHaveBeenCalledWith(
            '[Cron] Payment Reminder Sweep failed:', expect.any(Error),
        );

        scheduler.stop();
    });
});
