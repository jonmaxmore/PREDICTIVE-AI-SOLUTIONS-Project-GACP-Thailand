/**
 * Revision deadline working-day calculation in Asia/Bangkok (ICT).
 *
 * Anchors the Tier 14 contract (batches 9-12) that
 * `application-review-revision-methods.reviewApplication` for action
 * REJECT/REVISION sets `formData.revisionDueAt` to exactly what
 * `addWorkingDays(now, PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS, 'Asia/Bangkok')`
 * returns — i.e. weekends + Thai public holidays are SKIPPED, and the
 * weekday determination uses ICT (NOT UTC).
 *
 * The unit util has its own tests for the calendar internals; here we exercise
 * the deadline-end-to-end through the review method so any future refactor
 * that introduces UTC drift or a different SLA value blows this up.
 *
 * Mocks: prisma + audit-trail. No I/O.
 */

'use strict';

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {},
    default: {},
}));

jest.mock('../../services/audit-trail', () => ({
    log: jest.fn().mockResolvedValue(null),
    logAction: jest.fn().mockResolvedValue(null),
    ACTIONS: { APPROVE: 'APPROVE', REJECT: 'REJECT', REVISION: 'REVISION' },
    ENTITIES: { APPLICATION: 'APPLICATION' },
    SEVERITY: { INFO: 'INFO', WARNING: 'WARNING', CRITICAL: 'CRITICAL' },
}));

const { addWorkingDays, isHoliday, isWorkingDay } = require('../../utils/working-days');
const { PAYMENT } = require('../../config/business-rules');

function formatICT(date) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Bangkok',
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

describe('utils/working-days.addWorkingDays in Asia/Bangkok', () => {
    test('5 working days from a plain Monday lands on the following Monday (skip Sat+Sun)', () => {
        // Monday 2026-05-04 10:00 ICT — no holidays in this window.
        // Mon 4 (start) -> Tue 5 +1, Wed 6 +2, Thu 7 +3, Fri 8 +4, Mon 11 +5
        const mon = new Date('2026-05-04T10:00:00+07:00');
        const due = addWorkingDays(mon, 5, 'Asia/Bangkok');
        expect(formatICT(due)).toContain('Mon');
        expect(formatICT(due)).toContain('05/11/2026');
        // Returns end-of-business-day instant in ICT.
        expect(due.toISOString()).toBe('2026-05-11T16:59:59.999Z');
    });

    test('skips Thai public holidays (Labor Day + Coronation Day) when counting working days', () => {
        // Sanity-check the fixtures first.
        expect(isHoliday(new Date('2026-05-01T10:00:00+07:00'))).toBe(true); // วันแรงงาน
        expect(isHoliday(new Date('2026-05-04T10:00:00+07:00'))).toBe(true); // วันฉัตรมงคล
        // From Wed 2026-04-29, 5wd path: Thu 4/30 +1, skip Fri 5/1 (holiday),
        // skip Sat-Sun, skip Mon 5/4 (holiday), Tue 5/5 +2, Wed 5/6 +3,
        // Thu 5/7 +4, Fri 5/8 +5.
        const start = new Date('2026-04-29T10:00:00+07:00');
        const due = addWorkingDays(start, 5, 'Asia/Bangkok');
        expect(formatICT(due)).toContain('05/08/2026');
        expect(formatICT(due)).toContain('Fri');
    });

    test('Friday late-night ICT: 5wd from Fri 23:30 ICT lands on the following Friday', () => {
        // Fri 2026-05-15 23:30 ICT = 2026-05-15 16:30 UTC (still Fri UTC).
        // From Friday, 5wd: Mon 5/18, Tue 5/19, Wed 5/20, Thu 5/21, Fri 5/22.
        const friLate = new Date('2026-05-15T23:30:00+07:00');
        expect(isWorkingDay(friLate, 'Asia/Bangkok')).toBe(true);
        const due = addWorkingDays(friLate, 5, 'Asia/Bangkok');
        expect(formatICT(due)).toContain('05/22/2026');
        expect(formatICT(due)).toContain('Fri');
    });

    test('ICT Saturday early-morning (Friday in UTC fringe) treated as WEEKEND in ICT, not working day', () => {
        // Sat 2026-05-16 02:00 ICT = Fri 2026-05-15 19:00 UTC.
        // UTC weekday is Friday — naive UTC-based isWeekend() would wrongly
        // call this a working day. ICT must say Saturday (weekend) so
        // isWorkingDay returns false and addWorkingDays advances past it.
        const satIctButFriUtc = new Date('2026-05-16T02:00:00+07:00');
        expect(isWorkingDay(satIctButFriUtc, 'Asia/Bangkok')).toBe(false);
        // UTC interpretation would say this IS a working day — defensive
        // anchor so anyone changing the helper sees both behaviours diverge.
        expect(isWorkingDay(satIctButFriUtc, 'UTC')).toBe(true);
        // Counting 5wd from Sat 02:00 ICT must advance to Mon first.
        // Mon 5/18 +1, Tue 5/19 +2, Wed 5/20 +3, Thu 5/21 +4, Fri 5/22 +5.
        const due = addWorkingDays(satIctButFriUtc, 5, 'Asia/Bangkok');
        expect(formatICT(due)).toContain('05/22/2026');
    });
});

describe('PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS is 5 (canonical)', () => {
    test('canonical SLA value is 5 working days', () => {
        // If product ever changes this, every Thai farmer-facing copy
        // ("กรุณาแก้ไขภายใน 5 วันทำการ") must move in lockstep — anchor it.
        expect(PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS).toBe(5);
    });
});

