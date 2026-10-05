'use strict';

/**
 * Checkout schedule service — due dates + reminder dates for the Stripe
 * checkout invoices (operator decision Q2-D1, W3-41).
 *
 * Three rules, enforced by the unit-test source pins:
 *   - Every window length (per-milestone due window, PRE_DUE window) comes
 *     from config/business-rules.js PAYMENT — no day-count literal lives here.
 *   - Every calendar decision (weekend / วันหยุดราชการไทย, ICT timezone)
 *     delegates to the ONE canonical calendar in utils/working-days.js —
 *     this module defines no calendar data of its own.
 *   - OVERDUE is DERIVED, never stored: an invoice is overdue when it is
 *     still unpaid and the query instant is strictly past its dueDate. This
 *     module is pure — it builds values and where-clauses only and performs
 *     no database write of any kind.
 *
 * @module services/checkout/checkout-schedule-service
 */

const { addWorkingDays, isWorkingDay } = require('../../utils/working-days');
const businessRules = require('../../config/business-rules');

/**
 * Invoice.status value while the checkout is unpaid, as minted by
 * stripe-checkout-service and settled to paid by checkout-settlement-service.
 * (A legacy stored past-due status string exists in old rows; it is neither
 * read nor written here — derivation replaces it.)
 */
const INVOICE_STATUS_PENDING = 'pending';

/** Asia/Bangkok (ICT) has no daylight saving — local days are fixed length. */
const DAY_MS = 24 * 60 * 60 * 1000;

function scheduleError(code, message) {
    return Object.assign(new Error(message), { code });
}

/** The configured due window (business days) for a milestone — never a default. */
function dueWindowDays(milestone) {
    const table = businessRules?.PAYMENT?.INVOICE_DUE_BUSINESS_DAYS;
    const days = table ? table[milestone] : undefined;
    if (!Number.isFinite(days)) {
        throw scheduleError(
            'SCHEDULE_UNKNOWN_MILESTONE',
            `No invoice due window configured for milestone: ${milestone}`,
        );
    }
    return days;
}

/**
 * Due date for an invoice minted at `mintDate` for `milestone`:
 * mint + the configured business-day window, end-of-business-day instant on
 * the canonical Thai working-day calendar.
 *
 * @param {Date|string|number} mintDate - the mint instant
 * @param {string} milestone - 'M1' | 'M2' (config keys)
 * @returns {Date}
 * @throws {Error} code SCHEDULE_UNKNOWN_MILESTONE when no window is configured
 */
function computeDueDate(mintDate, milestone) {
    return addWorkingDays(new Date(mintDate), dueWindowDays(milestone));
}

/**
 * DERIVED overdue predicate: still unpaid AND strictly past due at `now`.
 * Anything else — paid, cancelled, missing dueDate, missing invoice — is not
 * overdue. Nothing is ever written back.
 *
 * @param {{ status?: string, dueDate?: Date|string|null }|null} invoice
 * @param {Date|string|number} [now]
 * @returns {boolean}
 */
function isInvoiceOverdue(invoice, now = new Date()) {
    if (!invoice || invoice.status !== INVOICE_STATUS_PENDING || !invoice.dueDate) {
        return false;
    }
    const due = new Date(invoice.dueDate);
    if (Number.isNaN(due.getTime())) {
        return false;
    }
    return new Date(now).getTime() > due.getTime();
}

/**
 * Where-clause object for querying derived-overdue invoices (findMany/count):
 * unpaid and strictly past due at `now`. The overdue set is always computed
 * at query time — there is deliberately NO writer companion to this function.
 *
 * @param {Date|string|number} [now]
 * @returns {{ status: string, dueDate: { lt: Date } }}
 */
function overdueInvoiceWhere(now = new Date()) {
    return {
        status: INVOICE_STATUS_PENDING,
        dueDate: { lt: new Date(now) },
    };
}

/**
 * Normalize an intended reminder day: keep it when it is a working day,
 * otherwise shift FORWARD to the next working day (operator rule for days
 * landing on เสาร์/อาทิตย์/วันหยุดราชการ). Either way the canonical
 * end-of-business-day instant is returned (addWorkingDays convention).
 */
function shiftToWorkingDay(intended) {
    return isWorkingDay(intended)
        ? addWorkingDays(intended, 0)
        : addWorkingDays(intended, 1);
}

/**
 * Walk BACK `count` working days from `from`. utils/working-days has no
 * backward arithmetic, so this composes its canonical isWorkingDay over
 * fixed-length ICT days — no calendar knowledge lives here.
 */
function minusWorkingDays(from, count) {
    let cursor = new Date(from);
    let stepped = 0;
    while (stepped < count) {
        cursor = new Date(cursor.getTime() - DAY_MS);
        if (isWorkingDay(cursor)) {
            stepped += 1;
        }
    }
    return cursor;
}

/**
 * The reminder days derived from a due date (dispatching them is D2 work):
 *   PRE_DUE          the configured number of business days before due
 *   DUE_DATE         the due day itself
 *   OVERDUE_NOTICE   the next working day after due
 * Each intended day is shifted forward onto a working day independently.
 *
 * @param {Date|string|number} dueDate
 * @returns {{ PRE_DUE: Date, DUE_DATE: Date, OVERDUE_NOTICE: Date }}
 */
function computeReminderDates(dueDate) {
    const preDays = businessRules?.PAYMENT?.PAYMENT_REMINDER?.PRE_DUE_BUSINESS_DAYS;
    if (!Number.isFinite(preDays)) {
        throw scheduleError(
            'SCHEDULE_REMINDER_CONFIG_MISSING',
            'PAYMENT.PAYMENT_REMINDER.PRE_DUE_BUSINESS_DAYS is not configured',
        );
    }
    const due = new Date(dueDate);
    return {
        PRE_DUE: shiftToWorkingDay(minusWorkingDays(due, preDays)),
        DUE_DATE: shiftToWorkingDay(due),
        OVERDUE_NOTICE: addWorkingDays(due, 1),
    };
}

module.exports = {
    computeDueDate,
    isInvoiceOverdue,
    overdueInvoiceWhere,
    computeReminderDates,
};
