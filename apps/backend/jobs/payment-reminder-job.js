'use strict';

/**
 * Payment reminder sweep — W3-41 Q2-D2 (operator decisions, ground truth):
 *
 *   - Three reminder types per checkout invoice — PRE_DUE / DUE_DATE /
 *     OVERDUE_NOTICE. The send day is the working-day-SHIFTED intended day
 *     from checkout-schedule-service.computeReminderDates; this job holds no
 *     calendar or window knowledge of its own.
 *   - Durable dedup, insert-first: a PaymentReminderLog row is inserted
 *     BEFORE dispatching; the unique (invoiceId, reminderType, intendedDate)
 *     constraint is the last line of defense — P2002 means this reminder
 *     already went out on that intended day → skip silently. A same-day
 *     re-run therefore sends at most once per (invoice, type).
 *   - Collision rule: when DUE_DATE and OVERDUE_NOTICE shift onto the same
 *     working day, BOTH go out — reminderType is part of the dedup key.
 *   - NEVER writes invoice / payment state of any kind. OVERDUE is
 *     derived-only (operator command) — this job's only writes are its own
 *     PaymentReminderLog rows and the notification the service persists.
 *   - Scope: serviceType CERTIFICATION_CHECKOUT + status 'pending' only —
 *     the Wave-2 checkout mint (stripe-checkout-service). Legacy slip-flow
 *     invoices are out of scope and are never reminded here.
 *   - Fault isolation: an error on one invoice is logged and counted; the
 *     sweep continues with the rest.
 *
 * Registered in jobs/scheduler.js — daily '0 9 * * *' Asia/Bangkok.
 *
 * @module jobs/payment-reminder-job
 */

const { prisma } = require('../services/prisma-database');
const { withoutTenantScope } = require('../services/tenant-context');
const { sendNotification, NotifyType } = require('../services/notification-service');
const { computeReminderDates } = require('../services/checkout/checkout-schedule-service');
const { getZonedParts } = require('../utils/working-days');
const { createLogger } = require('../shared/logger');

const logger = createLogger('payment-reminder');

/**
 * Invoice.serviceType minted by stripe-checkout-service for the checkout
 * family this sweep may touch — legacy exact 'CERTIFICATION_CHECKOUT' plus
 * the milestone-dimensioned '_M1'/'_M2' (F-CHECKOUT-M2, 2026-08-18); matched
 * by PREFIX below, not equality, so a milestone-dimensioned invoice keeps
 * getting reminders. Same in-module documented-constant idiom as
 * checkout-schedule-service's INVOICE_STATUS_PENDING — no shared constant
 * exists for this value yet (mint + settlement carry the same prefix).
 */
const CHECKOUT_SERVICE_TYPE_PREFIX = 'CERTIFICATION_CHECKOUT';

/** Invoice.status while the checkout is unpaid (settlement writes 'paid'). */
const INVOICE_STATUS_PENDING = 'pending';

/**
 * One reminder candidate for one invoice: insert-first, then dispatch, then
 * stamp sentAt. Returns 'sent' | 'deduped' | 'unconfirmed'.
 */
async function dispatchReminder(invoice, reminderType, intendedDate) {
    let row;
    try {
        row = await prisma.paymentReminderLog.create({
            data: {
                invoiceId: invoice.id,
                reminderType,
                intendedDate,
                // Copy-from-parent tenancy (same pattern as the settlement
                // writes): the reminder belongs to the invoice's tenant.
                organizationId: invoice.organizationId,
            },
        });
    } catch (err) {
        if (err && err.code === 'P2002') {
            // Already inserted for this intended day (earlier run today, or a
            // concurrent sweep) — the durable dedup says skip silently.
            return 'deduped';
        }
        throw err;
    }

    // sendNotification never throws — it catches internally and resolves null
    // when nothing persisted (real contract, pinned in the unit test). Only a
    // persisted dispatch earns the sentAt stamp; an unconfirmed one stays
    // NULL on the row (visible to ops) and is NOT retried — dedup already
    // holds the key, by design.
    const dispatched = await sendNotification(invoice.applicant.id, NotifyType.PAYMENT_REMINDER, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        reminderType,
        dueDate: new Date(invoice.dueDate).toISOString(),
        intendedDate: new Date(intendedDate).toISOString(),
    });
    if (!dispatched) {
        logger.warn(`[payment-reminder] ${reminderType} for invoice ${invoice.id} was not persisted (sentAt left NULL)`);
        return 'unconfirmed';
    }

    await prisma.paymentReminderLog.update({
        where: { id: row.id },
        data: { sentAt: new Date() },
    });
    return 'sent';
}

/**
 * Daily sweep: for every pending checkout invoice, compute the three shifted
 * reminder days from its dueDate and dispatch whichever falls on "today" in
 * Asia/Bangkok (ICT calendar-date equality).
 *
 * @param {Date} [now] — clock injection (tests); defaults to the real clock.
 * @returns {Promise<{ checked: number, matched: number, sent: number, deduped: number, failed: number }>}
 */
async function runPaymentReminderSweep(now = new Date()) {
    const today = getZonedParts(now).isoDate;

    // Cross-tenant scan: cron has no tenant scope (same idiom as the other
    // sweeps). Rows are written with the invoice's own organizationId.
    const invoices = await withoutTenantScope(() => prisma.invoice.findMany({
        where: {
            serviceType: { startsWith: CHECKOUT_SERVICE_TYPE_PREFIX },
            status: INVOICE_STATUS_PENDING,
            isDeleted: false,
        },
        select: {
            id: true,
            invoiceNumber: true,
            dueDate: true,
            organizationId: true,
            applicant: { select: { id: true } },
        },
    }));

    const summary = { checked: invoices.length, matched: 0, sent: 0, deduped: 0, failed: 0 };

    for (const invoice of invoices) {
        try {
            if (!invoice.dueDate || Number.isNaN(new Date(invoice.dueDate).getTime())) {
                logger.warn(`[payment-reminder] invoice ${invoice.id} has no usable dueDate; skipping`);
                continue;
            }
            if (!invoice.applicant?.id) {
                logger.warn(`[payment-reminder] invoice ${invoice.id} has no applicant to notify; skipping`);
                continue;
            }

            const reminderDates = computeReminderDates(invoice.dueDate);
            for (const [reminderType, intendedDate] of Object.entries(reminderDates)) {
                if (getZonedParts(intendedDate).isoDate !== today) { continue; }
                summary.matched += 1;

                const outcome = await dispatchReminder(invoice, reminderType, intendedDate);
                if (outcome === 'sent') { summary.sent += 1; }
                if (outcome === 'deduped') { summary.deduped += 1; }
            }
        } catch (err) {
            // One broken invoice must never sink the sweep — log and go on.
            summary.failed += 1;
            logger.error(`[payment-reminder] invoice ${invoice.id} failed (sweep continues): ${err?.message}`);
        }
    }

    return summary;
}

module.exports = { runPaymentReminderSweep };
