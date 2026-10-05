/**
 * Operator ruling 2026-09-26 — "เวลาไทยทั้งหมด": every business date the web app
 * computes or prints is a Bangkok date, whatever clock zone renders it (a UTC
 * server during SSR, a browser abroad).
 *
 * Two ways the zone leaks in, and how this file shuts each one:
 *  - zone-less locale formatting (toLocale*String, Intl.DateTimeFormat): the
 *    spies below give every call that names no zone the UTC default a server
 *    process has, so a formatter that forgets the zone prints the UTC day here
 *    even on a Bangkok laptop;
 *  - process-clock calendar reads (getDate / getMonth / getFullYear, local
 *    `new Date(y, m, d)`): those only differ when the jest process itself runs
 *    in another zone, so this file is also run under TZ=UTC and
 *    TZ=America/Los_Angeles (see the port report).
 */

import {
  bangkokDateParts,
  bangkokFirstOfMonthIso,
  bangkokTodayIso,
  formatThaiDateTime,
  formatThaiTime,
} from '@/lib/format/thai-date';
import * as accounting from '@/lib/services/accounting-service';
import * as orphans from '@/lib/services/finance-orphans-service';
import { formatThaiDate as libFormatThaiDate, formatThaiDateShort as libFormatThaiDateShort } from '@/lib/utils';
import {
  formatThaiDateLong,
  formatThaiDateNumeric,
  formatThaiDateTime as utilsFormatThaiDateTime,
} from '@/utils/thai-date';
import { calculateFallbackMetrics, formatDateShort, type QueueItem } from '@/app/provider/dashboard/dashboard-utils';
import { daysUntil } from '@/app/health/applications/[id]/revision/revision-state';
import {
  fromDateInputValue,
  toDateInputValue,
} from '@/app/health/planting/[id]/activities/planting-activities-page-config';

// 01:30 on 17 Sep 2569 in Bangkok; still 16 Sep in UTC.
const AFTER_MIDNIGHT_BKK = '2026-09-16T18:30:00.000Z';
// 03:00 on 1 Oct 2569 in Bangkok; still 30 Sep in UTC.
const FIRST_OF_OCT_BKK = '2026-09-30T20:00:00.000Z';

type LocaleMethod = 'toLocaleString' | 'toLocaleDateString' | 'toLocaleTimeString';

function runLikeAUtcProcess() {
  for (const method of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as LocaleMethod[]) {
    const original = Date.prototype[method];
    jest
      .spyOn(Date.prototype, method)
      .mockImplementation(function (this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        return original.call(this, locales, { timeZone: 'UTC', ...(options ?? {}) });
      });
  }
  const RealDTF = Intl.DateTimeFormat;
  jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    ((locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) =>
      new RealDTF(locales, { timeZone: 'UTC', ...(options ?? {}) })) as unknown as typeof Intl.DateTimeFormat,
  );
}

beforeEach(() => {
  runLikeAUtcProcess();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function freezeClock(iso: string) {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'setInterval'] });
  jest.setSystemTime(new Date(iso));
}

describe('the simulated process really formats zone-less calls in UTC', () => {
  it('a zone-less call reads 16, a Bangkok call reads 17', () => {
    expect(new Date(AFTER_MIDNIGHT_BKK).toLocaleDateString('en-US', { day: 'numeric' })).toBe('16');
    expect(new Intl.DateTimeFormat('en-US', { day: 'numeric' }).format(new Date(AFTER_MIDNIGHT_BKK))).toBe('16');
  });
});

describe('lib/format/thai-date — Bangkok parts and pickers', () => {
  it('reads the Bangkok day, month and year of an instant', () => {
    expect(bangkokDateParts(AFTER_MIDNIGHT_BKK)).toEqual({ year: 2026, month: 9, day: 17, isoDate: '2026-09-17' });
    expect(bangkokDateParts('not-a-date')).toBeNull();
    expect(bangkokDateParts(null)).toBeNull();
  });

  it('today and the 1st of the month are Bangkok days, including 1 Oct at 03:00', () => {
    expect(bangkokTodayIso(new Date(FIRST_OF_OCT_BKK))).toBe('2026-10-01');
    expect(bangkokFirstOfMonthIso(new Date(FIRST_OF_OCT_BKK))).toBe('2026-10-01');
    expect(bangkokFirstOfMonthIso(new Date('2026-09-15T05:00:00.000Z'))).toBe('2026-09-01');
  });

  it('date-time and time print Bangkok time, with a fallback for bad input', () => {
    expect(formatThaiTime(AFTER_MIDNIGHT_BKK)).toBe('01:30');
    expect(formatThaiDateTime(AFTER_MIDNIGHT_BKK)).toContain('17 ก.ย. 2569');
    expect(formatThaiDateTime(AFTER_MIDNIGHT_BKK)).toContain('01:30');
    expect(formatThaiDateTime('nope')).toBe('-');
  });
});

describe('finance period pickers (accounting + orphans) default to the Bangkok month', () => {
  it.each([
    ['accounting-service', accounting],
    ['finance-orphans-service', orphans],
  ])('%s: firstOfMonthIso is the 1st (not the last day of the previous month) and todayIso is the Bangkok day', (_name, mod) => {
    freezeClock('2026-09-15T05:00:00.000Z');
    expect(mod.firstOfMonthIso()).toBe('2026-09-01');
    freezeClock(FIRST_OF_OCT_BKK);
    expect(mod.firstOfMonthIso()).toBe('2026-10-01');
    expect(mod.todayIso()).toBe('2026-10-01');
    expect(mod.formatThaiDate(AFTER_MIDNIGHT_BKK)).toBe('17/09/2569');
  });
});

describe('shared Thai date formatters print the Bangkok day', () => {
  it('lib/utils', () => {
    expect(libFormatThaiDate(AFTER_MIDNIGHT_BKK)).toBe('17 กันยายน 2569');
    expect(libFormatThaiDateShort(AFTER_MIDNIGHT_BKK)).toBe('17 ก.ย. 2569');
  });

  it('utils/thai-date', () => {
    expect(formatThaiDateLong(AFTER_MIDNIGHT_BKK)).toBe('17 กันยายน 2569');
    expect(formatThaiDateNumeric(AFTER_MIDNIGHT_BKK)).toBe('17/09/2569');
    expect(utilsFormatThaiDateTime(AFTER_MIDNIGHT_BKK)).toBe('17 ก.ย. 69 01:30 น.');
  });
});

describe('dashboards and deadlines count Bangkok days', () => {
  it('the provider dashboard counts an application submitted at 01:30 today (Bangkok) as new today', () => {
    freezeClock('2026-09-17T03:00:00.000Z'); // 10:00 on 17 Sep in Bangkok
    const item = {
      id: 'a', applicationNumber: 'A', applicantName: 'x', stageCode: 'SUBMITTED', stageLabel: '',
      priorityLabel: 'normal', submittedDate: formatDateShort(AFTER_MIDNIGHT_BKK), updatedDate: '',
      actionHref: '', isOverdue: false,
    } as QueueItem;
    expect(item.submittedDate).toBe('17 ก.ย. 2569');
    expect(calculateFallbackMetrics([item]).newToday).toBe(1);
  });

  it('a revision due at the end of 17 Sep (Bangkok) has 0 days left at 01:30 on 17 Sep', () => {
    expect(daysUntil('2026-09-17T16:59:59.999Z', new Date(AFTER_MIDNIGHT_BKK))).toBe(0);
  });

  it('a planting activity date picked as 17 Sep round-trips as 17 Sep, 00:00 in Bangkok', () => {
    const picked = fromDateInputValue('2026-09-17');
    expect(picked?.toISOString()).toBe('2026-09-16T17:00:00.000Z');
    expect(toDateInputValue(picked)).toBe('2026-09-17');
    expect(toDateInputValue(new Date(AFTER_MIDNIGHT_BKK))).toBe('2026-09-17');
  });
});
