'use strict';

/**
 * O4 (staging walk 2026-09-30): on the one-page receipt / tax invoice the last
 * glyph of "บาท" in the totals column was cut at the right edge
 * (screens/06-receipt-pdf-rendered.png). The invoice had the same cut.
 *
 * Cause: the print stylesheet gives the body no padding (the page's 10mm PDF
 * margin is the only inset, P2 2026-09-29), and the totals cell had
 * `padding-right: 0`, so the amount's text box ended exactly on the printable
 * edge. Sarabun's ท inks a little past its advance width, and Chromium clips
 * everything outside the printable area. pdf.js reported the "บาท" run ending
 * at 568.5pt against a printable edge of 567.57pt (A4 595.92pt − 10mm).
 *
 * The text layer never showed it — the full "5,885.00 บาท" is in the text even
 * when the ink is clipped — so this suite measures geometry: every text run's
 * right end must sit at least EDGE_CLEARANCE_PT inside the printable edge. The
 * PDF is rendered through the real Puppeteer path, and pdf.js runs in a child
 * process (pdf-parse's pdfjs needs ESM dynamic import, which jest's CJS
 * transform refuses — same harness as receipt-tax-invoice-paper.test.js).
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tpl = require('../../services/pdf/invoice-template-service');
const pdfGenerator = require('../../services/pdf/pdf-generator.service');

jest.setTimeout(180000);

// renderTemplateToPdf prints with a 10mm margin on every side.
const PRINT_MARGIN_PT = (10 / 25.4) * 72;
// Room for a glyph that inks past its advance width (Sarabun ท ≈ 1pt at 15px).
const EDGE_CLEARANCE_PT = 3;

const COMPANY_NAME = 'บริษัท ทดสอบพร้อมเพย์สเตจจิ้ง จำกัด';

function paidCompanyInvoice() {
    return {
        id: 'inv-edge',
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
            entity: { id: 'entity-co', type: 'JURISTIC', displayName: COMPANY_NAME, juristicId: '0105561234560' },
        },
        applicant: {},
    };
}

function adjustmentNote(numberField, number) {
    const original = paidCompanyInvoice();
    return {
        id: `note-${number}`,
        [numberField]: number,
        subtotal: 5500,
        vat: 385,
        totalAmount: 5885,
        reason: 'ปรับยอดค่าบริการ',
        status: 'ISSUED',
        issuedAt: new Date('2026-09-29T08:14:45Z'),
        createdAt: new Date('2026-09-29T08:14:45Z'),
        originalInvoice: original,
    };
}

// pdfjs writes sara am (ำ) as nikhahit + sara aa; fold it back and collapse spaces.
const normalize = (s) => s.replace(/ํา/g, 'ำ').replace(/[ \t]+/g, ' ');

/** Page count, text, page width and each text run's right end (pt), page 1. */
function pdfGeometry(buffer) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-edge-'));
    const file = path.join(dir, 'paper.pdf');
    fs.writeFileSync(file, buffer);
    const script = [
        "import { createRequire } from 'node:module';",
        "import fs from 'node:fs';",
        `const { PDFParse } = createRequire(${JSON.stringify(path.join(__dirname, '../../package.json'))})('pdf-parse');`,
        `const parser = new PDFParse({ data: fs.readFileSync(${JSON.stringify(file)}) });`,
        'const info = await parser.getInfo();',
        'const text = await parser.getText();',
        // getInfo() loaded the document; pdf-parse keeps the pdf.js proxy on `doc`.
        'const page = await parser.doc.getPage(1);',
        'const content = await page.getTextContent();',
        'const runs = content.items.filter((i) => i.str.trim()).map((i) => ({ str: i.str, right: i.transform[4] + i.width }));',
        'process.stdout.write(JSON.stringify({ pages: info.total, text: text.text, pageWidth: page.view[2], runs }));',
        'await parser.destroy();',
    ].join('\n');
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    const parsed = JSON.parse(out);
    return { ...parsed, text: normalize(parsed.text) };
}

afterAll(async () => {
    const instance = pdfGenerator.default || pdfGenerator;
    if (instance.browser) { await instance.browser.close(); instance.browser = null; }
});

const DOCUMENTS = [
    ['receipt-tax-invoice.html', () => tpl.generateReceiptTaxInvoicePdf(paidCompanyInvoice(), { upload: false })],
    ['invoice.html', () => tpl.generateInvoicePdf({ ...paidCompanyInvoice(), status: 'PENDING' }, { upload: false })],
    ['credit-note.html', () => tpl.generateCreditNotePdf(adjustmentNote('creditNoteNumber', 'CN-PRD-2026-000001'), { upload: false })],
    ['debit-note.html', () => tpl.generateDebitNotePdf(adjustmentNote('debitNoteNumber', 'DN-PRD-2026-000001'), { upload: false })],
];

describe('O4 — no text on the finance papers runs into the printable right edge', () => {
    const rendered = {};
    beforeAll(async () => {
        for (const [name, render] of DOCUMENTS) {
            rendered[name] = pdfGeometry(await render());
        }
    });

    it.each(DOCUMENTS.map(([name]) => [name]))('%s: every text run ends inside the printable area with clearance', (name) => {
        const { pageWidth, runs } = rendered[name];
        const limit = pageWidth - PRINT_MARGIN_PT - EDGE_CLEARANCE_PT;
        const tooFarRight = runs
            .filter((r) => r.right > limit)
            .map((r) => `${r.str} ends at ${r.right.toFixed(2)}pt > ${limit.toFixed(2)}pt`);
        expect(tooFarRight).toEqual([]);
    });

    it('the receipt / tax invoice is still ONE A4 page and prints the full "5,885.00 บาท"', () => {
        const paper = rendered['receipt-tax-invoice.html'];
        expect(paper.pages).toBe(1);
        expect(paper.text).toContain('5,885.00 บาท');
        expect(paper.text).toContain('หน้า 1 / 1');
    });

    it('the invoice is still ONE A4 page and prints the full "5,885.00 บาท"', () => {
        const paper = rendered['invoice.html'];
        expect(paper.pages).toBe(1);
        expect(paper.text).toContain('5,885.00 บาท');
    });
});
