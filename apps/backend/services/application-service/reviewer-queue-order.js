/**
 * The order a reviewer's queue arrives in.
 *
 * The query ordered by `createdAt: 'asc'` — oldest submission first. That is the
 * right rule for work with no clock on it and the wrong rule for work that has
 * one: an application whose revision deadline expired yesterday sat below one
 * submitted a week earlier with three weeks left, because submission date was
 * the only thing the ordering knew about.
 *
 * The deadline cannot be ordered in SQL. `getRevisionDueAt` reads
 * `formData.revisionDueAt` out of a JSON column, and there is no functional
 * index over that path. So the ordering happens here, after the rows are shaped
 * — which is only trustworthy once the *whole* set is in hand. Sorting a
 * truncated window by urgency is worse than not sorting it: it looks
 * authoritative and is wrong. `listAllReviewerQueueApplications` is what makes
 * the set whole; this is what puts it in order.
 *
 * The rule, in one sentence: whoever runs out of time first comes first.
 */

/**
 * Milliseconds for a date-ish value, or null when there is nothing usable.
 *
 * `new Date('ไม่ใช่วันที่').getTime()` is NaN, and NaN in a comparator is not a
 * bad answer — it is no answer. Every comparison involving it returns false, so
 * the sort silently produces an arbitrary order. A junk deadline must not be
 * able to claim the top of a reviewer's queue, so it is treated as no deadline.
 */
function timeOf(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
}

/**
 * Earlier of two keys first, with absence sorting last rather than first —
 * a missing date must not read as "the beginning of time" and jump the queue.
 */
function byTime(left, right) {
    if (left === right) {
        return 0;
    }
    if (left === null) {
        return 1;
    }
    if (right === null) {
        return -1;
    }
    return left - right;
}

/**
 * Total order over shaped reviewer-queue items.
 *
 * 1. A deadline outranks no deadline. A deadline is a promise to the applicant
 *    with a date attached; untimed work carries no such promise, so it yields.
 * 2. Among deadlines, the nearest first. Overdue is just "already passed", so
 *    the most overdue naturally leads without needing a case of its own.
 * 3. Among untimed work, oldest submission first — first in, first served, the
 *    behaviour the queue already had, kept where it was the right answer.
 * 4. Ties break on id, so the order is total. Cursor paging over a non-total
 *    order drops and repeats rows at the page boundary.
 *
 * @param {object} left  shaped queue item
 * @param {object} right shaped queue item
 * @returns {number} negative when `left` should be worked first
 */
function compareBySlaPriority(left, right) {
    const byDeadline = byTime(timeOf(left?.revisionDueAt), timeOf(right?.revisionDueAt));
    if (byDeadline !== 0) {
        return byDeadline;
    }

    const bySubmission = byTime(timeOf(left?.submittedAt), timeOf(right?.submittedAt));
    if (bySubmission !== 0) {
        return bySubmission;
    }

    const leftId = String(left?.id ?? '');
    const rightId = String(right?.id ?? '');
    if (leftId === rightId) {
        return 0;
    }
    return leftId < rightId ? -1 : 1;
}

/**
 * @param {Array<object>} items shaped queue items
 * @returns {Array<object>} a new array in SLA order; the caller's is untouched
 */
function sortBySlaPriority(items) {
    return [...(items || [])].sort(compareBySlaPriority);
}

module.exports = { sortBySlaPriority, compareBySlaPriority };
