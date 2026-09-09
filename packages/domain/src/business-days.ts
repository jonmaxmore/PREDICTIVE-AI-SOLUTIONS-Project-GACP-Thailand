import type { CalendarDate, PublicHoliday } from '@gacp/contracts';

// วันที่ปฏิทินเป็นข้อความ YYYY-MM-DD เสมอ ไม่ใช้ Date ที่ผูกเขตเวลา เพื่อให้กำหนดวันตรงกันทุกเครื่อง

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtcDate(date: CalendarDate): Date {
  const match = CALENDAR_DATE_PATTERN.exec(date);
  if (!match) throw new RangeError(`วันที่ต้องเป็น YYYY-MM-DD ได้รับ ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    throw new RangeError(`วันที่ไม่มีอยู่จริงในปฏิทิน ${date}`);
  }
  return value;
}

function fromUtcDate(value: Date): CalendarDate {
  return value.toISOString().slice(0, 10);
}

export function addCalendarDays(start: CalendarDate, days: number): CalendarDate {
  if (!Number.isSafeInteger(days)) throw new RangeError('จำนวนวันต้องเป็นจำนวนเต็ม');
  const value = toUtcDate(start);
  value.setUTCDate(value.getUTCDate() + days);
  return fromUtcDate(value);
}

export function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  toUtcDate(left);
  toUtcDate(right);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isWeekend(date: CalendarDate): boolean {
  const weekday = toUtcDate(date).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export type HolidayCalendar = ReadonlySet<CalendarDate>;

export function toHolidayCalendar(holidays: readonly PublicHoliday[]): HolidayCalendar {
  return new Set(holidays.map((holiday) => holiday.date));
}

export function isBusinessDay(date: CalendarDate, holidays: HolidayCalendar): boolean {
  return !isWeekend(date) && !holidays.has(date);
}

// เลื่อนไปข้างหน้าทีละวันทำการ (จันทร์ถึงศุกร์ ไม่นับวันหยุดราชการ) ใช้กับกำหนดส่งเอกสารเพิ่ม
export function addBusinessDays(
  start: CalendarDate,
  businessDays: number,
  holidays: HolidayCalendar,
): CalendarDate {
  if (!Number.isSafeInteger(businessDays) || businessDays < 0) {
    throw new RangeError('จำนวนวันทำการต้องเป็นจำนวนเต็มไม่ติดลบ');
  }
  let current = start;
  let remaining = businessDays;
  while (remaining > 0) {
    current = addCalendarDays(current, 1);
    if (isBusinessDay(current, holidays)) remaining -= 1;
  }
  return current;
}

// วันหยุดราชการที่ตกวันเสาร์อาทิตย์จะชดเชยในวันทำการถัดไป ตามประกาศคณะรัฐมนตรี
export function substituteHolidays(holidays: readonly PublicHoliday[]): PublicHoliday[] {
  const calendar = new Set<CalendarDate>(holidays.map((holiday) => holiday.date));
  const result: PublicHoliday[] = [...holidays];
  for (const holiday of holidays) {
    if (!isWeekend(holiday.date)) continue;
    let substitute = holiday.date;
    do {
      substitute = addCalendarDays(substitute, 1);
    } while (isWeekend(substitute) || calendar.has(substitute));
    calendar.add(substitute);
    result.push({ date: substitute, nameTh: `วันหยุดชดเชย${holiday.nameTh}` });
  }
  return result.sort((left, right) => compareCalendarDates(left.date, right.date));
}
