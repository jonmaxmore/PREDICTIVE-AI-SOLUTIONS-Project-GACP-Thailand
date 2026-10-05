'use strict';

/**
 * Stripe checkout configuration — Wave 2 of the single lump-sum checkout
 * engine (docs/payment-refactor/step2-data-model-design.md v2 §5.5).
 *
 * PURE CONFIG ONLY. The SDK client (and both secret accessors) live in
 * services/payment/stripe-adapter.js — the ONE file allowed to import the
 * stripe SDK (W2-01 adapter seam; probe: stripe-sdk-isolated). The
 * publishable key (pk_...) is read here too since the PromptPay QR step
 * (2026-09-27): the backend hands it to the browser in the checkout response
 * so it is never baked into a web build (getStripePublishableKey below).
 */

/**
 * Locked by the master directive: the exact statement descriptor for
 * บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด. 20 chars — within Stripe's 22-char
 * limit for THB card charges.
 */
const STATEMENT_DESCRIPTOR = 'PREDICTIVE AI - GACP';

/** Stripe THB minor unit is the satang (1/100 THB). */
function toSatang(amountThb) {
    // Coerce string | number | Prisma Decimal (checkout_orders.total_payable_amount
    // is a Postgres numeric → Prisma Decimal object at settle time; Number() reads
    // its value, whereas a bare Decimal fails Number.isFinite and threw).
    const n = Number(amountThb);
    if (!Number.isFinite(n) || n < 0) {
        throw Object.assign(
            new Error(`toSatang: invalid THB amount ${amountThb}`),
            { code: 'INVALID_AMOUNT' },
        );
    }
    return Math.round(n * 100);
}

/** Feature flag for the drain-then-purge window (D2). */
function isStripeCheckoutEnabled() {
    return process.env.STRIPE_CHECKOUT_ENABLED === 'true';
}

/**
 * Pure env accessors — the config layer is the ONLY place that reads
 * process.env (ratchet counter: env-direct). The SDK-importing adapter
 * consumes these; it never touches the environment itself.
 */
function getStripeSecretKey() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
        throw Object.assign(
            new Error('STRIPE_SECRET_KEY is not configured — Stripe checkout is unavailable (fail-closed)'),
            { code: 'STRIPE_NOT_CONFIGURED' },
        );
    }
    return key;
}

/** No signing secret → webhook verification refuses to exist (fail-closed). */
function assertWebhookSecret() {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
        throw Object.assign(
            new Error('STRIPE_WEBHOOK_SECRET is not configured — the Stripe webhook route refuses to boot (fail-closed)'),
            { code: 'STRIPE_WEBHOOK_NOT_CONFIGURED' },
        );
    }
    return secret;
}

/**
 * The test/live mode a Stripe key belongs to, read from its documented prefix
 * (sk_ secret, rk_ restricted, pk_ publishable). Anything else is null, which
 * no caller treats as a match: an unrecognised key is never guessed into a mode.
 */
function stripeKeyMode(key) {
    const m = /^(?:sk|rk|pk)_(test|live)_/.exec(String(key || ''));
    return m ? m[1] : null;
}

function configError(status, code, message) {
    return Object.assign(new Error(message), { status, statusCode: status, code });
}

/**
 * The publishable key the browser loads Stripe.js with (PromptPay QR step,
 * operator ruling 2026-09-27). Read here at request time, not baked into the
 * web build, so one image serves every environment and the key follows the
 * backend's own secret.
 *
 * One name for every deployed environment: STRIPE_PUBLISHABLE_KEY. The dev
 * file apps/backend/.env already carries the key under the web-style name
 * NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and is not renamed, so that name is the
 * fallback only.
 *
 * Fail closed: a missing value, or one that is not a pk_test_/pk_live_ key (a
 * secret pasted into the wrong slot must never reach a browser), refuses with
 * STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED. The mode comparison with the secret
 * key lives in the adapter, which owns the secret.
 */
function getStripePublishableKey() {
    const key = process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
        throw configError(503, 'STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED',
            'STRIPE_PUBLISHABLE_KEY is not configured — the PromptPay QR cannot be shown (fail-closed)');
    }
    if (!/^pk_(test|live)_/.test(key)) {
        throw configError(503, 'STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED',
            'STRIPE_PUBLISHABLE_KEY does not hold a publishable key (pk_test_/pk_live_) — refused (fail-closed)');
    }
    return key;
}

/** PAYMENT_ADAPTER=mock|stripe (W2-01 seam switch); default stripe. */
function getPaymentAdapterKind() {
    return String(process.env.PAYMENT_ADAPTER || 'stripe').toLowerCase();
}

module.exports = {
    STATEMENT_DESCRIPTOR,
    toSatang,
    isStripeCheckoutEnabled,
    getStripeSecretKey,
    assertWebhookSecret,
    getPaymentAdapterKind,
    getStripePublishableKey,
    stripeKeyMode,
};
