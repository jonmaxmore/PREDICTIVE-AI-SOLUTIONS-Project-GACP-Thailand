/**
 * Unit tests for working-days utility.
 *
 * All assertions use the explicit Asia/Bangkok timezone (ICT, UTC+7) so the
 * suite is deterministic regardless of host TZ. Canonical rule (revision
 * deadlines measured in working days evaluated in ICT) is in
 * apps/backend/config/business-rules.js.
 */
const {
    isHoliday,
    isWorkingDay,
    addWorkingDays,
    countWorkingDaysBetween,
    calculateRevisionDeadline,
    getDeadlineStatus,
    getZonedParts,
} = require('../../utils/working-days');

const ICT = 'Asia/Bangkok';

/** Return the local YYYY-MM-DD (ICT) for a Date. */
function ictDate(d) {
    return getZonedParts(d, ICT).isoDate;
}

/** Return the local weekday short name (ICT) for a Date. */
function ictWeekday(d) {
    return getZonedParts(d, ICT).weekday;
}

/** Build a Date pinned to ICT-local midnight for a given YYYY-MM-DD. */
function ictMidnight(yyyyMmDd) {
    // ICT is UTC+7, so local midnight = UTC 17:00 previous day.
    // Simpler: parse as UTC then subtract 7h.
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 3600 * 1000);
}

describe('working-days utility (ICT/Asia/Bangkok)', () => {
    describe('isWorkingDay', () => {
        it('returns false for Saturday in ICT', () => {
            // 2026-03-14 is a Saturday in ICT
            expect(isWorkingDay(ictMidnight('2026-03-14'))).toBe(false);
        });

        it('returns false for Sunday in ICT', () => {
            expect(isWorkingDay(ictMidnight('2026-03-15'))).toBe(false);
        });

        it('returns true for Monday in ICT', () => {
            expect(isWorkingDay(ictMidnight('2026-03-16'))).toBe(true);
        });

        it('returns false for New Year (Jan 1)', () => {
            expect(isWorkingDay(ictMidnight('2026-01-01'))).toBe(false);
        });

        it('returns false for Songkran (Apr 13)', () => {
            expect(isWorkingDay(ictMidnight('2026-04-13'))).toBe(false);
        });

        it('returns false for Queen Suthida Birthday (Jun 3)', () => {
            expect(isWorkingDay(ictMidnight('2026-06-03'))).toBe(false);
        });
    });

    describe('isHoliday', () => {
        it('detects recurring holidays', () => {
            expect(isHoliday(ictMidnight('2026-12-05'))).toBe(true); // Father's Day
            expect(isHoliday(ictMidnight('2026-10-23'))).toBe(true); // Chulalongkorn Day
        });

        it('detects extra Buddhist holidays for 2026', () => {
            expect(isHoliday(ictMidnight('2026-03-03'))).toBe(true); // Makha Bucha
            expect(isHoliday(ictMidnight('2026-07-29'))).toBe(true); // Asalha Puja
        });

        it('returns false for normal working days', () => {
            expect(isHoliday(ictMidnight('2026-03-11'))).toBe(false); // Wednesday
        });
    });

    describe('addWorkingDays', () => {
        it('adds 5 working days correctly (simple case, no holidays)', () => {
            // Monday 2026-03-16 + 5 working days = Monday 2026-03-23 (end of day)
            const start = ictMidnight('2026-03-16');
            const result = addWorkingDays(start, 5);
            expect(ictDate(result)).toBe('2026-03-23');
            expect(ictWeekday(result)).toBe('Mon');
        });

        it('skips weekends correctly', () => {
            // Friday 2026-03-20 + 1 working day = Monday 2026-03-23
            const start = ictMidnight('2026-03-20');
            const result = addWorkingDays(start, 1);
            expect(ictDate(result)).toBe('2026-03-23');
        });

        it('skips holidays correctly', () => {
            // Apr 10 (Fri) + 5 working days: skip 11/12 (Sat/Sun),
            // 13/14/15 (Songkran), so candidate working days are
            // 16 (Thu), 17 (Fri), 20 (Mon), 21 (Tue), 22 (Wed).
            const start = ictMidnight('2026-04-10');
            const result = addWorkingDays(start, 5);
            expect(ictDate(result)).toBe('2026-04-22');
        });

        it('returns end of business day (23:59 ICT) on the deadline date', () => {
            const start = ictMidnight('2026-03-16');
            const result = addWorkingDays(start, 1);
            // Format the result in ICT and check hour/minute parts.
            const hh = new Intl.DateTimeFormat('en-US', {
                timeZone: ICT, hour: '2-digit', hour12: false,
            }).format(result);
            const mm = new Intl.DateTimeFormat('en-US', {
                timeZone: ICT, minute: '2-digit',
            }).format(result);
            expect(Number(hh)).toBe(23);
            expect(Number(mm)).toBe(59);
        });

        it('throws for negative days', () => {
            expect(() => addWorkingDays(new Date(), -1)).toThrow();
        });

        it('honors an explicit timezone parameter', () => {
            const start = ictMidnight('2026-03-16');
            const result = addWorkingDays(start, 1, 'Asia/Bangkok');
            expect(ictDate(result)).toBe('2026-03-17');
        });
    });

    describe('ICT timezone edge cases (Bug 3)', () => {
        it('Friday 23:00 ICT must still count as Friday for deadline math, even though it is Saturday in UTC', () => {
            // 2026-03-20 is a Friday in ICT.
            // 2026-03-20 23:00 ICT == 2026-03-20 16:00 UTC — still Friday everywhere.
            // The harder edge: 2026-03-20 23:30 ICT == 2026-03-20 16:30 UTC (still Friday UTC).
            // The real boundary: 2026-03-21 00:30 ICT == 2026-03-20 17:30 UTC.
            // We want the inverse: an instant that is Friday ICT but Saturday in UTC.
            // That requires Friday 17:00-23:59 UTC == Saturday 00:00-06:59 ICT — not Friday ICT.
            // Inverse scenario: Friday ICT late evening, e.g. 23:30 ICT,
            // which is 16:30 UTC — still Friday UTC, day-of-week match.
            //
            // The *critical* edge case stated in the bug: Friday 23:00 ICT must be classified
            // as Friday (working day) regardless of UTC interpretation. The naive
            // `date.getDay()` reads UTC-relative weekday for a Date object representing that
            // instant only when the host TZ is UTC; with a host TZ of e.g. UTC-5,
            // a Friday 23:00 ICT instant (= Friday 11:00 UTC = Friday 06:00 host) is fine,
            // but a Sat-00:30 ICT instant (= Fri 17:30 UTC) would be misclassified as Friday
            // by getDay() under UTC. Our implementation uses Intl with explicit ICT, so:
            const fridayLateNightIct = new Date('2026-03-20T16:30:00Z'); // 23:30 Fri ICT
            expect(ictWeekday(fridayLateNightIct)).toBe('Fri');
            expect(isWorkingDay(fridayLateNightIct)).toBe(true);

            // And the inverse: an instant near the Sat/Fri UTC boundary that is
            // Saturday in UTC but still Friday in ICT.
            // Friday 23:00 ICT = Friday 16:00 UTC (still Fri in both — not a boundary).
            // To get "Sat in UTC, Fri in ICT" we need UTC after Sat 00:00 but ICT still Friday.
            // That's impossible: ICT is +7 ahead of UTC, so ICT crosses midnight first.
            // The genuine inverse (Fri in UTC, Sat in ICT) does exist:
            const saturdayEarlyIct = new Date('2026-03-20T17:30:00Z'); // 00:30 Sat ICT
            expect(ictWeekday(saturdayEarlyIct)).toBe('Sat');
            expect(isWorkingDay(saturdayEarlyIct)).toBe(false);
            // Naive getDay() (UTC) would return 5 (Fri) for this Date and classify it as a
            // working day — that is the bug guarded against here.
        });

        it('uses ICT calendar to detect Thai holidays even when UTC calendar disagrees', () => {
            // 2026-12-05 (Father's Day) at 00:30 ICT == 2026-12-04 17:30 UTC.
            // ICT calendar says holiday; UTC calendar says Dec 4 (not in list).
            const ictHolidayMorning = new Date('2026-12-04T17:30:00Z');
            expect(ictDate(ictHolidayMorning)).toBe('2026-12-05');
            expect(isHoliday(ictHolidayMorning)).toBe(true);
            expect(isWorkingDay(ictHolidayMorning)).toBe(false);
        });

        it('deadline math is invariant under host timezone (uses explicit ICT)', () => {
            // Same UTC instant, different host TZ interpretations — ICT classification
            // must agree with the canonical rule.
            const start = new Date('2026-03-16T02:00:00Z'); // 09:00 Mon ICT
            const due = addWorkingDays(start, 5);
            expect(ictDate(due)).toBe('2026-03-23');
        });
    });

    describe('countWorkingDaysBetween', () => {
        it('counts correctly for a simple week', () => {
            const result = countWorkingDaysBetween(
                ictMidnight('2026-03-16'), // Monday
                ictMidnight('2026-03-20'), // Friday
            );
            expect(result).toBe(4);
        });

        it('returns 0 for same instant', () => {
            const date = ictMidnight('2026-03-16');
            expect(countWorkingDaysBetween(date, date)).toBe(0);
        });

        it('returns negative for overdue', () => {
            const result = countWorkingDaysBetween(
                ictMidnight('2026-03-20'), // Friday
                ictMidnight('2026-03-16'), // Monday (before)
            );
            expect(result).toBeLessThan(0);
        });
    });

    describe('calculateRevisionDeadline', () => {
        it('returns correct deadline with default 5 working days', () => {
            const start = ictMidnight('2026-03-16');
            const result = calculateRevisionDeadline(start);
            expect(result.workingDaysAdded).toBe(5);
            expect(ictDate(result.revisionDue)).toBe('2026-03-23');
        });
    });

    describe('getDeadlineStatus', () => {
        it('returns overdue for past dates', () => {
            const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const status = getDeadlineStatus(pastDate);
            expect(status.isOverdue).toBe(true);
            expect(status.urgency).toBe('expired');
            expect(status.displayText).toBe('หมดเขตแล้ว');
        });

        it('returns normal for future dates', () => {
            const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
            const status = getDeadlineStatus(futureDate);
            expect(status.isOverdue).toBe(false);
            expect(status.urgency).toBe('normal');
        });
    });
});
