/**
 * ส่งกลับให้เจ้าหน้าที่ตรวจ — the applicant fixes ONE paper, not the whole filing.
 *
 * ── THE ROUND TRIP THIS ENDS ──────────────────────────────────────────────────
 * Before the per-slot review, a filing came back as "แก้ไข" and the applicant
 * re-uploaded everything they had, because they could not tell which paper was
 * the problem. The officer then re-read nine documents to find the one that had
 * actually changed. Both sides paid for one bad scan of a title deed.
 *
 * ── THE RULE THAT MATTERS ─────────────────────────────────────────────────────
 * A resubmit is only a resubmit if something was actually replaced. The test is
 * not "is a file attached" — one was attached when the officer rejected it — but
 * "is the file NEWER than the request". A filing sent back with the same scan is
 * a round trip that teaches the applicant nothing and costs the officer a second
 * reading, so it is refused, naming the papers still stale.
 */

'use strict';

const {
    assertRevisionSlotsRefreshed,
    REVISION_INCOMPLETE,
} = require('../../services/application-document-review-service');

const REQUESTED_AT = new Date('2026-09-05T10:00:00.000Z');
const BEFORE = new Date('2026-09-01T10:00:00.000Z');
const AFTER = new Date('2026-09-06T10:00:00.000Z');

const requested = (slotId, at = REQUESTED_AT) => ({ slotId, createdAt: at });
const doc = (slotId, at) => ({ slotId, uploadedAt: at });

describe('a resubmit needs a NEWER file for every paper that was asked for', () => {
    test('a fresh upload satisfies the request', () => {
        expect(() => assertRevisionSlotsRefreshed(
            [requested('land_rights')],
            [doc('land_rights', AFTER)],
        )).not.toThrow();
    });

    test('the SAME file that was rejected does not — that is the round trip we are ending', () => {
        let err;
        try {
            assertRevisionSlotsRefreshed([requested('land_rights')], [doc('land_rights', BEFORE)]);
        } catch (e) { err = e; }
        expect(err.code).toBe(REVISION_INCOMPLETE);
        expect(err.slotIds).toEqual(['land_rights']);
    });

    test('no file at all does not', () => {
        expect(() => assertRevisionSlotsRefreshed([requested('land_rights')], []))
            .toThrow(expect.objectContaining({ code: REVISION_INCOMPLETE, slotIds: ['land_rights'] }));
    });

    test('a file uploaded at the exact instant of the request does not count', () => {
        // Equal timestamps mean the upload cannot have been a response to the
        // request. Treating it as one lets a filing through on a coincidence.
        expect(() => assertRevisionSlotsRefreshed(
            [requested('land_rights')], [doc('land_rights', REQUESTED_AT)],
        )).toThrow(expect.objectContaining({ code: REVISION_INCOMPLETE }));
    });

    test('every stale paper is named, not just the first — one round trip, not three', () => {
        let err;
        try {
            assertRevisionSlotsRefreshed(
                [requested('land_rights'), requested('sop_manual'), requested('site_photos')],
                [doc('land_rights', AFTER), doc('sop_manual', BEFORE)],
            );
        } catch (e) { err = e; }
        expect(err.slotIds).toEqual(['sop_manual', 'site_photos']);
    });

    test('each slot is judged against ITS OWN request time', () => {
        // Round 2 may ask for a paper the applicant already replaced in round 1.
        // Judging both against one timestamp would accept a stale file.
        const later = new Date('2026-09-10T10:00:00.000Z');
        expect(() => assertRevisionSlotsRefreshed(
            [requested('land_rights', REQUESTED_AT), requested('sop_manual', later)],
            [doc('land_rights', AFTER), doc('sop_manual', AFTER)],
        )).toThrow(expect.objectContaining({ code: REVISION_INCOMPLETE, slotIds: ['sop_manual'] }));
    });

    test('the newest upload for a slot is the one that counts', () => {
        expect(() => assertRevisionSlotsRefreshed(
            [requested('land_rights')],
            [doc('land_rights', BEFORE), doc('land_rights', AFTER)],
        )).not.toThrow();
    });

    test('a paper nobody asked for is irrelevant either way', () => {
        expect(() => assertRevisionSlotsRefreshed(
            [requested('land_rights')],
            [doc('land_rights', AFTER), doc('water_test', BEFORE)],
        )).not.toThrow();
    });

    test('nothing requested is a defect, not a free pass', () => {
        // Reaching a resubmit with no outstanding request means the application
        // is in REVISION_REQUESTED for a reason nobody recorded. Letting it
        // through would send the officer a filing with no note of what changed.
        expect(() => assertRevisionSlotsRefreshed([], [doc('land_rights', AFTER)]))
            .toThrow(expect.objectContaining({ code: REVISION_INCOMPLETE }));
    });

    test('the refusal carries Thai an applicant can act on', () => {
        let err;
        try { assertRevisionSlotsRefreshed([requested('land_rights')], []); } catch (e) { err = e; }
        expect(err.messageTh).toContain('อัปโหลด');
    });
});
