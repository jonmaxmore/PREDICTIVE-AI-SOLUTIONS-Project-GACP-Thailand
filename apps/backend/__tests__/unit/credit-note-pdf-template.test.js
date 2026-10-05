/**
 * Tests for the credit-note + debit-note PDF templates (B20-A, 2026-05-16).
 *
 * Anchors:
 *   - Templates render with the single-issuer principle: PLATFORM only,
 *     no DTAM identity ever appears (ม.86 — one document = one seller).
 *   - All ม.86/10 (CN) / ม.86/9 (DN) mandatory fields are present in the
 *     HTML: reference to original invoice, reason text, separate
 *     amount/VAT/total, sequential number.
 *   - Approver / signature block is present.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.join(
    __dirname, '..', '..', 'services', 'pdf', 'templates',
);

function readTemplate(name) {
    return fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8');
}

describe('[B20-A] credit-note.html — ใบลดหนี้ template', () => {
    let html;
    beforeAll(() => { html = readTemplate('credit-note.html'); });

    it('carries the ใบลดหนี้ + CREDIT NOTE badges', () => {
        expect(html).toContain('ใบลดหนี้');
        expect(html).toContain('CREDIT NOTE');
        expect(html).toContain('ม.86/10');
    });

    it('includes the original-invoice reference block (required by ม.86/10)', () => {
        expect(html).toContain('{{ORIGINAL_INVOICE_NUMBER}}');
        expect(html).toContain('{{ORIGINAL_INVOICE_DATE}}');
        expect(html).toContain('อ้างอิงใบกำกับภาษีเลขที่');
    });

    it('includes the reason block (required by ม.86/10)', () => {
        expect(html).toContain('{{REASON}}');
        expect(html).toContain('เหตุที่ออกใบลดหนี้');
    });

    it('renders subtotal / VAT / total as separate visible fields', () => {
        expect(html).toContain('{{SUBTOTAL_TH}}');
        expect(html).toContain('{{VAT_TH}}');
        expect(html).toContain('{{TOTAL_TH}}');
        expect(html).toContain('{{TOTAL_AMOUNT_TEXT}}');
    });

    it('uses PLATFORM single-issuer block (no DTAM)', () => {
        // The issuer fields are bound to PLATFORM_ISSUER at render time.
        // The TEMPLATE itself must NOT carry any hardcoded DTAM identity.
        expect(html).toContain('{{ISSUER_NAME_TH}}');
        expect(html).toContain('{{ISSUER_TAX_ID}}');
        expect(html).toContain('ข้อมูลผู้ออกใบลดหนี้');
        // Anti-regression: the literal DTAM tax-ID (0994000036540) must
        // never appear in the template body (single-issuer principle).
        expect(html).not.toContain('0994000036540');
        // The literal DTAM legal name must not appear either.
        expect(html).not.toContain('กรมการแพทย์แผนไทย');
    });

    it('renders the auto-sign approver block', () => {
        expect(html).toContain('{{APPROVER_NAME}}');
        expect(html).toContain('{{APPROVER_POSITION}}');
        expect(html).toContain('{{APPROVER_ROLE}}');
        expect(html).toContain('{{APPROVER_SIGNED_AT_TH}}');
    });

    it('carries the sequential CN number placeholder', () => {
        expect(html).toContain('{{DOC_NUMBER}}');
        expect(html).toContain('{{RECEIPT_NUMBER_TH}}');
    });

    it('totals row marks the value as a reduction ("ลดยอด")', () => {
        expect(html).toContain('ลดยอด');
    });
});

describe('[B20-A] debit-note.html — ใบเพิ่มหนี้ template', () => {
    let html;
    beforeAll(() => { html = readTemplate('debit-note.html'); });

    it('carries the ใบเพิ่มหนี้ + DEBIT NOTE badges', () => {
        expect(html).toContain('ใบเพิ่มหนี้');
        expect(html).toContain('DEBIT NOTE');
        expect(html).toContain('ม.86/9');
    });

    it('includes the original-invoice reference block (required by ม.86/9)', () => {
        expect(html).toContain('{{ORIGINAL_INVOICE_NUMBER}}');
        expect(html).toContain('{{ORIGINAL_INVOICE_DATE}}');
    });

    it('includes the reason block', () => {
        expect(html).toContain('{{REASON}}');
        expect(html).toContain('เหตุที่ออกใบเพิ่มหนี้');
    });

    it('renders subtotal / VAT / total separately', () => {
        expect(html).toContain('{{SUBTOTAL_TH}}');
        expect(html).toContain('{{VAT_TH}}');
        expect(html).toContain('{{TOTAL_TH}}');
    });

    it('uses PLATFORM single-issuer block', () => {
        expect(html).toContain('{{ISSUER_NAME_TH}}');
        expect(html).toContain('{{ISSUER_TAX_ID}}');
        expect(html).not.toContain('0994000036540');
        expect(html).not.toContain('กรมการแพทย์แผนไทย');
    });

    it('marks the totals row as an addition ("เพิ่มยอด")', () => {
        expect(html).toContain('เพิ่มยอด');
    });
});
