/**
 * Working Days Calculator (Asia/Bangkok / ICT, UTC+7)
 *
 * คำนวณวันทำการตามปฏิทินราชการไทย (หักเสาร์-อาทิตย์ และวันหยุดราชการ)
 * ใช้ใน Revision Deadline (5 วันทำการ) และ CAR Deadline
 *
 * Canonical business rule: revision deadlines are measured in working days
 * (Mon-Fri) evaluated in the Asia/Bangkok timezone (ICT, UTC+7).
 * Source of truth: apps/backend/config/business-rules.js (PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS).
 *
 * IMPORTANT: All weekday / calendar-date checks must be evaluated in the
 * target timezone. Using `date.getDay()` / `date.getDate()` here would be
 * UTC-relative and would mis-classify edge cases such as Friday 23:00 ICT
 * (which is Saturday in UTC).
 *
 * @module utils/working-days
 */

/**
 * The revision window length, read rather than re-spelled.
 *
 * This module is otherwise dependency-free, and staying that way was worth
 * checking before adding this line: config/business-rules.js itself requires
 * nothing, so no cycle is possible in either direction, and no module-boundary
 * rule in eslint.config.js separates utils/ from config/. The alternative was
 * to leave the day count spelled as a literal default parameter, which is a
 * second definition of a business number that the header above already declares
 * lives in config — a caller who omitted the argument would silently keep the
 * old value after the config moved. Note the direction: only calculateRevisionDeadline,
 * which is named for the business rule, reads this. The calendar primitives
 * (addWorkingDays, isWorkingDay, countWorkingDaysBetween) take their day count
 * from the caller and know nothing about revisions.
 */
const { PAYMENT } = require('../config/business-rules');

const DEFAULT_TIME_ZONE = 'Asia/Bangkok';

/**
 * วันหยุดราชการไทย (recurring yearly — MM-DD format)
 * ไม่รวมวันหยุดที่เลื่อนตามปฏิทินจันทรคติ (ต้องอัปเดตทุกปี)
 *
 * วันใดตรงเสาร์-อาทิตย์ วันทำการถัดไปเป็นวันหยุดชดเชย — คำนวณใน
 * substituteHolidaysFor() ด้านล่าง ไม่ต้องพิมพ์ลงตารางเอง
 */
const RECURRING_HOLIDAYS = [
  '01-01', // วันขึ้นปีใหม่
  '04-06', // วันจักรี
  '04-13', // วันสงกรานต์
  '04-14', // วันสงกรานต์
  '04-15', // วันสงกรานต์
  '05-01', // วันแรงงาน
  '05-04', // วันฉัตรมงคล
  '06-03', // วันเฉลิมพระชนมพรรษา สมเด็จพระราชินี
  '07-28', // วันเฉลิมพระชนมพรรษา ร.10
  '08-12', // วันแม่แห่งชาติ
  '10-13', // วันคล้ายวันสวรรคต ร.9
  '10-23', // วันปิยมหาราช
  '12-05', // วันพ่อแห่งชาติ
  '12-10', // วันรัฐธรรมนูญ
  '12-31', // วันสิ้นปี
];

/**
 * วันหยุดพิเศษเพิ่มเติมตามปี (YYYY-MM-DD format)
 * อัปเดตเมื่อราชกิจจานุเบกษาประกาศ
 *
 * คัดลอกตามประกาศทุกวัน: วันหยุดทางจันทรคติ วันหยุดพิเศษ และวันหยุดชดเชยที่
 * ประกาศระบุ (รวมวันชดเชยที่กฎเสาร์-อาทิตย์คำนวณได้เองด้วย — ซ้ำกันไม่เป็นไร
 * เพราะเป็นวันเดียวกัน) ห้ามเดาวันจากปฏิทินดาราศาสตร์
 *
 * ที่มา (ตรวจ 2026-09-17):
 * - วันหยุดพิเศษ 2 มิ.ย. 68, 11 ส.ค. 68, 2 ม.ค. 69: มติ ครม. 12 พ.ย. 2567
 *   ตามที่กรมประชาสัมพันธ์เผยแพร่
 * - 2568, 2569: บัญชีวันหยุดราชการประจำปีตามที่ ม.สงขลานครินทร์ (hr.psu.ac.th)
 *   และสื่อข่าวเผยแพร่ซ้ำ — หน้าต้นฉบับของ สลค. (soc.go.th) เปิดไม่ได้
 *   (HTTP 403) วันที่ตรวจ ควรเทียบซ้ำ
 * - 2570: ครม. ยังไม่ประกาศบัญชีวันหยุดราชการ — ใช้ประกาศธนาคารแห่งประเทศไทย
 *   ที่ 37/2569 (ราชกิจจานุเบกษา 25 ส.ค. 2569) ไปก่อน
 */
const EXTRA_HOLIDAYS_BY_YEAR = {
  2025: [
    '2025-02-12', // วันมาฆบูชา
    '2025-04-07', // ชดเชยวันจักรี
    '2025-04-16', // ชดเชยวันสงกรานต์
    '2025-05-05', // ชดเชยวันฉัตรมงคล
    '2025-05-11', // วันวิสาขบูชา (วันอาทิตย์)
    '2025-05-12', // ชดเชยวันวิสาขบูชา
    '2025-06-02', // วันหยุดพิเศษ (มติ ครม. 12 พ.ย. 2567)
    '2025-07-10', // วันอาสาฬหบูชา
    '2025-07-11', // วันเข้าพรรษา
    '2025-08-11', // วันหยุดพิเศษ (มติ ครม. 12 พ.ย. 2567)
  ],
  2026: [
    '2026-01-02', // วันหยุดพิเศษ (มติ ครม. 12 พ.ย. 2567)
    '2026-03-03', // วันมาฆบูชา
    '2026-05-31', // วันวิสาขบูชา (วันอาทิตย์)
    '2026-06-01', // ชดเชยวันวิสาขบูชา
    '2026-07-29', // วันอาสาฬหบูชา
    '2026-07-30', // วันเข้าพรรษา
    '2026-12-07', // ชดเชยวันคล้ายวันพระบรมราชสมภพ ร.9 / วันพ่อแห่งชาติ
  ],
  2027: [
    '2027-02-21', // วันมาฆบูชา (วันอาทิตย์)
    '2027-02-22', // ชดเชยวันมาฆบูชา
    '2027-05-03', // ชดเชยวันแรงงาน
    '2027-05-20', // วันวิสาขบูชา
    '2027-07-18', // วันอาสาฬหบูชา (วันอาทิตย์)
    '2027-07-19', // วันเข้าพรรษา / ชดเชยวันอาสาฬหบูชา (ธปท.)
    // ไม่อยู่ในประกาศ ธปท. — ถ้าราชการหยุด 19 ก.ค. เป็นวันเข้าพรรษา วันชดเชย
    // อาสาฬหบูชาจะเป็นวันนี้ คงไว้จนกว่า ครม. ประกาศบัญชีปี 2570 (หยุดเกิน =
    // กำหนดส่งช้าลงหนึ่งวัน ไม่ทำให้คำขอหมดเขตก่อนเวลา)
    '2027-07-20',
    '2027-10-25', // ชดเชยวันปิยมหาราช
    '2027-12-06', // ชดเชยวันคล้ายวันพระบรมราชสมภพ ร.9 / วันพ่อแห่งชาติ
  ],
};

/**
 * Format a Date as YYYY-MM-DD evaluated in the target timezone.
 * Uses Intl.DateTimeFormat so we never read UTC-relative fields like getDate().
 *
 * @param {Date} date
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {{ year: number, month: number, day: number, isoDate: string, mmdd: string, weekday: string }}
 */
function getZonedParts(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);

  const lookup = {};
  for (const p of parts) {
    if (p.type !== 'literal') {lookup[p.type] = p.value;}
  }
  const year = Number(lookup.year);
  const month = Number(lookup.month); // 1-12
  const day = Number(lookup.day);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return {
    year,
    month,
    day,
    isoDate: `${year}-${mm}-${dd}`,
    mmdd: `${mm}-${dd}`,
    weekday: lookup.weekday, // 'Mon', 'Tue', ... 'Sun'
  };
}

// Blocker F follow-through (full-system audit 2026-07-07): the lunar-holiday
// table above ends at a fixed year. Dates for later years come from the Royal
// Gazette (ราชกิจจานุเบกษา) and MUST NOT be guessed — but silently computing a
// deadline into an uncovered year would under-count holidays exactly like the
// bug this module exists to prevent. Warn loudly (once per year per process)
// so ops extend EXTRA_HOLIDAYS_BY_YEAR when the gazette publishes.
const MAX_EXTRA_HOLIDAY_YEAR = Math.max(
  ...Object.keys(EXTRA_HOLIDAYS_BY_YEAR).map(Number),
);
const warnedUncoveredYears = new Set();

function warnIfExtraHolidayCoverageMissing(year) {
  if (year <= MAX_EXTRA_HOLIDAY_YEAR || warnedUncoveredYears.has(year)) {
    return;
  }
  warnedUncoveredYears.add(year);
  console.warn(
    `[working-days] EXTRA_HOLIDAYS_BY_YEAR has no entry for ${year} ` +
    `(coverage ends ${MAX_EXTRA_HOLIDAY_YEAR}). Lunar Thai public holidays for ` +
    `${year} will NOT be excluded from working-day deadlines until the table is ` +
    'extended from the Royal Gazette announcement — deadlines computed into this ' +
    'year may be too short.',
  );
}

/**
 * วันหยุดชดเชยของวันหยุดวันที่ตายตัว (RECURRING_HOLIDAYS) ในปีปฏิทิน `year`
 * เป็น Set ของ 'YYYY-MM-DD'
 *
 * DOMA-10 (audit 2026-09-17): Sat 5 Dec 2569 had no substitute here, so Mon
 * 7 Dec counted as a working day and deadlines across it came out a day short.
 *
 * The rule follows the announced lists: a run of consecutive fixed-date
 * holidays that touches a weekend gets ONE substitute, on the first day after
 * the run that is neither a weekend nor a fixed-date holiday. That is how the
 * lists treat a single day (Sat 5 Dec 2569 → Mon 7 Dec) and a block alike
 * (Songkran Sat 13 - Mon 15 Apr 2567 → Tue 16 only; Sat 31 Dec 2565 + Sun
 * 1 Jan 2566 → Mon 2 Jan only). December of the year before is walked too,
 * because the year-end run ends in January.
 *
 * The rule does not read EXTRA_HOLIDAYS_BY_YEAR. That table is copied from
 * the announcement, substitutes included, so a substitute that is both
 * announced and derived names the same day once instead of pushing the
 * derived one a day further out.
 *
 * The days here are civil dates, not instants: each is carried as a UTC
 * midnight purely as a label, so getUTCDay() reads the weekday of the date
 * itself and no clock zone is involved.
 */
const DAY_MS = 24 * 3600 * 1000;
const substituteHolidayCache = new Map();

function substituteHolidaysFor(year) {
  if (substituteHolidayCache.has(year)) {
    return substituteHolidayCache.get(year);
  }
  const label = (t) => new Date(t).toISOString().slice(0, 10);
  const isWeekend = (t) => [0, 6].includes(new Date(t).getUTCDay());
  const isFixed = (t) => RECURRING_HOLIDAYS.includes(label(t).slice(5));

  const fixedDays = [];
  for (const y of [year - 1, year]) {
    for (const mmdd of [...RECURRING_HOLIDAYS].sort()) {
      const [mm, dd] = mmdd.split('-').map(Number);
      fixedDays.push(Date.UTC(y, mm - 1, dd));
    }
  }

  const substitutes = new Set();
  let i = 0;
  while (i < fixedDays.length) {
    let j = i;
    while (j + 1 < fixedDays.length && fixedDays[j + 1] - fixedDays[j] === DAY_MS) {
      j++;
    }
    if (fixedDays.slice(i, j + 1).some(isWeekend)) {
      let t = fixedDays[j] + DAY_MS;
      while (isWeekend(t) || isFixed(t) || substitutes.has(label(t))) {
        t += DAY_MS;
      }
      substitutes.add(label(t));
    }
    i = j + 1;
  }

  const forYear = new Set([...substitutes].filter((d) => d.startsWith(`${year}-`)));
  substituteHolidayCache.set(year, forYear);
  return forYear;
}

/**
 * ตรวจสอบว่าวันนั้นเป็นวันหยุดนักขัตฤกษ์หรือไม่ (เทียบ timezone Asia/Bangkok)
 * @param {Date} date
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {boolean}
 */
function isHoliday(date, timeZone = DEFAULT_TIME_ZONE) {
  const { mmdd, isoDate, year } = getZonedParts(date, timeZone);
  if (RECURRING_HOLIDAYS.includes(mmdd)) {
    return true;
  }
  if (substituteHolidaysFor(year).has(isoDate)) {
    return true;
  }
  const extraHolidays = EXTRA_HOLIDAYS_BY_YEAR[year] || [];
  return extraHolidays.includes(isoDate);
}

/**
 * ตรวจสอบว่าวันนั้นเป็นวันทำการหรือไม่
 * (ไม่ใช่เสาร์-อาทิตย์ และไม่ใช่วันหยุดราชการ) — เทียบ timezone Asia/Bangkok
 *
 * Edge case covered: Friday 23:00 ICT is Saturday in UTC; we evaluate in ICT
 * so it still counts as Friday. See business-rules.js for canonical rule.
 *
 * @param {Date} date
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {boolean}
 */
function isWorkingDay(date, timeZone = DEFAULT_TIME_ZONE) {
  const { weekday } = getZonedParts(date, timeZone);
  if (weekday === 'Sat' || weekday === 'Sun') {
    return false;
  }
  return !isHoliday(date, timeZone);
}

/**
 * The UTC instant of 00:00 local time in the target zone on the civil date
 * `year`-`month`-`day` (month 1-12). Parts past the end of a month roll over
 * the way Date.UTC rolls them, so (2026, 12, 32) is 1 January 2027.
 *
 * This is the one place the zone offset is solved. The day boundaries below,
 * and the Bangkok day and month windows elsewhere (the VAT period, an audit
 * appointment), are built on it instead of on the process clock, which is UTC
 * in the containers.
 *
 * @param {number} year
 * @param {number} month - 1-12
 * @param {number} day
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {Date}
 */
function startOfLocalCalendarDay(year, month, day, timeZone = DEFAULT_TIME_ZONE) {
  // Build a UTC date for that day's noon (avoids DST issues), read the local
  // hour there, then snap back to local midnight of that day.
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = getZonedParts(utcNoon, timeZone);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(utcNoon);
  const localHour = Number(fmt);
  // localHour at the UTC noon timestamp; offset = localHour - 12 (in hours, may be negative)
  const offsetHours = localHour - 12;
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0) - offsetHours * 3600 * 1000,
  );
}

/**
 * Advance a Date by exactly one calendar day in the target timezone, then
 * return a Date whose UTC instant maps to 00:00 local in that zone for the
 * resulting calendar day. Used to iterate forward across timezone boundaries
 * without UTC drift.
 *
 * @param {Date} date
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {Date}
 */
function nextLocalDayStart(date, timeZone = DEFAULT_TIME_ZONE) {
  const { year, month, day } = getZonedParts(date, timeZone);
  return startOfLocalCalendarDay(year, month, day + 1, timeZone);
}

/**
 * Return the UTC instant that corresponds to 23:59:59.999 local time in the
 * target zone on the same calendar day as `date`.
 *
 * @param {Date} date
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {Date}
 */
function endOfLocalDay(date, timeZone = DEFAULT_TIME_ZONE) {
  const { year, month, day } = getZonedParts(date, timeZone);
  // 23:59:59.999 = midnight + 86_399_999 ms
  return new Date(startOfLocalCalendarDay(year, month, day, timeZone).getTime() + DAY_MS - 1);
}

/**
 * The Bangkok calendar year of an instant (default: now). Every document
 * number year (receipt, tax invoice, certificate, quotation, application, CAR)
 * reads this, from the same instant the document prints, so the number year and
 * the printed year cannot disagree around midnight on 1 January.
 *
 * @param {Date|string|number} [date=new Date()]
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {number} Christian-era year (add 543 for พ.ศ.)
 */
function localYear(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const d = date instanceof Date ? date : new Date(date);
  return getZonedParts(d, timeZone).year;
}

/**
 * The instant of 00:00 local on the calendar day that contains `date`.
 *
 * @param {Date|string|number} [date=new Date()]
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {Date}
 */
function startOfLocalDay(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const d = date instanceof Date ? date : new Date(date);
  const { year, month, day } = getZonedParts(d, timeZone);
  return startOfLocalCalendarDay(year, month, day, timeZone);
}

/**
 * The same local wall-clock time `years` calendar years later (a certificate's
 * expiry from its issue instant). 29 Feb rolls to 1 Mar, as setFullYear did.
 *
 * @param {Date} date
 * @param {number} years
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {Date}
 */
function addLocalYears(date, years, timeZone = DEFAULT_TIME_ZONE) {
  const { year, month, day } = getZonedParts(date, timeZone);
  const sinceMidnight = date.getTime() - startOfLocalCalendarDay(year, month, day, timeZone).getTime();
  return new Date(startOfLocalCalendarDay(year + years, month, day, timeZone).getTime() + sinceMidnight);
}

/**
 * A local calendar month as the half-open instant window [start, end).
 * `month` is 1-12; 13 or 0 roll into the neighbouring year.
 *
 * @param {number} year
 * @param {number} month
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {{ start: Date, end: Date }}
 */
function localMonthRange(year, month, timeZone = DEFAULT_TIME_ZONE) {
  return {
    start: startOfLocalCalendarDay(year, month, 1, timeZone),
    end: startOfLocalCalendarDay(year, month + 1, 1, timeZone),
  };
}

/**
 * Read a bare "YYYY-MM-DD" as a local calendar day. Returns null for anything
 * else, so a caller can keep treating full ISO instants as instants.
 *
 * @param {unknown} value
 * @returns {{ year: number, month: number, day: number } | null}
 */
function parseLocalIsoDate(value) {
  if (typeof value !== 'string') { return null; }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) { return null; }
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * The instant of a local wall-clock time on a local calendar day: "2026-09-20"
 * + "09:00" is 09:00 in Bangkok (02:00Z), whatever the process clock's zone —
 * `new Date("2026-09-20T09:00:00")` would read it in the process zone instead.
 * Returns an Invalid Date when either part is malformed, as `new Date(...)`
 * did, so callers keep their existing validity checks.
 *
 * @param {string} isoDay - "YYYY-MM-DD"
 * @param {string} [hhmm="00:00"] - "H:mm" or "HH:mm", 24-hour
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {Date}
 */
function localWallClock(isoDay, hhmm = '00:00', timeZone = DEFAULT_TIME_ZONE) {
  const day = parseLocalIsoDate(isoDay);
  const t = typeof hhmm === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim()) : null;
  if (!day || !t || Number(t[1]) > 23 || Number(t[2]) > 59) { return new Date(NaN); }
  const start = startOfLocalCalendarDay(day.year, day.month, day.day, timeZone);
  return new Date(start.getTime() + (Number(t[1]) * 60 + Number(t[2])) * 60 * 1000);
}

/**
 * "HH:mm" (24-hour) of an instant in the local zone — the time an appointment
 * or a notification prints, whatever the process clock's zone.
 *
 * @param {Date|string|number} date
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {string}
 */
function formatLocalTime(date, timeZone = DEFAULT_TIME_ZONE) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const hh = (parts.find((p) => p.type === 'hour') || {}).value || '00';
  const mm = (parts.find((p) => p.type === 'minute') || {}).value || '00';
  return `${hh}:${mm}`;
}

/**
 * เพิ่มจำนวนวันทำการจากวันเริ่มต้น (Asia/Bangkok timezone by default)
 *
 * Canonical: revision deadlines in business-rules.js are measured in working
 * days evaluated in ICT. Returns the end-of-business-day instant (23:59:59.999
 * local) on the resulting working day.
 *
 * @param {Date|string|number} startDate - วันเริ่มนับ
 * @param {number} count - จำนวนวันทำการที่ต้องการเพิ่ม
 * @param {string} [timeZone=DEFAULT_TIME_ZONE] - IANA timezone, default Asia/Bangkok
 * @returns {Date} วันที่ครบกำหนด (end-of-business-day instant)
 */
function addWorkingDays(startDate, count, timeZone = DEFAULT_TIME_ZONE) {
  if (!Number.isFinite(count) || count < 0) {
    throw new Error(`Invalid count: ${count}`);
  }

  let cursor = new Date(startDate);
  // Coverage guard: computing a deadline into a year past the lunar-holiday
  // table would silently under-count holidays. Warn (once per year) so ops
  // extend the table from the Royal Gazette.
  warnIfExtraHolidayCoverageMissing(getZonedParts(cursor, timeZone).year);
  let added = 0;
  while (added < count) {
    cursor = nextLocalDayStart(cursor, timeZone);
    if (isWorkingDay(cursor, timeZone)) {
      added++;
    }
  }
  warnIfExtraHolidayCoverageMissing(getZonedParts(cursor, timeZone).year);
  // Return end of local business day
  return endOfLocalDay(cursor, timeZone);
}

/**
 * นับจำนวนวันทำการที่เหลือระหว่างสองวัน (เทียบใน timezone Asia/Bangkok)
 * @param {Date} from - วันเริ่มต้น
 * @param {Date} to - วันสิ้นสุด (deadline)
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {number} จำนวนวันทำการที่เหลือ (ค่าลบ = เกินกำหนด)
 */
function countWorkingDaysBetween(from, to, timeZone = DEFAULT_TIME_ZONE) {
  const start = new Date(from);
  const end = new Date(to);

  if (end.getTime() === start.getTime()) {return 0;}

  if (end < start) {
    let count = 0;
    let cursor = new Date(end);
    while (cursor < start) {
      cursor = nextLocalDayStart(cursor, timeZone);
      if (isWorkingDay(cursor, timeZone)) {
        count--;
      }
    }
    return count;
  }

  let count = 0;
  let cursor = new Date(start);
  while (cursor < end) {
    cursor = nextLocalDayStart(cursor, timeZone);
    if (cursor > end) {break;}
    if (isWorkingDay(cursor, timeZone)) {
      count++;
    }
  }
  return count;
}

/**
 * คำนวณ revision deadline จากวันที่เริ่มนับ
 * @param {Date} startDate - วันที่เริ่มนับ (วันที่สั่งแก้ไข)
 * @param {number} [businessDays] - จำนวนวันทำการ (default: config/business-rules.js
 *   PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS)
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {{ revisionDue: Date, workingDaysAdded: number }}
 */
function calculateRevisionDeadline(
  startDate,
  businessDays = PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS,
  timeZone = DEFAULT_TIME_ZONE,
) {
  const revisionDue = addWorkingDays(startDate, businessDays, timeZone);
  return {
    revisionDue,
    workingDaysAdded: businessDays,
  };
}

/**
 * ดึงข้อมูล deadline status แบบเข้าใจง่าย
 * @param {Date} deadlineDate - วันครบกำหนด
 * @param {string} [timeZone=DEFAULT_TIME_ZONE]
 * @returns {{ remainingWorkingDays: number, isOverdue: boolean, urgency: string, displayText: string }}
 */
function getDeadlineStatus(deadlineDate, timeZone = DEFAULT_TIME_ZONE) {
  const now = new Date();
  const remaining = countWorkingDaysBetween(now, deadlineDate, timeZone);
  const isOverdue = now > deadlineDate;

  let urgency = 'normal';
  if (isOverdue) {
    urgency = 'expired';
  } else if (remaining <= 1) {
    urgency = 'critical'; // < 24 ชม.ทำการ
  } else if (remaining <= 2) {
    urgency = 'high';
  }

  let displayText;
  if (isOverdue) {
    displayText = 'หมดเขตแล้ว';
  } else if (remaining === 0) {
    displayText = 'วันสุดท้าย';
  } else {
    displayText = `${remaining} วันทำการ`;
  }

  return {
    remainingWorkingDays: remaining,
    isOverdue,
    urgency,
    displayText,
  };
}

module.exports = {
  isHoliday,
  isWorkingDay,
  addWorkingDays,
  countWorkingDaysBetween,
  calculateRevisionDeadline,
  getDeadlineStatus,
  getZonedParts,
  // Exported for the requirement register, which selects DATED LAW by the day of
  // filing (services/requirement-rule-service.js). It needs the same DST-safe
  // zone arithmetic the deadline engine already does; a second implementation
  // over a hardcoded +07:00 would be a second answer to "when does a Thai day end".
  endOfLocalDay,
  // The offset solver behind endOfLocalDay, for Bangkok day and month windows
  // (services/vat-report-service.js, services/audit-scheduling-service.js)
  // that must not lean on the process clock zone.
  startOfLocalCalendarDay,
  // Bangkok year / day / month / clock-time readers for business code: document
  // number years, "today" windows, ledger and VAT months, printed times.
  localYear,
  startOfLocalDay,
  nextLocalDayStart,
  localMonthRange,
  addLocalYears,
  parseLocalIsoDate,
  localWallClock,
  formatLocalTime,
  RECURRING_HOLIDAYS,
  EXTRA_HOLIDAYS_BY_YEAR,
  DEFAULT_TIME_ZONE,
};
