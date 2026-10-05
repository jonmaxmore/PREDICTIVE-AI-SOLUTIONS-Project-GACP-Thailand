'use strict';

/**
 * PaymentAdapter seam — W2-01 (the work brief §3.1).
 *
 * Business logic reaches the payment gateway ONLY through this interface:
 *
 *   createCheckoutSession({ amountSatang, currency, paymentMethodTypes,
 *                           statementDescriptor, description, metadata,
 *                           idempotencyKey })      → { id, clientSecret, raw }
 *   verifyWebhookSignature({ rawBody, signature }) → verified event (throws)
 *   parseEvent(event)                              → { kind, type, eventId, object }
 *   getPaymentIntent(id)                           → gateway intent object
 *   cancelPaymentIntent(id)                        → canceled intent (throws if not cancelable)
 *   getClientConfig()                              → { publishableKey|null } (browser confirm; 503 fail-closed)
 *
 * Implementations:
 *   stripe-adapter.js       — the ONE file allowed to import the stripe SDK
 *                             (probe: stripe-sdk-isolated)
 *   mock-payment-adapter.js — deterministic, network-free; carries QA while
 *                             Stripe keys are BLOCKED(operator:stripe-keys)
 *
 * Switch: PAYMENT_ADAPTER=mock|stripe (default stripe; unknown fails closed).
 */

/**
 * Domain event vocabulary over BOTH Stripe event families. The engine keys on
 * `kind`, so a later move between Payment Intents (Elements) and Checkout
 * Sessions (hosted page) is an adapter-only change — settlement code does not
 * know event type strings.
 */
const SETTLE_TYPES = Object.freeze(['payment_intent.succeeded', 'checkout.session.completed']);
const FAIL_TYPES = Object.freeze(['payment_intent.payment_failed', 'checkout.session.async_payment_failed']);
const CANCEL_TYPES = Object.freeze(['payment_intent.canceled', 'checkout.session.expired']);

function parseEvent(event) {
    const type = event ? event.type : undefined;
    let kind = 'UNKNOWN';
    if (SETTLE_TYPES.includes(type)) {
        kind = 'SETTLED';
    } else if (FAIL_TYPES.includes(type)) {
        kind = 'FAILED';
    } else if (CANCEL_TYPES.includes(type)) {
        kind = 'CANCELLED';
    }
    return {
        kind,
        type,
        eventId: event ? event.id : undefined,
        object: event && event.data ? event.data.object : undefined,
    };
}

/** Resolve the active adapter from PAYMENT_ADAPTER (fail-closed on unknowns). */
function getPaymentAdapter() {
    const { getPaymentAdapterKind } = require('../../config/stripe');
    const kind = getPaymentAdapterKind();
    if (kind === 'stripe') {
        return require('./stripe-adapter');
    }
    if (kind === 'mock') {
        return require('./mock-payment-adapter');
    }
    throw Object.assign(
        new Error(`PAYMENT_ADAPTER "${kind}" is not a known adapter (stripe|mock)`),
        { code: 'PAYMENT_ADAPTER_INVALID' },
    );
}

/** Shared guard: webhook verification works on raw bytes, never parsed JSON. */
function assertRawBody(rawBody) {
    if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') {
        throw Object.assign(
            new Error('webhook verification requires the raw request body — a JSON.parse-d body is rejected'),
            { code: 'RAW_BODY_REQUIRED' },
        );
    }
}

module.exports = {
    getPaymentAdapter,
    parseEvent,
    assertRawBody,
};
