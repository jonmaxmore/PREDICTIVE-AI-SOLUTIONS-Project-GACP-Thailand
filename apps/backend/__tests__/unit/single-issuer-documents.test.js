'use strict';

/**
 * W14 — ONE issuer for every customer-facing document (operator ruling
 * 2026-08-22, the change log @ c28355ea):
 *
 *   "บริษัทจะเป็นคนออกใบเสนอราคา ใบวางบิล และใบเสร็จ เท่านั้น หมายความว่า
 *    เกษตรกรจ่ายเงินเข้าบริษัท ส่วนที่เหลือบริษัทจะเป็นคนเคลียร์บิลกับกรมเอง"
 *
 * The farmer pays the COMPANY. The company settles with DTAM afterwards,
 * outside this system. Consequences pinned here:
 *
 *   - getInvoiceIssuer() answers with the company for EVERY service type,
 *     including the two that used to route to DTAM.
 *   - Every document charges VAT, because the whole ค่าบริการ is the company's
 *     own VATable supply. There is no VAT-exempt government leg left.
 *   - The collection-agent fine print is GONE. It said the company issued the
 *     document "ในฐานะตัวแทนรับชำระเงินรายได้แผ่นดิน" — as DTAM's authorised
 *     collection agent. Under this ruling that sentence is simply false, and a
 *     false statement on a tax document is not a cosmetic problem.
 *   - One bank channel: the farmer makes ONE transfer, to the company. The
 *     retired model demanded two transfers and two slips per phase.
 *
 * DTAM does not disappear from the codebase — the company still owes it the
 * state portion, so the remittance/liability machinery keeps its DTAM
 * counterparty. What DTAM stops being is an ISSUER OF DOCUMENTS TO THE FARMER.
 */

const issuers = require('../../config/invoice-issuers');

const {
    SERVICE_TYPES,
    ISSUER_TYPES,
    getInvoiceIssuer,
    getBankAccountForIssuer,
} = issuers;

const ALL_SERVICE_TYPES = Object.values(SERVICE_TYPES);

describe('W14 — one issuer for every document', () => {
    test.each(ALL_SERVICE_TYPES)('%s is issued by the company', (serviceType) => {
        const issuer = getInvoiceIssuer(serviceType);
        expect(issuer.type).toBe(ISSUER_TYPES.PLATFORM);
        // The company's real legal identity, not DTAM's.
        expect(issuer.legalNameTH).toContain('พรีดิกทีฟ เอไอ โซลูชัน');
        expect(issuer.taxId).toBe('0105568045932');
    });

    test.each(ALL_SERVICE_TYPES)('%s คิด VAT — ไม่มีขาที่ยกเว้นหลงเหลือ', (serviceType) => {
        expect(getInvoiceIssuer(serviceType).chargesVat).toBe(true);
        // `shouldChargeVat()` ถูกถอด 2026-09-11: คำถามนี้ไม่มีคำตอบอื่นได้แล้ว
        // และไม่มีผู้เรียกเหลืออยู่
        expect(issuers.shouldChargeVat).toBeUndefined();
    });

    test.each(ALL_SERVICE_TYPES)('%s points at the company bank account — one transfer, not two', (serviceType) => {
        const issuer = getInvoiceIssuer(serviceType);
        expect(issuer.bankAccount).toBeDefined();
        expect(issuer.bankAccount.issuer).toBe(ISSUER_TYPES.PLATFORM);
        expect(issuer.bankAccount.vatExempt).toBe(false);
    });

    test('every document is a full tax invoice from the company', () => {
        for (const serviceType of ALL_SERVICE_TYPES) {
            const issuer = getInvoiceIssuer(serviceType);
            expect(issuer.receiptDocumentType).toBe('FULL_TAX_INVOICE_RECEIPT');
        }
    });

    test('an unknown service type is still rejected — the single issuer is not a catch-all', () => {
        // Collapsing to one issuer must not turn a typo into a silently valid
        // document. A serviceType the platform does not recognise is still an
        // error, exactly as before.
        expect(() => getInvoiceIssuer('NOT_A_REAL_SERVICE_TYPE')).toThrow(/Unknown serviceType/);
    });
});

describe('W14 — the collection-agent fiction is removed', () => {
    test('no issuer claims to be collecting on behalf of DTAM', () => {
        for (const serviceType of ALL_SERVICE_TYPES) {
            const issuer = getInvoiceIssuer(serviceType);
            expect(issuer.collectedByPlatform).toBeUndefined();
            expect(issuer.collectionAgentNoteTH).toBeUndefined();
            expect(issuer.collectionAgentNoteEN).toBeUndefined();
        }
    });

    test('the collection-agent fine print is not exported from the config at all', () => {
        // Belt and braces: the strings must not survive on the DTAM constant
        // either, or a future template could re-print them.
        const dtam = issuers.DTAM_ISSUER;
        if (dtam) {
            expect(dtam.collectionAgentNoteTH).toBeUndefined();
            expect(dtam.collectionAgentNoteEN).toBeUndefined();
            expect(dtam.collectedByPlatform).toBeUndefined();
        }
    });
});

describe('ไม่มีฝั่งกรมเหลืออยู่เลย (operator 2026-09-11)', () => {
    // เดิมบล็อกนี้ตรึงว่า "กรมยังเป็นคู่สัญญาที่ต้องนำส่งเงินให้ แม้ไม่ใช่ผู้ออกเอกสาร"
    // จึงต้องเข้าถึงเลขบัญชีของกรมได้อยู่ · operator สั่งถอดระบบนำส่งเงินให้กรมทั้งชุด
    // ⇒ ไม่มีหนี้ที่ต้องนำส่ง และไม่มีบัญชีของกรมให้ต้องรู้จัก
    test('ขอบัญชีฝั่งกรม = โยนข้อผิดพลาด ไม่ใช่คืนเลขบัญชีเงียบ ๆ', () => {
        expect(() => getBankAccountForIssuer('DTAM')).toThrow(/Unknown issuerType/);
    });

    test('ทะเบียนผู้ออกเอกสารมีรายเดียว', () => {
        expect(Object.keys(ISSUER_TYPES)).toEqual(['PLATFORM']);
        expect(issuers.DTAM_ISSUER).toBeUndefined();
        expect(issuers.DTAM_BANK_ACCOUNT).toBeUndefined();
    });
});

describe('W14 — a stored VAT of zero is not a missing VAT', () => {
    // Regression guard for a bug introduced while collapsing the issuers.
    // Removing the `isStateSide` branch from deriveInvoiceAmounts left `vat: 0`
    // falling through to the legacy reverse-derivation (total × 7/107), which
    // FABRICATES tax: a 5,000 THB state component would have printed ~327 THB of
    // VAT that was never charged. "No VAT was charged" and "we do not know what
    // the VAT was" are different facts and must not collapse into each other.
    const { deriveInvoiceAmounts } = require('../../services/pdf/invoice-template-service');

    test('an explicit vat of 0 stays 0 — never reverse-derived', () => {
        // The phase-invoice mint really does write this row: a STATE component
        // carries vat=0 because the phase's whole VAT rides on its PLATFORM
        // component, so the two still sum to the right payable.
        const amounts = deriveInvoiceAmounts({ subtotal: 5000, vat: 0, totalAmount: 5000 });
        expect(amounts.vat).toBe(0);
        expect(amounts.subtotal).toBe(5000);
        expect(amounts.total).toBe(5000);
        // What the bug produced:
        expect(amounts.vat).not.toBe(Math.round((5000 * 7) / 107)); // 327
    });

    test('a stored VAT is printed as stored', () => {
        const amounts = deriveInvoiceAmounts({ subtotal: 33000, vat: 2310, totalAmount: 35310 });
        expect(amounts).toEqual({ subtotal: 33000, vat: 2310, total: 35310 });
    });

    test('a genuinely ABSENT vat is still reverse-derived — legacy rows keep working', () => {
        // The reverse-derivation is not removed, only narrowed to the case it
        // was written for: a legacy row that never stored its components.
        const amounts = deriveInvoiceAmounts({ totalAmount: 5350 });
        expect(amounts.vat).toBe(Math.round((5350 * 7) / 107)); // 350
        expect(amounts.subtotal).toBe(5350 - amounts.vat);
        expect(amounts.subtotal + amounts.vat).toBe(amounts.total);
    });
});
