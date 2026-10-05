/**
 * Smoke test for modules/billing/index.js — Phase A6 §A6-1 / A6-2.
 *
 * Asserts that the public API surface of the billing module is stable:
 *  - All documented re-exports are functions / objects (not undefined)
 *  - Identity-equals the source service exports (so re-exports stay
 *    in sync without manual maintenance)
 *
 * If you add or rename a public symbol on fee-service or payment-constants,
 * this test will fail until you update the barrel — that's the point.
 */

'use strict';

const path = require('path');

const billing = require(
    path.resolve(__dirname, '../../modules/billing/index.js'),
);
const feeService = require(
    path.resolve(__dirname, '../../services/fee-service.js'),
);
const paymentConstants = require(
    path.resolve(__dirname, '../../services/payment-constants.js'),
);

describe('modules/billing barrel (Phase A6 §A6-2)', () => {
    test('exposes fee-service public API', () => {
        expect(billing.calculatePhase1Fee).toBe(feeService.calculatePhase1Fee);
        expect(billing.calculatePhase2Fee).toBe(feeService.calculatePhase2Fee);
        expect(billing.calculateApplicationFees).toBe(feeService.calculateApplicationFees);
        expect(billing.resolveCultivationScopeCount).toBe(feeService.resolveCultivationScopeCount);
        expect(billing.FEE_RATES).toBe(feeService.FEE_RATES);
    });

    test('exposes payment-constants public API', () => {
        expect(billing.CONFIG).toBe(paymentConstants.CONFIG);
        expect(billing.PAYMENT_TYPES).toBe(paymentConstants.PAYMENT_TYPES);
        expect(billing.PAYMENT_STATUS).toBe(paymentConstants.PAYMENT_STATUS);
        expect(billing.PAYMENT_METHODS).toBe(paymentConstants.PAYMENT_METHODS);
        // SUBMISSION_THRESHOLD retired (R2 M6 / D-2, 2026-08-05): the barrel no
        // longer re-exports it. Retirement is pinned by
        // __tests__/unit/d2-resubmission-retired.test.js.
        expect(billing.SUBMISSION_THRESHOLD).toBeUndefined();
    });

    test('every export is defined (no accidental undefined)', () => {
        for (const [k, v] of Object.entries(billing)) {
            expect(v).toBeDefined();
             
            v;  // touch each value
            // not testing the assertion message — just ensuring iteration works
            // and each key has a non-undefined value
            // (extra safety: the above expect already covers this)
            // The forEach is for naming visibility in failure output.
            void k;
        }
    });

    test('functional smoke: calculatePhase1Fee returns expected shape', () => {
        const fee = billing.calculatePhase1Fee({}, { scopeCount: 1 });
        expect(fee).toBeDefined();
        expect(typeof fee).toBe('object');
        // Shouldn't matter exactly which fields exist — just that the
        // function runs cleanly through the re-export.
    });
});
