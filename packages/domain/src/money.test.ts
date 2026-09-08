import { describe, expect, it } from 'vitest';
import { applyRateBasisPoints, bahtToSatang, calculateQuotationTotals } from './money.ts';

describe('เงินเป็นสตางค์', () => {
  it('งวดที่ 1 หนึ่งรูปแบบการปลูก = 5,885.00 บาท', () => {
    const totals = calculateQuotationTotals([
      { stateFeeSatang: 500_000, serviceFeeSatang: 50_000 },
    ]);
    expect(totals.subtotalSatang).toBe(550_000);
    expect(totals.vatSatang).toBe(38_500);
    expect(totals.netSatang).toBe(588_500);
  });

  it('งวดที่ 1 สองรูปแบบการปลูก = 11,770.00 บาท และงวดที่ 2 = 58,850.00 บาท', () => {
    const first = calculateQuotationTotals([
      { stateFeeSatang: 500_000, serviceFeeSatang: 50_000 },
      { stateFeeSatang: 500_000, serviceFeeSatang: 50_000 },
    ]);
    expect(first.netSatang).toBe(1_177_000);
    const second = calculateQuotationTotals([
      { stateFeeSatang: 2_500_000, serviceFeeSatang: 250_000 },
      { stateFeeSatang: 2_500_000, serviceFeeSatang: 250_000 },
    ]);
    expect(second.netSatang).toBe(5_885_000);
    expect(first.netSatang + second.netSatang).toBe(7_062_000);
  });

  it('ต่ออายุงวดเดียว = 35,310.00 บาท', () => {
    const totals = calculateQuotationTotals([
      { stateFeeSatang: 3_000_000, serviceFeeSatang: 300_000 },
    ]);
    expect(totals.netSatang).toBe(3_531_000);
  });

  it('ปัดครึ่งสตางค์ขึ้น', () => {
    expect(applyRateBasisPoints(1, 700)).toBe(0);
    expect(applyRateBasisPoints(715, 700)).toBe(50);
    expect(applyRateBasisPoints(93, 700)).toBe(7);
  });

  it('ปฏิเสธเงินที่ไม่ใช่จำนวนเต็มหรือติดลบ และใบเสนอราคาว่าง', () => {
    expect(() => calculateQuotationTotals([{ stateFeeSatang: 10.5, serviceFeeSatang: 0 }])).toThrow(
      RangeError,
    );
    expect(() => calculateQuotationTotals([{ stateFeeSatang: -1, serviceFeeSatang: 0 }])).toThrow(
      RangeError,
    );
    expect(() => calculateQuotationTotals([])).toThrow(RangeError);
    expect(bahtToSatang(5885)).toBe(588_500);
  });
});
