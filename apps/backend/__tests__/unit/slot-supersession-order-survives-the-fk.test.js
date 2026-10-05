/**
 * Replacing the document in an occupied slot never worked against a real database.
 *
 * `takeTheSlot` mints the new row's id up front and then, in ONE updateMany,
 * releases the old rows AND points them at their successor:
 *
 *     supersededById: id      ← the row with that id does not exist yet
 *     …
 *     tx.applicationDocument.create({ data: { ...data, id, … } })
 *
 * Postgres checks `application_documents_supersededById_fkey` on that update, the
 * row is not there, the transaction aborts, and syncApplicationDocument — which
 * documents itself as "best-effort: logs and swallows errors" — returns null. The
 * caller answers HTTP 200 with a documentId and nothing was written.
 *
 * Observed in the 2026-09-05 UAT walk: three re-uploads to one slot, two of them
 * with genuinely different bytes, left ONE row with the original fileHash,
 * slotVersion 1 and supersededAt null. Calling the sync directly surfaced the
 * swallowed error:
 *
 *     Foreign key constraint violated:
 *     `application_documents_supersededById_fkey (index)`
 *
 * The two constraints genuinely conflict in that order — the unique index on
 * (applicationId, currentForSlot) demands the release happen BEFORE the insert,
 * while the FK demands the successor exist BEFORE anything names it. Both hold if
 * naming the successor is a THIRD step, after the insert.
 *
 * The existing reupload test cannot see any of this: it mocks prisma away
 * (`jest.mock('../../services/prisma-database', () => ({ prisma: {} }))`), so it
 * asserts the intent while the database refuses the implementation. This test
 * asserts the ORDER instead, which a mock can observe.
 */
'use strict';

jest.mock('../../shared/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

const { syncApplicationDocument } = require('../../services/application-document-sync');

/** Records the sequence of writes a transaction performs. */
function makeTx(calls) {
    return {
        applicationDocument: {
            findMany: jest.fn(async () => { calls.push('findMany'); return [{ slotVersion: 1, id: 'old-1' }]; }),
            updateMany: jest.fn(async (args) => {
                calls.push(`updateMany:${'supersededById' in (args.data || {}) ? 'names-successor' : 'release'}`);
                return { count: 1 };
            }),
            create: jest.fn(async ({ data }) => { calls.push('create'); return { ...data }; }),
        },
    };
}

function makePrisma(calls) {
    const tx = makeTx(calls);
    return {
        applicationDocument: {
            findFirst: jest.fn(async () => null),
            ...tx.applicationDocument,
        },
        $transaction: jest.fn(async (fn) => fn(tx)),
    };
}

const ARGS = {
    applicationId: 'app-1', documentId: 'doc-new', slotId: 'land_rights', stepKey: 'documents',
    fileName: 'rescan.pdf', fileUrl: '/uploads/rescan.pdf', fileSize: 4890,
    mimeType: 'application/pdf', uploadedBy: 'user-1', absolutePath: '/nonexistent',
};

describe('taking an occupied slot respects BOTH the unique index and the FK', () => {
    test('the successor is created BEFORE any row names it', async () => {
        const calls = [];
        await syncApplicationDocument(makePrisma(calls), ARGS);

        const created = calls.indexOf('create');
        const named = calls.indexOf('updateMany:names-successor');
        expect(created).toBeGreaterThan(-1);
        expect(named).toBeGreaterThan(-1);
        // The FK is checked the moment supersededById is written. Naming the
        // successor before it exists is what aborted every real replacement.
        expect(named).toBeGreaterThan(created);
    });

    test('the slot is RELEASED before the insert claims it', async () => {
        const calls = [];
        await syncApplicationDocument(makePrisma(calls), ARGS);

        const released = calls.indexOf('updateMany:release');
        const created = calls.indexOf('create');
        // The unique index on (applicationId, currentForSlot) refuses the other
        // order — so this is the constraint pulling the opposite way from the FK.
        expect(released).toBeGreaterThan(-1);
        expect(released).toBeLessThan(created);
    });

    test('the release does NOT carry supersededById', async () => {
        const calls = [];
        const prisma = makePrisma(calls);
        await syncApplicationDocument(prisma, ARGS);

        const releaseCall = prisma.$transaction.mock.calls.length
            ? null : null; // the tx object is internal; assert via the recorded sequence
        expect(releaseCall).toBeNull();
        expect(calls.filter((c) => c === 'updateMany:release')).toHaveLength(1);
        expect(calls.filter((c) => c === 'updateMany:names-successor')).toHaveLength(1);
    });
});
