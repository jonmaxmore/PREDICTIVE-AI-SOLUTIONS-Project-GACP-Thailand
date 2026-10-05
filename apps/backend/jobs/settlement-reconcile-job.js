'use strict';

/**
 * Settlement reconcile — the Stripe-truth backstop (Task 5,
 * design notes).
 *
 * Two independent sweeps, both bounded (SETTLEMENT.RECONCILE_BATCH) and
 * fault-isolated per row (one bad row is logged + counted; the sweep never
 * aborts):
 *
 *   Query A — retry unprocessed webhook events. `stripe_webhook_events` rows
 *   stuck at RECEIVED/FAILED (nextRetryAt reached, or never scheduled and
 *   now stale past SETTLEMENT.RECONCILE_STALE_MS) are re-driven through
 *   settleEvent(eventId) — the SAME event-bookkeeping wrapper the webhook
 *   route uses, so status/attempts/nextRetryAt stay consistent.
 *
 *   Scoped to type: 'payment_intent.succeeded' (controller-ruled refinement
 *   over the brief's simpler query): settleEvent only knows how to settle
 *   that event family (checkout-settlement-service.js handleStripeEvent
 *   dispatches settleEvent for payment_intent.succeeded ONLY). A
 *   charge.succeeded or payment_intent.payment_failed row left RECEIVED/
 *   FAILED and retried here would raise a false ORDER_NOT_FOUND /
 *   AMOUNT_MISMATCH against settleFromPaymentIntent's expectations instead
 *   of being handled by its own (different) code path.
 *
 *   Query B — re-drive orders Stripe reports captured but that never
 *   advanced past PENDING_PAYMENT locally (webhook lost/late/erroring).
 *   Stripe's own PaymentIntent status is the source of truth here: only a
 *   PI Stripe reports 'succeeded' is re-driven, through
 *   settleFromPaymentIntent (eventId: null — no event row backs this call;
 *   the id only appears in logs, confirmed tolerant of null).
 *
 *   Before re-driving (controller-ruled refinement over the brief's simpler
 *   query), each candidate order is checked for a PROCESSED
 *   payment_intent.succeeded event already recorded against its
 *   PaymentIntent id. If one exists, settleFromPaymentIntent already ran and
 *   refused for a TERMINAL reason (AMOUNT_MISMATCH / ORDER_NOT_FOUND —
 *   settleEvent stamps the event PROCESSED even on a refusal; see
 *   checkout-settlement-service.js settleEvent's `terminal` handling). Re-
 *   driving a terminal order would just re-alert the identical case every 10
 *   minutes forever; it needs an operator, not a retry. The check runs
 *   before the Stripe API call so a terminal order costs neither a re-drive
 *   nor a wasted round trip.
 *
 * Neither query writes the order's settled status directly — both delegate
 * to checkout-settlement-service, the one file allowed to write it (probe
 * settle-webhook-only). Query B does not stamp any event row itself; the
 * order's own status is the source of truth, and a lingering RECEIVED event
 * for the same PI is later resolved by query A (it will find the order
 * already settled and settleEvent's own idempotency stamps it PROCESSED).
 *
 * Cross-tenant scan (the cron holds no tenant scope) via withoutTenantScope;
 * re-enters each order's own tenant via runWithTenantContext for the
 * re-drive (mirrors jobs/payment-closure-job.js).
 *
 * Registered in jobs/scheduler.js — every 10 min, all day, Asia/Bangkok.
 *
 * @module jobs/settlement-reconcile-job
 */

const { prisma } = require('../services/prisma-database');
const { createLogger } = require('../shared/logger');
const { withoutTenantScope, runWithTenantContext } = require('../services/tenant-context');
const { SETTLEMENT } = require('../config/business-rules');
const { settleEvent, settleFromPaymentIntent } = require('../services/checkout/checkout-settlement-service');
const { getPaymentAdapter } = require('../services/payment/payment-adapter');

const logger = createLogger('settlement-reconcile');

/**
 * settleEvent (and the webhook route's own dispatch) only understands this
 * event family — see checkout-settlement-service.js handleStripeEvent.
 * Refinement A pins query A to it.
 */
const SETTLE_EVENT_TYPE = 'payment_intent.succeeded';

/**
 * @param {Date} [now] — clock injection (tests); defaults to the real clock.
 * @returns {Promise<{retriedEvents: number, reDrivenOrders: number, deadLettered: number, errors: number}>}
 */
async function runSettlementReconcile(now = new Date()) {
    const summary = { retriedEvents: 0, reDrivenOrders: 0, deadLettered: 0, errors: 0 };
    const staleBefore = new Date(now.getTime() - SETTLEMENT.RECONCILE_STALE_MS);

    // Query A — unprocessed events due for retry (nextRetryAt reached, or
    // never scheduled and now stale). type-scoped (Refinement A): excludes
    // PROCESSED + DEAD_LETTER (terminal) via the status filter, and excludes
    // non-succeeded event families (charge.succeeded, payment_failed, ...)
    // via the type filter, so only rows settleEvent can actually settle are
    // ever fetched.
    const events = await prisma.stripeWebhookEvent.findMany({
        where: {
            type: SETTLE_EVENT_TYPE,
            status: { in: ['RECEIVED', 'FAILED'] },
            OR: [
                { nextRetryAt: { lte: now } },
                { nextRetryAt: null, receivedAt: { lt: staleBefore } },
            ],
        },
        orderBy: { receivedAt: 'asc' },
        take: SETTLEMENT.RECONCILE_BATCH,
    });
    for (const ev of events) {
        try {
            const r = await settleEvent(ev.id);
            summary.retriedEvents += 1;
            if (r.status === 'DEAD_LETTER') { summary.deadLettered += 1; }
        } catch (e) {
            summary.errors += 1;
            logger.error('[reconcile] event retry failed', { eventId: ev.id, error: e.message });
        }
    }

    // Query B — orders captured by Stripe but not settled locally (Stripe =
    // source of truth). Cross-tenant scan; re-enters each order's tenant
    // below to re-drive.
    const adapter = getPaymentAdapter();
    const orders = await withoutTenantScope(() => prisma.checkoutOrder.findMany({
        where: {
            status: 'PENDING_PAYMENT',
            stripePaymentIntentId: { not: null },
            createdAt: { lt: staleBefore },
        },
        take: SETTLEMENT.RECONCILE_BATCH,
    }));
    for (const order of orders) {
        try {
            // Refinement B: skip a candidate whose PI already has a
            // PROCESSED payment_intent.succeeded event — that is a
            // TERMINAL outcome (AMOUNT_MISMATCH / ORDER_NOT_FOUND), not a
            // missed settle. Checked BEFORE the Stripe call.
            const alreadyHandled = await prisma.stripeWebhookEvent.findFirst({
                where: {
                    status: 'PROCESSED',
                    type: SETTLE_EVENT_TYPE,
                    payload: { path: ['data', 'object', 'id'], equals: order.stripePaymentIntentId },
                },
                select: { id: true },
            });
            if (alreadyHandled) { continue; } // terminal or already settled — do not re-drive

            const pi = await adapter.getPaymentIntent(order.stripePaymentIntentId);
            if (!pi || pi.status !== 'succeeded') { continue; } // not captured → leave for the closure sweep

            await runWithTenantContext({ organizationId: order.organizationId }, () =>
                settleFromPaymentIntent({ paymentIntent: pi, eventId: null }));
            summary.reDrivenOrders += 1;
        } catch (e) {
            summary.errors += 1;
            logger.error('[reconcile] order re-drive failed', { orderId: order.id, error: e.message });
        }
    }

    logger.info('[reconcile] settlement reconcile complete', summary);
    return summary;
}

module.exports = { runSettlementReconcile };
