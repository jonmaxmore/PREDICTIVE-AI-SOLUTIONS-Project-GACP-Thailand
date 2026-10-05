/**
 * Unit Tests — Split-Payment Calculator
 * Tests: FIN-01, FIN-02, FIN-03 (Calculation Check)
 *
 * Wave 0 (docs/payment-refactor/legacy-payment-audit.md): the dead wrappers
 * calculateSplitPayment / calculateFullPaymentSummary / buildTaxInvoiceLineItems
 * were removed with their only caller (the /invoices/split-calculator route).
 * The flat per-phase math they wrapped lives in config/payment-fees
 * computePhaseBreakdown, pinned directly here; the live aggregation surface
 * (classifyRevenueType + calculateRevenueSplit) keeps its tests unchanged.
 */

const {
  calculateRevenueSplit,
  classifyRevenueType,
} = require('../../services/split-payment-calculator');
const { computePhaseBreakdown } = require('../../config/payment-fees');

describe('split-payment-calculator', () => {
  // W14 (operator ruling 2026-08-22, the change log c28355ea): VAT is 7% of the
  // WHOLE ค่าบริการ (ราคาเต็ม + ค่าแพลตฟอร์ม), not of the platform portion alone.
  // `serviceFee` in THIS module still names only the platform 10% — the field
  // name predates the ruling and is left alone so the change stays a money
  // change and not a rename sweep. The VAT figures below moved accordingly.

  // FIN-01: งวดที่ 1 = ค่าบริการ 5,500 + VAT 385 = 5,885
  it('FIN-01: งวดที่ 1 รวม 5,885', () => {
    const result = computePhaseBreakdown(1);
    expect(result.serviceFee).toBe(5500);
    expect(result.vat).toBe(385);
    expect(result.total).toBe(5885);
  });

  // FIN-02: งวดที่ 2 = ค่าบริการ 27,500 + VAT 1,925 = 29,425
  it('FIN-02: งวดที่ 2 รวม 29,425', () => {
    const result = computePhaseBreakdown(2);
    expect(result.serviceFee).toBe(27500);
    expect(result.vat).toBe(1925);
    expect(result.total).toBe(29425);
  });

  // FIN-03: VAT = 7% ของค่าบริการ
  it('FIN-03: VAT เป็น 7% ของค่าบริการ', () => {
    for (const phase of [1, 2]) {
      const b = computePhaseBreakdown(phase);
      expect(b.vat).toBe(Math.round(b.serviceFee * 0.07));
    }
  });

  // ── walletA / walletB ถูกถอด 2026-09-11 ────────────────────────────────────
  // operator สั่งถอดระบบนำส่งเงินให้กรมทั้งชุด · เดิม walletA = ยอดที่บริษัทเป็นหนี้กรม
  // walletB = ส่วนที่บริษัทเก็บไว้ · เมื่อไม่มีหนี้ที่ต้องนำส่ง ก็ไม่มีสองกระเป๋าให้แยก
  it('ไม่มี walletA / walletB เหลืออยู่', () => {
    const b = computePhaseBreakdown(1);
    expect(b.walletA).toBeUndefined();
    expect(b.walletB).toBeUndefined();
    // และไม่มีช่องยอดส่วนรัฐ
    expect(b.govFee).toBeUndefined();
  });

  // Revenue classification
  it('should classify service types correctly', () => {
    expect(classifyRevenueType('PHASE_1_STATE_FEE')).toBe('GOV');
    expect(classifyRevenueType('APPLICATION_FEE')).toBe('GOV');
    expect(classifyRevenueType('AUDIT_FEE')).toBe('GOV');
    expect(classifyRevenueType('PHASE_1_PLATFORM_FEE')).toBe('PLATFORM');
    expect(classifyRevenueType('PHASE_2_PLATFORM_FEE')).toBe('PLATFORM');
  });

  // Revenue split from invoices
  it('should aggregate revenue split from paid invoices', () => {
    const invoices = [
      { serviceType: 'PHASE_1_STATE_FEE', totalAmount: 5000, status: 'PAID' },
      { serviceType: 'PHASE_1_PLATFORM_FEE', totalAmount: 535, status: 'PAID' },
      { serviceType: 'PHASE_2_STATE_FEE', totalAmount: 25000, status: 'PAID' },
      { serviceType: 'PHASE_2_PLATFORM_FEE', totalAmount: 2675, status: 'PAID' },
      { serviceType: 'PHASE_1_STATE_FEE', totalAmount: 5000, status: 'PENDING' }, // Should be excluded
    ];

    const split = calculateRevenueSplit(invoices);
    expect(split.walletA).toBe(30000);   // 5,000 + 25,000
    expect(split.walletB).toBe(3210);    // 535 + 2,675
    expect(split.paidCount).toBe(4);     // 4 paid, 1 pending excluded
    expect(split.totalRevenue).toBe(33210);
  });
});
