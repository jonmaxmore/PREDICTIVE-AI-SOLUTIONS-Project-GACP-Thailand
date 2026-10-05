'use strict';

/**
 * The signer line on the company's finance papers never prints system language
 * (operator ruling: a document speaks to the customer, never about the system —
 * finance-documents design, "กติกาที่ใช้กับทั้งสามใบ"). With no approver — every
 * paper today — the line used to read "ระบบออกเอกสารอัตโนมัติ". Now the signer
 * block carries the seller company's name only: no "ระบบ…" text, no invented
 * person. Checked on the substituted HTML of every finance template that has a
 * signer line: the receipt / tax invoice, the credit note and the debit note
 * (quotation.html and invoice.html print no approver line).
 */

const fs = require('fs');
const path = require('path');
const tpl = require('../../services/pdf/invoice-template-service');
const pdfGenerator = require('../../services/pdf/pdf-generator.service');

const TEMPLATES = path.join(__dirname, '../../services/pdf/templates');

function signerBlocks(html) {
    const m = html.match(/<div class="signature-block">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
    return m ? m[1] : '';
}

const invoice = {
    id: 'inv-sig', invoiceNumber: 'INV-SIG-1', receiptNumber: 'TAX-PRD-2026-000077',
    serviceType: 'CERTIFICATION_CHECKOUT_M1', totalAmount: 5885, subtotal: 5500, vat: 385,
    status: 'paid', paymentMethod: 'STRIPE', paidAt: new Date('2026-09-29T08:00:00Z'),
    receiptIssuedAt: new Date('2026-09-29T08:00:00Z'), createdAt: new Date('2026-09-29T07:00:00Z'),
    application: { applicationNumber: 'APP-SIG-1', entity: { id: 'e', type: 'JURISTIC', displayName: 'บริษัท ผู้ซื้อ จำกัด', juristicId: '0105561234560' } },
    applicant: {},
};
const note = {
    createdAt: new Date('2026-09-29T09:00:00Z'), subtotal: 100, vat: 7, totalAmount: 107, reason: 'ทดสอบ',
    originalInvoice: { ...invoice, invoiceNumber: 'INV-SIG-1' },
};

describe('no approver: the signer line is the seller company only', () => {
    const cases = [
        ['receipt-tax-invoice.html', async () => tpl.generateReceiptTaxInvoicePdf(invoice, { upload: false, htmlOnly: true })],
        ['credit-note.html', async () => pdfGenerator.replaceTemplateVariables(
            fs.readFileSync(path.join(TEMPLATES, 'credit-note.html'), 'utf8'),
            tpl.buildAdjustmentNoteContext(note, { docNumber: 'CN-PRD-2026-000001', docTypeTh: 'ใบลดหนี้', docTypeEn: 'Credit Note' }),
        )],
        ['debit-note.html', async () => pdfGenerator.replaceTemplateVariables(
            fs.readFileSync(path.join(TEMPLATES, 'debit-note.html'), 'utf8'),
            tpl.buildAdjustmentNoteContext(note, { docNumber: 'DN-PRD-2026-000001', docTypeTh: 'ใบเพิ่มหนี้', docTypeEn: 'Debit Note' }),
        )],
    ];

    it.each(cases)('%s prints no "ระบบออกเอกสารอัตโนมัติ" anywhere', async (_file, render) => {
        const html = await render();
        expect(html).not.toContain('ระบบออกเอกสารอัตโนมัติ');
    });

    it.each(cases)('%s: the seller signer block holds no "ระบบ" and names the seller company', async (_file, render) => {
        const html = await render();
        const block = signerBlocks(html);
        expect(block).not.toBe('');
        const sellerSigner = block.split('<div class="signer">')[1] || '';
        expect(sellerSigner).not.toContain('ระบบ');
        expect(sellerSigner).toMatch(/<div class="role">[^<]*<\/div>\s*<div class="name">บริษัท [^<]+<\/div>/);
    });
});

describe('with an approver, the named person still signs', () => {
    it('buildReceiptContext puts the approver on the signer line', () => {
        const ctx = tpl.buildReceiptContext(invoice, { name: 'นาง สุดา ใจดี', role: 'r', position: 'p', approvedAt: new Date() });
        expect(ctx.APPROVER_SIGNER_LINE_HTML).toContain('นาง สุดา ใจดี');
    });
});
