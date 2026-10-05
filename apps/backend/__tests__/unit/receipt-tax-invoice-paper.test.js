'use strict';

/**
 * The third finance document is ONE paper: "ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป"
 * (operator-approved design docs/design/2026-09-05-finance-documents-design.md
 * §1 row 3 and §3.3). It is numbered TAX-PRD-… exactly as the settlement stored
 * it, and carries the ป.รัษฎากร ม.86/4 elements: the words ใบกำกับภาษี, the
 * seller's name/address/tax ID/branch, the buyer's name/address and — for a
 * company — tax ID, the number, the date, the description, VAT shown apart.
 *
 * Before this change the paper a paid invoice produced (the staff route and the
 * owner route both go through invoiceService.generateReceiptPdf) was
 * receipt.html, titled only "ใบเสร็จรับเงิน", and tax-invoice.html was served by
 * no route at all — so no route delivered the ruled document.
 *
 * The render here is the real one: invoiceService.generateReceiptPdf → the
 * template → Puppeteer. The PDF's text is read by pdf-parse in a child node
 * process (pdf-parse's pdfjs needs ESM dynamic import, which jest's CJS
 * transform refuses), so every assertion below is on the printed page.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const invoiceService = require('../../services/invoice-service');
const tpl = require('../../services/pdf/invoice-template-service');
const pdfGenerator = require('../../services/pdf/pdf-generator.service');
const { PLATFORM_ISSUER } = require('../../config/invoice-issuers');

jest.setTimeout(120000);

const COMPANY_TAX_ID = '0105561234560'; // checksum-valid fixture used across this repo
const COMPANY_TAX_ID_GROUPED = '0-1055-61234-56-0';
const NATIONAL_ID = '1103700012345';
const RECEIPT_NUMBER = 'TAX-PRD-2026-000002';

function paidInvoice(entity, formDataExtra = {}) {
    return {
        id: 'inv-paper',
        invoiceNumber: 'INV-CO-09246C23-M1',
        serviceType: 'CERTIFICATION_CHECKOUT_M1',
        totalAmount: 5885,
        subtotal: 5500,
        vat: 385,
        // What checkout settlement writes (services/checkout/checkout-settlement-service.js).
        status: 'paid',
        paymentMethod: 'STRIPE',
        receiptNumber: RECEIPT_NUMBER,
        receiptIssuedAt: new Date('2026-09-29T08:14:45Z'),
        receiptIssuedBy: 'stripe-webhook',
        receiptStatus: 'ISSUED',
        paidAt: new Date('2026-09-29T08:14:45Z'),
        createdAt: new Date('2026-09-29T08:13:00Z'),
        dueDate: new Date('2026-10-08T00:00:00Z'),
        lineItems: [{ lineNumber: 1, description: 'ค่าบริการ GACP', quantity: 1, unitPrice: 5500, amount: 5500 }],
        application: {
            applicationNumber: 'APP-2569-MUJZRHP3-69A796',
            cultivationScopeCount: 1,
            formData: {
                plantName: 'ขิง',
                applicantData: {
                    address: '99 หมู่ 1 ตำบลทดสอบ', district: 'อำเภอเมืองนนทบุรี',
                    province: 'จังหวัดนนทบุรี', postalCode: '11000', ...formDataExtra,
                },
            },
            entity,
        },
        applicant: { nationalId: NATIONAL_ID },
    };
}

const COMPANY = { id: 'e-co', type: 'JURISTIC', displayName: 'บริษัท ทดสอบพร้อมเพย์สเตจจิ้ง จำกัด', juristicId: COMPANY_TAX_ID };
const PERSON = { id: 'e-person', type: 'INDIVIDUAL', displayName: 'สมชาย ทดสอบ' };

// pdfjs writes sara am (ำ) as nikhahit + sara aa; fold it back and collapse spaces.
const normalize = (s) => s.replace(/ํา/g, 'ำ').replace(/[ \t]+/g, ' ');

function pdfText(buffer) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcpt-paper-'));
    const file = path.join(dir, 'paper.pdf');
    fs.writeFileSync(file, buffer);
    const script = [
        "import { createRequire } from 'node:module';",
        "import fs from 'node:fs';",
        `const { PDFParse } = createRequire(${JSON.stringify(path.join(__dirname, '../../package.json'))})('pdf-parse');`,
        `const parser = new PDFParse({ data: fs.readFileSync(${JSON.stringify(file)}) });`,
        'const info = await parser.getInfo();',
        'const text = await parser.getText();',
        'process.stdout.write(JSON.stringify({ pages: info.total, text: text.text }));',
        'await parser.destroy();',
    ].join('\n');
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    const parsed = JSON.parse(out);
    return { pages: parsed.pages, text: normalize(parsed.text) };
}

async function renderThroughService(invoice) {
    const spy = jest.spyOn(invoiceService, 'getForDocument').mockResolvedValue(invoice);
    try {
        return await invoiceService.generateReceiptPdf(invoice.id);
    } finally {
        spy.mockRestore();
    }
}

afterAll(async () => {
    const instance = pdfGenerator.default || pdfGenerator;
    if (instance.browser) { await instance.browser.close(); instance.browser = null; }
});

describe('the paper a paid invoice produces is ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป (company buyer)', () => {
    let pdf;
    beforeAll(async () => {
        pdf = pdfText(await renderThroughService(paidInvoice(COMPANY)));
    });

    it('is titled both ใบเสร็จรับเงิน and ใบกำกับภาษี', () => {
        expect(pdf.text).toContain('ใบเสร็จรับเงิน');
        expect(pdf.text).toContain('ใบกำกับภาษี');
    });

    it('prints the TAX-PRD number exactly as stored', () => {
        expect(pdf.text).toContain(RECEIPT_NUMBER);
    });

    it('prints the seller tax ID', () => {
        expect(pdf.text).toContain(PLATFORM_ISSUER.taxId);
    });

    it('prints the company buyer tax ID grouped 1-4-5-2-1', () => {
        expect(pdf.text).toContain(COMPANY_TAX_ID_GROUPED);
    });

    it('shows subtotal, VAT and total apart', () => {
        expect(pdf.text).toContain('5,500.00');
        expect(pdf.text).toContain('385.00');
        expect(pdf.text).toContain('5,885.00');
    });

    it('fits one page', () => {
        expect(pdf.pages).toBe(1);
    });

    it('refers to the invoice it settles', () => {
        expect(pdf.text).toContain('INV-CO-09246C23-M1');
    });

    it('names no payment provider and speaks no system language', () => {
        for (const word of ['STRIPE', 'Stripe', 'stripe', 'webhook', 'RECEIPT_ISSUED', 'e-Tax', 'e-TAX', 'ม.86']) {
            expect(pdf.text).not.toContain(word);
        }
    });

    // Review I-4(a): design §3.3 lists "อ้างอิงการชำระ". The stored rows carry no
    // customer-facing payment number of their own (a checkout order has a UUID and
    // the provider's intent id, neither of which may be printed), so the reference
    // is the invoice number the payment settled — the number the customer paid against.
    it('prints อ้างอิงการชำระ with the invoice number the payment settled, never a provider id', () => {
        expect(pdf.text).toMatch(/อ้างอิงการชำระ \/ Payment ref\.\s*INV-CO-09246C23-M1/);
        expect(pdf.text).not.toMatch(/\b(pi|cs|ch|pm)_[A-Za-z0-9]/);
    });

    // Review I-4(c): the ผู้รับเงิน signer line the old staff receipt carried.
    // Review round 2: with no approver the line names the seller company only —
    // never "ระบบออกเอกสารอัตโนมัติ" or any other "ระบบ…" text, and no invented person.
    it('carries the ผู้รับเงิน signer line with the seller company directly under it', () => {
        expect(pdf.text).toMatch(/ผู้รับเงิน \/ Cashier\s*บริษัท/);
        expect(pdf.text).not.toContain('ระบบออกเอกสารอัตโนมัติ');
        const start = pdf.text.indexOf('ผู้รับเงิน / Cashier');
        // The buyer signer's role follows; pdfjs splits its Thai (ผู้ซื้อ), so the
        // English half marks the end of the seller signer block.
        const end = pdf.text.indexOf('/ Buyer', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        expect(pdf.text.slice(start, end)).not.toContain('ระบบ');
    });

    it('a company buyer has no second registration row (its tax id is the id)', () => {
        expect(pdf.text).not.toContain('Registration No.');
    });

    // m8: one date format on the paper, the full month name (design specimen).
    it('prints both dates with the full month name', () => {
        expect(pdf.text).not.toContain('29 ก.ย. 2569');
        expect((pdf.text.match(/29 กันยายน 2569/g) || []).length).toBeGreaterThanOrEqual(2);
    });
});

// Review I-4(b): a community enterprise has no tax id, but the paper still names
// it by its registration number — the row the old receipt printed through the
// payer-block rule (PAYER_ID_LABEL / PAYER_ID), taken from the same resolver.
describe('the same paper, community enterprise buyer', () => {
    let pdf;
    beforeAll(async () => {
        pdf = pdfText(await renderThroughService(paidInvoice({
            id: 'e-ce', type: 'COMMUNITY_ENTERPRISE', displayName: 'วิสาหกิจชุมชนทดสอบสมุนไพร', communityRegNo: '58012345678',
        })));
    });

    it('prints the registration number row from the payer-block rule', () => {
        expect(pdf.text).toMatch(/เลขทะเบียนวิสาหกิจชุมชน \/ Registration No\.\s*58012345678/);
    });

    it('its tax id stays "-"', () => {
        expect(pdf.text).toMatch(/เลขประจำตัวผู้เสียภาษี \/ Tax ID\s*-/);
    });

    it('fits one page', () => {
        expect(pdf.pages).toBe(1);
    });
});

// m7 + m8, on the substituted HTML (the same template, no Puppeteer needed).
describe('the method and the dates on the paper', () => {
    const methodOf = (html) => (html.match(/วิธีชำระ \/ Method<\/div>\s*<div>([^<]*)<\/div>/) || [])[1];

    it.each(['STRIPE', 'PROMPTPAY', 'CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'QR_CASH', 'stripe'])(
        'the rail code %s prints ชำระผ่านระบบ', async (code) => {
            const html = await tpl.generateReceiptTaxInvoicePdf({ ...paidInvoice(COMPANY), paymentMethod: code }, { upload: false, htmlOnly: true });
            expect(methodOf(html)).toBe('ชำระผ่านระบบ');
        },
    );

    it('an unknown code prints "-", never itself', async () => {
        const html = await tpl.generateReceiptTaxInvoicePdf({ ...paidInvoice(COMPANY), paymentMethod: 'ACME_PAY' }, { upload: false, htmlOnly: true });
        expect(methodOf(html)).toBe('-');
        expect(html).not.toContain('ACME_PAY');
    });

    it('with neither receiptIssuedAt nor paidAt, the dates print "-", not today', async () => {
        const html = await tpl.generateReceiptTaxInvoicePdf(
            { ...paidInvoice(COMPANY), receiptIssuedAt: null, paidAt: null }, { upload: false, htmlOnly: true },
        );
        expect(html).toMatch(/วันที่ \/ Date<\/span><span class="value">-<\/span>/);
        expect(html).toMatch(/วันที่ชำระ \/ Paid on<\/div>\s*<div>-<\/div>/);
    });
});

describe('the same paper, individual buyer', () => {
    let pdf;
    beforeAll(async () => {
        pdf = pdfText(await renderThroughService(paidInvoice(PERSON, { idCard: NATIONAL_ID })));
    });

    it('shows no national ID, in full or grouped', () => {
        expect(pdf.text).not.toContain(NATIONAL_ID);
        expect(pdf.text).not.toContain('1-1037-00012-34-5');
    });

    it('is still the combined paper with the stored number', () => {
        expect(pdf.text).toContain('ใบกำกับภาษี');
        expect(pdf.text).toContain(RECEIPT_NUMBER);
        expect(pdf.pages).toBe(1);
    });
});

describe('one paper, one template (the superseded two leave no trace)', () => {
    const templates = path.join(__dirname, '../../services/pdf/templates');

    it('receipt.html and tax-invoice.html are gone; receipt-tax-invoice.html is the one template', () => {
        expect(fs.existsSync(path.join(templates, 'receipt.html'))).toBe(false);
        expect(fs.existsSync(path.join(templates, 'tax-invoice.html'))).toBe(false);
        expect(fs.existsSync(path.join(templates, 'receipt-tax-invoice.html'))).toBe(true);
    });

    it('the template service exports one generator for it, and not the two old ones', () => {
        expect(typeof tpl.generateReceiptTaxInvoicePdf).toBe('function');
        expect(tpl.generateReceiptPdf).toBeUndefined();
        expect(tpl.generateTaxInvoicePdf).toBeUndefined();
    });

    it('refuses to print the paper without a stored receipt number (no fallback to the invoice number)', async () => {
        const unissued = { ...paidInvoice(COMPANY), receiptNumber: null };
        await expect(tpl.generateReceiptTaxInvoicePdf(unissued, { upload: false, htmlOnly: true }))
            .rejects.toMatchObject({ code: 'RECEIPT_NOT_ISSUED' });
    });
});
