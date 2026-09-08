import { describe, expect, it } from 'vitest';
import {
  formatBahtFromSatang,
  formatThaiDate,
  formatThaiDateTime,
  toThaiDigits,
} from './format.ts';

describe('formatter ไทย', () => {
  it('แสดงวันที่เป็น พ.ศ. ตามเวลาไทย', () => {
    const date = new Date('2026-09-08T17:30:00+07:00');
    expect(formatThaiDate(date)).toBe('8 ก.ย. 2569');
    expect(formatThaiDate(date, 'long')).toBe('8 กันยายน 2569');
    expect(formatThaiDateTime(date)).toBe('8 ก.ย. 2569 17:30');
  });

  it('วันที่ใกล้เที่ยงคืน UTC ยังนับเป็นวันไทยที่ถูกต้อง', () => {
    expect(formatThaiDate(new Date('2026-12-31T18:00:00Z'))).toBe('1 ม.ค. 2570');
  });

  it('แปลงสตางค์เป็นบาทสองทศนิยม', () => {
    expect(formatBahtFromSatang(588_500)).toBe('5,885.00');
    expect(formatBahtFromSatang(1_177_000, { withUnit: true })).toBe('11,770.00 บาท');
    expect(formatBahtFromSatang(5)).toBe('0.05');
    expect(formatBahtFromSatang(-1_177_000)).toBe('-11,770.00');
  });

  it('ปฏิเสธสตางค์ที่ไม่ใช่จำนวนเต็ม', () => {
    expect(() => formatBahtFromSatang(10.5)).toThrow(RangeError);
  });

  it('แปลงเลขอารบิกเป็นเลขไทยเฉพาะเมื่อขอ', () => {
    expect(toThaiDigits('ส่วนที่ 1 ข้อ 12')).toBe('ส่วนที่ ๑ ข้อ ๑๒');
  });
});
