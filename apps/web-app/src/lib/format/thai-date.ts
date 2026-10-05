/**
 * Guarded Thai-date formatters.
 *
 * A bare `new Date(x).toLocaleDateString('th-TH')` renders the Buddhist-era
 * epoch "1/1/2513" when x is null / undefined / '' / an invalid string — which
 * leaked onto staff screens (calendar, work inbox, final-approval) AND into
 * exported financial CSVs. These helpers return a fallback ('-' by default,
 * '' for the day-badge) on any falsy / NaN input instead.
 */
const TH_LOCALE = 'th-TH';

/**
 * Every "which day" decision in this product is a Bangkok decision: an issue
 * date, a due date, a harvest day all answer "which day was it here". The
 * machine rendering them may sit anywhere (staging is foreign-hosted), and an
 * instant late in the Thai evening is still the day before almost everywhere
 * west of here — so a formatter that trusts the process clock dates documents
 * one day early. The zone is named here, once.
 */
export const THAI_TIME_ZONE = 'Asia/Bangkok';

const DEFAULT_OPTS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: THAI_TIME_ZONE,
};

/**
 * The options as they actually reach Intl. Bangkok is the floor, not the law:
 * a caller that names its own zone (an export read in UTC, say) still wins,
 * because its `timeZone` lands after the default.
 */
export function thaiDateFormatOptions(
  options: Intl.DateTimeFormatOptions = DEFAULT_OPTS,
): Intl.DateTimeFormatOptions {
  return { timeZone: THAI_TIME_ZONE, ...options };
}

export function formatThaiDate(
  value?: string | number | Date | null,
  options: Intl.DateTimeFormatOptions = DEFAULT_OPTS,
  fallback = '-',
): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toLocaleDateString(TH_LOCALE, thaiDateFormatOptions(options));
}

/**
 * Day-of-month for date-badge widgets; '' on null/invalid (no "1"-from-epoch).
 * Read through the same formatter as the date printed beside it, so the badge
 * and the date can never name two different days for one instant.
 */
export function thaiDayOfMonth(value?: string | number | Date | null): string {
  return formatThaiDate(value, { day: 'numeric' }, '');
}

/** Year / month / day of an instant on the Bangkok calendar. */
export interface BangkokDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  /** "YYYY-MM-DD" of the Bangkok day. */
  isoDate: string;
}

/**
 * The Bangkok calendar day of an instant, read through Intl with the zone
 * named — never the viewer's or the server's clock zone (operator 2026-09-26:
 * "เวลาไทยทั้งหมด"). Returns null on null / invalid input.
 */
export function bangkokDateParts(value?: string | number | Date | null): BangkokDateParts | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: THAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return {
    year,
    month,
    day,
    isoDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/** Today's Bangkok day as "YYYY-MM-DD" (a date-picker default). */
export function bangkokTodayIso(now: Date = new Date()): string {
  return (bangkokDateParts(now) as BangkokDateParts).isoDate;
}

/** The 1st of the current Bangkok month as "YYYY-MM-01". */
export function bangkokFirstOfMonthIso(now: Date = new Date()): string {
  return `${bangkokTodayIso(now).slice(0, 7)}-01`;
}

/**
 * Date and time together, in Bangkok, e.g. "17 ก.ย. 2569 01:30". The caller's
 * options win except that the zone is always named.
 */
export function formatThaiDateTime(
  value?: string | number | Date | null,
  options: Intl.DateTimeFormatOptions = {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  },
  fallback = '-',
): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toLocaleString(TH_LOCALE, { timeZone: THAI_TIME_ZONE, ...options });
}

/** Time of day in Bangkok, e.g. "09:00". */
export function formatThaiTime(
  value?: string | number | Date | null,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
  fallback = '-',
): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toLocaleTimeString(TH_LOCALE, { timeZone: THAI_TIME_ZONE, ...options });
}
