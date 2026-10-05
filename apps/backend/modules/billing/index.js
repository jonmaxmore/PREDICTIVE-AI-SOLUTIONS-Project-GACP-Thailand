/**
 * @module modules/billing
 *
 * Phase A6 §A6-1 / A6-2 — billing-domain public API.
 *
 * 2026-04-29 update: fee-service + payment-constants have been physically
 * moved into ./internal/. The barrel now imports from there directly.
 *
 * Consumers should `require('../modules/billing')` and pick exports.
 * Existing consumers importing the legacy `services/fee-service` or
 * `services/payment-constants` paths continue to work via the thin
 * re-export shims kept at those paths — those shims will be deleted
 * once consumer-side migration is complete.
 *
 * Anything NOT re-exported here is private to the module and protected
 * by the `gacp/no-cross-module-internal` ESLint rule.
 */

'use strict';

const feeService = require('./internal/fee-service');
const paymentConstants = require('./internal/payment-constants');

module.exports = {
    // ── Fee calculation ──
    FEE_RATES: feeService.FEE_RATES,
    // A getter: the rate is read when asked, so a fee.vat_rate override applied
    // after this module loaded is seen (fix/fees-from-server round 2).
    get VAT_RATE() {
        return feeService.VAT_RATE;
    },
    resolveCultivationScopeCount: feeService.resolveCultivationScopeCount,
    collectUniqueCultivationMethods: feeService.collectUniqueCultivationMethods,
    calculatePhase1Fee: feeService.calculatePhase1Fee,
    calculatePhase2Fee: feeService.calculatePhase2Fee,
    // W12 — the renewal's single charge, grossed up by the same buildPhaseFee
    // the phase fees use. Public so the pricing route and quotation-service
    // read ONE function instead of each doing its own arithmetic.
    calculateRenewalFee: feeService.calculateRenewalFee,
    calculateApplicationFees: feeService.calculateApplicationFees,

    // ── Payment constants ──
    CONFIG: paymentConstants.CONFIG,
    PAYMENT_TYPES: paymentConstants.PAYMENT_TYPES,
    PAYMENT_STATUS: paymentConstants.PAYMENT_STATUS,
    PAYMENT_METHODS: paymentConstants.PAYMENT_METHODS,
};
