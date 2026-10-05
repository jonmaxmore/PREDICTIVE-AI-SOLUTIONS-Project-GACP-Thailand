/**
 * A fee.* SystemConfig override reaches the fee engine and the public price
 * route (fix/fees-from-server round 2, 2026-10-03).
 *
 * The facts this suite was written to establish:
 *   - config/business-rules.js loadFeesFromSystemConfig MUTATES the exported
 *     FEES object in place (`FEES[feeKey] = numVal`), it does not replace it.
 *   - modules/billing/internal/fee-service.js used to copy FEES into its own
 *     FEE_RATES object and VAT_RATE constant when the module loaded. server.js
 *     requires routes/api (and so the billing module) at line 92, long before
 *     any database work, so an override applied by the loader afterwards would
 *     have changed FEES and nothing that bills or quotes.
 *   - (separate finding, reported, not changed here) nothing in the backend
 *     calls loadFeesFromSystemConfig at all — see green.txt round 2.
 *
 * The module graph is loaded in server.js order — the API router first, then
 * the override — and the override goes through the real loader with a fake
 * prisma that answers one fee.* row. Rates must be read at call time from the
 * single FEES source. No formula, rounding or VAT rule is under test.
 */

'use strict';

jest.mock('../../services/system-config-service', () => ({
    getValue: jest.fn().mockResolvedValue(null),
}));

const express = require('express');
const request = require('supertest');

// The billing module and the pricing route load first, as they do when
// server.js requires routes/api at boot (server.js:92).
require('../../routes/api/finance/pricing');
const billing = require('../../modules/billing');
const { FEES, loadFeesFromSystemConfig } = require('../../config/business-rules');
// Round 3: the other two places that held a load-time copy, and consumers of them.
const { PAYMENT_FEES, computePhaseBreakdown } = require('../../config/payment-fees');
const { PLATFORM_ISSUER, PLATFORM_BANK_ACCOUNT } = require('../../config/invoice-issuers');
const { calculateRevenueSplit } = require('../../services/split-payment-calculator');

const ORIGINAL = { ...FEES };

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/pricing', require('../../routes/api/finance/pricing'));
    return app;
}

function fakePrisma(rows) {
    return { systemConfig: { findMany: async () => rows } };
}

afterEach(() => {
    Object.assign(FEES, ORIGINAL);
});

describe('fee.* overrides applied after boot', () => {
    test('the loader mutates the FEES object in place', async () => {
        const before = FEES;
        await loadFeesFromSystemConfig(fakePrisma([{ key: 'fee.renewal_per_scope', value: '40000' }]));
        expect(FEES).toBe(before);
        expect(FEES.RENEWAL_PER_SCOPE).toBe(40000);
    });

    test('calculateRenewalFee bills the overridden renewal fee', async () => {
        await loadFeesFromSystemConfig(fakePrisma([{ key: 'fee.renewal_per_scope', value: '40000' }]));
        const fee = billing.calculateRenewalFee({}, { scopeCount: 1 });
        expect(fee.serviceFeeAmount).toBe(40000);
        expect(fee.phaseTotal).toBe(40000 + Math.round(40000 * FEES.VAT_RATE));
    });

    test('GET /api/pricing/fees quotes the overridden renewal fee', async () => {
        await loadFeesFromSystemConfig(fakePrisma([{ key: 'fee.renewal_per_scope', value: '40000' }]));
        const res = await request(buildApp()).get('/api/pricing/fees');
        expect(res.status).toBe(200);
        expect(res.body.data.renewalFee).toBe(40000);
        expect(res.body.data.renewalTotalPerScope).toBe(billing.calculateRenewalFee({}, { scopeCount: 1 }).phaseTotal);
    });

    test('phase fees and the VAT rate follow their overrides too, on the engine and the route', async () => {
        await loadFeesFromSystemConfig(fakePrisma([
            { key: 'fee.phase1_per_scope', value: '6000' },
            { key: 'fee.phase2_per_scope', value: '30000' },
            { key: 'fee.vat_rate', value: '0.1' },
        ]));
        expect(billing.FEE_RATES.PHASE1_PER_SCOPE).toBe(6000);
        expect(billing.VAT_RATE).toBe(0.1);
        expect(billing.calculatePhase1Fee({}, { scopeCount: 1 }).phaseTotal).toBe(6600);
        expect(billing.calculatePhase2Fee({}, { scopeCount: 1 }).phaseTotal).toBe(33000);
        const res = await request(buildApp()).get('/api/pricing/fees');
        expect(res.body.data.applicationFee).toBe(6000);
        expect(res.body.data.inspectionFee).toBe(30000);
        expect(res.body.data.phase1TotalPerScope).toBe(6600);
        expect(res.body.data.vatRate).toBe(0.1);
    });

    test('with no override the engine still bills the defaults', () => {
        expect(billing.calculateRenewalFee({}, { scopeCount: 1 }).serviceFeeAmount).toBe(ORIGINAL.RENEWAL_PER_SCOPE);
    });
});

describe('round 3 — the other fee consumers read FEES at call time too', () => {
    const OVERRIDES = [
        { key: 'fee.phase1_per_scope', value: '6000' },
        { key: 'fee.phase2_per_scope', value: '30000' },
        { key: 'fee.vat_rate', value: '0.1' },
    ];

    test('config/payment-fees.js PAYMENT_FEES (accounting, journal, split, export)', async () => {
        await loadFeesFromSystemConfig(fakePrisma(OVERRIDES));
        expect(PAYMENT_FEES.VAT_RATE).toBe(0.1);
        expect(PAYMENT_FEES.DOCUMENT_REVIEW_FEE).toBe(6000);
        expect(PAYMENT_FEES.FIELD_AUDIT_FEE).toBe(30000);
        expect(PAYMENT_FEES.PHASE_1_SERVICE_FEE).toBe(6000);
        expect(PAYMENT_FEES.PHASE_1_VAT).toBe(600);
        expect(PAYMENT_FEES.PHASE_1_TOTAL).toBe(6600);
        expect(PAYMENT_FEES.PHASE_2_TOTAL).toBe(33000);
        expect(PAYMENT_FEES.RE_SUBMISSION_FEE).toBe(6000);
        expect(PAYMENT_FEES.TOTAL_STANDARD_FEE).toBe(39600);
    });

    test('computePhaseBreakdown bills the overridden phase', async () => {
        await loadFeesFromSystemConfig(fakePrisma(OVERRIDES));
        const p1 = computePhaseBreakdown(1);
        expect([p1.serviceFee, p1.vat, p1.total]).toEqual([6000, 600, 6600]);
        expect(p1.lineItems.map((l) => l.amount)).toEqual([6000, 600]);
    });

    test('config/invoice-issuers.js PLATFORM_ISSUER and PLATFORM_BANK_ACCOUNT carry the overridden VAT rate', async () => {
        await loadFeesFromSystemConfig(fakePrisma(OVERRIDES));
        expect(PLATFORM_ISSUER.vatRate).toBe(0.1);
        expect(PLATFORM_BANK_ACCOUNT.vatRate).toBe(0.1);
        // still frozen: an override goes through FEES, never through the issuer object
        expect(Object.isFrozen(PLATFORM_ISSUER)).toBe(true);
        expect(Object.isFrozen(PLATFORM_BANK_ACCOUNT)).toBe(true);
    });

    test('the split calculator extracts VAT at the overridden rate', async () => {
        await loadFeesFromSystemConfig(fakePrisma(OVERRIDES));
        const split = calculateRevenueSplit([{ serviceType: 'PHASE_1_PLATFORM_FEE', totalAmount: 110, status: 'PAID' }]);
        expect(split.vatCollected).toBe(10);
    });

    test('with no override every consumer reads the defaults', () => {
        expect(PAYMENT_FEES.VAT_RATE).toBe(ORIGINAL.VAT_RATE);
        expect(PAYMENT_FEES.PHASE_1_SERVICE_FEE).toBe(ORIGINAL.PHASE1_PER_SCOPE);
        expect(PLATFORM_ISSUER.vatRate).toBe(ORIGINAL.VAT_RATE);
    });
});
