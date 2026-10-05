'use strict';
/**
 * fix/fee-line-descriptions — ทุกเอกสารการเงินเรียกบรรทัดเดียวกันด้วยชื่อเดียวกัน และบอกว่าครอบคลุมอะไร
 *
 * มติ operator 2026-10-03: ค่าบริการก้อนเดียว ห้ามแยกส่วนกรม/ส่วนแพลตฟอร์ม แต่ทุกเอกสาร
 * ต้องตั้งชื่อบรรทัดตามแค็ตตาล็อกเดียว และระบุชัดว่าครอบคลุมอะไร (กรมจะได้ไม่ต้องถามว่า
 * "ทำไมเก็บเกินค่าบริการ") · งวดที่ 2 ไม่รวมค่าเดินทาง ค่าที่พัก หรือค่าตอบแทนผู้ตรวจ
 *
 * ก่อนแก้: ใบวางบิล/ใบเสร็จของ checkout พิมพ์ "ค่าบริการ GACP" (serviceTypeLabel ไม่รู้จัก
 * CERTIFICATION_CHECKOUT_M1/M2) · ใบเสนอราคาพิมพ์ชื่อไม่มีคำว่างวด + รายละเอียดใต้บรรทัด
 * "งวดที่ 1 · ค่าตรวจเอกสาร" · บรรทัดที่บันทึกตอน checkout ชื่อ "ค่าบริการตรวจประเมินและ
 * รับรองมาตรฐาน GACP" · ประมาณราคา /api/pricing เรียก "ค่าบริการตรวจประเมินภาคสนาม"
 *
 * ยอดเงิน: ทุกชุดข้างล่างตรึงยอดที่พิมพ์ไว้ด้วย — งานนี้เปลี่ยนคำอธิบายเท่านั้น
 */

const mockCapture = { html: '' };
jest.mock('../../services/pdf/pdf-generator.service', () => {
    // The real singleton (its methods live on the prototype, so no spread):
    // real template read + substitution, only the Puppeteer step captured.
    const actual = jest.requireActual('../../services/pdf/pdf-generator.service');
    actual.generatePDF = async (html) => { mockCapture.html = html; return Buffer.from('PDF'); };
    return actual;
});

const catalogue = require('../../shared/instalment-service-names');
const tpl = require('../../services/pdf/invoice-template-service');
const { PLATFORM_ISSUER } = require('../../config/invoice-issuers');

jest.setTimeout(30000);

// ── แค็ตตาล็อกตามมติ — คำต่อคำ ──────────────────────────────────────────────────
const P1_NAME = 'งวดที่ 1 ค่าบริการตรวจสอบเอกสาร';
const P1_COVERAGE = 'ครอบคลุม: รับและตรวจความครบถ้วน ความถูกต้องของเอกสารคำขอตามหลักเกณฑ์ GACP · ตรวจเบื้องต้นด้วยระบบ · แจ้งผลและรับเอกสารแก้ไข · จัดเก็บเอกสารอิเล็กทรอนิกส์ · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์';
const P2_NAME = 'งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง';
const P2_COVERAGE = 'ครอบคลุม: นัดหมายและตรวจประเมินแปลงปลูก ณ สถานที่จริง · บันทึกหลักฐานการตรวจ · ออกใบรับรองอิเล็กทรอนิกส์พร้อมลายมือชื่อดิจิทัลและ QR ตรวจสอบย้อนกลับ · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์';
const RN_NAME = 'ค่าบริการต่ออายุใบรับรอง';
const RN_COVERAGE = 'ครอบคลุม: ตรวจประเมินเพื่อต่ออายุ · ออกใบรับรองฉบับใหม่พร้อมลายมือชื่อดิจิทัลและ QR · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์';
const VAT_NAME = 'ภาษีมูลค่าเพิ่ม 7% คิดจากค่าบริการทั้งจำนวน';

// HTML escaping leaves Thai text and "·" alone; ":" too. These strings appear verbatim.
const esc = (s) => s.replace(/&/g, '&amp;');

describe('the catalogue is the ruling, verbatim', () => {
    test('PHASE_1 / PHASE_2 / RENEWAL names and coverage', () => {
        const c = catalogue.SERVICE_CATALOGUE;
        expect(c.PHASE_1.name).toBe(P1_NAME);
        expect(c.PHASE_1.coverage).toBe(P1_COVERAGE);
        expect(c.PHASE_2.name).toBe(P2_NAME);
        expect(c.PHASE_2.coverage).toBe(P2_COVERAGE);
        expect(c.RENEWAL.name).toBe(RN_NAME);
        expect(c.RENEWAL.coverage).toBe(RN_COVERAGE);
        for (const key of ['PHASE_1', 'PHASE_2', 'RENEWAL']) {
            expect(c[key].nameEn).toMatch(/\S/);
            expect(c[key].coverageEn).toMatch(/^Covers: /);
        }
    });

    test('the VAT line reads the rate it is given, not a literal 7', () => {
        expect(catalogue.vatLine(0.07).name).toBe(VAT_NAME);
        expect(catalogue.vatLine(0.1).name).toBe('ภาษีมูลค่าเพิ่ม 10% คิดจากค่าบริการทั้งจำนวน');
        expect(catalogue.vatLine(0.07).nameEn).toMatch(/7%/);
    });

    test('a checkout milestone resolves to its service; a renewal M2 to RENEWAL', () => {
        expect(catalogue.serviceForServiceType('CERTIFICATION_CHECKOUT_M1').name).toBe(P1_NAME);
        expect(catalogue.serviceForServiceType('CERTIFICATION_CHECKOUT_M2').name).toBe(P2_NAME);
        expect(catalogue.serviceForServiceType('CERTIFICATION_CHECKOUT_M2', { isRenewal: true }).name).toBe(RN_NAME);
        expect(catalogue.serviceForServiceType('SUBSCRIPTION_PREMIUM_MONTHLY')).toBeNull();
    });

    test('Phase 2 claims no inspector travel, lodging or honoraria', () => {
        const all = JSON.stringify(catalogue.catalogueForApi(0.07));
        expect(all).not.toMatch(/ค่าเดินทาง|ค่าที่พัก|ค่าตอบแทน|ค่าพาหนะ|travel|lodging|honorari/i);
    });
});

// ── ใบวางบิล + ใบเสร็จ (real template, htmlOnly) ─────────────────────────────────
const NEW_APP = {
    id: 'app-new',
    applicationNumber: 'APP-LINES-NEW',
    formData: { plantId: 'cannabis', cultivationMethods: ['OUTDOOR'], applicantType: 'INDIVIDUAL', applicantData: { firstName: 'ก', lastName: 'ข' } },
};
const RENEWAL_APP = {
    id: 'app-ren',
    applicationNumber: 'APP-LINES-REN',
    formData: { ...NEW_APP.formData, renewalOf: 'cert-old-1' },
};

function checkoutInvoice(milestone, application, amounts) {
    return {
        id: `inv-${milestone}`,
        invoiceNumber: `INV-CO-LINES-${milestone}`,
        serviceType: `CERTIFICATION_CHECKOUT_${milestone}`,
        ...amounts,
        createdAt: new Date('2026-10-03T00:00:00Z'),
        dueDate: new Date('2026-10-10T00:00:00Z'),
        paidAt: new Date('2026-10-03T05:00:00Z'),
        receiptIssuedAt: new Date('2026-10-03T05:00:00Z'),
        receiptNumber: `TAX-PRD-LINES-${milestone}`,
        paymentMethod: 'STRIPE',
        application,
        applicant: {},
    };
}

const CASES = [
    ['M1 new filing', 'M1', NEW_APP, { subtotal: 5500, vat: 385, totalAmount: 5885 }, P1_NAME, P1_COVERAGE, ['5,500.00', '385.00', '5,885.00']],
    ['M2 new filing', 'M2', NEW_APP, { subtotal: 27500, vat: 1925, totalAmount: 29425 }, P2_NAME, P2_COVERAGE, ['27,500.00', '1,925.00', '29,425.00']],
    ['M2 renewal', 'M2', RENEWAL_APP, { subtotal: 33000, vat: 2310, totalAmount: 35310 }, RN_NAME, RN_COVERAGE, ['33,000.00', '2,310.00', '35,310.00']],
];

describe.each(CASES)('%s — invoice and receipt', (_label, milestone, app, amounts, name, coverage, printed) => {
    let invoiceHtml;
    let receiptHtml;
    beforeAll(async () => {
        invoiceHtml = await tpl.generateInvoicePdf(checkoutInvoice(milestone, app, amounts), { upload: false, htmlOnly: true });
        receiptHtml = await tpl.generateReceiptTaxInvoicePdf(checkoutInvoice(milestone, app, amounts), { upload: false, htmlOnly: true });
    });

    test('the invoice line is the catalogue name, with the coverage under it', () => {
        expect(invoiceHtml).toContain(esc(name));
        expect(invoiceHtml).toContain(esc(coverage));
        expect(invoiceHtml).not.toContain('ค่าบริการ GACP');
    });

    test('the receipt line is the catalogue name, with the coverage under it', () => {
        expect(receiptHtml).toContain(esc(name));
        expect(receiptHtml).toContain(esc(coverage));
        expect(receiptHtml).not.toContain('ค่าบริการ GACP');
    });

    test('the VAT row names its base from the served rate', () => {
        expect(PLATFORM_ISSUER.vatRate).toBe(0.07);
        expect(invoiceHtml).toContain(VAT_NAME);
        expect(receiptHtml).toContain(VAT_NAME);
    });

    test('amounts printed are the row`s own (subtotal, VAT, total) — unchanged', () => {
        for (const figure of printed) {
            expect(invoiceHtml).toContain(figure);
        }
        // The receipt body prints Arabic digits for the line and the totals.
        for (const figure of printed) {
            expect(receiptHtml).toContain(figure);
        }
    });
});

// ── ใบเสนอราคา ─────────────────────────────────────────────────────────────────
function row({ renewal = false, scopes = 1 } = {}) {
    const p1 = { phase: 'PHASE_1', amount: 5885 * scopes, serviceFeeAmount: 5500 * scopes, vatAmount: 385 * scopes, scopeCount: scopes };
    const p2 = renewal
        ? { phase: 'PHASE_2', amount: 35310 * scopes, serviceFeeAmount: 33000 * scopes, vatAmount: 2310 * scopes, scopeCount: scopes }
        : { phase: 'PHASE_2', amount: 29425 * scopes, serviceFeeAmount: 27500 * scopes, vatAmount: 1925 * scopes, scopeCount: scopes };
    return {
        quotationNumber: 'QT-PRD-2026-LINES',
        issuerType: 'PLATFORM',
        status: 'PENDING',
        totalAmount: String(renewal ? p2.amount : p1.amount + p2.amount),
        installments: renewal ? [p2] : [p1, p2],
        acceptedSnapshot: null,
        validUntil: new Date('2026-10-12T00:00:00Z'),
    };
}

const THREE_APP = {
    ...NEW_APP,
    totalAreaTypes: 3,
    formData: { ...NEW_APP.formData, cultivationMethods: ['INDOOR', 'GREENHOUSE', 'OUTDOOR'] },
};

describe('quotation PDF lines', () => {
    beforeEach(() => { mockCapture.html = ''; });

    test.each([
        ['phase 1, three types', THREE_APP, 1, row({ scopes: 3 }), P1_NAME, P1_COVERAGE, 3, '17,655.00', '5,885.00'],
        ['phase 2, three types', THREE_APP, 2, row({ scopes: 3 }), P2_NAME, P2_COVERAGE, 3, '88,275.00', '29,425.00'],
        ['renewal, one type', RENEWAL_APP, 2, row({ renewal: true }), RN_NAME, RN_COVERAGE, 1, '35,310.00', '35,310.00'],
    ])('%s: every line is the name + its coverage; totals unchanged', async (_l, application, phase, quotationRow, name, coverage, lines, total, perLine) => {
        await tpl.generateQuotationPdf({ application, issuerSide: 'PLATFORM', phase, quotationRow }, { upload: false });
        const html = mockCapture.html;
        const count = (s) => html.split(esc(s)).length - 1;
        expect(count(name)).toBe(lines);
        expect(count(coverage)).toBe(lines);
        expect(html).toContain(total);
        expect(html.split(perLine).length - 1).toBeGreaterThanOrEqual(lines);
        // Retired variants: the old detail line and the old stage caption.
        expect(html).not.toContain('งวดที่ 1 · ค่าตรวจเอกสาร');
        expect(html).not.toContain('งวดที่ 2 · ค่าตรวจประเมินพื้นที่');
        expect(html).not.toContain('ค่าบริการและภาษีมูลค่าเพิ่ม (');
        expect(html).not.toContain('ค่าบริการตรวจประเมินและรับรองมาตรฐาน');
    });

    test('a renewal never prints an instalment name', async () => {
        await tpl.generateQuotationPdf({ application: RENEWAL_APP, issuerSide: 'PLATFORM', phase: 2, quotationRow: row({ renewal: true }) }, { upload: false });
        expect(mockCapture.html).not.toContain(P2_NAME);
        expect(mockCapture.html).not.toMatch(/งวดที่ 2/);
    });

    test('the quotation API copy serves the same names + coverage for the application', () => {
        const fresh = tpl.buildQuotationCopy(NEW_APP).services;
        expect(fresh.PHASE_1).toMatchObject({ name: P1_NAME, coverage: P1_COVERAGE });
        expect(fresh.PHASE_2).toMatchObject({ name: P2_NAME, coverage: P2_COVERAGE });
        expect(fresh.VAT.name).toBe(VAT_NAME);
        const renewal = tpl.buildQuotationCopy(RENEWAL_APP).services;
        expect(renewal.PHASE_1).toBeNull();
        expect(renewal.PHASE_2).toMatchObject({ name: RN_NAME, coverage: RN_COVERAGE });
    });

    test('the opening paragraph no longer names a retired variant', () => {
        expect(tpl.buildQuotationCopy(NEW_APP).intro).not.toContain('ค่าบริการตรวจประเมินและรับรองมาตรฐาน');
    });
});

// ── บรรทัดที่บันทึกตอนชำระสำเร็จ (ใบกำกับภาษีใน checkout_documents) ───────────────────
describe('settlement document payload', () => {
    const { buildSettlementDocumentPayload } = require('../../services/checkout/checkout-settlement-service');
    const order = (milestone, application, net, vat) => ({
        id: 'co-1', applicationId: application.id, milestone, application,
        platformFeeNet: net, platformFeeVat: vat, totalPayableAmount: net + vat,
    });

    test.each([
        ['M1', NEW_APP, 5500, 385, P1_NAME],
        ['M2', NEW_APP, 27500, 1925, P2_NAME],
        ['M2', RENEWAL_APP, 33000, 2310, RN_NAME],
    ])('%s %#: the line is the catalogue name; money fields unchanged', (milestone, app, net, vat, name) => {
        const { taxInvoice } = buildSettlementDocumentPayload(order(milestone, app, net, vat), { company: 'TAX-1' }, new Date('2026-10-03T00:00:00Z'));
        expect(taxInvoice.lines).toEqual([{ code: 'PLATFORM_FEE', description: name, amount: String(net) }]);
        expect(taxInvoice.serviceFee).toBe(String(net));
        expect(taxInvoice.vat).toEqual({ rate: PLATFORM_ISSUER.vatRate, amount: String(vat), base: String(net) });
        expect(taxInvoice.total).toBe(String(net + vat));
    });
});

// ── payment-fees + /api/pricing ────────────────────────────────────────────────
describe('payment-fees and the pricing API name lines from the catalogue', () => {
    const { computePhaseBreakdown, PAYMENT_FEES } = require('../../config/payment-fees');
    const pricing = require('../../routes/api/finance/pricing');

    test.each([[1, P1_NAME], [2, P2_NAME]])('computePhaseBreakdown(%s)', (phase, name) => {
        const b = computePhaseBreakdown(phase);
        expect(b.lineItems[0].description).toBe(name);
        expect(b.lineItems[1].description).toBe(VAT_NAME);
        // amounts unchanged
        expect(b.lineItems[0].amount).toBe(phase === 1 ? PAYMENT_FEES.PHASE_1_SERVICE_FEE : PAYMENT_FEES.PHASE_2_SERVICE_FEE);
        expect(b.lineItems[1].amount).toBe(phase === 1 ? PAYMENT_FEES.PHASE_1_VAT : PAYMENT_FEES.PHASE_2_VAT);
        expect(b.total).toBe(b.serviceFee + b.vat);
    });

    test('the estimate names both instalments from the catalogue; totals unchanged', () => {
        const est = pricing.buildEstimateBreakdown({ areaCount: 2 });
        expect(est.items.map((i) => i.description)).toEqual([P1_NAME, P2_NAME]);
        expect(est.total).toBe((5885 + 29425) * 2);
    });

    test('GET /api/pricing/fees serves names and coverage', () => {
        const payload = pricing.defaultFeesPayload();
        expect(payload.services.PHASE_1).toMatchObject({ name: P1_NAME, coverage: P1_COVERAGE });
        expect(payload.services.PHASE_2).toMatchObject({ name: P2_NAME, coverage: P2_COVERAGE });
        expect(payload.services.RENEWAL).toMatchObject({ name: RN_NAME, coverage: RN_COVERAGE });
        expect(payload.services.VAT.name).toBe(VAT_NAME);
        // amounts unchanged
        expect(payload.phase1TotalPerScope).toBe(5885);
        expect(payload.phase2TotalPerScope).toBe(29425);
        expect(payload.renewalTotalPerScope).toBe(35310);
    });
});
