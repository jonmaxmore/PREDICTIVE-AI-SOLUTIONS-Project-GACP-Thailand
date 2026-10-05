/**
 * P1-3 — guarded Thai-date formatters never emit the Buddhist epoch "2513"
 * (1970) for null/invalid input. This pins the guard so the dead-end class
 * (calendar / work / final-approval / accounting CSV / receipts) can't regress.
 */
import {
  formatThaiDate,
  thaiDateFormatOptions,
  thaiDayOfMonth,
  THAI_TIME_ZONE,
} from '../thai-date';

describe('formatThaiDate', () => {
  it('returns the fallback for null / undefined / empty / invalid input', () => {
    expect(formatThaiDate(null)).toBe('-');
    expect(formatThaiDate(undefined)).toBe('-');
    expect(formatThaiDate('')).toBe('-');
    expect(formatThaiDate('not-a-date')).toBe('-');
    expect(formatThaiDate(null, undefined, '—')).toBe('—');
  });

  it('never renders the 2513 / 1970 epoch for the real null-ish inputs', () => {
    // These date fields arrive as ISO strings or null — never numeric 0.
    for (const v of [null, undefined, '']) {
      expect(formatThaiDate(v)).not.toMatch(/2513|1970/);
    }
  });

  it('formats a valid date in th-TH', () => {
    const out = formatThaiDate('2026-06-16T00:00:00Z');
    expect(out).not.toBe('-');
    expect(out).toMatch(/\d/); // contains digits (year/day)
  });
});

/**
 * Which day it is, is a Bangkok question. Every date this product prints —
 * an issue date, a due date, a harvest day — answers "which day was it here",
 * and the server that renders it may sit anywhere. An instant late in the
 * Thai evening is still the previous day almost everywhere west of here, so a
 * formatter that trusts the process clock dates documents one day early.
 */
describe('the Thai formatters read the clock in Asia/Bangkok, not the process TZ', () => {
  // 00:30 on the 28th in Bangkok; 10:30 on the 27th in Los Angeles.
  const BANGKOK_AFTER_MIDNIGHT = '2026-08-27T17:30:00.000Z';

  /**
   * The rendered-value cases below cannot move the runner's clock: under jest
   * `process.env.TZ = 'America/Los_Angeles'` stores the string but never
   * reaches ICU (measured on this repo 2026-08-28 — after the assignment
   * `Intl.DateTimeFormat().resolvedOptions().timeZone` still read Asia/Bangkok
   * and `new Date(BANGKOK_AFTER_MIDNIGHT).getDate()` still read 28, because
   * jest hands the test a copy of process.env, not the real one). On a laptop
   * already set to Bangkok they would therefore pass either way. This case is
   * the one that does not depend on the runner: it asks what time zone the
   * module hands the formatter.
   */
  it('hands Intl Asia/Bangkok by default, on any runner', () => {
    expect(thaiDateFormatOptions()).toMatchObject({ timeZone: THAI_TIME_ZONE });
    expect(THAI_TIME_ZONE).toBe('Asia/Bangkok');
    expect(thaiDateFormatOptions({ day: 'numeric' })).toMatchObject({
      day: 'numeric',
      timeZone: 'Asia/Bangkok',
    });
  });

  it('lets a caller that names its own time zone keep it', () => {
    expect(thaiDateFormatOptions({ timeZone: 'UTC' })).toMatchObject({ timeZone: 'UTC' });
  });

  it('formats the Bangkok day (28 ส.ค. 2569), not the process-local day (27)', () => {
    const out = formatThaiDate(BANGKOK_AFTER_MIDNIGHT);
    expect(out).toContain('28');
    expect(out).toContain('2569');
    expect(out).not.toContain('27');
  });

  it('a caller that passes options but no timeZone still gets Bangkok', () => {
    const out = formatThaiDate(BANGKOK_AFTER_MIDNIGHT, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    expect(out).toContain('28');
    expect(out).not.toContain('27');
  });

  it('a caller that names its own timeZone still wins', () => {
    const out = formatThaiDate(BANGKOK_AFTER_MIDNIGHT, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    expect(out).toContain('27');
    expect(out).not.toContain('28');
  });

  it('the day badge agrees with the date beside it', () => {
    expect(thaiDayOfMonth(BANGKOK_AFTER_MIDNIGHT)).toBe('28');
  });

  it('keeps the null guard while pinned to Bangkok', () => {
    expect(formatThaiDate(null)).toBe('-');
    expect(formatThaiDate('')).toBe('-');
    expect(thaiDayOfMonth(null)).toBe('');
    expect(thaiDayOfMonth('')).toBe('');
  });
});

describe('thaiDayOfMonth', () => {
  it('returns "" for null / invalid (no epoch "1")', () => {
    expect(thaiDayOfMonth(null)).toBe('');
    expect(thaiDayOfMonth('')).toBe('');
    expect(thaiDayOfMonth('nope')).toBe('');
  });

  it('returns the day-of-month for a valid date', () => {
    expect(thaiDayOfMonth('2026-06-16T12:00:00Z')).toMatch(/^\d{1,2}$/);
  });
});
