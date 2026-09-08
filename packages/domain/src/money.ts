// เงินทุกค่าเป็นสตางค์จำนวนเต็ม อัตราเป็น basis points (10000 = 100%) เพื่อไม่ให้มีทศนิยมลอยตัวในเส้นเงิน

export type Satang = number;

export const VAT_RATE_BASIS_POINTS_DEFAULT = 700;

function assertSatang(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} ต้องเป็นสตางค์จำนวนเต็มไม่ติดลบ ได้รับ ${value}`);
  }
}

export function bahtToSatang(baht: number): Satang {
  const satang = Math.round(baht * 100);
  assertSatang(satang, 'จำนวนเงิน');
  return satang;
}

// ปัดครึ่งสตางค์ขึ้น (half up) ด้วยเลขจำนวนเต็มล้วน
export function applyRateBasisPoints(amountSatang: Satang, rateBasisPoints: number): Satang {
  assertSatang(amountSatang, 'จำนวนเงิน');
  if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0) {
    throw new RangeError(`อัตราต้องเป็น basis points จำนวนเต็มไม่ติดลบ ได้รับ ${rateBasisPoints}`);
  }
  return Math.floor((amountSatang * rateBasisPoints + 5000) / 10000);
}

export type QuotationLineInput = {
  readonly stateFeeSatang: Satang;
  readonly serviceFeeSatang: Satang;
};

export type QuotationTotals = {
  readonly stateFeeTotalSatang: Satang;
  readonly serviceFeeTotalSatang: Satang;
  readonly subtotalSatang: Satang;
  readonly vatSatang: Satang;
  readonly netSatang: Satang;
};

// ก้อนเดียวหน้าบ้าน: ค่าธรรมเนียม + ค่าบริการ = ยอดรวมก่อนภาษี บวก VAT เต็มทั้งก้อน = ยอดรวมสุทธิ
export function calculateQuotationTotals(
  lines: readonly QuotationLineInput[],
  vatRateBasisPoints: number = VAT_RATE_BASIS_POINTS_DEFAULT,
): QuotationTotals {
  if (lines.length === 0) throw new RangeError('ใบเสนอราคาต้องมีอย่างน้อยหนึ่งบรรทัด');
  let stateFeeTotalSatang = 0;
  let serviceFeeTotalSatang = 0;
  for (const line of lines) {
    assertSatang(line.stateFeeSatang, 'ค่าธรรมเนียม');
    assertSatang(line.serviceFeeSatang, 'ค่าบริการ');
    stateFeeTotalSatang += line.stateFeeSatang;
    serviceFeeTotalSatang += line.serviceFeeSatang;
  }
  const subtotalSatang = stateFeeTotalSatang + serviceFeeTotalSatang;
  const vatSatang = applyRateBasisPoints(subtotalSatang, vatRateBasisPoints);
  return {
    stateFeeTotalSatang,
    serviceFeeTotalSatang,
    subtotalSatang,
    vatSatang,
    netSatang: subtotalSatang + vatSatang,
  };
}
