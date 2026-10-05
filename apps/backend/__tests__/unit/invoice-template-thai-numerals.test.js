/**
 * Tests for the B16-D Thai-numeral context builder living inside
 * invoice-template-service. We test the PURE helper (`buildReceiptContext`)
 * and the approver-fields helper directly so the assertions don't need a
 * Puppeteer/Chrome render.
 *
 * The HTML templates consume both sets of placeholders:
 *   - ASCII: {{RECEIPT_NUMBER}}, {{ISSUE_DATE}}, {{SUBTOTAL}}, {{TOTAL}}
 *   - Thai: {{RECEIPT_NUMBER_TH}}, {{ISSUE_DATE_TH}}, {{YEAR_BE_TH}},
 *           {{SUBTOTAL_TH}}, {{VAT_TH}}, {{TOTAL_TH}}, {{PAYER_TAX_ID_TH}}
 *   - Approver: {{APPROVER_NAME}}, {{APPROVER_ROLE}}, {{APPROVER_POSITION}},
 *               {{APPROVER_SIGNED_AT_TH}}
 *
 * The footer reference number deliberately stays in ASCII so cross-system
 * grep works without re-encoding.
 */

'use strict';

const path = require('path');

const tpl = require(path.join('..', '..', 'services', 'pdf', 'invoice-template-service'));

describe('[B16-D] invoice-template-service — buildReceiptContext', () => {
    const baseInvoice = {
        receiptNumber: 'RCP-DTAM-2569-000001',
        invoiceNumber: 'INV-2569-000001',
        serviceType: 'PHASE_1_STATE_FEE',
        receiptIssuedAt: new Date(2026, 4, 16),  // local May 16, 2026
        totalAmount: 5000,
        subtotal: 5000,
        vat: 0,
        applicant: { taxId: '0105568045932' },
    };

    it('produces BOTH ASCII and Thai-numeral fields', () => {
        const ctx = tpl.buildReceiptContext(baseInvoice);
        expect(ctx.RECEIPT_NUMBER).toBe('RCP-DTAM-2569-000001');
        expect(ctx.RECEIPT_NUMBER_TH).toBe('RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑');
    });

    it('renders SUBTOTAL_TH / TOTAL_TH with Thai numerals + commas', () => {
        // A VAT-bearing subtotal/VAT/total split only exists on a PLATFORM
        // invoice — state revenue is VAT-exempt (ม.77/1(10) ป.รัษฎากร), so a
        // STATE_FEE row is normalized to vat=0 / subtotal=total. Use a platform
        // fixture so the Thai-numeral formatting of all three lines is exercised.
        const ctx = tpl.buildReceiptContext({
            ...baseInvoice,
            serviceType: 'PHASE_2_PLATFORM_FEE',
            totalAmount: 33210,
            subtotal: 31000,
            vat: 2210,
        });
        expect(ctx.TOTAL_TH).toBe('๓๓,๒๑๐.๐๐');
        expect(ctx.SUBTOTAL_TH).toBe('๓๑,๐๐๐.๐๐');
        expect(ctx.VAT_TH).toBe('๒,๒๑๐.๐๐');
    });

    it('renders ISSUE_DATE_TH with full พุทธศักราช spelling and YEAR_BE_TH', () => {
        const ctx = tpl.buildReceiptContext(baseInvoice);
        expect(ctx.ISSUE_DATE_TH).toBe('๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙');
        expect(ctx.YEAR_BE_TH).toBe('๒๕๖๙');
    });

    it('renders PAYER_TAX_ID_TH only for juristic payers (PDPA-safe)', () => {
        const juristic = tpl.buildReceiptContext(baseInvoice);
        expect(juristic.PAYER_TAX_ID_TH).toMatch(/^[๐-๙-]+$/);
        const individual = tpl.buildReceiptContext({ ...baseInvoice, applicant: { taxId: 'not-13-digits' } });
        expect(individual.PAYER_TAX_ID_TH).toBe('-');
    });

    it('emits a neutral block when approver is missing — no invented name, no system wording', () => {
        const ctx = tpl.buildReceiptContext(baseInvoice);
        expect(ctx.APPROVER_NAME).toBe('-');
        expect(ctx.APPROVER_SIGNER_LINE_HTML).toBe('');
        expect(ctx.APPROVER_SIGNED_AT_TH).toBe('-');
    });

    it('embeds approver name/role/position + Thai-formatted signed-at', () => {
        const approver = {
            id: 'u-1',
            name: 'นาง สุดา ใจดี',
            role: 'FINANCE_OFFICER_PLATFORM',
            position: 'หัวหน้าบัญชี',
            approvedAt: new Date(2026, 4, 16),
        };
        const ctx = tpl.buildReceiptContext(baseInvoice, approver);
        expect(ctx.APPROVER_NAME).toBe('นาง สุดา ใจดี');
        expect(ctx.APPROVER_ROLE).toBe('FINANCE_OFFICER_PLATFORM');
        expect(ctx.APPROVER_POSITION).toBe('หัวหน้าบัญชี');
        expect(ctx.APPROVER_SIGNED_AT_TH).toBe('๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙');
    });

    it('ค่าปริยายของตำแหน่งผู้อนุมัติ — ผู้ออกเอกสารรายเดียว จึงมีชุดเดียว', () => {
        const platformCtx = tpl.buildReceiptContext(
            { ...baseInvoice, serviceType: 'PHASE_1_PLATFORM_FEE' },
            { id: 'u-2', name: 'นาย สมชาย วิเชียร' },
        );
        expect(platformCtx.APPROVER_POSITION).toBe('หัวหน้าบัญชี');
        expect(platformCtx.APPROVER_ROLE).toBe('FINANCE_OFFICER_PLATFORM');

        const dtamCtx = tpl.buildReceiptContext(
            { ...baseInvoice, serviceType: 'PHASE_1_STATE_FEE' },
            { id: 'u-3', name: 'นาง สุดา ใจดี' },
        );
        expect(dtamCtx.APPROVER_POSITION).toBe('หัวหน้าบัญชี');
        expect(dtamCtx.APPROVER_ROLE).toBe('FINANCE_OFFICER_PLATFORM');
    });
});
