/**
 * Bug 8.3 — findDraftForSubmit id-less fallback must filter by status.
 *
 * The submit endpoint (applications.js:500) calls findDraftForSubmit with an
 * OPTIONAL applicationId. When the client omits it, the lookup was
 * `where: { healthId, isDeleted: false }` ordered by updatedAt desc — i.e. it
 * returned the applicant's MOST-RECENTLY-UPDATED application of ANY status.
 * So an applicant who also has a CERTIFIED / EXPIRED / in-review application
 * that was touched more recently than their working DRAFT would have that
 * wrong application picked as "the draft to submit" → a confusing 409
 * (INVALID_STATUS_FOR_SUBMIT) or a wrong idempotent response instead of
 * submitting their actual draft.
 *
 * Fix: the id-less fallback filters to the submit-eligible SOURCE states the
 * /submit handler can actually transition from (RESUBMIT_TARGET keys):
 * DRAFT, REGISTERED, REVISION_REQUESTED, CAR_PENDING. The exact-id path is
 * unchanged (the handler validates that specific application's status and
 * returns the proper idempotent/409 response).
 */

'use strict';

const {
    createApplicationApplicantQueryMethods,
} = require('../../services/application-service/application-applicant-query-methods');

const SUBMITTABLE = ['DRAFT', 'REVISION_REQUESTED', 'CAR_PENDING'];
// Spec 2026-09-30 §3.1 (Task 4): the lookup reads within the caller's holder
// scope; R1 keeps the pre-R1 healthId pin as the AND member.
const SCOPE = { userId: 'U1', readIds: ['entity-1'], editIds: ['entity-1'] };

describe('Bug 8.3 — findDraftForSubmit status filter', () => {
    test('id-less lookup filters to submittable source states (not any status)', async () => {
        const findFirst = jest.fn(async () => null);
        const methods = createApplicationApplicantQueryMethods({ prisma: { application: { findFirst } } });

        await methods.findDraftForSubmit({ healthId: 'H1', holderScope: SCOPE }); // no applicationId

        expect(findFirst).toHaveBeenCalledTimes(1);
        const { where } = findFirst.mock.calls[0][0];
        expect(where.AND).toEqual([{ healthId: 'H1' }]);
        expect(JSON.parse(JSON.stringify(where.OR))).toEqual([{ entityId: { in: ['entity-1'] } }, { healthId: 'H1' }]);
        expect(where.isDeleted).toBe(false);
        expect(where.status).toEqual({ in: SUBMITTABLE });
    });

    test('exact-id lookup does NOT add a status filter (handler validates that app)', async () => {
        const findFirst = jest.fn(async () => null);
        const methods = createApplicationApplicantQueryMethods({ prisma: { application: { findFirst } } });

        await methods.findDraftForSubmit({ applicationId: 'app-1', healthId: 'H1', holderScope: SCOPE });

        const { where } = findFirst.mock.calls[0][0];
        expect(where.id).toBe('app-1');
        expect(where.status).toBeUndefined();
    });

    test('returns null immediately when healthId is absent (unchanged)', async () => {
        const findFirst = jest.fn(async () => ({ id: 'x' }));
        const methods = createApplicationApplicantQueryMethods({ prisma: { application: { findFirst } } });
        await expect(methods.findDraftForSubmit({ holderScope: SCOPE })).resolves.toBeNull();
        expect(findFirst).not.toHaveBeenCalled();
    });
});
