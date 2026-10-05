'use strict';

/**
 * P2 (staging walk 2026-09-29): a one-line invoice printed on TWO pages — page 1
 * said "หน้า 1 / 1" and page 2 held nothing but the footer line. The receipt and
 * the tax invoice spilled the same way (measured before this fix: 2 pages each
 * for the fixture below, which is the walk's real invoice shape — one checkout
 * line, a company payer with a tax id and an address).
 *
 * This renders the REAL PDF through the real Puppeteer path (not htmlOnly) and
 * counts page objects in the file. Chromium writes each page as an uncompressed
 * `/Type /Page` object, so the count is exact for these documents.
 *
 * Since 2026-09-29 the receipt and the tax invoice are one paper
 * (receipt-tax-invoice.html); its company buyer block comes from
 * utils/applicant-resolver.js.
 */

const tpl = require('../../services/pdf/invoice-template-service');
const pdfGenerator = require('../../services/pdf/pdf-generator.service');

jest.setTimeout(120000);

const COMPANY_TAX_ID = '0105561234560'; // checksum-valid fixture used across this repo
const COMPANY_NAME = 'บริษัท ทดสอบพร้อมเพย์สเตจจิ้ง จำกัด';

function oneLinePaidCompanyInvoice() {
    return {
        id: 'inv-one-page',
        invoiceNumber: 'INV-CO-09246C23-M1',
        serviceType: 'CERTIFICATION_CHECKOUT_M1',
        totalAmount: 5885,
        subtotal: 5500,
        vat: 385,
        status: 'RECEIPT_ISSUED',
        receiptNumber: 'TAX-PRD-2026-000002',
        receiptIssuedAt: new Date('2026-09-29T08:14:45Z'),
        paidAt: new Date('2026-09-29T08:14:45Z'),
        createdAt: new Date('2026-09-29T08:13:00Z'),
        dueDate: new Date('2026-10-08T00:00:00Z'),
        paymentMethod: 'PromptPay',
        lineItems: [{ lineNumber: 1, description: 'ค่าบริการ GACP', quantity: 1, unitPrice: 5500, amount: 5500 }],
        application: {
            applicationNumber: 'APP-2569-MUJZRHP3-69A796',
            cultivationScopeCount: 1,
            formData: {
                plantName: 'ขิง',
                farmName: 'แปลงทดสอบขิง วอล์ค 863400fc',
                applicantData: {
                    address: '99 หมู่ 1 ตำบลทดสอบ', district: 'อำเภอเมืองนนทบุรี',
                    province: 'จังหวัดนนทบุรี', postalCode: '11000',
                },
            },
            entity: { id: 'entity-co', type: 'JURISTIC', displayName: COMPANY_NAME, juristicId: COMPANY_TAX_ID },
        },
        applicant: {},
    };
}

function pageCount(pdf) {
    return (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

afterAll(async () => {
    const instance = pdfGenerator.default || pdfGenerator;
    if (instance.browser) { await instance.browser.close(); instance.browser = null; }
});

describe('P2 — a one-line document fits one A4 page', () => {
    it.each([
        ['invoice (ใบวางบิล / ใบแจ้งหนี้)', 'generateInvoicePdf'],
        ['receipt / tax invoice (ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป)', 'generateReceiptTaxInvoicePdf'],
    ])('%s renders as exactly one page', async (_label, fn) => {
        const pdf = await tpl[fn](oneLinePaidCompanyInvoice(), { upload: false });
        expect(Buffer.isBuffer(pdf)).toBe(true);
        expect(pageCount(pdf)).toBe(1);
    });

    it.each([
        ['invoice.html', 'generateInvoicePdf', 'เอกสารเลขที่ INV-CO-09246C23-M1'],
        ['receipt-tax-invoice.html', 'generateReceiptTaxInvoicePdf', 'ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป เลขที่ TAX-PRD-2026-000002'],
    ])('%s still prints its footer reference line (the fit is not bought by dropping it)', async (_file, fn, line) => {
        const html = await tpl[fn](oneLinePaidCompanyInvoice(), { upload: false, htmlOnly: true });
        expect(html).toContain(line);
    });
});

describe('the receipt / tax invoice prints the company buyer block', () => {
    let paper;
    beforeAll(async () => {
        paper = await tpl.generateReceiptTaxInvoicePdf(oneLinePaidCompanyInvoice(), { upload: false, htmlOnly: true });
    });

    it('company name label and name', () => {
        expect(paper).toContain('ชื่อบริษัท / Company Name');
        expect(paper).toContain(COMPANY_NAME);
    });

    it('the buyer tax id under the tax-id label, grouped 1-4-5-2-1', () => {
        expect(paper).toContain('เลขประจำตัวผู้เสียภาษี / Tax ID');
        expect(paper).toContain('0-1055-61234-56-0');
    });

    it('the address', () => {
        expect(paper).toContain('99 หมู่ 1 ตำบลทดสอบ อำเภอเมืองนนทบุรี จังหวัดนนทบุรี 11000');
    });

    it('the receipt number and never the invoice title', () => {
        expect(paper).toContain('TAX-PRD-2026-000002');
        expect(paper).not.toContain('ใบวางบิล');
    });
});
