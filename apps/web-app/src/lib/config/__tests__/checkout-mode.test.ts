/**
 * checkout-mode.test.ts — W2-03 D1: env switch for the Stripe checkout UI.
 *
 * Contract locked here (dispatch D1 spec):
 *
 *   1. `getCheckoutApiMode()` reads NEXT_PUBLIC_CHECKOUT_API_MODE, trims it,
 *      and returns 'mock' ONLY for the exact, case-sensitive value 'mock'.
 *      Everything else — unset, blank, typo, wrong case — resolves to 'live'.
 *      Fail-safe direction is deliberate: a misconfigured env var must send
 *      the UI to the REAL backend, never silently into mock-money land.
 *   2. `isCheckoutUiEnabled()` is true ONLY when
 *      NEXT_PUBLIC_CHECKOUT_UI_ENABLED === 'true' (exact string, no trim,
 *      no case folding) — same fail-closed idiom as the map-tiles resolver
 *      (src/lib/config/map-tiles.ts).
 *
 * Pattern mirrors src/lib/config/__tests__/map-tiles.test.ts: originals are
 * captured once and restored after each test so env mutation cannot leak
 * into other suites.
 */
import { afterEach, describe, expect, it } from '@jest/globals';

import { getCheckoutApiMode, isCheckoutUiEnabled } from '../checkout-mode';

const ORIGINAL_API_MODE = process.env.NEXT_PUBLIC_CHECKOUT_API_MODE;
const ORIGINAL_UI_ENABLED = process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED;

afterEach(() => {
    if (ORIGINAL_API_MODE === undefined) {
        delete process.env.NEXT_PUBLIC_CHECKOUT_API_MODE;
    } else {
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = ORIGINAL_API_MODE;
    }
    if (ORIGINAL_UI_ENABLED === undefined) {
        delete process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED;
    } else {
        process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED = ORIGINAL_UI_ENABLED;
    }
});

describe('getCheckoutApiMode — fail-safe towards the real backend', () => {
    it("returns 'live' when the variable is unset", () => {
        delete process.env.NEXT_PUBLIC_CHECKOUT_API_MODE;
        expect(getCheckoutApiMode()).toBe('live');
    });

    it("returns 'live' for an empty string", () => {
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = '';
        expect(getCheckoutApiMode()).toBe('live');
    });

    it("returns 'live' for whitespace-only values", () => {
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = '   ';
        expect(getCheckoutApiMode()).toBe('live');
    });

    it("returns 'mock' for the exact value 'mock'", () => {
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = 'mock';
        expect(getCheckoutApiMode()).toBe('mock');
    });

    it("trims surrounding whitespace before matching — '  mock  ' is mock", () => {
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = '  mock  ';
        expect(getCheckoutApiMode()).toBe('mock');
    });

    it("is case-sensitive — 'Mock' / 'MOCK' fall back to 'live'", () => {
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = 'Mock';
        expect(getCheckoutApiMode()).toBe('live');
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = 'MOCK';
        expect(getCheckoutApiMode()).toBe('live');
    });

    it("returns 'live' for the explicit value 'live'", () => {
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = 'live';
        expect(getCheckoutApiMode()).toBe('live');
    });

    it("returns 'live' for any typo or unknown value", () => {
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = 'mockk';
        expect(getCheckoutApiMode()).toBe('live');
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = 'sandbox';
        expect(getCheckoutApiMode()).toBe('live');
    });
});

describe("isCheckoutUiEnabled — exact 'true' only", () => {
    it("returns true only for the exact string 'true'", () => {
        process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED = 'true';
        expect(isCheckoutUiEnabled()).toBe(true);
    });

    it('returns false when unset', () => {
        delete process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED;
        expect(isCheckoutUiEnabled()).toBe(false);
    });

    it("returns false for 'TRUE' / 'True' (no case folding)", () => {
        process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED = 'TRUE';
        expect(isCheckoutUiEnabled()).toBe(false);
        process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED = 'True';
        expect(isCheckoutUiEnabled()).toBe(false);
    });

    it("returns false for '1', 'yes', 'false' and blank", () => {
        process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED = '1';
        expect(isCheckoutUiEnabled()).toBe(false);
        process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED = 'yes';
        expect(isCheckoutUiEnabled()).toBe(false);
        process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED = 'false';
        expect(isCheckoutUiEnabled()).toBe(false);
        process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED = '';
        expect(isCheckoutUiEnabled()).toBe(false);
    });

    it("returns false for ' true ' — exact match means no trim either", () => {
        process.env.NEXT_PUBLIC_CHECKOUT_UI_ENABLED = ' true ';
        expect(isCheckoutUiEnabled()).toBe(false);
    });
});
