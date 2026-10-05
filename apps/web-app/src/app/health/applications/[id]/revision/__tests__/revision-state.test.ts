/**
 * The applicant's screen may not be more permissive than the door.
 *
 * Every rule here mirrors assertRevisionSlotsRefreshed. The mirror does not
 * enforce anything — the server refuses regardless — it means an applicant
 * learns "you still have one paper to replace" from a disabled button and a
 * highlighted row, instead of from a 409 after pressing it.
 *
 * If the two ever disagree, the SERVER is right and this is the bug.
 */

import {
    isReplaced, submitState, daysUntil, REVISION_COPY_TH,
    type RequestedDocument,
} from '../revision-state';

const ASKED = '2026-09-05T10:00:00.000Z';

const doc = (over: Partial<RequestedDocument> = {}): RequestedDocument => ({
    slotId: 'land_rights',
    labelTH: 'สำเนาเอกสารสิทธิ์ที่ดิน',
    reason: 'สำเนาโฉนดอ่านเลขที่ไม่ออก',
    dueDate: '2026-09-12T00:00:00.000Z',
    requestedAt: ASKED,
    uploadedAt: null,
    ...over,
});

describe('has the paper actually been replaced', () => {
    test('a newer upload counts', () => {
        expect(isReplaced(doc({ uploadedAt: '2026-09-06T10:00:00.000Z' }))).toBe(true);
    });

    test('the file that was already there does not — it was attached when the officer refused it', () => {
        expect(isReplaced(doc({ uploadedAt: '2026-09-01T10:00:00.000Z' }))).toBe(false);
    });

    test('no file at all does not', () => {
        expect(isReplaced(doc({ uploadedAt: null }))).toBe(false);
    });

    test('the exact instant of the request does not — it cannot have been a response', () => {
        expect(isReplaced(doc({ uploadedAt: ASKED }))).toBe(false);
    });

    test('an unreadable date is treated as not replaced, never as replaced', () => {
        expect(isReplaced(doc({ uploadedAt: 'ไม่ใช่วันที่' }))).toBe(false);
    });
});

describe('may the filing be sent back', () => {
    test('every paper replaced → yes', () => {
        const s = submitState([
            doc({ slotId: 'land_rights', uploadedAt: '2026-09-06T00:00:00.000Z' }),
            doc({ slotId: 'sop_manual', uploadedAt: '2026-09-07T00:00:00.000Z' }),
        ]);
        expect(s.canSubmit).toBe(true);
        expect(s.blockedReason).toBeNull();
    });

    test('one outstanding paper disables it and NAMES the row', () => {
        const s = submitState([
            doc({ slotId: 'land_rights', uploadedAt: '2026-09-06T00:00:00.000Z' }),
            doc({ slotId: 'sop_manual', uploadedAt: null }),
        ]);
        expect(s.canSubmit).toBe(false);
        expect(s.outstandingSlotIds).toEqual(['sop_manual']);
        expect(s.blockedReason).toBe(REVISION_COPY_TH.blocked);
    });

    test('every outstanding paper is named, not just the first', () => {
        const s = submitState([doc({ slotId: 'a' }), doc({ slotId: 'b' }), doc({ slotId: 'c' })]);
        expect(s.outstandingSlotIds).toEqual(['a', 'b', 'c']);
    });

    test('an empty list does NOT enable the button', () => {
        // Reaching this screen with nothing outstanding means something is wrong.
        // Sending the officer a filing with no note of what changed spends their
        // reading rather than the applicant's.
        expect(submitState([]).canSubmit).toBe(false);
    });
});

describe('the deadline is a day, not an instant', () => {
    test('a paper due today is not overdue at one minute past midnight', () => {
        expect(daysUntil('2026-09-12T00:00:00.000Z', new Date('2026-09-12T00:01:00.000Z'))).toBe(0);
    });

    test('tomorrow is 1', () => {
        // Days are Bangkok days (operator 2026-09-26): 23:00 on 12 Sep in
        // Bangkok, due during 13 Sep in Bangkok.
        expect(daysUntil('2026-09-13T00:00:00.000Z', new Date('2026-09-12T16:00:00.000Z'))).toBe(1);
    });

    test('06:00 in Bangkok is already the due day, though UTC still says the day before', () => {
        expect(daysUntil('2026-09-13T00:00:00.000Z', new Date('2026-09-12T23:00:00.000Z'))).toBe(0);
    });

    test('yesterday is negative — overdue is shown, not hidden', () => {
        expect(daysUntil('2026-09-11T00:00:00.000Z', new Date('2026-09-12T01:00:00.000Z'))).toBe(-1);
    });

    test('no due date is null, never zero — zero would read as "due today"', () => {
        expect(daysUntil(null)).toBeNull();
    });
});
