/**
 * Tests for buildAdjustmentNoteContext — the credit-/debit-note PDF data
 * mapper that wires the GET /:id/pdf routes (previously 501
 * PDF_RENDER_NOT_WIRED) to the existing credit-note.html / debit-note.html
 * templates (mockup-replacement worklist item A.3).
 *
 * Pure-helper test (no Puppeteer, no DB) — mirrors invoice-template-thai-
 * numerals.test.js / invoice-template-single-issuer.test.js, which assert the
 * placeholder dictionary directly. The B20-A template test already pins the
 * HTML placeholder set; this pins that the JS produces every one of those
 * placeholders with the right values for both CN and DN shapes.
 */

'use strict';

const {
    buildAdjustmentNoteContext,
    generateCreditNotePdf,
    generateDebitNotePdf,
} = require('../../services/pdf/invoice-template-service');

const baseOriginalInvoice = {
    id: 'inv-1',
    invoiceNumber: 'TAX-PRD-2026-000042',
    serviceType: 'PHASE_1_PLATFORM_FEE',
    subtotal: 1000,
    vat: 70,
    totalAmount: 1070,
    paidAt: new Date('2026-03-10T00:00:00Z'),
    billingName: 'บริษัท ตัวอย่าง จำกัด',
    billingAddress: '99/9 ถนนตัวอย่าง กรุงเทพฯ 10110',
};

const creditNote = {
    creditNoteNumber: 'CN-PRD-2026-000001',
    originalInvoiceId: 'inv-1',
    originalInvoice: baseOriginalInvoice,
    reason: 'ยกเลิกบริการบางส่วนตามคำขอผู้ซื้อ',
    reasonCode: 'PRICE_REDUCTION',
    subtotal: 300,
    vat: 21,
    totalAmount: 321,
    status: 'ISSUED',
    issuedAt: new Date('2026-04-01T00:00:00Z'),
    createdAt: new Date('2026-04-01T00:00:00Z'),
};

const CN_META = { docNumber: 'CN-PRD-2026-000001', docTypeTh: 'ใบลดหนี้', docTypeEn: 'CREDIT NOTE' };

describe('buildAdjustmentNoteContext — credit note (ใบลดหนี้)', () => {
    it('maps the document number + type into DOC_NUMBER and RECEIPT_NUMBER_TH', () => {
        const ctx = buildAdjustmentNoteContext(creditNote, CN_META);
        expect(ctx.DOC_NUMBER).toBe('CN-PRD-2026-000001');
        expect(ctx.DOC_TYPE_TH).toBe('ใบลดหนี้');
        expect(ctx.DOC_TYPE_EN).toBe('CREDIT NOTE');
        // RECEIPT_NUMBER_TH is the Thai-numeral transliteration of the doc number.
        expect(ctx.RECEIPT_NUMBER_TH).toContain('CN-PRD-');
        expect(ctx.RECEIPT_NUMBER_TH).toMatch(/[๐-๙]/); // contains Thai digits
    });

    it('references the ORIGINAL tax invoice (mandatory ม.86/10)', () => {
        const ctx = buildAdjustmentNoteContext(creditNote, CN_META);
        expect(ctx.ORIGINAL_INVOICE_NUMBER).toBe('TAX-PRD-2026-000042');
        expect(ctx.ORIGINAL_INVOICE_DATE).not.toBe('-');
        expect(ctx.ORIGINAL_INVOICE_DATE).toMatch(/2569|มี\.?ค\.?|มีนาคม/); // BE 2569 / Thai March
    });

    it('carries the free-text reason (mandatory ม.86/10)', () => {
        const ctx = buildAdjustmentNoteContext(creditNote, CN_META);
        expect(ctx.REASON).toBe('ยกเลิกบริการบางส่วนตามคำขอผู้ซื้อ');
    });

    it('maps the note amounts (NOT the original invoice amounts) to the totals', () => {
        const ctx = buildAdjustmentNoteContext(creditNote, CN_META);
        // The adjustment is 321 (the note total), not 1070 (the original).
        // The *_TH display fields are Thai numerals per RECEIPT-DESIGN-SPEC.
        expect(ctx.SUBTOTAL_TH).toContain('๓๐๐');
        expect(ctx.VAT_TH).toContain('๒๑');
        expect(ctx.TOTAL_TH).toContain('๓๒๑');
        expect(ctx.TOTAL_AMOUNT_TEXT).toContain('บาท'); // Thai amount-in-words
        // The single line item carries the note amounts (Arabic numerals in body).
        expect(ctx.TAX_ITEMS_ROWS).toContain('300.00');
        expect(ctx.TAX_ITEMS_ROWS).toContain('21.00');
        expect(ctx.TAX_ITEMS_ROWS).toContain('321.00');
    });

    it('resolves the PLATFORM issuer (never DTAM — ม.86/10 single-issuer)', () => {
        const ctx = buildAdjustmentNoteContext(creditNote, CN_META);
        expect(ctx.ISSUER_NAME_TH).toBeTruthy();
        expect(ctx.ISSUER_TAX_ID).toBeTruthy();
        // Anti-regression: never the literal DTAM identity.
        expect(ctx.ISSUER_TAX_ID).not.toBe('0994000036540');
        expect(ctx.ISSUER_NAME_TH).not.toContain('กรมการแพทย์แผนไทย');
    });

    // Operator rule 2026-09-27 (the audit ledger L-083): the payer is the ORIGINAL
    // invoice's applying entity, through utils/applicant-resolver.js — this test
    // used to pin the `billingName` snapshot, which no writer ever populates.
    it('draws the payer from the original invoice entity, not the billing snapshot', () => {
        const withEntity = {
            ...creditNote,
            originalInvoice: {
                ...baseOriginalInvoice,
                application: {
                    entity: { type: 'JURISTIC', displayName: 'บริษัท ตัวอย่าง จำกัด', juristicId: '0105561234560' },
                    formData: { applicantData: { address: '99/9 ถนนตัวอย่าง กรุงเทพฯ 10110' } },
                },
            },
        };
        const ctx = buildAdjustmentNoteContext(withEntity, CN_META);
        expect(ctx.PAYER_NAME).toBe('บริษัท ตัวอย่าง จำกัด');
        expect(ctx.PAYER_ADDRESS).toContain('กรุงเทพ');
        expect(ctx.PAYER_ID_TH).toBe('๐-๑๐๕๕-๖๑๒๓๔-๕๖-๐');

        // The snapshot alone is not a source: no entity, no payer.
        const snapshotOnly = buildAdjustmentNoteContext(creditNote, CN_META);
        expect(snapshotOnly.PAYER_NAME).toBe('-');
        // PDPA / ม.86/4(3): never print a national ID — defaults to '-'.
        expect(snapshotOnly.PAYER_ID_TH).toBe('-');
    });

    it('no approver supplied: no invented name and no system wording (review round 2)', () => {
        const ctx = buildAdjustmentNoteContext(creditNote, CN_META);
        expect(ctx.APPROVER_NAME).toBe('-');
        expect(ctx.APPROVER_SIGNER_LINE_HTML).toBe('');
    });

    it('embeds a supplied approver into the signature block', () => {
        const ctx = buildAdjustmentNoteContext(creditNote, CN_META, {
            name: 'นางสาวบัญชี ทดสอบ',
            role: 'ACCOUNT_PLATFORM',
            position: 'หัวหน้าบัญชี Platform',
            approvedAt: new Date('2026-04-01T03:00:00Z'),
        });
        expect(ctx.APPROVER_NAME).toBe('นางสาวบัญชี ทดสอบ');
        expect(ctx.APPROVER_ROLE).toBe('ACCOUNT_PLATFORM');
        expect(ctx.APPROVER_SIGNED_AT_TH).not.toBe('-');
    });

    it('renders YEAR_BE_TH as the Buddhist-era year in Thai numerals', () => {
        const ctx = buildAdjustmentNoteContext(creditNote, CN_META);
        // issuedAt 2026 → BE 2569 → ๒๕๖๙
        expect(ctx.YEAR_BE_TH).toBe('๒๕๖๙');
    });

    it('falls back to "-" for a missing original-invoice reference', () => {
        const orphan = { ...creditNote, originalInvoice: undefined };
        const ctx = buildAdjustmentNoteContext(orphan, CN_META);
        expect(ctx.ORIGINAL_INVOICE_NUMBER).toBe('-');
        expect(ctx.ORIGINAL_INVOICE_DATE).toBe('-');
        expect(ctx.PAYER_NAME).toBe('-');
    });
});

describe('buildAdjustmentNoteContext — debit note (ใบเพิ่มหนี้) parity', () => {
    const debitNote = {
        debitNoteNumber: 'DN-PRD-2026-000001',
        originalInvoice: baseOriginalInvoice,
        reason: 'เรียกเก็บเพิ่มจากการคิดราคาต่ำกว่าจริง',
        reasonCode: 'UNDERCHARGE',
        subtotal: 200,
        vat: 14,
        totalAmount: 214,
        status: 'ISSUED',
        issuedAt: new Date('2026-04-05T00:00:00Z'),
        createdAt: new Date('2026-04-05T00:00:00Z'),
    };
    const DN_META = { docNumber: 'DN-PRD-2026-000001', docTypeTh: 'ใบเพิ่มหนี้', docTypeEn: 'DEBIT NOTE' };

    it('produces the SAME placeholder set as a credit note (templates are symmetric)', () => {
        const dn = buildAdjustmentNoteContext(debitNote, DN_META);
        const cn = buildAdjustmentNoteContext(creditNote, CN_META);
        expect(Object.keys(dn).sort()).toEqual(Object.keys(cn).sort());
    });

    it('maps the debit-note number + amounts', () => {
        const ctx = buildAdjustmentNoteContext(debitNote, DN_META);
        expect(ctx.DOC_NUMBER).toBe('DN-PRD-2026-000001');
        expect(ctx.DOC_TYPE_EN).toBe('DEBIT NOTE');
        expect(ctx.TOTAL_TH).toContain('๒๑๔');
    });
});

describe('generator wrappers are exported + callable', () => {
    it('exports generateCreditNotePdf + generateDebitNotePdf as functions', () => {
        expect(typeof generateCreditNotePdf).toBe('function');
        expect(typeof generateDebitNotePdf).toBe('function');
    });
});
