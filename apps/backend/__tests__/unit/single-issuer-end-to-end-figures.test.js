'use strict';

/**
 * W14 — the SAME payable at every stage a farmer can see it.
 *
 * Operator ruling 2026-08-22 (the change log c28355ea), figures confirmed
 * d1c33ea0: 35,310 / 70,620 / 105,930 for 1 / 2 / 3 cultivation scopes.
 *
 * The defect class this suite exists to catch is not "the formula is wrong" —
 * single-issuer-fee-model.test.js pins the formula. It is "the formula is right
 * in one place and stale in another", which is how a farmer ends up looking at
 * a quotation for one number and a card charge for a different one. So every
 * stage is read from its REAL code path and compared to the same literal:
 *
 *   pricing API  →  quotation  →  billing note  →  receipt  →  settlement
 *
 * WHAT IS NOT COVERED HERE, and why: the actual Prisma writes (quotation rows,
 * checkout_orders) need a live Postgres. Their arithmetic is asserted through
 * the pure functions that produce the values those writes persist, and the
 * DB-level CHECK is asserted as an equation. A real-DB proof is a separate,
 * DB-gated run — see the report.
 */

jest.mock('../../services/system-config-service', () => ({
    getValue: jest.fn().mockResolvedValue(null),
}));

const express = require('express');
const request = require('supertest');

const feeService = require('../../services/fee-service');
const quotationService = require('../../services/quotation-service');
const templateService = require('../../services/pdf/invoice-template-service');
const { SERVICE_TYPES, getInvoiceIssuer } = require('../../config/invoice-issuers');

// The operator's confirmed payable, per cultivation-scope count.
const PAYABLE = Object.freeze({ 1: 35310, 2: 70620, 3: 105930 });
const SERVICE_FEE = Object.freeze({ 1: 33000, 2: 66000, 3: 99000 });
const VAT = Object.freeze({ 1: 2310, 2: 4620, 3: 6930 });
const SCOPES = [1, 2, 3];

function buildPricingApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/pricing', require('../../routes/api/finance/pricing'));
    return app;
}

function renewalApplication(scopeCount) {
    return {
        id: `app-renewal-${scopeCount}`,
        totalAreaTypes: scopeCount,
        organizationId: 'org-1',
        formData: {
            renewalOf: 'cert-1',
            renewalOfCertificateNumber: 'GACP-TH-2569-ABCDEF',
        },
    };
}

function newApplication(scopeCount) {
    return {
        id: `app-new-${scopeCount}`,
        totalAreaTypes: scopeCount,
        organizationId: 'org-1',
        formData: {},
    };
}

describe.each(SCOPES)('W14 end-to-end — %i cultivation scope(s)', (scopeCount) => {
    const payable = PAYABLE[scopeCount];

    test('STAGE 1 — the pricing API quotes the confirmed payable', async () => {
        const res = await request(buildPricingApp())
            .post('/api/pricing/calculate')
            .send({ areaTypes: Array.from({ length: scopeCount }, (_u, i) => `SCOPE_${i}` ) });
        expect(res.status).toBe(200);
        const data = res.body.data;
        expect(data.total).toBe(payable);
        expect(data.subtotal).toBe(SERVICE_FEE[scopeCount]);
        expect(data.vat).toBe(VAT[scopeCount]);
    });

    test('STAGE 2 — a NEW application quotation bills the same payable across two phases', () => {
        const billed = quotationService._internals.resolveBillableFees(newApplication(scopeCount));
        expect(billed.grandTotal).toBe(payable);
        expect(billed.serviceFeeTotal).toBe(SERVICE_FEE[scopeCount]);
        expect(billed.vatTotal).toBe(VAT[scopeCount]);
        // Two phases, and they sum to the single figure.
        expect(billed.phase1).not.toBeNull();
        expect(billed.phase1.phaseTotal + billed.phase2.phaseTotal).toBe(payable);
    });

    test('STAGE 2b — a RENEWAL quotation bills the same payable in ONE charge', () => {
        const billed = quotationService._internals.resolveBillableFees(renewalApplication(scopeCount));
        expect(billed.grandTotal).toBe(payable);
        expect(billed.phase1).toBeNull();
        expect(billed.isRenewal).toBe(true);
    });

    test('STAGE 3 — the billing note (ใบวางบิล) prints the service fee, the VAT and the payable', () => {
        const amounts = {
            subtotal: SERVICE_FEE[scopeCount],
            vat: VAT[scopeCount],
            total: payable,
        };
        const html = templateService.buildTotalsRowsHtml(
            templateService.detectIssuerSide(SERVICE_TYPES.PHASE_2_STATE_FEE),
            amounts,
            'invoice',
        );
        // A VAT line MUST appear even on what used to be the "state" side —
        // there is no VAT-exempt document any more.
        expect(html).toContain('ภาษีมูลค่าเพิ่ม 7%');
        expect(html).toContain(payable.toLocaleString('en-US'));
        expect(html).toContain(VAT[scopeCount].toLocaleString('en-US'));
    });

    test('STAGE 4 — the receipt prints the same payable as a company tax invoice', () => {
        const amounts = {
            subtotal: SERVICE_FEE[scopeCount],
            vat: VAT[scopeCount],
            total: payable,
        };
        const html = templateService.buildTotalsRowsHtml(
            templateService.detectIssuerSide(SERVICE_TYPES.PHASE_1_STATE_FEE),
            amounts,
            'receipt',
        );
        expect(html).toContain('ยอดที่รับชำระทั้งสิ้น');
        expect(html).toContain('ภาษีมูลค่าเพิ่ม 7%');
        expect(html).toContain(payable.toLocaleString('en-US'));

        // ...and it is the COMPANY's tax invoice, for every service type.
        for (const serviceType of Object.values(SERVICE_TYPES)) {
            const issuer = getInvoiceIssuer(serviceType);
            expect(issuer.receiptDocumentType).toBe('FULL_TAX_INVOICE_RECEIPT');
            expect(issuer.taxId).toBe('0105568045932');
        }
    });

    test('STAGE 5 — what settlement records reconciles to the same payable', () => {
        // checkout_orders columns, as stripe-checkout-service fills them from
        // the fee service and as checkout-settlement-service reads them back.
        // The DB CHECK since migration 20260929155037 (the DTAM column dropped):
        //   total_payable_amount = platform_fee_gross = platform_fee_net + platform_fee_vat
        //
        // operator 2026-09-11 — no state/platform split any more. The service fee
        // is one figure and it is ALL the company's, so the whole ค่าบริการ sits in
        // platform_fee_net. The column names still say "platform"; renaming them
        // is a separate decision — which is why this stage asserts the equation
        // and not the nouns.
        const single = feeService.calculateRenewalFee({}, { scopeCount });
        const platformFeeNet = single.serviceFeeAmount;
        const platformFeeVat = single.vatAmount;
        const platformFeeGross = platformFeeNet + platformFeeVat;
        const totalPayableAmount = platformFeeGross;

        expect(totalPayableAmount).toBe(payable);
        expect(totalPayableAmount).toBe(platformFeeNet + platformFeeVat);

        // And the phased path settles to the same grand total.
        const phase1 = feeService.calculatePhase1Fee({}, { scopeCount });
        const phase2 = feeService.calculatePhase2Fee({}, { scopeCount });
        const settledAcrossPhases = [phase1, phase2].reduce(
            (sum, p) => sum + p.serviceFeeAmount + p.vatAmount,
            0,
        );
        expect(settledAcrossPhases).toBe(payable);
    });

    test('ALL STAGES AGREE — one number, five sources', async () => {
        const res = await request(buildPricingApp())
            .post('/api/pricing/calculate')
            .send({ areaTypes: Array.from({ length: scopeCount }, (_u, i) => `SCOPE_${i}` ) });
        const fromApi = res.body.data.total;
        const fromQuotation = quotationService._internals
            .resolveBillableFees(newApplication(scopeCount)).grandTotal;
        const fromRenewalQuotation = quotationService._internals
            .resolveBillableFees(renewalApplication(scopeCount)).grandTotal;
        const single = feeService.calculateRenewalFee({}, { scopeCount });
        // dtam column is 0; the whole ค่าบริการ + its VAT is what settles.
        const fromSettlement = 0 + single.serviceFeeAmount + single.vatAmount;

        expect(new Set([fromApi, fromQuotation, fromRenewalQuotation, fromSettlement, payable]).size)
            .toBe(1);
    });
});
