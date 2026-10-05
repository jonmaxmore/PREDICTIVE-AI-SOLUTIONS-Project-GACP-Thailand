'use strict';

/**
 * MockPaymentAdapter — deterministic, network-free gateway double
 * (the work brief §3.1). Carries QA/E2E while the real keys are
 * BLOCKED(operator:stripe-keys); reports produced against this adapter are
 * marked integration=mock, never integration=live (§6.4).
 *
 * Determinism contract:
 *   - same idempotencyKey → same intent id (re-entry lands on one charge,
 *     mirroring Stripe's idempotency behavior);
 *   - __setNextCreateFailure(err) makes exactly the next create throw —
 *     tests order failures instead of hoping for them;
 *   - webhook signature is an HMAC-SHA256 over the raw bytes with a fixed
 *     non-secret dev key — same "raw bytes only" posture as the real
 *     adapter, so a JSON.parse-d body is rejected identically.
 */

const crypto = require('crypto');
const { parseEvent, assertRawBody } = require('./payment-adapter');

const name = 'mock';

// Deliberately NOT a secret and NOT env-configurable: a fixed dev signing key
// keeps the mock rail deterministic everywhere (and the env-direct ratchet flat).
const MOCK_SIGNING_KEY = 'gacp-mock-payment-signing-key';

const intents = new Map();
let nextCreateFailure = null;

function idFor(seed) {
    return 'pi_mock_' + crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 16);
}

async function createCheckoutSession({
    amountSatang, currency, paymentMethodTypes, statementDescriptor,
    description, metadata, idempotencyKey,
}) {
    if (nextCreateFailure) {
        const err = nextCreateFailure;
        nextCreateFailure = null;
        throw err;
    }
    if (!Number.isInteger(amountSatang) || amountSatang <= 0) {
        throw Object.assign(
            new Error(`mock adapter: amountSatang must be a positive integer, got ${amountSatang}`),
            { code: 'INVALID_AMOUNT' },
        );
    }
    const id = idFor(idempotencyKey || `${amountSatang}:${currency}`);
    const intent = {
        id,
        client_secret: `${id}_secret_mock`,
        amount: amountSatang,
        currency,
        status: 'requires_payment_method',
        payment_method_types: paymentMethodTypes || [],
        statement_descriptor: statementDescriptor,
        description,
        metadata: metadata || {},
    };
    intents.set(id, intent);
    return { id, clientSecret: intent.client_secret, raw: intent };
}

function signPayload(rawBody) {
    assertRawBody(rawBody);
    return 'mock-sig=' + crypto.createHmac('sha256', MOCK_SIGNING_KEY).update(rawBody).digest('hex');
}

function verifyWebhookSignature({ rawBody, signature }) {
    assertRawBody(rawBody);
    const expected = signPayload(rawBody);
    const a = Buffer.from(String(signature || ''));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw Object.assign(
            new Error('mock adapter: webhook signature mismatch'),
            { code: 'MOCK_SIGNATURE_INVALID' },
        );
    }
    return JSON.parse(rawBody.toString());
}

async function getPaymentIntent(id) {
    return intents.get(id) || null;
}

/** Same refusal shape as the gateway: a succeeded intent cannot be canceled. */
async function cancelPaymentIntent(id) {
    const intent = intents.get(id);
    if (!intent) { return null; }
    if (intent.status === 'succeeded') {
        throw new Error(`mock adapter: ${id} has succeeded and cannot be canceled`);
    }
    intent.status = 'canceled';
    return intent;
}

/**
 * A mock intent has no Stripe account behind it, so no browser can confirm it:
 * no publishable key is handed out, and the checkout screen says the QR cannot
 * be shown rather than loading Stripe.js against a secret Stripe never issued.
 */
function getClientConfig() {
    return { publishableKey: null };
}

/** Order exactly the next createCheckoutSession to throw `err`. */
function __setNextCreateFailure(err) {
    nextCreateFailure = err;
}

function __reset() {
    intents.clear();
    nextCreateFailure = null;
}

module.exports = {
    name,
    createCheckoutSession,
    verifyWebhookSignature,
    parseEvent,
    getPaymentIntent,
    cancelPaymentIntent,
    signPayload,
    getClientConfig,
    __setNextCreateFailure,
    __reset,
};
