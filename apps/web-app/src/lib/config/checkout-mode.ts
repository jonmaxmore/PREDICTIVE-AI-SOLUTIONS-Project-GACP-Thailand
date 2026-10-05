/**
 * checkout-mode.ts — env switch for the Stripe checkout UI (W2-03 D1).
 *
 * Two independent knobs, both read at call time (same idiom as
 * `map-tiles.ts` in this directory — no module-load caching, so tests and
 * long-lived sessions always see the current value):
 *
 *   NEXT_PUBLIC_CHECKOUT_API_MODE     'mock' → the checkout service serves
 *                                     local fixtures with a small artificial
 *                                     latency; anything else → real backend.
 *   NEXT_PUBLIC_CHECKOUT_UI_ENABLED   'true' → checkout UI surfaces render.
 *
 * The fail-safe direction is deliberate and OPPOSITE for the two knobs:
 *
 *   - API mode fails towards **live**: only the exact, case-sensitive value
 *     'mock' (after trimming surrounding whitespace) selects mock mode. A
 *     typo'd or half-configured environment must talk to the real backend —
 *     silently landing in mock-money land would let a whole payment flow
 *     "succeed" without a single satang moving.
 *   - UI enablement fails towards **off**: only the exact string 'true'
 *     (no trim, no case folding) turns the checkout UI on, so the feature
 *     stays invisible until an operator switches it on explicitly.
 */

export type CheckoutApiMode = 'live' | 'mock';

/**
 * Resolve which backend the checkout service should talk to.
 *
 * 'mock' ONLY for the exact trimmed value 'mock'; every other value —
 * unset, blank, wrong case, typo — resolves to 'live'.
 */
export function getCheckoutApiMode(): CheckoutApiMode {
    const raw = (process.env.NEXT_PUBLIC_CHECKOUT_API_MODE ?? '').trim();
    return raw === 'mock' ? 'mock' : 'live';
}

/**
 * True only when NEXT_PUBLIC_CHECKOUT_UI_ENABLED is the exact string
 * 'true'. No trim, no case folding — fail closed.
 */
export function isCheckoutUiEnabled(): boolean {
    return process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED === 'true';
}
