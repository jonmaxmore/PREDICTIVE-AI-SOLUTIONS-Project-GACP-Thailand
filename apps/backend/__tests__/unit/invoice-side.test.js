/**
 * Bug 6.2 — canonical money-flow side classifier.
 *
 * Before this fix TWO reporting classifiers disagreed on the money-flow side
 * of the legacy `APPLICATION_FEE` / `AUDIT_FEE` serviceTypes:
 *   - split-payment-calculator.classifyRevenueType → GOV (state)
 *   - customer-statement / daily-cash / bank-reconciliation
 *     .classifyServiceType → PLATFORM
 * and invoiceSideWhere keyed only on `endsWith('_STATE_FEE')`, missing the
 * legacy state types entirely.
 *
 * Decision: legacy APPLICATION_FEE / AUDIT_FEE = STATE/DTAM (they are the
 * pre-split state fees). This suite pins ONE canonical helper and asserts
 * every consumer agrees.
 */

'use strict';

// prisma-database is dragged in transitively by some consumers (invoice-helpers);
// stub it so the module graph loads without DATABASE_URL.
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

describe('Bug 6.2 — canonical classifyInvoiceSide', () => {
    const { classifyInvoiceSide, INVOICE_SIDES } = require('../../services/finance/invoice-side');

    test('legacy APPLICATION_FEE → STATE', () => {
        expect(classifyInvoiceSide('APPLICATION_FEE')).toBe('STATE');
    });

    test('legacy AUDIT_FEE (+ aliases) → STATE', () => {
        expect(classifyInvoiceSide('AUDIT_FEE')).toBe('STATE');
        expect(classifyInvoiceSide('PHASE_2_AUDIT')).toBe('STATE');
        expect(classifyInvoiceSide('PHASE2_AUDIT')).toBe('STATE');
    });

    test('canonical _STATE_FEE types → STATE', () => {
        expect(classifyInvoiceSide('PHASE_1_STATE_FEE')).toBe('STATE');
        expect(classifyInvoiceSide('PHASE_2_STATE_FEE')).toBe('STATE');
    });

    test('platform fees → PLATFORM', () => {
        expect(classifyInvoiceSide('PHASE_1_PLATFORM_FEE')).toBe('PLATFORM');
        expect(classifyInvoiceSide('PHASE_2_PLATFORM_FEE')).toBe('PLATFORM');
    });

    test('subscription → PLATFORM', () => {
        expect(classifyInvoiceSide('SUBSCRIPTION')).toBe('PLATFORM');
        expect(classifyInvoiceSide('SUBSCRIPTION_PRO')).toBe('PLATFORM');
    });

    test('exposes STATE / PLATFORM side constants', () => {
        expect(INVOICE_SIDES.STATE).toBe('STATE');
        expect(INVOICE_SIDES.PLATFORM).toBe('PLATFORM');
    });
});

describe('Bug 6.2 — all consumers agree legacy APPLICATION_FEE = STATE side', () => {
    test('split-payment-calculator.classifyRevenueType → GOV (state)', () => {
        const { classifyRevenueType, REVENUE_TYPE } = require('../../services/split-payment-calculator');
        expect(classifyRevenueType('APPLICATION_FEE')).toBe(REVENUE_TYPE.GOV);
        expect(classifyRevenueType('AUDIT_FEE')).toBe(REVENUE_TYPE.GOV);
        // sanity: platform + subscription stay PLATFORM
        expect(classifyRevenueType('PHASE_1_PLATFORM_FEE')).toBe(REVENUE_TYPE.PLATFORM);
        expect(classifyRevenueType('SUBSCRIPTION')).toBe(REVENUE_TYPE.PLATFORM);
    });

    test('customer-statement-service.classifyServiceType → DTAM (state)', () => {
        const svc = require('../../services/customer-statement-service');
        const { classifyServiceType } = svc._internals;
        expect(classifyServiceType('APPLICATION_FEE')).toBe(svc.BOOK_SIDES.DTAM);
        expect(classifyServiceType('AUDIT_FEE')).toBe(svc.BOOK_SIDES.DTAM);
        expect(classifyServiceType('PHASE_1_STATE_FEE')).toBe(svc.BOOK_SIDES.DTAM);
        expect(classifyServiceType('PHASE_1_PLATFORM_FEE')).toBe(svc.BOOK_SIDES.PLATFORM);
        expect(classifyServiceType('SUBSCRIPTION')).toBe(svc.BOOK_SIDES.PLATFORM);
    });

    

    

    test('invoice-side.classifyIssuerSide → DTAM (state)', () => {
        // The issuer-side classifier moved here from payment-slip-service when the
        // slip subsystem was removed (spine commit d5350740). Same DTAM/PLATFORM map.
        const { classifyIssuerSide } = require('../../services/finance/invoice-side');
        expect(classifyIssuerSide('APPLICATION_FEE')).toBe('DTAM');
        expect(classifyIssuerSide('AUDIT_FEE')).toBe('DTAM');
        expect(classifyIssuerSide('PHASE_1_STATE_FEE')).toBe('DTAM');
        expect(classifyIssuerSide('PHASE_1_PLATFORM_FEE')).toBe('PLATFORM');
        expect(classifyIssuerSide('SUBSCRIPTION')).toBe('PLATFORM');
    });
});
