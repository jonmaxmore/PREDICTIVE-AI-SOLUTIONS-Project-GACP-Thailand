'use strict';

/**
 * StripeAdapter — the ONE file in the backend allowed to import the stripe
 * SDK (probe: stripe-sdk-isolated; the work brief §3.1).
 *
 * Zero-trust secret posture (unchanged from Wave 2 config):
 *   - STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET live in the backend env ONLY;
 *     both accessors FAIL CLOSED with an error naming the variable.
 *   - The publishable key (pk_...) is handed to the browser through
 *     getClientConfig() below, only when its test/live mode matches the
 *     secret key's mode (PromptPay QR step, 2026-09-27).
 */

const Stripe = require('stripe');
const { parseEvent, assertRawBody } = require('./payment-adapter');
// Env access stays in the config layer (ratchet: env-direct); this file only
// owns the SDK. Both accessors FAIL CLOSED with an error naming the variable.
const {
    getStripeSecretKey, assertWebhookSecret, getStripePublishableKey, stripeKeyMode,
} = require('../../config/stripe');

const name = 'stripe';

let _client = null;
let _clientKey = null;

/**
 * Lazily construct the Stripe client. Cached per key so tests that swap the
 * env get a fresh client. Throws (fail-closed) when the key is absent —
 * checkout creation must not degrade to a broken state.
 */
function getStripeClient() {
    const key = getStripeSecretKey();
    if (!_client || _clientKey !== key) {
        _client = new Stripe(key, { apiVersion: '2026-05-27.dahlia' });
        _clientKey = key;
    }
    return _client;
}

/** Fail fast BEFORE any DB row is minted when the gateway is unconfigured. */
function assertReady() {
    getStripeClient();
}

/**
 * What the browser needs to confirm an intent this adapter created: the
 * publishable key of the SAME account and the SAME mode.
 *
 * L3 (no live key before G1): a live publishable key beside a test secret
 * would load live Stripe.js against a test intent, and a test publishable key
 * beside a live secret would do the reverse; neither can take a payment and the
 * first would put a live key in front of a user. Both refuse with
 * STRIPE_KEY_MODE_MISMATCH before any row is minted. A secret key whose mode
 * cannot be read counts as a mismatch: the mode is never guessed.
 */
function getClientConfig() {
    const secretMode = stripeKeyMode(getStripeSecretKey());
    const publishableKey = getStripePublishableKey();
    if (!secretMode || stripeKeyMode(publishableKey) !== secretMode) {
        throw Object.assign(
            new Error('STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY are not the same mode (test/live) — refused (fail-closed)'),
            { status: 503, statusCode: 503, code: 'STRIPE_KEY_MODE_MISMATCH' },
        );
    }
    return { publishableKey };
}

async function createCheckoutSession({
    amountSatang, currency, paymentMethodTypes, statementDescriptor,
    description, metadata, idempotencyKey,
}) {
    const stripe = getStripeClient();
    const intent = await stripe.paymentIntents.create(
        {
            amount: amountSatang,
            currency,
            payment_method_types: paymentMethodTypes,
            statement_descriptor: statementDescriptor,
            description,
            metadata,
        },
        { idempotencyKey },
    );
    return { id: intent.id, clientSecret: intent.client_secret, raw: intent };
}

/**
 * constructEvent enforces the HMAC and the replay-protection timestamp
 * tolerance over the EXACT raw bytes. A parsed body is rejected before the
 * SDK is even consulted (PROMPT §3.2 pin).
 */
function verifyWebhookSignature({ rawBody, signature }) {
    assertRawBody(rawBody);
    const secret = assertWebhookSecret();
    return getStripeClient().webhooks.constructEvent(rawBody, signature, secret);
}

async function getPaymentIntent(id) {
    return getStripeClient().paymentIntents.retrieve(id);
}

/**
 * Cancel an unpaid intent so the QR a payer may still hold can no longer be
 * paid. No production caller since PR3 removed the checkout door's DTAM-portion
 * retire guard (the backlog 2026-09-29). Stripe refuses to cancel a succeeded
 * intent; that error propagates to the caller.
 */
async function cancelPaymentIntent(id) {
    return getStripeClient().paymentIntents.cancel(id);
}

module.exports = {
    name,
    createCheckoutSession,
    verifyWebhookSignature,
    parseEvent,
    getPaymentIntent,
    cancelPaymentIntent,
    // exported for fail-closed unit pins + the checkout service's fail-fast
    getStripeClient,
    assertWebhookSecret,
    assertReady,
    getClientConfig,
};
