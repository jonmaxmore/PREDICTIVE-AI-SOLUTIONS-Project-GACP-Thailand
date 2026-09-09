import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  addCalendarDays,
  compareCalendarDates,
  isBusinessDay,
  isWeekend,
  substituteHolidays,
  toHolidayCalendar,
} from './business-days.ts';

const holidays = toHolidayCalendar([
  { date: '2026-09-14', nameTh: 'วันหยุดทดสอบ' },
  { date: '2026-09-15', nameTh: 'วันหยุดทดสอบวันที่สอง' },
]);

describe('วันปฏิทิน', () => {
  it('บวกวันข้ามเดือนและปีอธิกสุรทิน', () => {
    expect(addCalendarDays('2026-09-09', 30)).toBe('2026-10-09');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('ปฏิเสธวันที่ไม่มีอยู่จริง', () => {
    expect(() => addCalendarDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => compareCalendarDates('9 ก.ย. 2569', '2026-09-09')).toThrow(RangeError);
  });

  it('รู้จักเสาร์อาทิตย์', () => {
    expect(isWeekend('2026-09-12')).toBe(true);
    expect(isWeekend('2026-09-13')).toBe(true);
    expect(isWeekend('2026-09-09')).toBe(false);
  });
});

describe('วันทำการ', () => {
  it('ข้ามเสาร์อาทิตย์และวันหยุดราชการ', () => {
    // พุธ 9 ก.ย. + 3 วันทำการ = พฤ 10, ศ 11, (ข้าม ส อา จ14 อ15 หยุด) พ 16
    expect(addBusinessDays('2026-09-09', 3, holidays)).toBe('2026-09-16');
    expect(isBusinessDay('2026-09-14', holidays)).toBe(false);
    expect(isBusinessDay('2026-09-16', holidays)).toBe(true);
  });

  it('ศูนย์วันทำการคืนวันเดิม และปฏิเสธค่าลบ', () => {
    expect(addBusinessDays('2026-09-12', 0, holidays)).toBe('2026-09-12');
    expect(() => addBusinessDays('2026-09-12', -1, holidays)).toThrow(RangeError);
  });

  it('วันหยุดที่ตกเสาร์อาทิตย์ได้วันชดเชยในวันทำการถัดไป', () => {
    const result = substituteHolidays([
      { date: '2026-05-31', nameTh: 'วันวิสาขบูชา' }, // อาทิตย์
      { date: '2026-06-01', nameTh: 'วันหยุดสมมติ' },
    ]);
    expect(result.map((holiday) => holiday.date)).toEqual([
      '2026-05-31',
      '2026-06-01',
      '2026-06-02',
    ]);
    expect(result[2]?.nameTh).toBe('วันหยุดชดเชยวันวิสาขบูชา');
  });
});
