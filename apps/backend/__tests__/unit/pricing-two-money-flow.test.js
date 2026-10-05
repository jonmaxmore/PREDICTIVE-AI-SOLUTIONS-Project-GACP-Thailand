/**
 * C1-03 — ตัวเลขที่ /pricing/calculate ประเมินให้ ต้องตรงกับเลขคณิตของใบแจ้งหนี้ที่ผูกพัน
 *
 * ── โมเดลปัจจุบัน (operator 2026-09-11) ──
 *   ค่าบริการก้อนเดียวต่องวด ไม่มีการแยกค่าธรรมเนียมรัฐ ไม่มีบรรทัดใดยกเว้น VAT
 *   ต่อหนึ่งรูปแบบการปลูก: งวด 1 = 5,500 + VAT 385 = 5,885 · งวด 2 = 27,500 + VAT 1,925 = 29,425
 *
 * หัวไฟล์เดิมอธิบาย "two-money-flow": ค่าธรรมเนียมรัฐยกเว้น VAT ตาม ม.77/1(10)
 * ค่าแพลตฟอร์ม 10% และ VAT คิดเฉพาะส่วนแพลตฟอร์ม (รวม 33,210) — เลิกใช้ตั้งแต่ W14
 * และถอดออกจากโค้ดทั้งหมด 2026-09-11
 *
 * The breakdown is built on the canonical billing engine (modules/billing),
 * the same one quotation-service uses to write real invoices — these tests
 * pin that the estimate and the invoice can never diverge again.
 */

// Mock the only DB-touching import in the route's require chain so this suite
// runs without a database (locally this dev box has no Docker; the existing
// pricing-phase2-area-count suite skips that and only passes on CI).
jest.mock('../../services/system-config-service', () => ({
    getValue: jest.fn().mockResolvedValue(null),
}));

const { buildEstimateBreakdown, computePricing } = require('../../routes/api/finance/pricing');
const { calculateApplicationFees } = require('../../modules/billing');

describe('C1-03 — ตัวประเมินราคาตรงกับใบแจ้งหนี้ที่ผูกพัน', () => {
    test('1 รูปแบบ ทั้งสองงวด → 35,310 (5,885 + 29,425)', () => {
        const e = buildEstimateBreakdown({ areaCount: 1, includeInspection: true });
        expect(e.breakdown.phase1.phaseTotal).toBe(5885);
        expect(e.breakdown.phase2.phaseTotal).toBe(29425);
        expect(e.total).toBe(35310);
        expect(e.total).not.toBe(33000); // ยอดก่อน VAT ไม่ใช่ยอดที่ต้องจ่าย
    });

    test('VAT คิดจากค่าบริการทั้งก้อน', () => {
        // W14 (operator ruling 2026-08-22, the change log c28355ea): this test
        // previously asserted the opposite — that VAT touched the platform fee
        // ONLY and the state fee was VAT-exempt. With one issuer, the whole
        // ค่าบริการ is the company's own supply, so all of it is taxed.
        const e = buildEstimateBreakdown({ areaCount: 1, includeInspection: true });
        // platform = 10% of state; VAT = 7% of (state + platform)
        expect(e.breakdown.phase1.serviceFeeAmount).toBe(5500);
        expect(e.breakdown.phase1.vatAmount).toBe(385);   // 7% ของ 5,500
        expect(e.breakdown.phase2.serviceFeeAmount).toBe(27500);
        expect(e.breakdown.phase2.vatAmount).toBe(1925);  // 7% ของ 27,500
        expect(e.vat).toBe(385 + 1925);
        expect(e.breakdown.serviceFeeTotal).toBe(33000);
    });

    test('subtotal (pre-VAT) + vat === total, and vat is no longer hardcoded 0', () => {
        const e = buildEstimateBreakdown({ areaCount: 2, includeInspection: true });
        expect(e.subtotal + e.vat).toBe(e.total);
        expect(e.vat).toBeGreaterThan(0);
    });

    test('scales per cultivation scope (areaCount 3 → 3 × 35,310)', () => {
        const e = buildEstimateBreakdown({ areaCount: 3, includeInspection: true });
        expect(e.scopeCount).toBe(3);
        expect(e.total).toBe(3 * 35310);
    });

    test('includeInspection: false → งวด 1 อย่างเดียว (5,885 ต่อรูปแบบ) งวด 2 เป็น null', () => {
        const e = buildEstimateBreakdown({ areaCount: 1, includeInspection: false });
        expect(e.breakdown.phase2).toBeNull();
        expect(e.total).toBe(5885);
    });

    test('หนึ่งบรรทัดต่องวด ไม่มีธงยกเว้น VAT และผลรวมเท่ายอดก่อน VAT', () => {
        const e = buildEstimateBreakdown({ areaCount: 1, includeInspection: true });
        expect(e.items.map((i) => i.total)).toEqual([5500, 27500]);
        // ไม่มีบรรทัดใดถือธงยกเว้น VAT — ธงที่เหลืออยู่บนบรรทัดที่ไม่มีการยกเว้น
        // คือคำเชิญให้คนอ่านเชื่อว่ายังมีการยกเว้น
        expect(e.items.some((i) => 'vatExempt' in i)).toBe(false);
        const itemsSum = e.items.reduce((s, i) => s + i.total, 0);
        expect(itemsSum).toBe(e.subtotal);
    });

    test('estimate equals the canonical engine output (cannot drift from the invoice)', () => {
        const e = buildEstimateBreakdown({ areaCount: 2, includeInspection: true });
        const engine = calculateApplicationFees({}, { scopeCount: 2 });
        expect(e.total).toBe(engine.grandTotal);
        expect(e.breakdown.serviceFeeTotal).toBe(engine.serviceFeeTotal);
        expect(e.breakdown.vatTotal).toBe(engine.vatTotal);
    });

    test('invalid areaCount falls back to 1 scope', () => {
        expect(buildEstimateBreakdown({ areaCount: 0 }).scopeCount).toBe(1);
        expect(buildEstimateBreakdown({ areaCount: NaN }).scopeCount).toBe(1);
    });

    test('computePricing คืนยอดก่อน VAT ล้วน ๆ', () => {
        const r = computePricing({ areaCount: 3, includeInspection: true });
        expect(r.phase1Total).toBe(16500);
        expect(r.phase2Total).toBe(82500);
        expect(r.total).toBe(99000);
    });
});
