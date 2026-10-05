/**
 * Single Issuer Compliance Tests (2026-05-16)
 *
 * Owner directive (Thai, verbatim 2026-05-16):
 *   "จากตัวใบกำกับภาษีอย่างคือ สองใบรวมกัน แต่ต้องเป็นสองใบ
 *    หรือเอกสารอื่นๆ ก็ต้องเป็นสองใบ"
 *   = "Tax invoices that combine two into one must instead be two
 *      separate documents. Other documents must also be two."
 *
 * Legal grounds:
 *   - ม.86 ป.รัษฎากร  — ผู้ประกอบการต้องออกใบกำกับภาษีในนามของตน
 *   - ม.86/4 ป.รัษฎากร — ใบกำกับภาษีเต็มรูปต้องแสดงผู้ขายเพียงรายเดียว
 *   - ม.77/1 (10)     — รายได้แผ่นดินยกเว้น VAT
 *   - กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน
 *
 * Coverage:
 *   1. the receipt / tax invoice template (receipt-tax-invoice.html) has NO
 *      state-fee row, NO Wallet A/B panel
 *   2. generateReceiptTaxInvoicePdf throws INVALID_ISSUER_SIDE when given a STATE
 *      service type (defensive guard against caller routing bugs)
 *   3. buildTotalsRowsHtml: DTAM totals show NO VAT row;
 *      PLATFORM totals show VAT row
 *   4. buildQuotationTotalsRowsHtml is RETIRED (one-fee residue sweep
 *      2026-09-26) — it printed the retired State Fee / Platform Fee split
 *      and had zero callers
 *   5. generateQuotationPdf rejects missing/invalid issuerSide
 *   6. government-revenue-receipt template is RETIRED — deleted, unloaded, unreferenced
 *   7. buildPlatformQuotationMeta().bankLine names the channel the checkout
 *      rail actually offers (PromptPay), not a credit/debit card
 */

'use strict';

const path = require('path');
const fs = require('fs');

const TEMPLATE_DIR = path.join(
    __dirname, '..', '..', 'services', 'pdf', 'templates',
);
const SERVICE_PATH = path.join(
    __dirname, '..', '..', 'services', 'pdf', 'invoice-template-service',
);
const tpl = require(SERVICE_PATH);
const { ISSUER_TYPES } = require(path.join(
    __dirname, '..', '..', 'config', 'invoice-issuers',
));

describe('[Single Issuer] receipt-tax-invoice.html — combined rows removed', () => {
    const html = fs.readFileSync(
        path.join(TEMPLATE_DIR, 'receipt-tax-invoice.html'), 'utf8',
    );

    it('does NOT render a ค่าธรรมเนียมรัฐ row in the totals table', () => {
        const totalsBlock = html.match(/<table class="totals-table">[\s\S]*?<\/table>/);
        expect(totalsBlock).toBeTruthy();
        expect(totalsBlock[0]).not.toContain('GOV_FEE_AMOUNT_TH');
        expect(totalsBlock[0]).not.toMatch(/ค่าธรรมเนียมรัฐ/);
    });

    it('does NOT render the Wallet A / Wallet B revenue-split panel', () => {
        expect(html).not.toContain('WALLET_A_AMOUNT');
        expect(html).not.toContain('WALLET_B_AMOUNT');
        expect(html).not.toContain('class="wallet-card');
        expect(html).not.toMatch(/นำส่งระบบรับรองมาตรฐาน GACP สมุนไพร/);
    });

    it('renders the one-seller subtotal + VAT + total rows', async () => {
        expect(html).toContain('{{TOTALS_ROWS_HTML}}');
        const rendered = await tpl.generateReceiptTaxInvoicePdf({
            id: 'inv-1', invoiceNumber: 'INV-1', receiptNumber: 'TAX-PRD-2026-000009',
            serviceType: 'CERTIFICATION_CHECKOUT_M1', totalAmount: 5885, subtotal: 5500, vat: 385,
            status: 'paid', paidAt: new Date('2026-09-29T08:00:00Z'), receiptIssuedAt: new Date('2026-09-29T08:00:00Z'),
            createdAt: new Date('2026-09-29T07:00:00Z'), applicant: {},
        }, { upload: false, htmlOnly: true });
        expect(rendered).toMatch(/ค่าบริการ \/ Service fee/);
        expect(rendered).toMatch(/ภาษีมูลค่าเพิ่ม 7%/);
        expect(rendered).toContain('5,885.00');
    });
});

describe('[Single Issuer] generateReceiptTaxInvoicePdf — INVALID_ISSUER_SIDE guard', () => {
    it('throws INVALID_ISSUER_SIDE when given a STATE service type', async () => {
        // DTAM is VAT-exempt government revenue — a full tax invoice MUST
        // NEVER be issued in its name. Caller must route to the DTAM
        // government-revenue-receipt template instead.
        const stateInvoice = {
            id: 'inv-state-1',
            invoiceNumber: 'INV-STATE-1',
            receiptNumber: 'RCP-DTAM-2569-000099',
            serviceType: 'PHASE_1_STATE_FEE',
            totalAmount: 5000,
            subtotal: 5000,
            vat: 0,
            createdAt: new Date(),
            applicant: { taxId: '0105568045932' },
        };
        await expect(tpl.generateReceiptTaxInvoicePdf(stateInvoice, { upload: false }))
            .rejects.toMatchObject({ code: 'INVALID_ISSUER_SIDE', expected: 'PLATFORM', actual: 'DTAM' });
    });

    it('also rejects PHASE_2_STATE_FEE with the same structured error', async () => {
        const stateInvoice = {
            id: 'inv-state-2',
            invoiceNumber: 'INV-STATE-2',
            serviceType: 'PHASE_2_STATE_FEE',
            totalAmount: 25000,
            subtotal: 25000,
            vat: 0,
            createdAt: new Date(),
        };
        await expect(tpl.generateReceiptTaxInvoicePdf(stateInvoice, { upload: false }))
            .rejects.toMatchObject({ code: 'INVALID_ISSUER_SIDE' });
    });
});

describe('[Single Issuer] buildTotalsRowsHtml — DTAM vs PLATFORM', () => {
    it('EVERY document shows the VAT row — the VAT-exempt variant is gone (W14)', () => {
        // Was: 'DTAM totals show ยอดรวม + รวมทั้งสิ้น only (NO VAT row)'.
        // Operator ruling 2026-08-22 (the change log c28355ea): one issuer, one
        // shape of totals block. A document with no VAT line would understate
        // the tax the company actually charged.
        const html = tpl.buildTotalsRowsHtml(
            // A legacy pre-W14 caller's value, spelled out: ISSUER_TYPES no longer
            // has DTAM, so `ISSUER_TYPES.DTAM` passed `undefined` and tested nothing.
            'DTAM',
            { subtotal: 5500, vat: 385, total: 5885 },
            'invoice',
        );
        expect(html).toMatch(/ภาษีมูลค่าเพิ่ม 7%/);
        expect(html).toMatch(/ค่าบริการ/);
        expect(html).toMatch(/ยอดที่ต้องชำระทั้งสิ้น/);
        expect(html).toMatch(/5,885/);
    });

    it('PLATFORM totals include the VAT 7% line', () => {
        const html = tpl.buildTotalsRowsHtml(
            ISSUER_TYPES.PLATFORM,
            { subtotal: 500, vat: 35, total: 535 },
            'invoice',
        );
        expect(html).toMatch(/ภาษีมูลค่าเพิ่ม 7%/);
        expect(html).toMatch(/ยอดที่ต้องชำระทั้งสิ้น/);
        expect(html).toMatch(/500/);
        expect(html).toMatch(/35/);
        expect(html).toMatch(/535/);
    });

    it('uses the receipt grand label when variant=receipt', () => {
        const html = tpl.buildTotalsRowsHtml(
            ISSUER_TYPES.PLATFORM,
            { subtotal: 2500, vat: 175, total: 2675 },
            'receipt',
        );
        expect(html).toMatch(/ยอดที่รับชำระทั้งสิ้น/);
        // Phase 2 platform side: 2,500 + 175 = 2,675 (anchor — fee math
        // doesn't change in this fix, only document boundaries).
        expect(html).toMatch(/2,675/);
    });
});

describe('[one-fee residue sweep 2026-09-26] buildQuotationTotalsRowsHtml — deleted, zero callers', () => {
    it('is no longer exported: the function printed the retired State Fee / Platform Fee split and had no caller (generateQuotationPdf builds rows from buildQuotationItemLines/buildQuotationComponents instead)', () => {
        expect(tpl.buildQuotationTotalsRowsHtml).toBeUndefined();
    });
});

describe('[Single Issuer] generateQuotationPdf — issuerSide required', () => {
    it('rejects when issuerSide is missing', async () => {
        await expect(
            tpl.generateQuotationPdf(
                { application: { applicationNumber: 'APP-1' }, phase: 1 },
                { upload: false },
            ),
        ).rejects.toMatchObject({ code: 'INVALID_ISSUER_SIDE' });
    });

    it('rejects when issuerSide is an unknown string', async () => {
        await expect(
            tpl.generateQuotationPdf(
                {
                    application: { applicationNumber: 'APP-1' },
                    phase: 1,
                    issuerSide: 'GACP_PLATFORM',
                },
                { upload: false },
            ),
        ).rejects.toMatchObject({ code: 'INVALID_ISSUER_SIDE' });
    });
});

describe('[Single Issuer] government-revenue-receipt.html — retired 2026-09-11', () => {
    // This block used to read the template and pin that the platform fee had
    // not leaked into it. The operator retired the second issuer, so there is
    // no document in the ministry's name at all and the file is deleted.
    //
    // A deletion is pinned, not dropped: the reason the file may not come back
    // is that it is a VAT-exempt government receipt, and the company has no
    // standing to issue one. A future refactor restoring it "for completeness"
    // would be restoring a document for a legal entity this system no longer
    // bills for. Reading a missing file also fails the WHOLE suite at load
    // (ENOENT in a describe body), which is how this arrived.
    it('the template file is gone', () => {
        expect(fs.existsSync(path.join(TEMPLATE_DIR, 'government-revenue-receipt.html'))).toBe(false);
    });

    it('and no template service still tries to load it', () => {
        // Naming the file is fine — the refusal message explains that it is
        // gone. LOADING it is the regression: that is what threw ENOENT.
        const dir = path.join(__dirname, '..', '..', 'services', 'pdf');
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
            const src = fs.readFileSync(path.join(dir, file), 'utf8');
            const live = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
            expect(live).not.toMatch(/(readFileSync|loadTemplate|renderTemplate|require)\([^)]*government-revenue-receipt/);
            expect(live).not.toMatch(/['"`]government-revenue-receipt\.html['"`]/);
        }
    });

    it('and the guard that used to route there now refuses instead of pointing at nothing', () => {
        // A remediation string naming a deleted file sends an operator looking
        // for code that is not there — the failure mode the change log 2026-09-11
        // records twice over.
        const svc = fs.readFileSync(
            path.join(__dirname, '..', '..', 'services', 'pdf', 'invoice-template-service.js'), 'utf8',
        );
        const throwBlock = svc.slice(svc.indexOf("serviceType.includes('STATE_FEE')"));
        const message = throwBlock.slice(0, throwBlock.indexOf('throw err;'));
        expect(message).toContain('INVALID_ISSUER_SIDE');
        expect(message).not.toMatch(/Route to the DTAM government-revenue-receipt template/);
    });
});

describe('[Single Issuer] detectIssuerSide — service-type classifier', () => {
    it('classifies STATE_FEE service types as the COMPANY too (W14)', () => {
        // Was DTAM. One issuer now, so every recognised application service
        // type resolves to the company — including the two that used to be
        // routed to a separate government issuer.
        expect(tpl.detectIssuerSide('PHASE_1_STATE_FEE')).toBe(ISSUER_TYPES.PLATFORM);
        expect(tpl.detectIssuerSide('PHASE_2_STATE_FEE')).toBe(ISSUER_TYPES.PLATFORM);
        expect(tpl.detectIssuerSide('phase_1_state_fee')).toBe(ISSUER_TYPES.PLATFORM);
    });

    it('classifies PLATFORM_FEE / AUDIT / SUBSCRIPTION as PLATFORM', () => {
        expect(tpl.detectIssuerSide('PHASE_1_PLATFORM_FEE')).toBe(ISSUER_TYPES.PLATFORM);
        expect(tpl.detectIssuerSide('PHASE_2_PLATFORM_FEE')).toBe(ISSUER_TYPES.PLATFORM);
        expect(tpl.detectIssuerSide('PHASE_2_AUDIT')).toBe(ISSUER_TYPES.PLATFORM);
        expect(tpl.detectIssuerSide('SUBSCRIPTION_PREMIUM_MONTHLY')).toBe(ISSUER_TYPES.PLATFORM);
    });
});

describe('[one-fee residue sweep 2026-09-26] buildPlatformQuotationMeta().bankLine — the channel offered today', () => {
    // The checkout rail's live offer, never a literal typed here — a method it
    // starts offering with no name in the map below fails loud instead of
    // silently mismatching this line (frontend-service-facts-mirror.test.js
    // pins the same list against the web copy the same way).
    const { CHECKOUT_PAYMENT_METHOD_TYPES } = require('../../services/checkout/stripe-checkout-service');
    const METHOD_NAME_TH = Object.freeze({ promptpay: 'พร้อมเพย์', card: 'บัตร' });

    it('names PromptPay (the offered rail), never a credit/debit card', () => {
        const meta = tpl.buildPlatformQuotationMeta();
        const offered = [...CHECKOUT_PAYMENT_METHOD_TYPES];
        expect(offered.length).toBeGreaterThan(0);
        for (const method of offered) {
            expect(Object.keys(METHOD_NAME_TH)).toContain(method);
            expect(meta.bankLine).toContain(METHOD_NAME_TH[method]);
        }
        expect(meta.bankLine).not.toMatch(/บัตรเครดิต|บัตรเดบิต/);
    });
});

describe('[fix round 1, 2026-09-26] buildPaymentInfoHtml — the same channel source as bankLine (review Minor-1)', () => {
    // Minor-1: buildPaymentInfoHtml hardcoded its own English "PromptPay QR"
    // phrasing — a second, independent copy of the exact fact bankLine
    // already derives from CHECKOUT_PAYMENT_METHOD_TYPES. The English wording
    // stays the same today (so the quotation/invoice preview components that
    // duplicate this exact sentence, e.g. quotation-document.tsx, stay in
    // sync without their own change) — what changed is the SOURCE: a method
    // the rail starts/stops offering with no name in the English map fails
    // this test loud, instead of drifting silently the way the Thai bankLine
    // used to before this sweep fixed it.
    const { CHECKOUT_PAYMENT_METHOD_TYPES } = require('../../services/checkout/stripe-checkout-service');
    const METHOD_NAME_EN = Object.freeze({ promptpay: 'PromptPay', card: 'card' });

    it('names the offered channel via an English map keyed off the same list as bankLine, not a bare literal', () => {
        const html = tpl.buildPaymentInfoHtml('PLATFORM');
        const offered = [...CHECKOUT_PAYMENT_METHOD_TYPES];
        expect(offered.length).toBeGreaterThan(0);
        for (const method of offered) {
            expect(Object.keys(METHOD_NAME_EN)).toContain(method);
            expect(html).toContain(METHOD_NAME_EN[method]);
        }
        // Today's one offered method renders exactly the wording every
        // preview component that duplicates this sentence still expects.
        expect(html).toContain('ชำระผ่านระบบด้วย PromptPay QR ที่หน้าชำระเงินของระบบ');
    });
});
