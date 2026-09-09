// formatter ภาษาไทยที่ทุกหน้าจอและเอกสารใช้ร่วมกัน ห้ามพิมพ์ปี พ.ศ. หรือทศนิยมเงินเองในที่อื่น

const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;
const THAI_MONTHS_LONG = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;
const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

type DateParts = {
  readonly day: number;
  readonly monthIndex: number;
  readonly buddhistYear: number;
  readonly hour: number;
  readonly minute: number;
};

function toBangkokParts(date: Date): DateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour) % 24;
  return {
    day: Number(parts.day),
    monthIndex: Number(parts.month) - 1,
    buddhistYear: Number(parts.year) + 543,
    hour,
    minute: Number(parts.minute),
  };
}

// วันที่ปฏิทินของวันนี้ตามเวลาไทย (YYYY-MM-DD) ใช้เป็น asOf ของกฎและวันออกเอกสาร
export function todayCalendarDateInBangkok(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// แสดงวันที่ปฏิทิน YYYY-MM-DD เป็น พ.ศ. โดยไม่ผ่านเขตเวลา
export function formatCalendarDateThai(
  calendarDate: string,
  style: 'short' | 'long' = 'short',
): string {
  const [year, month, day] = calendarDate.split('-').map(Number);
  if (!year || !month || !day) throw new RangeError(`วันที่ต้องเป็น YYYY-MM-DD ได้รับ ${calendarDate}`);
  const monthName = style === 'long' ? THAI_MONTHS_LONG[month - 1] : THAI_MONTHS_SHORT[month - 1];
  return `${day} ${monthName} ${year + 543}`;
}

export function formatThaiDate(date: Date, style: 'short' | 'long' = 'short'): string {
  const { day, monthIndex, buddhistYear } = toBangkokParts(date);
  const month = style === 'long' ? THAI_MONTHS_LONG[monthIndex] : THAI_MONTHS_SHORT[monthIndex];
  return `${day} ${month} ${buddhistYear}`;
}

export function formatThaiDateTime(date: Date): string {
  const { hour, minute } = toBangkokParts(date);
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return `${formatThaiDate(date)} ${time}`;
}

// เงินเก็บเป็นสตางค์จำนวนเต็ม แสดงเป็นบาทสองทศนิยมพร้อมตัวคั่นหลักพัน
export function formatBahtFromSatang(
  satang: number,
  options: { readonly withUnit?: boolean } = {},
): string {
  if (!Number.isSafeInteger(satang)) throw new RangeError(`สตางค์ต้องเป็นจำนวนเต็ม ได้รับ ${satang}`);
  const sign = satang < 0 ? '-' : '';
  const absolute = Math.abs(satang);
  const baht = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  const grouped = baht.toLocaleString('en-US');
  const text = `${sign}${grouped}.${String(remainder).padStart(2, '0')}`;
  return options.withUnit ? `${text} บาท` : text;
}

const THAI_DIGITS = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'] as const;

// ใช้เฉพาะเอกสารราชการที่ต้องพิมพ์เลขไทย (เช่น หัวข้อส่วนที่ ๑ ของ กทล.1)
export function toThaiDigits(text: string): string {
  return text.replace(/[0-9]/g, (digit) => THAI_DIGITS[Number(digit)] ?? digit);
}
