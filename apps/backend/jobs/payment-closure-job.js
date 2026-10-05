'use strict';

/**
 * Payment-closure sweep — R2 mechanism-1 M5 (operator decision,
 * evidence/R2-special-reopen/decisions-final.md:65).
 *
 * Money-STATE-adjacent, NOT money-mutating: this job CLOSES an application
 * whose checkout payment was ABANDONED. It marks the application terminal
 * (closedReason=PAYMENT_ABANDONED) + writes ONE canonical audit row + notifies
 * the applicant. It NEVER touches invoice amounts, invoice status, or any
 * payment transaction — no money is moved, refunded, or re-priced.
 *
 * Close condition — ALL must hold (operator ground truth):
 *   1. The application has a PENDING checkout invoice whose dueDate is MORE
 *      than PAYMENT_ABANDONMENT_CLOSE_CALENDAR_DAYS calendar days in the past
 *      (config/business-rules.js — REVERSIBLE, no hardcode here), AND
 *   2. That invoice has all THREE reminder types already logged in
 *      PaymentReminderLog (PRE_DUE / DUE_DATE / OVERDUE_NOTICE) — i.e. the
 *      applicant was fully reminded before the case is closed, AND
 *   3. Stripe does NOT report the invoice's checkout order PaymentIntent as
 *      'succeeded' — a captured payment always outranks a stale local
 *      PENDING invoice (a settle that failed or stalled after Task 3-5 made
 *      settlement retryable). Checked gateway-side, fail-SAFE on error.
 * AND the application must still be sitting at a payment gate
 * (PENDING_DOC_FEE / PENDING_AUDIT_FEE) — never already terminal. That gate
 * check is also the idempotency guard: a second sweep over an already-closed
 * (EXPIRED) case is a no-op.
 *
 * The close is routed through the canonical machinery exactly like the M4
 * revision-deadline cron (jobs/revision-deadline-checker.js): cross-tenant
 * scan (withoutTenantScope) → re-enter each row's tenant (runWithTenantContext)
 * → buildTransitionUpdate builds the guarded EXPIRED payload → writeApplicationStatus
 * performs the write + emits the single hash-chained audit row via onAudit.
 *
 * NOT reopen-eligible: the reopen mechanism (R2 mechanism 2) is unbuilt, so a
 * PAYMENT_ABANDONED close is final. This is a code note only.
 *
 * Registered in jobs/scheduler.js — daily '0 3 * * *' Asia/Bangkok.
 *
 * @module jobs/payment-closure-job
 */

const { prisma } = require('../services/prisma-database');
const { getPaymentAdapter } = require('../services/payment/payment-adapter');
const { sendNotification, NotifyType } = require('../services/notification-service');
const { runWithTenantContext, withoutTenantScope } = require('../services/tenant-context');
const { createLogger } = require('../shared/logger');
const { APPLICATION_STATUSES } = require('../shared/workflow-state-machine');
const { writeApplicationStatus } = require('../services/application-status-writer');
const { buildTransitionUpdate } = require('../services/workflow-transition-service');
const { auditLogger, AuditCategory, ResourceType } = require('../middleware/audit-logger');
const { PAYMENT } = require('../config/business-rules');

const logger = createLogger('payment-closure');

/**
 * Invoice.serviceType minted by stripe-checkout-service — legacy exact
 * 'CERTIFICATION_CHECKOUT' plus the milestone-dimensioned '_M1'/'_M2'
 * (F-CHECKOUT-M2, 2026-08-18); matched by PREFIX below, not equality. The
 * ONLY invoice family that carries payment reminders, so the ONLY family
 * whose abandonment this sweep may close. Same documented in-module constant
 * idiom as payment-reminder-job.js.
 */
const CHECKOUT_SERVICE_TYPE_PREFIX = 'CERTIFICATION_CHECKOUT';

/** Invoice.status while the checkout is unpaid (settlement writes 'paid'). */
const INVOICE_STATUS_PENDING = 'pending';

/**
 * The three reminder types (checkout-schedule-service vocabulary / the
 * PaymentReminderLog CHECK constraint). ALL three must be logged for an invoice
 * before its application may be closed — proof the applicant was fully warned.
 */
const REQUIRED_REMINDER_TYPES = ['PRE_DUE', 'DUE_DATE', 'OVERDUE_NOTICE'];

/**
 * The pre-payment gates a case may be closed FROM. An application anywhere else
 * (transient states, or already terminal) is left untouched — this is both the
 * money-safety guard (only genuinely-at-a-payment-gate cases are abandoned) and
 * the idempotency guard (an EXPIRED case is not in this set, so a re-run skips it).
 */
const CLOSEABLE_PRE_PAYMENT_STATES = new Set([
    APPLICATION_STATUSES.PENDING_DOC_FEE,
    APPLICATION_STATUSES.PENDING_AUDIT_FEE,
]);

/** The only terminal close-reason this cron may stamp (frozen M4 vocab). */
const M5_CLOSED_REASON = 'PAYMENT_ABANDONED';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Are all three reminder types logged for this invoice? Cross-tenant read (the
 * cron holds no tenant scope); the invoiceId is exact so the read is tight.
 */
async function allRemindersSent(invoiceId) {
    const logs = await withoutTenantScope(() => prisma.paymentReminderLog.findMany({
        where: { invoiceId },
        select: { reminderType: true },
    }));
    const types = new Set(logs.map((l) => l.reminderType));
    return REQUIRED_REMINDER_TYPES.every((t) => types.has(t));
}

/**
 * Money-safety guard #3 (gateway truth). Task 3-5 made settlement retryable,
 * which means a settle that failed or stalled leaves the LOCAL invoice
 * reading PENDING even though Stripe already captured the payment. Stripe —
 * not the local row — is the source of truth for whether money moved, so
 * this is checked gateway-side immediately before every close. Cross-tenant
 * read (same idiom as allRemindersSent above): the cron holds no tenant
 * scope at this point in the loop, and CheckoutOrder is a tenant-scoped
 * model (tenant-prisma-extension.js), so an ambient tenant context — should
 * one ever wrap this sweep in the future — must not narrow this lookup.
 *
 * Fail-SAFE: if the gateway call throws (Stripe unreachable / rate limited),
 * this returns true (treat as paid, do NOT close) — a late close next run is
 * recoverable, a false close of a paying customer's application is not (the
 * reopen mechanism is unbuilt — see the module note above).
 *
 * @param {string} invoiceId
 * @returns {Promise<boolean>} true iff the close must be skipped this run.
 */
async function isInvoicePaidAtGateway(invoiceId) {
    const order = await withoutTenantScope(() => prisma.checkoutOrder.findFirst({
        where: { invoiceId },
        select: { stripePaymentIntentId: true },
    }));
    if (!order || !order.stripePaymentIntentId) {
        // No checkout order on file for this invoice, or no PI was ever
        // created — nothing for the gateway to have captured.
        return false;
    }
    try {
        const pi = await getPaymentAdapter().getPaymentIntent(order.stripePaymentIntentId);
        return Boolean(pi && pi.status === 'succeeded');
    } catch (e) {
        logger.warn(
            `[payment-closure] gateway check failed for invoice ${invoiceId} ` +
            `(PI ${order.stripePaymentIntentId}); skipping close this run ` +
            `(fail-safe, not an error): ${e?.message}`,
        );
        return true;
    }
}

/**
 * Resolve the applicant User.id for an application's healthId. Application.healthId
 * points at User.canonicalId (detokenize STAGE 0, data-state-agnostic — same idiom
 * as the M4 job). User is not tenant-scoped, so the lookup escapes tenant scope.
 */
async function resolveApplicantUserId(healthId) {
    if (!healthId) { return null; }
    const user = await withoutTenantScope(() => prisma.user.findFirst({
        where: { canonicalId: healthId, isDeleted: false },
        select: { id: true },
    }));
    return user?.id || null;
}

/**
 * Daily sweep: close every abandoned checkout case (BOTH conditions above).
 *
 * @param {Date} [now] — clock injection (tests); defaults to the real clock.
 * @returns {Promise<{ scanned: number, closed: number, skipped: number, errors: number }>}
 */
async function runPaymentClosureSweep(now = new Date()) {
    const thresholdDays = PAYMENT?.PAYMENT_ABANDONMENT_CLOSE_CALENDAR_DAYS;
    if (!Number.isFinite(thresholdDays)) {
        // Fail loud rather than close on a missing config (never guess a threshold).
        throw new Error(
            '[payment-closure] PAYMENT.PAYMENT_ABANDONMENT_CLOSE_CALENDAR_DAYS is not configured',
        );
    }
    // "MORE than N calendar days past due" → dueDate strictly before (now - N days).
    const cutoff = new Date(now.getTime() - thresholdDays * DAY_MS);

    // Cross-tenant scan: the cron has no tenant scope (same idiom as the other
    // sweeps). Per-case writes re-enter the case's tenant below.
    const invoices = await withoutTenantScope(() => prisma.invoice.findMany({
        where: {
            serviceType: { startsWith: CHECKOUT_SERVICE_TYPE_PREFIX },
            status: INVOICE_STATUS_PENDING,
            isDeleted: false,
            dueDate: { lt: cutoff },
            applicationId: { not: null },
            // Only fetch cases whose application still sits at a closeable
            // pre-payment gate. An already-closed (EXPIRED) or paid-through
            // (DOC_FEE_PAID/...) case is filtered out at the source rather than
            // re-fetched every night forever. This is a coarse pre-filter — the
            // authoritative re-check happens INSIDE the tx below (the scan
            // snapshot is stale by write time, WF-F7 TOCTOU).
            application: { status: { in: Array.from(CLOSEABLE_PRE_PAYMENT_STATES) } },
        },
        select: {
            id: true,
            invoiceNumber: true,
            dueDate: true,
            organizationId: true,
            application: {
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    healthId: true,
                    organizationId: true,
                    // version drives the WF-F7 optimistic lock on the close
                    // write (re-read fresh inside the tx below).
                    version: true,
                    // Selected so buildTransitionUpdate preserves the real
                    // formData/history (M4 Bug-2.1): without them the EXPIRED
                    // write would wipe applicant data and reset the audit trail.
                    formData: true,
                    workflowHistory: true,
                },
            },
        },
    }));

    const summary = { scanned: invoices.length, closed: 0, skipped: 0, errors: 0 };

    for (const invoice of invoices) {
        const app = invoice.application;
        if (!app) {
            // Orphan invoice (applicationId set but row missing) — nothing to close.
            summary.skipped += 1;
            continue;
        }

        // Money-safety guard #1 (state) — only close a case still sitting at a
        // payment gate. Anything else (transient or already terminal) is skipped;
        // this is also what makes a second run a no-op over an EXPIRED case.
        if (!CLOSEABLE_PRE_PAYMENT_STATES.has(app.status)) {
            summary.skipped += 1;
            continue;
        }

        const orgId = app.organizationId || invoice.organizationId;
        if (!orgId) {
            summary.errors += 1;
            logger.error(
                `[payment-closure] invoice ${invoice.id} / application ${app.id} missing organizationId; ` +
                'cannot establish tenant scope. Skipping.',
            );
            continue;
        }

        try {
            // Money-safety guard #2 (fully reminded) — all three reminder types
            // must be logged. A partially-reminded case is NEVER closed.
            if (!(await allRemindersSent(invoice.id))) {
                summary.skipped += 1;
                continue;
            }

            // Money-safety guard #3 (gateway truth) — a captured payment must never be
            // closed as abandoned even if the local invoice still reads PENDING
            // (a settle that failed/stalled). Stripe is the source of truth.
            if (await isInvoicePaidAtGateway(invoice.id)) {
                summary.skipped += 1;
                logger.error(
                    '[payment-closure] PAID-but-unsettled case — skipped close + alert',
                    { invoiceId: invoice.id, applicationId: app.id },
                );
                continue;
            }

            await runWithTenantContext({ organizationId: orgId }, async () => {
                // Did the tx actually stamp the close? A stale-snapshot skip or an
                // optimistic-lock conflict returns WITHOUT writing; only a genuine
                // close flips this, so the summary + notify below never miscount.
                let didClose = false;

                // Status write + its audit row are atomic (writeApplicationStatus
                // runs onAudit inside the tx handle) — same as the M4 close.
                await prisma.$transaction(async (tx) => {
                    // WF-F7 TOCTOU guard. The 03:00 scan snapshot of app.status is
                    // STALE by now: a PromptPay settlement (webhook PENDING_*_FEE ->
                    // *_FEE_PAID) may have landed in between. Re-read the application
                    // (status + version) AND the invoice status under the tx and
                    // re-check both money-safety guards against the FRESH row —
                    // stamping terminal EXPIRED over a freshly-PAID case would bury
                    // a paying customer's application (reopen is unbuilt).
                    const freshApp = await tx.application.findUnique({
                        where: { id: app.id },
                        select: {
                            status: true,
                            version: true,
                            formData: true,
                            workflowHistory: true,
                        },
                    });
                    const freshInvoice = await tx.invoice.findUnique({
                        where: { id: invoice.id },
                        select: { status: true },
                    });

                    if (
                        !freshApp
                        || !CLOSEABLE_PRE_PAYMENT_STATES.has(freshApp.status)
                        || freshInvoice?.status !== INVOICE_STATUS_PENDING
                    ) {
                        // Paid / advanced / vanished between scan and write — SKIP,
                        // never write. Counted as a skip after the tx (didClose stays
                        // false).
                        return;
                    }

                    // Route the EXPIRED transition through buildTransitionUpdate so
                    // the canonical workflow guards run (SYSTEM owns the
                    // PENDING_*_FEE->EXPIRED edges added for M5). Build from the
                    // FRESH row so the preserved formData/history is current.
                    const freshAppForTransition = {
                        ...app,
                        status: freshApp.status,
                        formData: freshApp.formData,
                        workflowHistory: freshApp.workflowHistory,
                    };
                    const transitionUpdate = buildTransitionUpdate({
                        application: freshAppForTransition,
                        toState: APPLICATION_STATUSES.EXPIRED,
                        actorId: 'cron-payment-closure',
                        actorRole: 'system',
                        reasonCode: 'PAYMENT_ABANDONED',
                        comment:
                            'Auto-closed: checkout payment abandoned ' +
                            `(unpaid > ${thresholdDays} calendar days past due, fully reminded). ` +
                            `Invoice ${invoice.invoiceNumber} due ${new Date(invoice.dueDate).toISOString()}`,
                    });

                    try {
                        await writeApplicationStatus({
                            prisma: tx,
                            applicationId: app.id,
                            fromStatus: freshApp.status,
                            toStatus: APPLICATION_STATUSES.EXPIRED,
                            // WF-F7 optimistic lock: a writer that advanced the row
                            // AFTER our re-read but BEFORE this write bumps version,
                            // our scoped UPDATE matches 0 rows and CONCURRENCY_CONFLICT
                            // is thrown instead of clobbering the concurrent write.
                            expectedVersion: freshApp.version,
                            actorId: 'cron-payment-closure',
                            actorRole: 'system',
                            reason:
                                'Auto-closed: checkout payment abandoned ' +
                                `(unpaid > ${thresholdDays} calendar days past due, fully reminded).`,
                            additionalData: {
                                ...(transitionUpdate?.updateData || {}),
                                // The ONLY closedReason value this cron writes.
                                closedReason: M5_CLOSED_REASON,
                                formData: {
                                    ...(typeof freshApp.formData === 'object' && freshApp.formData ? freshApp.formData : {}),
                                    _paymentAbandoned: {
                                        closedAt: new Date().toISOString(),
                                        reason: M5_CLOSED_REASON,
                                        invoiceId: invoice.id,
                                        invoiceDueDate: new Date(invoice.dueDate).toISOString(),
                                        // Code note: a PAYMENT_ABANDONED close is final —
                                        // the reopen mechanism (R2 mechanism 2) is unbuilt.
                                        reopenEligible: false,
                                    },
                                },
                            },
                            // Emit exactly ONE canonical (hash-chained) audit row for the
                            // close. Best-effort by contract — a transient audit hiccup
                            // never blocks the close (writeApplicationStatus swallows it).
                            onAudit: async (entry) => {
                                await auditLogger.log({
                                    category: AuditCategory.APPLICATION,
                                    action: 'APPLICATION_PAYMENT_ABANDONED',
                                    severity: 'INFO',
                                    actorId: 'cron-payment-closure',
                                    actorType: 'SYSTEM',
                                    actorRole: 'system',
                                    resourceType: ResourceType.APPLICATION,
                                    resourceId: app.id,
                                    organizationId: orgId,
                                    metadata: {
                                        closedReason: M5_CLOSED_REASON,
                                        reason: M5_CLOSED_REASON,
                                        invoiceId: invoice.id,
                                        invoiceNumber: invoice.invoiceNumber,
                                        invoiceDueDate: new Date(invoice.dueDate).toISOString(),
                                        thresholdDays,
                                        fromStatus: entry?.fromStatus ?? freshApp.status,
                                        toStatus: entry?.toStatus ?? APPLICATION_STATUSES.EXPIRED,
                                    },
                                });
                            },
                        });
                        didClose = true;
                    } catch (writeError) {
                        if (writeError?.code === 'CONCURRENCY_CONFLICT') {
                            // A concurrent writer won the race between our re-read and
                            // our write — treat exactly like the stale-snapshot skip
                            // above (didClose stays false → counted as a skip), NOT an
                            // error. Nothing was written (0-row UPDATE), so the empty
                            // tx commits cleanly.
                            return;
                        }
                        // Genuine failure — roll the tx back and surface to the
                        // per-case error handler below.
                        throw writeError;
                    }
                });

                if (!didClose) {
                    summary.skipped += 1;
                    return;
                }

                summary.closed += 1;
                logger.info(
                    `[payment-closure] Auto-closed: ${app.applicationNumber} ` +
                    `(invoice ${invoice.invoiceNumber}, ${app.status} -> EXPIRED, PAYMENT_ABANDONED)`,
                );

                // Notify the applicant (best-effort — a notification failure never
                // undoes the close). APPLICATION_EXPIRED is the farmer-facing
                // auto-cancel notice; the reason customises its message.
                try {
                    const applicantUserId = await resolveApplicantUserId(app.healthId);
                    if (applicantUserId) {
                        await sendNotification(applicantUserId, NotifyType.APPLICATION_EXPIRED, {
                            applicationNumber: app.applicationNumber,
                            reason: 'ไม่ชำระเงินค่าธรรมเนียมภายในกำหนด',
                            expiredAt: new Date().toISOString(),
                        });
                    } else {
                        logger.warn(
                            `[payment-closure] applicant User not found for ${app.applicationNumber}; ` +
                            'skipping applicant notification',
                        );
                    }
                } catch (notifyError) {
                    logger.warn(`[payment-closure] notification failed (non-fatal): ${notifyError?.message}`);
                }
            });
        } catch (itemError) {
            // One broken case must never sink the sweep — log, count, continue.
            summary.errors += 1;
            logger.error(
                `[payment-closure] failed to close application ${app.id} ` +
                `(invoice ${invoice.id}); sweep continues: ${itemError?.message}`,
            );
        }
    }

    logger.info(
        `[payment-closure] Completed: ${summary.scanned} scanned, ` +
        `${summary.closed} closed, ${summary.skipped} skipped, ${summary.errors} errors`,
    );

    return summary;
}

module.exports = { runPaymentClosureSweep, isInvoicePaidAtGateway };
