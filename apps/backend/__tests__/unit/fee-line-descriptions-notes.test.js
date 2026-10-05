'use strict';
/**
 * fix/fee-line-descriptions round 2 (operator 2026-10-03) — ใบลดหนี้/ใบเพิ่มหนี้ ตั้งชื่อบรรทัด
 * และบอกความครอบคลุมจากแค็ตตาล็อกเดียวกับใบที่มันปรับปรุง · ใบของการต่ออายุคือ
 * "ค่าบริการต่ออายุใบรับรอง" ไม่ใช่ "งวดที่ 2" · ใบของงวดคงชื่องวด · ยอดไม่เปลี่ยน
 *
 * ทางเรนเดอร์จริง: routes/api/finance/{credit,debit}-notes.js อ่านผ่าน
 * find{Credit,Debit}NoteForDocument ซึ่ง select originalInvoice.application (PAYER_APPLICATION_SELECT
 * = formData + entity) — เทสต์ล่างสุดตรึงว่ายังเลือก formData อยู่ ไม่งั้นการต่ออายุจะมองไม่เห็น
 */

const mockCapture = { html: '' };
jest.mock('../../services/pdf/pdf-generator.service', () => {
    const actual = jest.requireActual('../../services/pdf/pdf-generator.service');
    actual.generatePDF = async (html) => { mockCapture.html = html; return Buffer.from('PDF'); };
    return actual;
});

const tpl = require('../../services/pdf/invoice-template-service');
const { SERVICE_CATALOGUE } = require('../../shared/instalment-service-names');

jest.setTimeout(30000);

const NEW_APP = { applicationNumber: 'APP-NOTE-NEW', formData: { plantId: 'cannabis', applicantType: 'INDIVIDUAL', applicantData: { firstName: 'ก', lastName: 'ข' } } };
const RENEWAL_APP = { applicationNumber: 'APP-NOTE-REN', formData: { ...NEW_APP.formData, renewalOf: 'cert-old-1' } };

const note = (milestone, application, kind) => ({
    id: `${kind}-1`,
    [kind === 'credit' ? 'creditNoteNumber' : 'debitNoteNumber']: `${kind === 'credit' ? 'CN' : 'DN'}-PRD-2569-000001`,
    subtotal: 1000, vat: 70, totalAmount: 1070,
    reason: 'ปรับปรุงยอดตามที่ตกลง',
    issuedAt: new Date('2026-10-03T05:00:00Z'),
    originalInvoice: {
        invoiceNumber: `INV-CO-NOTE-${milestone}`,
        serviceType: `CERTIFICATION_CHECKOUT_${milestone}`,
        subtotal: 33000, vat: 2310, totalAmount: 35310,
        paidAt: new Date('2026-10-02T05:00:00Z'),
        application,
    },
});

const esc = (s) => s.replace(/&/g, '&amp;');

describe.each([
    ['credit', (n) => tpl.generateCreditNotePdf(n, { upload: false })],
    ['debit', (n) => tpl.generateDebitNotePdf(n, { upload: false })],
])('%s note', (kind, render) => {
    beforeEach(() => { mockCapture.html = ''; });

    test.each([
        ['renewal M2', 'M2', RENEWAL_APP, SERVICE_CATALOGUE.RENEWAL],
        ['new filing M2', 'M2', NEW_APP, SERVICE_CATALOGUE.PHASE_2],
        ['new filing M1', 'M1', NEW_APP, SERVICE_CATALOGUE.PHASE_1],
    ])('%s: the line is the catalogue name with its coverage; amounts unchanged', async (_l, m, app, entry) => {
        await render(note(m, app, kind));
        const html = mockCapture.html;
        expect(html).toContain(esc(entry.name));
        expect(html).toContain(esc(entry.coverage));
        for (const other of Object.values(SERVICE_CATALOGUE).filter((e) => e !== entry)) {
            expect(html).not.toContain(esc(other.coverage));
        }
        // amounts: the note's own figures, in the line (Arabic) and the Thai-digit totals
        expect(html).toContain('1,000.00');
        expect(html).toContain('70.00');
        expect(html).toContain('1,070.00');
        expect(html).toContain('๑,๐๗๐.๐๐');
    });
});

describe('the document read selects what the renewal test needs', () => {
    const fs = require('fs');
    const path = require('path');
    test.each(['credit-note-service.js', 'debit-note-service.js'])('%s ForDocument selects application with PAYER_APPLICATION_SELECT', (file) => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../services', file), 'utf8');
        const fn = src.slice(src.search(/async function find(Credit|Debit)NoteForDocument/));
        expect(fn.slice(0, 600)).toMatch(/application: \{ select: PAYER_APPLICATION_SELECT \}/);
        expect(require('../../utils/applicant-resolver').PAYER_APPLICATION_SELECT.formData).toBe(true);
    });
});
