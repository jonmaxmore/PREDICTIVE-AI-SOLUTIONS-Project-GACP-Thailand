'use strict';

/**
 * Stripe webhook — POST /api/v1/webhooks/stripe (also /api/webhooks/stripe
 * through the unversioned mount). Wave 2, design v2 §5.5; thin-webhook
 * rewrite per settlement-resilience Task 4 (progress.md Ruling 2 — overrides
 * the task-4 brief's Step 3, which kicked settleEvent for every event type).
 *
 * The ONLY unlock path for the two payment gates of the canonical 7-step
 * workflow. Order of operations, each a hard gate:
 *
 *   1. SIGNATURE — stripe.webhooks.constructEvent over the EXACT raw bytes
 *      (server.js captures req.rawBody in express.json's verify hook) with
 *      the stripe-signature header and STRIPE_WEBHOOK_SECRET. constructEvent
 *      enforces the HMAC and the replay-protection timestamp tolerance.
 *      Invalid → 400, zero side effects.
 *   2. DEDUP — insert into stripe_webhook_events FIRST, status RECEIVED. A
 *      P2002 on the event id means a REDELIVERY: load the existing row —
 *      already PROCESSED is a true duplicate (200, no re-drive); anything
 *      else (RECEIVED / FAILED / DEAD_LETTER) falls through and re-drives
 *      through the same dispatch below.
 *   3. DISPATCH, branched by type. settleEvent settles a PaymentIntent, so
 *      it is correct ONLY for payment_intent.succeeded — kicking it for
 *      every type (as charted in the original task-4 brief) would raise a
 *      false ORDER_NOT_FOUND on every charge.succeeded and a false
 *      AMOUNT_MISMATCH on every payment_intent.payment_failed, while also
 *      skipping the failure-recording handleStripeEvent does for the latter:
 *        - payment_intent.succeeded: ACK 200 FIRST, then kick
 *          settleEvent(event.id) out of the request path (setImmediate,
 *          not awaited). settleEvent stamps the event's own
 *          status/attempts/nextRetryAt on its own — this route does not
 *          stamp it. A crash between the 200 and the settle is the
 *          reconcile cron's job (Task 5), not this route's.
 *        - every other type (charge.succeeded, payment_intent.payment_failed,
 *          payment_intent.canceled, anything unrecognized): handled INLINE
 *          via handleStripeEvent (fast, terminal — e.g. records a payment
 *          failure; no-ops a type it doesn't recognize), then the event row
 *          is stamped PROCESSED before the 200. A handleStripeEvent THROW
 *          stamps the error and returns 500 so Stripe redelivers (the
 *          still-unprocessed dedup row lets the retry re-drive safely) — but
 *          once handleStripeEvent has already committed its effect, a stamp
 *          FAILURE on its own (transient DB blip, lock contention from a
 *          concurrent redelivery of the same row) is non-fatal: logged, still
 *          200. A stamp failure must never look like a handler failure —
 *          that would make Stripe redeliver and re-run an already-succeeded
 *          handler a second time.
 *
 * No auth middleware: authenticity IS the signature. The route refuses to
 * register at all when STRIPE_WEBHOOK_SECRET is missing (fail-closed).
 */

const express = require('express');
const { prisma } = require('../../../services/prisma-database');
const logger = require('../../../shared/logger');
const { getPaymentAdapter } = require('../../../services/payment/payment-adapter');
const { settleEvent, handleStripeEvent } = require('../../../services/checkout/checkout-settlement-service');

const router = express.Router();

router.post('/stripe', async (req, res) => {
    // 1. Signature over the raw bytes — via the adapter seam (W2-01). The
    //    adapter itself rejects anything that is not raw bytes, so a
    //    JSON.parse-d body can never reach signature verification.
    let event;
    try {
        const adapter = getPaymentAdapter();
        const signature = req.headers['stripe-signature'];
        const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
        if (!rawBody) {
            throw new Error('raw request body unavailable for signature verification');
        }
        event = adapter.verifyWebhookSignature({ rawBody, signature });
    } catch (err) {
        logger.warn('[stripe-webhook] signature verification failed', { error: err.message });
        return res.status(400).json({ success: false, error: 'INVALID_SIGNATURE' });
    }

    // 2. Insert-first dedup on the Stripe event id. A P2002 is a REDELIVERY:
    //    re-drive only if the stored row is not already PROCESSED.
    try {
        await prisma.stripeWebhookEvent.create({
            data: { id: event.id, type: event.type, payload: event, status: 'RECEIVED' },
        });
    } catch (err) {
        if (err && err.code === 'P2002') {
            const existing = await prisma.stripeWebhookEvent.findUnique({ where: { id: event.id } });
            if (existing && existing.status === 'PROCESSED') {
                return res.status(200).json({ success: true, duplicate: true });
            }
            // unprocessed (RECEIVED / FAILED / DEAD_LETTER) → fall through and re-drive below
        } else {
            logger.error('[stripe-webhook] event store insert failed', { eventId: event.id, error: err.message });
            return res.status(500).json({ success: false, error: 'EVENT_STORE_UNAVAILABLE' });
        }
    }

    // 3. Dispatch, branched by type — see header. settleEvent is a
    //    PaymentIntent settle; every other type goes through handleStripeEvent
    //    inline and is stamped terminal before responding.
    if (event.type === 'payment_intent.succeeded') {
        res.status(200).json({ success: true, received: true });
        setImmediate(() => {
            settleEvent(event.id).catch((err) => {
                logger.error('[stripe-webhook] async settle failed (reconcile will retry)', {
                    eventId: event.id, error: err.message,
                });
            });
        });
        return;
    }

    try {
        await handleStripeEvent(event);
    } catch (err) {
        logger.error('[stripe-webhook] handler failed — Stripe will redeliver', {
            eventId: event.id, type: event.type, error: err.message,
        });
        await prisma.stripeWebhookEvent.update({
            where: { id: event.id },
            data: { error: err.message },
        }).catch(() => {});
        return res.status(500).json({ success: false, error: 'HANDLER_FAILED' });
    }

    // handleStripeEvent's effect already committed — a failed stamp must not
    // trigger a Stripe retry (and a second handleStripeEvent run) of a
    // completed handler. Non-fatal: log and still ACK.
    await prisma.stripeWebhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
    }).catch((stampErr) => {
        logger.error('[stripe-webhook] processed-stamp failed (non-fatal)', {
            eventId: event.id, error: stampErr.message,
        });
    });
    return res.status(200).json({ success: true, received: true });
});

module.exports = router;
