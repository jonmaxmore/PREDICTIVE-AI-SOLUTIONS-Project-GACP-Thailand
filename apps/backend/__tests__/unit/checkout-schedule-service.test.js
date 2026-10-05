'use strict';

/**
 * Q2-D1 (W3-41) — checkout schedule service.
 *
 * Operator ground truth under test:
 *   - Invoice due date = mint + M1/M2 business-day window from
 *     config/business-rules.js (PAYMENT.INVOICE_DUE_BUSINESS_DAYS),
 *     computed with the ONE canonical Thai calendar (utils/working-days.js).
 *   - OVERDUE is DERIVED only (unpaid + past due at query time) — the service
 *     must expose a where-clause builder and contain NO database writer.
 *   - Reminder dates: PRE_DUE (config business days before due), DUE_DATE,
 *     OVERDUE_NOTICE (next working day after due); any intended day landing on
 *     a weekend / Thai public holiday shifts forward to the next working day.
 *
 * Fixture days are hand-derived from the canonical calendar in
 * utils/working-days.js (weekday table verified with Intl in Asia/Bangkok):
 *   - 2026-12-05 Sat + 2026-12-06 Sun weekend, 2026-12-10 Thu วันรัฐธรรมนูญ
 *   - 2026-12-31 Thu วันสิ้นปี, 2027-01-01 Fri วันขึ้นปีใหม่
 *   - 2026-08-12 Wed วันแม่แห่งชาติ
 * so every expected value below proves weekend AND holiday skipping, not just
 * naive day addition.
 */

const fs = require('fs');
const path = require('path');

const { getZonedParts, addWorkingDays } = require('../../utils/working-days');
const businessRules = require('../../config/business-rules');
const {
    computeDueDate,
    isInvoiceOverdue,
    overdueInvoiceWhere,
    computeReminderDates,
} = require('../../services/checkout/checkout-schedule-service');

const SERVICE_FILE = path.join(
    __dirname, '..', '..', 'services', 'checkout', 'checkout-schedule-service.js',
);

/** 10:00 Asia/Bangkok on the given calendar day. */
function ictMorning(isoDate) {
    return new Date(`${isoDate}T03:00:00.000Z`);
}

/** Asia/Bangkok calendar day of an instant. */
function dayOf(date) {
    return getZonedParts(date).isoDate;
}

describe('computeDueDate — config-driven business-day windows on the canonical calendar', () => {
    test('M1: mint Tue 2026-12-01 lands 2026-12-14 (skips the 05-06 weekend, the 12-07 substitute AND วันรัฐธรรมนูญ 12-10)', () => {
        // Naive +7 calendar days would be 2026-12-08; naive +7 weekdays would
        // be 2026-12-10 (a holiday). Only weekend+holiday skipping gives 12-14:
        // Mon 12-07 is the substitute for Father's Day on Sat 12-05 (DOMA-10).
        expect(dayOf(computeDueDate(ictMorning('2026-12-01'), 'M1'))).toBe('2026-12-14');
    });

    test('M2: mint Fri 2026-12-18 crosses year end to 2027-01-12 (skips 4 weekends + 12-31 + 01-01)', () => {
        expect(dayOf(computeDueDate(ictMorning('2026-12-18'), 'M2'))).toBe('2027-01-12');
    });

    test('delegates to the canonical addWorkingDays (same instant, end-of-business-day convention)', () => {
        const mint = ictMorning('2026-12-01');
        const expected = addWorkingDays(
            mint, businessRules.PAYMENT.INVOICE_DUE_BUSINESS_DAYS.M1,
        );
        expect(computeDueDate(mint, 'M1').getTime()).toBe(expected.getTime());
    });

    test('window lengths come from config, not literals baked into the service', () => {
        jest.isolateModules(() => {
            jest.doMock('../../config/business-rules', () => ({
                PAYMENT: {
                    INVOICE_DUE_BUSINESS_DAYS: { M1: 1, M2: 2 },
                    PAYMENT_REMINDER: { PRE_DUE_BUSINESS_DAYS: 1 },
                },
            }));
            const mocked = require('../../services/checkout/checkout-schedule-service');
            // Fri 2026-12-04 + 1 business day → Tue 2026-12-08 (05-06 weekend
            // and the Mon 12-07 substitute holiday skipped).
            expect(dayOf(mocked.computeDueDate(ictMorning('2026-12-04'), 'M1')))
                .toBe('2026-12-08');
            // 1-day PRE_DUE window: due Tue 2026-08-11 → Mon 2026-08-10 (real
            // config gives 2026-08-06 — see the reminder suite below).
            expect(dayOf(mocked.computeReminderDates(ictMorning('2026-08-11')).PRE_DUE))
                .toBe('2026-08-10');
        });
        jest.dontMock('../../config/business-rules');
        // The un-mocked module still answers with the operator window.
        expect(dayOf(computeDueDate(ictMorning('2026-12-04'), 'M1'))).toBe('2026-12-17');
    });

    test('an unknown milestone throws a coded error — never a silent default window', () => {
        for (const bad of ['M3', 'm1', undefined, null, '']) {
            let err;
            try {
                computeDueDate(ictMorning('2026-12-01'), bad);
            } catch (e) {
                err = e;
            }
            expect(err).toBeDefined();
            expect(err.code).toBe('SCHEDULE_UNKNOWN_MILESTONE');
        }
    });
});

describe('isInvoiceOverdue — DERIVED from unpaid status + dueDate, every branch', () => {
    const due = ictMorning('2026-08-11');
    const past = new Date(due.getTime() + 1);
    const before = new Date(due.getTime() - 1);

    test('unpaid (pending) and past due → true', () => {
        expect(isInvoiceOverdue({ status: 'pending', dueDate: due }, past)).toBe(true);
    });

    test('unpaid but not yet past due → false', () => {
        expect(isInvoiceOverdue({ status: 'pending', dueDate: due }, before)).toBe(false);
    });

    test('exactly at the due instant → false (strictly past-due only)', () => {
        expect(isInvoiceOverdue({ status: 'pending', dueDate: due }, new Date(due))).toBe(false);
    });

    test('paid → false no matter how late (settlement writes paid — see checkout-settlement-service)', () => {
        expect(isInvoiceOverdue({ status: 'paid', dueDate: due }, past)).toBe(false);
    });

    test('cancelled → false', () => {
        expect(isInvoiceOverdue({ status: 'cancelled', dueDate: due }, past)).toBe(false);
    });

    test('missing dueDate or missing invoice → false, never a throw', () => {
        expect(isInvoiceOverdue({ status: 'pending', dueDate: null }, past)).toBe(false);
        expect(isInvoiceOverdue(null, past)).toBe(false);
    });
});

describe('overdueInvoiceWhere — the derived-overdue query, no writer anywhere', () => {
    test('builds the pending + strictly-past-due where clause with the given instant', () => {
        const now = ictMorning('2026-08-14');
        expect(overdueInvoiceWhere(now)).toEqual({
            status: 'pending',
            dueDate: { lt: now },
        });
    });
});

describe('computeReminderDates — three intended days, shifted onto working days', () => {
    test('working-day due (Tue 2026-08-11): PRE_DUE 08-06, DUE_DATE 08-11, OVERDUE_NOTICE skips วันแม่ to 08-13', () => {
        const r = computeReminderDates(ictMorning('2026-08-11'));
        // 3 business days back: Mon 10 (1), 08-09 weekend skip, Fri 07 (2), Thu 06 (3).
        expect(dayOf(r.PRE_DUE)).toBe('2026-08-06');
        expect(dayOf(r.DUE_DATE)).toBe('2026-08-11');
        // Next working day after Tue 11: Wed 12 is วันแม่ → Thu 13.
        expect(dayOf(r.OVERDUE_NOTICE)).toBe('2026-08-13');
    });

    test('weekend due (Sat 2026-08-08): DUE_DATE shifts forward to Mon 08-10', () => {
        const r = computeReminderDates(ictMorning('2026-08-08'));
        // 3 business days back from Sat: Fri 07 (1), Thu 06 (2), Wed 05 (3).
        expect(dayOf(r.PRE_DUE)).toBe('2026-08-05');
        expect(dayOf(r.DUE_DATE)).toBe('2026-08-10');
        // Intended next-working-day after Sat 08 is also Mon 10 — each intended
        // day shifts independently per the operator rule, so they coincide.
        expect(dayOf(r.OVERDUE_NOTICE)).toBe('2026-08-10');
    });

    test('PRE_DUE walks back across a holiday: due Mon 2026-12-14 → 2026-12-08 (skips 12-13 weekend + 12-10)', () => {
        const r = computeReminderDates(ictMorning('2026-12-14'));
        expect(dayOf(r.PRE_DUE)).toBe('2026-12-08');
        expect(dayOf(r.OVERDUE_NOTICE)).toBe('2026-12-15');
    });
});

describe('source pins — the service stays config-driven, derived-only, calendar-free', () => {
    const src = fs.readFileSync(SERVICE_FILE, 'utf8');

    test('imports the config and the ONE canonical calendar', () => {
        expect(src).toMatch(/require\('\.\.\/\.\.\/config\/business-rules'\)/);
        expect(src).toMatch(/require\('\.\.\/\.\.\/utils\/working-days'\)/);
    });

    test('no bare due-window literals — the M1/M2 day counts live in config only', () => {
        expect(src).not.toMatch(/\b7\b/);
        expect(src).not.toMatch(/\b15\b/);
        expect(src).not.toMatch(/\b3\b/);
    });

    test('no stored-overdue write path: no quoted overdue literal, no prisma, no mutation call', () => {
        expect(src).not.toMatch(/['"`]overdue['"`]/);
        expect(src).not.toMatch(/prisma/i);
        expect(src).not.toMatch(/\.\s*(create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/);
    });

    test('no holiday data of its own — the calendar lives in utils/working-days.js alone', () => {
        expect(src).not.toMatch(/HOLIDAY/i);
        expect(src).not.toMatch(/['"]\d{2}-\d{2}['"]/);
        expect(src).not.toMatch(/['"]\d{4}-\d{2}-\d{2}['"]/);
    });
});
