'use strict';

/**
 * "เหลือ X วันทำการ" display fix (adversarial follow-up, owner approved
 * 2026-07-08): resolveDeadlinePayload computed remainingWorkingDays with the
 * LEGACY holiday-blind services/working-days-service (its holiday sources are
 * never seeded → weekends-only, server TZ) while the DEADLINE ITSELF is
 * stamped by the Thai-holiday-aware utils/working-days engine (#646). In a
 * week containing a Thai holiday the farmer saw one more remaining day than
 * they actually had. Enforcement was always correct (reads the stored stamp);
 * this pins the DISPLAY to the same engine.
 */

const { buildTrackingPayload } = require('../../routes/api/helpers/application-payload-builders');

function revisionApp(dueIso) {
    return {
        id: 'app-1',
        applicationNumber: 'GACP-2026-0300',
        status: 'REVISION_REQUESTED',
        formData: { revisionDueAt: dueIso },
    };
}

describe('tracking deadline display — Thai-holiday-aware remaining working days', () => {
    test('a Thai holiday inside the window is NOT counted as a remaining working day', () => {
        // 2026-03-03 (Tue) is มาฆบูชา. now = Mon 2026-03-02 12:00 ICT,
        // due = Thu 2026-03-05 end-of-business-day ICT.
        // Remaining working days: Tue 3rd = HOLIDAY (skip), Wed 4th, Thu 5th → 2.
        // The legacy engine (empty holiday set) showed 3.
        const now = new Date('2026-03-02T05:00:00Z');
        const payload = buildTrackingPayload(revisionApp('2026-03-05T16:59:59.999Z'), { now });

        expect(payload.deadline).toMatchObject({
            type: 'REVISION',
            isOverdue: false,
            remainingWorkingDays: 2,
        });
    });

    test('a clean week (no holidays) counts weekdays only', () => {
        // now = Mon 2026-03-16 12:00 ICT, due = Mon 2026-03-23 EOB ICT
        // (5 working days: Tue,Wed,Thu,Fri,Mon — weekend skipped).
        const now = new Date('2026-03-16T05:00:00Z');
        const payload = buildTrackingPayload(revisionApp('2026-03-23T16:59:59.999Z'), { now });

        expect(payload.deadline.remainingWorkingDays).toBe(5);
        expect(payload.deadline.isOverdue).toBe(false);
    });

    test('past due shows 0 remaining and isOverdue', () => {
        const now = new Date('2026-03-24T05:00:00Z');
        const payload = buildTrackingPayload(revisionApp('2026-03-23T16:59:59.999Z'), { now });

        expect(payload.deadline.remainingWorkingDays).toBe(0);
        expect(payload.deadline.isOverdue).toBe(true);
    });

    test('CAR deadline resolves the CAR stamps with the same engine', () => {
        const now = new Date('2026-03-02T05:00:00Z');
        const payload = buildTrackingPayload({
            id: 'app-2',
            applicationNumber: 'GACP-2026-0301',
            status: 'CAR_PENDING',
            formData: { carDueAt: '2026-03-05T16:59:59.999Z' },
        }, { now });

        expect(payload.deadline).toMatchObject({ type: 'CAR', remainingWorkingDays: 2 });
    });

    test('no deadline stamp → deadline is null (states outside the 5-day rule carry no clock)', () => {
        const payload = buildTrackingPayload({
            id: 'app-3',
            applicationNumber: 'GACP-2026-0302',
            status: 'PENDING_AUDIT_FEE',
            formData: {},
        }, { now: new Date('2026-03-02T05:00:00Z') });

        expect(payload.deadline).toBeNull();
    });
});
