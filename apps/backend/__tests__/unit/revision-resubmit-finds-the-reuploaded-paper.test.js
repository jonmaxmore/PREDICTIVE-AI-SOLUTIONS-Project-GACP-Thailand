/**
 * The resubmit door looked for the applicant's re-uploaded paper under the wrong
 * column, so it never found one and refused every resubmit.
 *
 * `ApplicationDocument` stores the slot twice, in two different spellings:
 *
 *     slotId       'land_rights'    ← the vocabulary the review rows use
 *     documentType 'LAND_RIGHTS'    ← the derived, upper-cased type
 *
 * The door queried `documentType: { in: requestedRows.map(r => r.slotId) }` —
 * comparing 'LAND_RIGHTS' against 'land_rights'. Proved against a real Postgres
 * during the 2026-09-05 UAT walk, with the exact SQL the code runs:
 *
 *     documentType IN ('land_rights')  → 0 rows
 *     slotId       IN ('land_rights')  → 1 row
 *
 * With no rows, `assertRevisionSlotsRefreshed` sees an empty document list, judges
 * every requested slot un-refreshed, and answers REVISION_INCOMPLETE — "please
 * upload the new document" — to an applicant who just did. There is no way out of
 * that loop from the applicant's side, and the message tells them to keep trying
 * the thing that cannot work.
 *
 * The fix matches on the slot under BOTH spellings, because `slotId` is nullable
 * and rows written before it existed carry only `documentType`.
 */
'use strict';

const { documentTypesOfSlot } = require('../../services/application-document-sync');

describe('the slot is stored under two spellings, and both must be searched', () => {
    test('documentTypesOfSlot covers the upper-cased type the table actually holds', () => {
        const names = documentTypesOfSlot('land_rights');
        expect(names).toEqual(expect.arrayContaining(['LAND_RIGHTS']));
    });

    test('a lower-case slotId alone would not match the stored documentType', () => {
        // The bug in one line: the two spellings are not equal, so a filter on one
        // column using the other column's vocabulary matches nothing.
        expect(documentTypesOfSlot('land_rights')).not.toEqual(['land_rights']);
    });
});

describe('buildRequestedSlotDocumentFilter — the resubmit door\'s lookup', () => {
    const { buildRequestedSlotDocumentFilter } = require('../../routes/api/applications/revision-resubmit');

    test('matches a row that carries only slotId', () => {
        const where = buildRequestedSlotDocumentFilter('app-1', ['land_rights']);
        expect(where.OR).toEqual(expect.arrayContaining([{ slotId: { in: ['land_rights'] } }]));
    });

    test('matches a legacy row that carries only the upper-cased documentType', () => {
        const where = buildRequestedSlotDocumentFilter('app-1', ['land_rights']);
        const byType = where.OR.find((clause) => clause.documentType);
        expect(byType.documentType.in).toEqual(expect.arrayContaining(['LAND_RIGHTS']));
    });

    test('stays scoped to the one application', () => {
        // Without this the door would read another applicant's uploads and let a
        // resubmit through on the strength of a stranger's paperwork.
        expect(buildRequestedSlotDocumentFilter('app-1', ['land_rights']).applicationId).toBe('app-1');
    });

    test('an empty slot list matches nothing rather than everything', () => {
        const where = buildRequestedSlotDocumentFilter('app-1', []);
        expect(where.OR.every((clause) => Object.values(clause)[0].in.length === 0)).toBe(true);
    });
});
