/**
 * The VAT rate and the company's legal name each have exactly one home.
 *
 * Operator, 2026-09-05: "เราใช้ hardcode ให้น้อยที่สุดถึงไม่ใช้เลย."
 *
 * Three copies of 7% were in play:
 *   config/business-rules.js  FEES.VAT_RATE          — the tariff, and the SSOT
 *   config/invoice-issuers.js PLATFORM_ISSUER.vatRate — typed again
 *   services/checkout/checkout-settlement-service.js — typed a third time, INTO
 *                                                      the tax invoice payload
 *
 * and two copies of the company's registered name:
 *   config/invoice-issuers.js PLATFORM_ISSUER.legalNameTH (env-overridable)
 *   services/checkout/checkout-settlement-service.js PLATFORM_LEGAL_NAME_TH
 *
 * The third VAT copy is the one that matters: it is printed on the document the
 * customer keeps, so an environment that overrode the rate would charge one
 * number and print another. The second company-name copy ignores
 * PLATFORM_COMPANY_NAME_TH entirely — an operator setting it would still see the
 * default on every settlement receipt, with no error to explain why.
 *
 * These are the same class as the fee table `fee-single-source` already guards,
 * one field over.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
    .split('\n')
    // Declarations, not mentions — a comment that explains the rate is not a
    // second rate, and punishing it teaches people to delete the explanation.
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

describe('7% is written down once', () => {
    test('the tariff owns it', () => {
        const { FEES } = require('../../config/business-rules');
        expect(FEES.VAT_RATE).toBe(0.07);
    });

    test('the issuer config DERIVES it — it does not re-type it', () => {
        const { FEES } = require('../../config/business-rules');
        const { PLATFORM_ISSUER } = require('../../config/invoice-issuers');
        expect(PLATFORM_ISSUER.vatRate).toBe(FEES.VAT_RATE);
        expect(read('config/invoice-issuers.js')).not.toMatch(/vatRate:\s*0\.07/);
    });

    test('the settlement document reads the rate rather than printing a literal', () => {
        expect(read('services/checkout/checkout-settlement-service.js')).not.toMatch(/rate:\s*0\.07/);
    });

    test('a raised rate reaches the document — the point of all of the above', () => {
        jest.isolateModules(() => {
            const REAL = jest.requireActual('../../config/business-rules');
            jest.doMock('../../config/business-rules', () => ({
                ...REAL,
                FEES: { ...REAL.FEES, VAT_RATE: 0.1 },
            }));
            // eslint-disable-next-line global-require
            const { buildSettlementDocumentPayload } = require('../../services/checkout/checkout-settlement-service');
            const { taxInvoice } = buildSettlementDocumentPayload({
                id: 'co-1',
                applicationId: 'app-1',
                platformFeeNet: 5500,
                platformFeeVat: 550,
                totalPayableAmount: 6050,
            }, { company: 'TAX-PRD-2569-0001' }, new Date('2026-09-05T00:00:00.000Z'));
            expect(taxInvoice.vat.rate).toBe(0.1);
        });
    });
});

describe('the company is named once', () => {
    test('the settlement document uses the issuer config, not its own copy', () => {
        expect(read('services/checkout/checkout-settlement-service.js')).not.toContain('พรีดิกทีฟ');
    });

    test('an operator who sets PLATFORM_COMPANY_NAME_TH sees it on the receipt', () => {
        const saved = process.env.PLATFORM_COMPANY_NAME_TH;
        process.env.PLATFORM_COMPANY_NAME_TH = 'บริษัท ทดสอบชื่อ จำกัด';
        try {
            jest.isolateModules(() => {
                // eslint-disable-next-line global-require
                const { buildSettlementDocumentPayload } = require('../../services/checkout/checkout-settlement-service');
                const { taxInvoice } = buildSettlementDocumentPayload({
                    id: 'co-1', applicationId: 'app-1',
                    platformFeeNet: 5500,
                    platformFeeVat: 385, totalPayableAmount: 5885,
                }, { company: 'TAX-PRD-2569-0001' }, new Date('2026-09-05T00:00:00.000Z'));
                expect(taxInvoice.issuerName).toBe('บริษัท ทดสอบชื่อ จำกัด');
            });
        } finally {
            if (saved === undefined) { delete process.env.PLATFORM_COMPANY_NAME_TH; } else { process.env.PLATFORM_COMPANY_NAME_TH = saved; }
        }
    });
});
