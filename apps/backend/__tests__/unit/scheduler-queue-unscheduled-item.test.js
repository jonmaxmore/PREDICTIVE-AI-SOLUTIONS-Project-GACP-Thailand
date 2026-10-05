'use strict';

/**
 * Found while fixing item 1 (not in the batch list): an application with NO schedule was
 * serialised with scheduledDate = 1970-01-01T00:00:00.000Z.
 *
 * resolveAuditSchedule fed `null` to `dt` (= safeDate = new Date(v)), and new Date(null) is
 * the epoch, a VALID date, so "no schedule" came out as "scheduled in 1970":
 *   - the calendar queue showed "เลื่อนนัด" (reschedule) instead of "จัดคู่นัดตรวจ" on rows
 *     that had never been booked, and a 1970 date;
 *   - overdueDays was 20731 on every unscheduled row;
 *   - the calendar door labelled every FIRST booking AUDIT_RESCHEDULED (and wrote
 *     previousScheduledDate 1970 into the workflow history).
 */

const { resolveAuditSchedule, buildSchedulerQueueItem } = require('../../routes/api/provider/handlers/queue-utils');

describe('an application with no schedule is unscheduled, not scheduled in 1970', () => {
    const unscheduled = { id: 'a', applicationNumber: 'N-1', status: 'AUDIT_FEE_PAID', formData: { workflowState: 'AUDIT_FEE_PAID' }, scheduledDate: null, applicant: {} };

    test('resolveAuditSchedule returns null date and null ISO', () => {
        const s = resolveAuditSchedule(unscheduled);
        expect(s.scheduledDate).toBeNull();
        expect(s.scheduledDateISO).toBeNull();
    });

    test('the queue item has no scheduledDate and is not overdue', () => {
        const item = buildSchedulerQueueItem(unscheduled, new Map(), new Map());
        expect(item.scheduledDate).toBeNull();
        expect(item.overdueDays).toBe(0);
    });

    test('a real schedule is still read, from the column or from formData', () => {
        const d = new Date(Date.now() + 5 * 86400000);
        expect(resolveAuditSchedule({ ...unscheduled, scheduledDate: d }).scheduledDateISO).toBe(d.toISOString());
        expect(resolveAuditSchedule({ ...unscheduled, formData: { auditSchedule: { scheduledDate: d.toISOString() } } }).scheduledDateISO)
            .toBe(d.toISOString());
    });
});
