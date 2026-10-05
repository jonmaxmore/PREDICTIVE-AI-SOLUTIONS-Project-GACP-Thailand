/**
 * The order a reviewer's queue arrives in.
 *
 * The query ordered by `createdAt: 'asc'` — oldest submission first. That is
 * the right rule for work that has no clock on it, and the wrong rule for work
 * that does. An application whose revision deadline expires in three hours sat
 * below one submitted a week earlier with three weeks left, because the only
 * thing the ordering knew about was the submission date.
 *
 * The deadline is not a column. `getRevisionDueAt` reads
 * `formData.revisionDueAt` out of the JSON blob, so Postgres cannot order by it
 * without a functional index that does not exist. That is exactly why the
 * ordering has to happen after the rows are shaped — and why it is only correct
 * once the *whole* set is in hand. Sorting a truncated window by urgency is
 * worse than not sorting it at all: it looks authoritative and is wrong.
 * `listAllReviewerQueueApplications` is what makes the set whole; this module
 * is what puts it in order.
 *
 * The rule, in one sentence: whoever runs out of time first comes first.
 */

const { sortBySlaPriority, compareBySlaPriority } = require('../../services/application-service/reviewer-queue-order');

/** A shaped queue item, as `toReviewerQueueItem` produces it. */
const item = (id, { dueAt = null, submittedAt = '2026-01-01T00:00:00.000Z' } = {}) => ({
    id,
    applicationNumber: `GACP-${id}`,
    applicantName: 'สมชาย ใจดี',
    revisionDueAt: dueAt,
    submittedAt,
});

const idsOf = (items) => sortBySlaPriority(items).map((entry) => entry.id);

describe('sortBySlaPriority', () => {
    describe('work with a deadline', () => {
        it('puts the nearest deadline first', () => {
            const items = [
                item('later', { dueAt: '2026-03-10T00:00:00.000Z' }),
                item('sooner', { dueAt: '2026-03-01T00:00:00.000Z' }),
            ];
            expect(idsOf(items)).toEqual(['sooner', 'later']);
        });

        it('puts an overdue application above one merely due soon', () => {
            // Overdue is simply "deadline already passed", so the single
            // earliest-deadline-first rule covers it without a special case.
            const items = [
                item('due-soon', { dueAt: '2026-03-01T00:00:00.000Z' }),
                item('overdue', { dueAt: '2025-12-01T00:00:00.000Z' }),
            ];
            expect(idsOf(items)).toEqual(['overdue', 'due-soon']);
        });

        it('orders several overdue applications by how long they have been overdue', () => {
            const items = [
                item('overdue-recent', { dueAt: '2026-02-01T00:00:00.000Z' }),
                item('overdue-worst', { dueAt: '2025-06-01T00:00:00.000Z' }),
                item('overdue-middle', { dueAt: '2025-11-01T00:00:00.000Z' }),
            ];
            expect(idsOf(items)).toEqual(['overdue-worst', 'overdue-middle', 'overdue-recent']);
        });
    });

    describe('work with no deadline', () => {
        it('keeps oldest-submission-first among itself', () => {
            // Nothing is counting down, so first in is first served — the
            // behaviour the queue had before, preserved where it was correct.
            const items = [
                item('newer', { submittedAt: '2026-02-01T00:00:00.000Z' }),
                item('older', { submittedAt: '2026-01-01T00:00:00.000Z' }),
            ];
            expect(idsOf(items)).toEqual(['older', 'newer']);
        });

        it('sits below work that is on a clock', () => {
            // A deadline is a promise to the applicant with a date attached.
            // Untimed work has no such promise, so it yields.
            const items = [
                item('untimed', { submittedAt: '2020-01-01T00:00:00.000Z' }),
                item('timed', { dueAt: '2030-01-01T00:00:00.000Z' }),
            ];
            expect(idsOf(items)).toEqual(['timed', 'untimed']);
        });
    });

    describe('it is a total order, so paging over it is stable', () => {
        it('breaks a shared deadline on the id', () => {
            const items = [
                item('b', { dueAt: '2026-03-01T00:00:00.000Z' }),
                item('a', { dueAt: '2026-03-01T00:00:00.000Z' }),
            ];
            expect(idsOf(items)).toEqual(['a', 'b']);
        });

        it('breaks a shared submission time on the id', () => {
            expect(idsOf([item('b'), item('a')])).toEqual(['a', 'b']);
        });

        it('returns the same order however the input was shuffled', () => {
            const items = [
                item('d'),
                item('c', { dueAt: '2026-05-01T00:00:00.000Z' }),
                item('a', { dueAt: '2026-01-01T00:00:00.000Z' }),
                item('b', { dueAt: '2026-03-01T00:00:00.000Z' }),
            ];
            const forward = idsOf(items);
            const reversed = idsOf([...items].reverse());
            expect(forward).toEqual(['a', 'b', 'c', 'd']);
            expect(reversed).toEqual(forward);
        });
    });

    describe('unreadable dates', () => {
        it('treats an unparseable deadline as no deadline rather than as year zero', () => {
            // `new Date('เร็วๆ นี้')` is Invalid Date, and its getTime() is NaN.
            // Sorting on NaN silently scrambles the comparator, so a junk value
            // must not be allowed to claim the top of a reviewer's queue.
            const items = [
                item('junk', { dueAt: 'ไม่ใช่วันที่' }),
                item('real', { dueAt: '2030-01-01T00:00:00.000Z' }),
            ];
            expect(idsOf(items)).toEqual(['real', 'junk']);
        });

        it('survives an item with neither date', () => {
            const items = [item('nothing', { submittedAt: null }), item('dated', { dueAt: '2026-01-01T00:00:00.000Z' })];
            expect(idsOf(items)).toEqual(['dated', 'nothing']);
        });
    });

    describe('it does not disturb the caller', () => {
        it('returns a new array rather than sorting in place', () => {
            const items = [item('b', { dueAt: '2026-03-01T00:00:00.000Z' }), item('a', { dueAt: '2026-01-01T00:00:00.000Z' })];
            const sorted = sortBySlaPriority(items);
            expect(sorted).not.toBe(items);
            expect(items.map((entry) => entry.id)).toEqual(['b', 'a']);
        });

        it('handles an empty or absent queue', () => {
            expect(sortBySlaPriority([])).toEqual([]);
            expect(sortBySlaPriority(null)).toEqual([]);
            expect(sortBySlaPriority(undefined)).toEqual([]);
        });
    });

    describe('compareBySlaPriority', () => {
        it('is exposed so callers can sort their own partitions', () => {
            const urgent = item('a', { dueAt: '2026-01-01T00:00:00.000Z' });
            const relaxed = item('b', { dueAt: '2026-09-01T00:00:00.000Z' });
            expect(compareBySlaPriority(urgent, relaxed)).toBeLessThan(0);
            expect(compareBySlaPriority(relaxed, urgent)).toBeGreaterThan(0);
            expect(compareBySlaPriority(urgent, urgent)).toBe(0);
        });
    });
});
