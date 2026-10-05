/**
 * fix/invoice-pdf-truth (2026-09-27) — the company's financial PDFs must not
 * lie to the customer. A real invoice downloaded from staging
 * (INV-CO-CAFF6646-M1, company payer) showed four problems, reproduced here
 * against the REAL template service (real Puppeteer render for the
 * invoice/receipt paths, so this is the rendered PDF text, not a guess about
 * what the template would say):
 *
 *   1. The company header printed the DTAM switchboard
 *      "โทร: 0-2591-7007 | อีเมล: contact@gacpth.com" (shared/ministry-contact.js
 *      MINISTRY_CONTACT_LINE) — a company document telling its own customer
 *      to call the ministry.
 *   2. PLATFORM_ISSUER.contactEmail defaulted to a personal gmail; the
 *      controller-decided address is finance@gacpth.com (config/invoice-
 *      issuers.js FINANCE_CONTACT_EMAIL, pinned against the web constant by
 *      finance-contact-email-mirror.test.js). The phone is undecided
 *      (PENDING) and must print NO phone at all — never a placeholder, never
 *      the ministry number.
 *   3. The line item read "ค่าธรรมเนียม GACP" — operator ruling 2026-09-11:
 *      the whole charge is "ค่าบริการ". Legacy STATE rows (APPLICATION_FEE,
 *      AUDIT_FEE, PHASE_2_AUDIT, PHASE_1_STATE_FEE, PHASE_2_STATE_FEE) are
 *      untouched — that support is retired separately.
 *   4. A juristic (company) payer was labelled "ชื่อ-นามสกุล / Name" +
 *      "เลขประจำตัวประชาชน / ID No." with a dash — a company holds its own
 *      certificate (operator 2026-09-07) and is never a person. An
 *      individual payer's labels are unchanged.
 *
 * Rendered via the REAL template service — same template file, same data-
 * building code as production — with `htmlOnly: true` so the assertion is on
 * the exact substituted HTML rather than a PDF binary. This is deliberately
 * NOT the real Puppeteer→PDF→pdf-parse round trip: pdf-parse's pdfjs-dist
 * dependency calls a dynamic `import()` that fails under Jest's CJS
 * transform ("A dynamic import callback was invoked without
 * --experimental-vm-modules"), confirmed by running it here. The evidence
 * pack (evidence/invoice-pdf-truth-2026-09-27/) renders the ACTUAL PDF
 * outside Jest, via pdf-parse, in plain node.
 */

'use strict';

const tpl = require('../../services/pdf/invoice-template-service');
const { PLATFORM_ISSUER } = require('../../config/invoice-issuers');

jest.setTimeout(30000);

function textOf(html) {
    // The substituted HTML still has markup around the text, but every
    // string this suite checks for is a whole word/phrase that cannot
    // straddle a tag boundary, so a plain `toContain` on the raw HTML is
    // exact — no PDF-text-reflow artefacts to account for.
    return html;
}

// A real "M1" checkout invoice — the serviceType checkout actually mints
// (CERTIFICATION_CHECKOUT_<milestone>), which is NOT a row in serviceTypeLabel's
// map and used to fall through to the buggy default.
function checkoutInvoice(overrides = {}) {
    return {
        id: 'inv-truth-1',
        invoiceNumber: 'INV-CO-TEST-M1',
        serviceType: 'CERTIFICATION_CHECKOUT_M1',
        totalAmount: 5885,
        subtotal: 5500,
        vat: 385,
        createdAt: new Date('2026-09-27T00:00:00Z'),
        dueDate: new Date('2026-10-04T00:00:00Z'),
        application: { applicationNumber: 'APP-TRUTH-1' },
        applicant: {},
        ...overrides,
    };
}

// Checksum-VALID (DOPA mod-11) company tax id, starts with '0' — reused
// verbatim from this codebase's own fixtures (applicant-validation.test.js,
// invoice-template-payer-tax-id-guard.test.js etc.), never a real company's
// number. The invoice-tax-id fix round 3 guard (`isPrintableJuristicTaxId`,
// invoice-template-service.js) now requires a real DOPA mod-11 checksum, not
// just a 13-digit shape — a made-up id like the previous fixture value here
// (`0105558123456`, checksum-INVALID) correctly renders '-' now instead of
// printing.
const VALID_JURISTIC_TAX_ID_FIXTURE = '0105561234560';

const JURISTIC_PAYER_APP = {
    applicationNumber: 'APP-TRUTH-CO',
    formData: {
        applicantData: {
            companyName: 'บริษัท ทดสอบพร้อมเพย์สเตจจิ้ง จำกัด',
            taxId: VALID_JURISTIC_TAX_ID_FIXTURE,
        },
        applicantType: 'JURISTIC',
    },
};

const INDIVIDUAL_PAYER_APP = {
    applicationNumber: 'APP-TRUTH-IND',
    formData: {
        applicantData: { firstName: 'สมชาย', lastName: 'ทดสอบ', idCard: '1234567890123' },
        applicantType: 'INDIVIDUAL',
    },
};

describe('[fix/invoice-pdf-truth] generateInvoicePdf — real render, company payer', () => {
    let text;
    beforeAll(async () => {
        const html = await tpl.generateInvoicePdf(
            checkoutInvoice({ application: JURISTIC_PAYER_APP }),
            { upload: false, htmlOnly: true },
        );
        text = textOf(html);
    });

    it('never prints the DTAM switchboard number', () => {
        expect(text).not.toContain('0-2591-7007');
    });

    it('never prints contact@gacpth.com (the ministry/platform address, not the issuer)', () => {
        expect(text).not.toContain('contact@gacpth.com');
    });

    it('never prints a gmail address', () => {
        expect(text).not.toMatch(/gmail\.com/i);
    });

    it('prints finance@gacpth.com as the company contact', () => {
        expect(text).toContain('finance@gacpth.com');
    });

    it('names the charge ค่าบริการ, not ค่าธรรมเนียม GACP', () => {
        expect(text).not.toContain('ค่าธรรมเนียม GACP');
        // fix/fee-line-descriptions (operator 2026-10-03): the catalogue name, not the
        // generic "ค่าบริการ GACP" this used to pin.
        expect(text).toContain('งวดที่ 1 ค่าบริการตรวจสอบเอกสาร');
    });

    it('labels a juristic payer with company-name / Tax ID, never person labels', () => {
        expect(text).toContain('ชื่อบริษัท / Company Name');
        expect(text).toContain('เลขประจำตัวผู้เสียภาษี / Tax ID');
        expect(text).not.toContain('เลขประจำตัวประชาชน / ID No.');
        expect(text).toContain(VALID_JURISTIC_TAX_ID_FIXTURE);
    });

    it('titles the document ใบวางบิล / ใบแจ้งหนี้ (finance-documents-three-rulings: 3 docs, not 4)', () => {
        expect(text).toContain('ใบวางบิล');
        expect(text).toContain('ใบแจ้งหนี้');
    });
});

describe('[fix/invoice-pdf-truth] generateInvoicePdf — real render, individual payer (labels unchanged)', () => {
    it('keeps the individual payer labels exactly as before', async () => {
        const html = await tpl.generateInvoicePdf(
            checkoutInvoice({ invoiceNumber: 'INV-IND-TEST-M1', application: INDIVIDUAL_PAYER_APP }),
            { upload: false, htmlOnly: true },
        );
        const text = textOf(html);
        expect(text).toContain('ชื่อ-นามสกุล / Name');
        expect(text).toContain('เลขประจำตัวประชาชน / ID No.');
        expect(text).not.toContain('ชื่อบริษัท / Company Name');
    });
});

describe('[fix/invoice-pdf-truth] generateReceiptTaxInvoicePdf — real render, company payer', () => {
    let text;
    beforeAll(async () => {
        const html = await tpl.generateReceiptTaxInvoicePdf(
            {
                id: 'inv-truth-2',
                invoiceNumber: 'INV-CO-TEST-M1',
                receiptNumber: 'RCP-CO-TEST-M1',
                serviceType: 'CERTIFICATION_CHECKOUT_M1',
                totalAmount: 5885,
                subtotal: 5500,
                vat: 385,
                createdAt: new Date('2026-09-27T00:00:00Z'),
                paidAt: new Date('2026-09-27T00:00:00Z'),
                receiptIssuedAt: new Date('2026-09-27T00:00:00Z'),
                application: JURISTIC_PAYER_APP,
                applicant: {},
            },
            { upload: false, htmlOnly: true },
        );
        text = textOf(html);
    });

    it('never prints the DTAM switchboard number or its email', () => {
        expect(text).not.toContain('0-2591-7007');
        expect(text).not.toContain('contact@gacpth.com');
    });

    it('never prints a gmail address, and prints finance@gacpth.com instead', () => {
        expect(text).not.toMatch(/gmail\.com/i);
        expect(text).toContain('finance@gacpth.com');
    });

    it('names the charge ค่าบริการ, not ค่าธรรมเนียม GACP', () => {
        expect(text).not.toContain('ค่าธรรมเนียม GACP');
    });

    it('labels a juristic payer with company-name / Tax ID, never person labels', () => {
        expect(text).toContain('ชื่อบริษัท / Company Name');
        expect(text).toContain('เลขประจำตัวผู้เสียภาษี / Tax ID');
        expect(text).not.toContain('เลขประจำตัว / ID No.');
    });
});

describe('[fix/invoice-pdf-truth] buildCompanyContactLine — no phone while PENDING/empty, never the ministry number', () => {
    it('never contains the DTAM switchboard, a gmail address, or a PENDING placeholder', () => {
        const line = tpl.buildCompanyContactLine();
        expect(line).not.toContain('0-2591-7007');
        expect(line).not.toMatch(/gmail\.com/i);
        expect(line).not.toMatch(/PENDING/);
    });

    it('omits the phone segment entirely while contactPhone is PENDING (today\'s real config)', () => {
        if (String(PLATFORM_ISSUER.contactPhone).startsWith('PENDING')) {
            const line = tpl.buildCompanyContactLine();
            expect(line).not.toMatch(/โทร/);
            expect(line).toContain('อีเมล:');
        }
    });

    it('prints the real phone once PLATFORM_CONTACT_PHONE is set, through the actual env-override path', () => {
        const prevPhone = process.env.PLATFORM_CONTACT_PHONE;
        process.env.PLATFORM_CONTACT_PHONE = '02-000-0000';
        let line;
        jest.isolateModules(() => {
            const freshTpl = require('../../services/pdf/invoice-template-service');
            line = freshTpl.buildCompanyContactLine();
        });
        if (prevPhone === undefined) { delete process.env.PLATFORM_CONTACT_PHONE; } else { process.env.PLATFORM_CONTACT_PHONE = prevPhone; }
        expect(line).toContain('โทร: 02-000-0000');
        expect(line).not.toContain('0-2591-7007');
    });
});

describe('[fix/invoice-pdf-truth] serviceTypeLabel — legacy STATE rows stay untouched', () => {
    it('keeps the legacy STATE labels exactly as they were (retired separately)', () => {
        expect(tpl.serviceTypeLabel('PHASE_1_STATE_FEE')).toBe('ค่าธรรมเนียมรัฐ ขั้นที่ 1 (ตรวจเอกสาร)');
        expect(tpl.serviceTypeLabel('APPLICATION_FEE')).toBe('ค่าธรรมเนียมยื่นคำขอ GACP');
        expect(tpl.serviceTypeLabel('PHASE_2_STATE_FEE')).toBe('ค่าธรรมเนียมรัฐ ขั้นที่ 2 (ตรวจประเมิน)');
        expect(tpl.serviceTypeLabel('AUDIT_FEE')).toBe('ค่าธรรมเนียมการตรวจประเมิน');
        expect(tpl.serviceTypeLabel('PHASE_2_AUDIT')).toBe('ค่าธรรมเนียมตรวจประเมิน ขั้นที่ 2');
    });

    it('the real checkout serviceType is named from the catalogue, and says ค่าบริการ, not ค่าธรรมเนียม', () => {
        expect(tpl.serviceTypeLabel('CERTIFICATION_CHECKOUT_M1')).toBe('งวดที่ 1 ค่าบริการตรวจสอบเอกสาร');
        expect(tpl.serviceTypeLabel('CERTIFICATION_CHECKOUT_M1')).not.toContain('ค่าธรรมเนียม');
    });
});

describe('[fix/invoice-pdf-truth] buildAdjustmentNoteContext — company contact line (credit/debit notes share this)', () => {
    it('COMPANY_CONTACT_LINE is present and never the ministry line', () => {
        const ctx = tpl.buildAdjustmentNoteContext(
            {
                creditNoteNumber: 'CN-TEST-1',
                originalInvoice: {
                    invoiceNumber: 'INV-TEST-1',
                    serviceType: 'PHASE_1_PLATFORM_FEE',
                    subtotal: 1000, vat: 70, totalAmount: 1070,
                    billingName: 'บริษัท ตัวอย่าง จำกัด',
                    billingAddress: '99/9 ถนนตัวอย่าง กรุงเทพฯ 10110',
                },
                subtotal: 100, vat: 7, totalAmount: 107,
                reason: 'ทดสอบ',
            },
            { docNumber: 'CN-TEST-1', docTypeTh: 'ใบลดหนี้', docTypeEn: 'CREDIT NOTE' },
        );
        expect(ctx.COMPANY_CONTACT_LINE).toBeDefined();
        expect(ctx.COMPANY_CONTACT_LINE).not.toContain('0-2591-7007');
        expect(ctx.COMPANY_CONTACT_LINE).not.toContain('contact@gacpth.com');
        expect(ctx.MINISTRY_CONTACT_LINE).toBeUndefined();
    });
});
