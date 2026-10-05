'use strict';
/**
 * quotation-pdf-prints-validity-date.test.js
 *
 * Operator ruling, re-confirmed 2026-09-27: quotation validity is 7 วันทำการ
 * นับจากวันที่ออก. The printed ใบเสนอราคา must show the row's OWN `validUntil`
 * date (Thai Bangkok format), or — only when no row is handed over — the
 * config day count as text. It must never print a hardcoded "30 วัน".
 *
 * Puppeteer is mocked out (generatePDF returns a stub buffer); the real
 * template file is loaded from disk and run through the SAME substitution
 * `replaceTemplateVariables` performs, so this test sees the actual HTML the
 * applicant's browser would render.
 */

const fs = require('fs');
const path = require('path');

const mockRealTemplate = fs.readFileSync(
    path.join(__dirname, '..', '..', 'services', 'pdf', 'templates', 'quotation.html'),
    'utf8',
);

const mockCapture = { html: '' };

jest.mock('../../services/pdf/pdf-generator.service', () => ({
    readTemplateCached: () => mockRealTemplate,
    replaceTemplateVariables: (tpl, data) =>
        tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(data[k] === undefined ? '' : data[k])),
    generatePDF: async (html) => { mockCapture.html = html; return Buffer.from('PDF'); },
}));

const tpl = require('../../services/pdf/invoice-template-service');

const application = {
    id: 'app-1',
    applicationNumber: 'GACP-TH-2569-000123',
    totalAreaTypes: 1,
    formData: { cultivationMethods: ['OUTDOOR'], farmName: 'ฟาร์มตัวอย่าง' },
};

const ROW_WITH_VALID_UNTIL = {
    quotationNumber: 'QT-PRD-2026-000009',
    issuerType: 'PLATFORM',
    status: 'PENDING',
    totalAmount: '35310.00',
    installments: [
        { phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
        { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
    ],
    acceptedSnapshot: null,
    // A concrete Tue 2026-09-29 (7 working days after Fri 2026-09-18) —
    // matches quotation-validity-seven-working-days.test.js Case 1.
    validUntil: new Date('2026-09-29T16:59:59.999Z'),
};

describe('generateQuotationPdf — prints the real validity deadline, never "30 วัน"', () => {
    beforeEach(() => { mockCapture.html = ''; });

    test('a stored row prints ITS OWN validUntil date, formatted in Thai', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: ROW_WITH_VALID_UNTIL,
        });

        // formatThaiDate renders Buddhist-era short date; 2026-09-29 → "29 ก.ย. 2569".
        expect(mockCapture.html).toContain('ยืนราคาถึงวันที่');
        expect(mockCapture.html).toContain('29 ก.ย. 2569');
        expect(mockCapture.html).not.toContain('30 วัน');
    });

    test('no stored row: falls back to the config day count as TEXT, not a hardcoded "30 วัน"', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: null,
        });

        expect(mockCapture.html).toContain('7 วันทำการ');
        expect(mockCapture.html).not.toContain('30 วัน');
    });
});
