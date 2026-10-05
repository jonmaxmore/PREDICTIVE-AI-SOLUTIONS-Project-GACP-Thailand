/**
 * checkout-fixtures.ts — canned FE-visible responses for the checkout
 * service's mock mode (W2-03 D1).
 *
 * Every fixture is shaped exactly like what `api.post('/payments/checkout')`
 * resolves to AFTER api-client envelope processing — i.e. what D2's UI will
 * actually receive — per the backend contract confirmed by the W2-03
 * spec-reader:
 *
 *   success: { success:true, data:{ checkoutOrderId, paymentIntentId,
 *              clientSecret, milestone, breakdown } }
 *   error:   { success:false, error:<code|string>, status?, code? }
 *            (the backend's `message` field is stripped by api-client —
 *             never rely on it)
 *   timeout: { success:false, error:'Request timeout. Please try again' }
 *            (client-side abort — no HTTP response, so no status/code)
 *
 * Amounts are THB integers mirroring the backend's real M1 example
 * (5500/385/5885/5885 — one fee, no DTAM figure since 2026-09-29). These
 * are TEST/MOCK fixtures pinned to the
 * confirmed contract, not business logic — the real numbers always come
 * from the backend.
 */

import type { CheckoutResult } from '../checkout-service';

/** M1 happy path — mirrors the backend's real M1 example breakdown. */
export const HAPPY: CheckoutResult = {
    success: true,
    data: {
        checkoutOrderId: 'co_mock_1',
        paymentIntentId: 'pi_mock_1',
        clientSecret: 'pi_mock_1_secret_mock',
        milestone: 'M1',
        breakdown: {
            platformFeeNet: 5500,
            platformFeeVat: 385,
            platformFeeGross: 5885,
            totalPayableAmount: 5885,
        },
    },
};

/**
 * DELIBERATELY WRONG NUMBERS — do not "fix".
 *
 * Identical to HAPPY except totalPayableAmount, which intentionally does
 * NOT equal platformFeeGross (5885, but this says 9999). D2's render test
 * feeds this fixture to the checkout UI and asserts that 9999 appears on
 * screen: that outcome is only possible if the UI renders the response
 * verbatim. If the UI recomputed the total locally it would show 5885 and
 * the test would fail — which is exactly
 * the point. A checkout-service test pins the non-summing property so a
 * well-meaning cleanup that makes these numbers add up fails loudly.
 */
export const HAPPY_NON_SUMMING: CheckoutResult = {
    success: true,
    data: {
        checkoutOrderId: 'co_mock_1',
        paymentIntentId: 'pi_mock_1',
        clientSecret: 'pi_mock_1_secret_mock',
        milestone: 'M1',
        breakdown: {
            platformFeeNet: 5500,
            platformFeeVat: 385,
            platformFeeGross: 5885,
            totalPayableAmount: 9999,
        },
    },
};

/** Another checkout already open for this application+milestone (HTTP 409). */
export const CONFLICT_409: CheckoutResult = {
    success: false,
    error: 'CHECKOUT_ALREADY_IN_PROGRESS',
    status: 409,
    code: 'CHECKOUT_ALREADY_IN_PROGRESS',
};

/** Backend catch-all failure (HTTP 5xx). */
export const SERVER_ERROR_500: CheckoutResult = {
    success: false,
    error: 'CHECKOUT_FAILED',
    status: 500,
};

/**
 * api-client timeout envelope — the request was aborted client-side, so
 * there is no HTTP response and therefore no `status` and no `code`.
 */
export const TIMEOUT: CheckoutResult = {
    success: false,
    error: 'Request timeout. Please try again',
};
