/**
 * Audit 2.10 — PATCH /:id/reject canonical edge guard.
 *
 * REJECTABLE_STATUSES ({ASSIGNED_FOR_REVIEW, CAR_REVIEWING}) gates the FROM
 * state, but the handler maps decisionType→targetStatus independently
 * (DOC_REVISION→REVISION_REQUESTED, FIELD_CAR→CAR_PENDING). Without an edge
 * check a reviewer could request DOC_REVISION on a CAR_REVIEWING app (or
 * FIELD_CAR on ASSIGNED_FOR_REVIEW) and write an illegal transition. The fix
 * validates the FROM→TO edge against the canonical ALLOWED_TRANSITIONS.
 *
 * This test pins the canonical-map invariant the guard relies on: the two
 * legitimate edges exist, and the two illegal cross-edges do NOT. If someone
 * widens the map (re-introducing a cross-edge), this fails — flagging that the
 * reject guard would again admit an illegal transition.
 */

'use strict';

const wf = require('../../services/workflow-transition-service');

describe('[audit 2.10] reject edge guard — canonical ALLOWED_TRANSITIONS invariant', () => {
    test('DOC_REVISION (→REVISION_REQUESTED) is legal only from ASSIGNED_FOR_REVIEW', () => {
        expect(wf.ALLOWED_TRANSITIONS.ASSIGNED_FOR_REVIEW.has('REVISION_REQUESTED')).toBe(true);
        // The illegal cross-edge a FIELD_CAR-vs-state mixup would have produced:
        expect(wf.ALLOWED_TRANSITIONS.CAR_REVIEWING.has('REVISION_REQUESTED')).toBe(false);
    });

    test('FIELD_CAR (→CAR_PENDING) is legal only from CAR_REVIEWING', () => {
        expect(wf.ALLOWED_TRANSITIONS.CAR_REVIEWING.has('CAR_PENDING')).toBe(true);
        // The illegal cross-edge a DOC_REVISION-vs-state mixup would have produced:
        expect(wf.ALLOWED_TRANSITIONS.ASSIGNED_FOR_REVIEW.has('CAR_PENDING')).toBe(false);
    });

    test('both REJECTABLE_STATUSES resolve to a non-empty canonical transition set', () => {
        for (const from of ['ASSIGNED_FOR_REVIEW', 'CAR_REVIEWING']) {
            expect(wf.ALLOWED_TRANSITIONS[from]).toBeInstanceOf(Set);
            expect(wf.ALLOWED_TRANSITIONS[from].size).toBeGreaterThan(0);
        }
    });
});
