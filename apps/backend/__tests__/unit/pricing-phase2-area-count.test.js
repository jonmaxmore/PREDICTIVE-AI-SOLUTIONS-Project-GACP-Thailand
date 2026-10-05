/**
 * 2026-09-11 — ตัวเลขในไฟล์นี้คือ **ค่าบริการก่อน VAT** ต่อรูปแบบการปลูก
 * (operator เลิกแยกค่าธรรมเนียมรัฐ) · ยอดที่ผู้ยื่นจ่ายจริงคือยอดนี้บวก VAT 7%
 */
/**
 * Tests for the pricing-route phase-2 areaCount multiplier (P0-6 in
 * the 2026-04-28 system cohesion audit).
 *
 * Before the fix, /api/pricing/calculate did:
 *   phase2Total = includeInspection ? inspectionFee : 0;
 * Multi-method applications were under-quoted on phase 2 — calculated
 * as 25,000 regardless of areaCount, while the canonical
 * calculatePhase2Fee in fee-service multiplies by scopeCount.
 */

// `require` returns the express router; computePricing is exposed as
// router.computePricing for unit testing.
const { computePricing } = require('../../routes/api/finance/pricing');

describe('pricing helper — P0-6 phase-2 areaCount fix', () => {
    test('areaCount: 3, includeInspection: true → phase2Total === 82500', () => {
        const result = computePricing({ areaCount: 3, includeInspection: true });
        expect(result.phase2Total).toBe(82500);
    });

    test('areaCount: 1 → phase2Total === 27500', () => {
        const result = computePricing({ areaCount: 1, includeInspection: true });
        expect(result.phase2Total).toBe(27500);
    });

    test('areaCount: 2 → phase2Total === 55000', () => {
        const result = computePricing({ areaCount: 2, includeInspection: true });
        expect(result.phase2Total).toBe(55000);
    });

    test('phase 1 also scales with areaCount (regression guard)', () => {
        const result = computePricing({ areaCount: 3, includeInspection: true });
        expect(result.phase1Total).toBe(16500);
    });

    test('includeInspection: false → phase2Total === 0', () => {
        const result = computePricing({ areaCount: 3, includeInspection: false });
        expect(result.phase2Total).toBe(0);
    });

    test('total = phase1Total + phase2Total', () => {
        const result = computePricing({ areaCount: 3, includeInspection: true });
        expect(result.total).toBe(16500 + 82500);
    });
});
