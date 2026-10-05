'use strict';

/**
 * Security review fix round 3 (2026-09-27) — the JURISTIC payer tax-id guard
 * added in round 2 (`isPrintableJuristicTaxId`, invoice-template-service.js)
 * was shape-only (`/^\d{13}$/`), which wrongly printed two classes of bad
 * input:
 *
 *   1. a checksum-INVALID 13-digit string (a typo or corrupted value) —
 *      `0105561234561` fails the DOPA mod-11 checksum
 *      (packages/validation/src/thai-id-checksum.js) but still matched the
 *      shape-only regex.
 *   2. a person's OWN national ID reaching the JURISTIC print path — a
 *      personal ID is ALSO exactly 13 digits, so `1100000000008` (a
 *      checksum-VALID synthetic individual fixture reused across this
 *      codebase's own unit suites) also matched, even under
 *      `applicantType: 'JURISTIC'`.
 *
 * Unit-level (no DB): these three template functions accept a plain
 * `invoice`-shaped object with `entity` set directly, resolved by
 * `resolveApplicantInfo` the same way the real Prisma row would be — no
 * PDPA encryption is exercised here, that is the real-DB integration file's
 * job (invoice-tax-id-select.test.js). This file is about the shape/
 * checksum guard logic, which needs no database.
 */

const tpl = require('../../services/pdf/invoice-template-service');

// Checksum-VALID (mod-11), starts with '0' — the shape a real company tax id
// has. Reused verbatim from this codebase's own fixtures
// (applicant-validation.test.js etc.), never a real company's number.
const VALID_JURISTIC_TAX_ID = '0105561234560';

// Same shape (13 digits, starts with '0') but the LAST digit is wrong, so it
// fails the mod-11 checksum — a typo'd or corrupted company tax id.
const INVALID_CHECKSUM_JURISTIC_TAX_ID = '0105561234561';

// Checksum-VALID, but starts with '1' — a real PERSON's national ID shape,
// not a company's. Reused verbatim from this codebase's own fixtures
// (applicant-resolver.test.js etc.), never a real person's number.
const NATIONAL_ID_SHAPED_VALUE = '1100000000008';

function juristicInvoiceFixture(taxId) {
    return {
        id: 'inv-payer-guard',
        invoiceNumber: 'INV-PAYER-GUARD',
        receiptNumber: 'RCT-PAYER-GUARD',
        serviceType: 'PHASE_1_PLATFORM_FEE',
        totalAmount: 535,
        subtotal: 500,
        vat: 35,
        createdAt: new Date('2026-09-27T00:00:00Z'),
        paidAt: new Date('2026-09-27T00:00:00Z'),
        receiptIssuedAt: new Date('2026-09-27T00:00:00Z'),
        entity: {
            id: 'ent-payer-guard',
            type: 'JURISTIC',
            displayName: 'บริษัท ทดสอบ ตัวกรองเลขผู้เสียภาษี จำกัด',
            juristicId: taxId,
        },
    };
}

// The PAYER value span, immediately after the buyer's tax-id label
// ("เลขประจำตัวผู้เสียภาษี / Tax ID"). The seller's own line on the receipt /
// tax invoice reads "เลขประจำตัวผู้เสียภาษีอากร / Tax ID" — the extra "อากร"
// sits inside the string, so this exact, longer match cannot hit the seller.
function extractPayerIdValue(html) {
    const m = html.match(/เลขประจำตัวผู้เสียภาษี \/ Tax ID<\/span><br>\s*<span class="val">([^<]*)<\/span>/);
    return m ? m[1] : null;
}

describe('payer tax-id guard (isPrintableJuristicTaxId) — round 3', () => {
    describe('a checksum-INVALID company id never prints — "-" instead', () => {
        const invoice = juristicInvoiceFixture(INVALID_CHECKSUM_JURISTIC_TAX_ID);

        it('generateInvoicePdf', async () => {
            const html = await tpl.generateInvoicePdf(invoice, { upload: false, htmlOnly: true });
            expect(html).not.toContain(INVALID_CHECKSUM_JURISTIC_TAX_ID);
            expect(extractPayerIdValue(html)).toBe('-');
        });

        it('generateReceiptTaxInvoicePdf', async () => {
            const html = await tpl.generateReceiptTaxInvoicePdf(invoice, { upload: false, htmlOnly: true });
            expect(html).not.toContain(INVALID_CHECKSUM_JURISTIC_TAX_ID);
            expect(extractPayerIdValue(html)).toBe('-');
        });

    });

    describe('a national-ID-shaped value on a JURISTIC payer never prints — "-" instead', () => {
        const invoice = juristicInvoiceFixture(NATIONAL_ID_SHAPED_VALUE);

        it('generateInvoicePdf', async () => {
            const html = await tpl.generateInvoicePdf(invoice, { upload: false, htmlOnly: true });
            expect(html).not.toContain(NATIONAL_ID_SHAPED_VALUE);
            expect(extractPayerIdValue(html)).toBe('-');
        });

        it('generateReceiptTaxInvoicePdf', async () => {
            const html = await tpl.generateReceiptTaxInvoicePdf(invoice, { upload: false, htmlOnly: true });
            expect(html).not.toContain(NATIONAL_ID_SHAPED_VALUE);
            expect(extractPayerIdValue(html)).toBe('-');
        });

    });

    describe('a valid company id still prints (no regression)', () => {
        const invoice = juristicInvoiceFixture(VALID_JURISTIC_TAX_ID);

        it('generateInvoicePdf', async () => {
            const html = await tpl.generateInvoicePdf(invoice, { upload: false, htmlOnly: true });
            expect(extractPayerIdValue(html)).toBe(VALID_JURISTIC_TAX_ID);
        });

        it('generateReceiptTaxInvoicePdf', async () => {
            const html = await tpl.generateReceiptTaxInvoicePdf(invoice, { upload: false, htmlOnly: true });
            // The receipt / tax invoice prints the buyer tax id grouped 1-4-5-2-1,
            // asserted against the LITERAL expected string (never against
            // formatThaiTaxId itself, which would be circular).
            expect(extractPayerIdValue(html)).toBe('0-1055-61234-56-0');
        });

    });
});
