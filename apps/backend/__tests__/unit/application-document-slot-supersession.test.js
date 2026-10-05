'use strict';

/**
 * F-G4-15 — a document slot holds ONE current document, and the data says which.
 *
 * Measured in the G4 walk: one draft application carried 67 `application_documents`
 * rows, six of them the ภท.11 slot, because every upload was an INSERT and
 * nothing replaced by slot. An officer opening that application had six ภท.11
 * rows and no rule saying which one the certificate would rest on; a farmer who
 * replaced a wrong file had no way to know which one would be opened.
 *
 * The rule now: every upload is still recorded, and exactly one row per
 * (application, slot) carries `currentForSlot` — that row IS the document being
 * judged. The rows it replaced keep `supersededAt` + `supersededById`.
 *
 * The fake client below enforces the same unique index the migration creates
 * (`application_documents_applicationId_currentForSlot_key`), NULLs distinct, so
 * these assertions fail the same way Postgres would rather than only proving
 * that the module does what the module does. Before the fix, the very first
 * assertion — two uploads to one slot leave one current row — was 0 current rows
 * out of 2, because no such column was written at all.
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const logger = require('../../shared/logger');
const {
    syncApplicationDocument,
    removeApplicationDocument,
    UNSLOTTED_DOCUMENT_TYPE,
} = require('../../services/application-document-sync');

const APP_ID = 'app-g4-walk';

/**
 * An in-memory `application_documents` that refuses what Postgres would refuse.
 * Only the operations this module issues are implemented; anything else throws
 * loudly rather than quietly returning a shape the real client never would.
 */
function makeFakeDocumentStore() {
    const rows = [];
    let sequence = 0;

    // `{ column: value }` and Prisma's `{ column: { in: [...] } }`, because the
    // module has to ask about a slot's whole set of past names in one query and a
    // fake that only understands equality would answer a question Postgres never
    // gets asked.
    const matches = (row, where = {}) =>
        Object.entries(where).every(([column, value]) => (
            value && typeof value === 'object' && Array.isArray(value.in)
                ? value.in.includes(row[column])
                : row[column] === value
        ));

    const enforceOneCurrentPerSlot = () => {
        const taken = new Set();
        for (const row of rows) {
            if (row.currentForSlot === null || row.currentForSlot === undefined) { continue; }
            const key = `${row.applicationId}\x00${row.currentForSlot}`;
            if (taken.has(key)) {
                const violation = new Error(
                    'Unique constraint failed on the fields: (`applicationId`,`currentForSlot`)',
                );
                violation.code = 'P2002';
                throw violation;
            }
            taken.add(key);
        }
    };

    const applicationDocument = {
        findFirst: async ({ where }) => {
            const hit = rows.find((row) => matches(row, where));
            return hit ? { ...hit } : null;
        },
        findMany: async ({ where }) => rows.filter((row) => matches(row, where)).map((row) => ({ ...row })),
        create: async ({ data }) => {
            sequence += 1;
            const row = {
                id: `generated-${sequence}`,
                createdAt: new Date(2569, 0, sequence),
                currentForSlot: null,
                slotVersion: 1,
                supersededAt: null,
                supersededById: null,
                ...data,
            };
            rows.push(row);
            try {
                enforceOneCurrentPerSlot();
            } catch (violation) {
                rows.pop();
                throw violation;
            }
            return { ...row };
        },
        update: async ({ where, data }) => {
            const row = rows.find((candidate) => candidate.id === where.id);
            if (!row) { throw new Error(`update: no row ${where.id}`); }
            Object.assign(row, data);
            enforceOneCurrentPerSlot();
            return { ...row };
        },
        updateMany: async ({ where, data }) => {
            const hits = rows.filter((row) => matches(row, where));
            hits.forEach((row) => Object.assign(row, data));
            return { count: hits.length };
        },
        deleteMany: async ({ where }) => {
            const doomed = new Set(rows.filter((row) => matches(row, where)).map((row) => row.id));
            for (let index = rows.length - 1; index >= 0; index -= 1) {
                if (doomed.has(rows[index].id)) { rows.splice(index, 1); }
            }
            // The self-FK is ON DELETE SET NULL.
            rows.forEach((row) => {
                if (doomed.has(row.supersededById)) { row.supersededById = null; }
            });
            return { count: doomed.size };
        },
    };

    return {
        applicationDocument,
        $transaction: async (work) => work({ applicationDocument }),
        allRows: () => rows.map((row) => ({ ...row })),
    };
}

let uploadCounter = 0;
function upload(prisma, { slotId, fileName, documentId }) {
    uploadCounter += 1;
    return syncApplicationDocument(prisma, {
        applicationId: APP_ID,
        documentId: documentId || `doc-${uploadCounter}`,
        slotId,
        stepKey: 'documents',
        fileName,
        fileUrl: `/uploads/application-drafts/${uploadCounter}-${fileName}`,
        fileSize: 14029,
        mimeType: 'application/pdf',
        uploadedBy: 'user-1',
        absolutePath: null,
    });
}

const currentRows = (prisma, documentType) =>
    prisma.allRows().filter((row) => row.currentForSlot === documentType);

beforeEach(() => {
    jest.clearAllMocks();
    uploadCounter = 0;
});

describe('re-uploading into a slot', () => {
    test('the second upload becomes the slot document and the first is kept as history', async () => {
        const prisma = makeFakeDocumentStore();
        const first = await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'wrong-scan.pdf' });
        const second = await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'right-scan.pdf' });

        // Nothing was lost: both uploads are still on the record.
        expect(prisma.allRows()).toHaveLength(2);

        // And exactly one of them is the answer to "which one is being judged".
        const current = currentRows(prisma, 'CONTROLLED_HERB_LICENSE');
        expect(current).toHaveLength(1);
        expect(current[0].id).toBe(second.id);
        expect(current[0].fileName).toBe('right-scan.pdf');
        expect(current[0].slotVersion).toBe(2);

        const superseded = prisma.allRows().find((row) => row.id === first.id);
        expect(superseded.currentForSlot).toBeNull();
        expect(superseded.supersededById).toBe(second.id);
        expect(superseded.supersededAt).toBeInstanceOf(Date);
        expect(superseded.slotVersion).toBe(1);

        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('the ภท.11 slot uploaded six times leaves six rows and ONE current document', async () => {
        const prisma = makeFakeDocumentStore();
        const uploaded = [];
        for (const fileName of ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf', 'f.pdf']) {
            // Sequential on purpose: this is one farmer replacing one file six times.
            uploaded.push(await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName }));
        }

        expect(prisma.allRows()).toHaveLength(6);
        const current = currentRows(prisma, 'CONTROLLED_HERB_LICENSE');
        expect(current).toHaveLength(1);
        expect(current[0].fileName).toBe('f.pdf');
        expect(current[0].slotVersion).toBe(6);

        // The history is a chain, readable forwards without sorting by time.
        const byId = new Map(prisma.allRows().map((row) => [row.id, row]));
        for (let index = 0; index < uploaded.length - 1; index += 1) {
            const row = byId.get(uploaded[index].id);
            expect(row.slotVersion).toBe(index + 1);
            expect(row.supersededById).toBe(uploaded[index + 1].id);
        }
        expect(byId.get(uploaded[5].id).supersededById).toBeNull();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('two spellings of the same slot are the same slot', async () => {
        const prisma = makeFakeDocumentStore();
        await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'first.pdf' });
        const second = await upload(prisma, { slotId: 'license_bt11', fileName: 'second.pdf' });

        const current = currentRows(prisma, 'CONTROLLED_HERB_LICENSE');
        expect(current).toHaveLength(1);
        expect(current[0].id).toBe(second.id);
    });

    test('a different slot is untouched by the replacement', async () => {
        const prisma = makeFakeDocumentStore();
        const landDeed = await upload(prisma, { slotId: 'LAND_TITLE', fileName: 'deed.pdf' });
        await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'permit-1.pdf' });
        await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'permit-2.pdf' });

        const deedRow = prisma.allRows().find((row) => row.id === landDeed.id);
        expect(deedRow.currentForSlot).toBe('LAND_RIGHTS');
        expect(deedRow.supersededAt).toBeNull();
        expect(currentRows(prisma, 'CONTROLLED_HERB_LICENSE')).toHaveLength(1);
    });
});

describe('uploads that hold no slot', () => {
    test('two slotless uploads coexist and neither claims a slot', async () => {
        const prisma = makeFakeDocumentStore();
        await upload(prisma, { slotId: null, fileName: 'extra-1.pdf' });
        await upload(prisma, { slotId: '', fileName: 'extra-2.pdf' });

        const rows = prisma.allRows();
        expect(rows).toHaveLength(2);
        rows.forEach((row) => {
            expect(row.documentType).toBe(UNSLOTTED_DOCUMENT_TYPE);
            expect(row.currentForSlot).toBeNull();
        });
        expect(logger.warn).not.toHaveBeenCalled();
    });
});

describe('recording the same upload twice', () => {
    test('re-syncing one documentId corrects that row instead of superseding it', async () => {
        const prisma = makeFakeDocumentStore();
        const first = await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'permit.pdf', documentId: 'doc-fixed' });
        const resynced = await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'permit-renamed.pdf', documentId: 'doc-fixed' });

        expect(prisma.allRows()).toHaveLength(1);
        expect(resynced.id).toBe(first.id);
        expect(resynced.fileName).toBe('permit-renamed.pdf');
        expect(resynced.slotVersion).toBe(1);
        expect(resynced.currentForSlot).toBe('CONTROLLED_HERB_LICENSE');
        expect(resynced.supersededAt).toBeNull();
    });
});

describe('deleting the slot document', () => {
    test('the slot is left empty, and the replaced rows stay as history', async () => {
        const prisma = makeFakeDocumentStore();
        const first = await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'old.pdf', documentId: 'doc-old' });
        await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'new.pdf', documentId: 'doc-new' });

        await removeApplicationDocument(prisma, APP_ID, 'doc-new');

        expect(currentRows(prisma, 'CONTROLLED_HERB_LICENSE')).toHaveLength(0);
        const survivor = prisma.allRows();
        expect(survivor).toHaveLength(1);
        expect(survivor[0].id).toBe(first.id);
        // The document it pointed at is gone; the fact that it was replaced is not.
        expect(survivor[0].supersededAt).toBeInstanceOf(Date);
        expect(survivor[0].supersededById).toBeNull();
    });

    test('a later upload can take the emptied slot', async () => {
        const prisma = makeFakeDocumentStore();
        await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'old.pdf', documentId: 'doc-old' });
        await removeApplicationDocument(prisma, APP_ID, 'doc-old');
        const replacement = await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'fresh.pdf' });

        const current = currentRows(prisma, 'CONTROLLED_HERB_LICENSE');
        expect(current).toHaveLength(1);
        expect(current[0].id).toBe(replacement.id);
        expect(logger.warn).not.toHaveBeenCalled();
    });
});

describe('rows written before the rule existed', () => {
    test('an upload into a slot the migration left undecided takes the slot and outranks them', async () => {
        // The migration deliberately marks nothing current where a slot already
        // holds several rows — that choice is the operator's. This is what
        // happens when the farmer settles it themselves by uploading again.
        //
        // The fixture rows carry 'LICENSE_BT11' because that is what is IN the
        // table: documentType is the canonical id AS OF THE DAY IT WAS WRITTEN
        // (application-document-sync.js:48-52), and on that day the canon of the
        // ภท.11 slot was license_bt11. Restamping the fixture to today's canon
        // would delete the whole question this block exists to ask.
        const prisma = makeFakeDocumentStore();
        for (const fileName of ['legacy-1.pdf', 'legacy-2.pdf', 'legacy-3.pdf']) {
            await prisma.applicationDocument.create({
                data: {
                    applicationId: APP_ID,
                    documentType: 'LICENSE_BT11',
                    fileUrl: `/uploads/application-drafts/${fileName}`,
                    fileName,
                    currentForSlot: null,
                    slotVersion: 1,
                },
            });
        }

        const fresh = await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'the-real-one.pdf' });

        expect(prisma.allRows()).toHaveLength(4);
        const current = currentRows(prisma, 'CONTROLLED_HERB_LICENSE');
        expect(current).toHaveLength(1);
        expect(current[0].id).toBe(fresh.id);
        // Version 2, not 4: the three pre-rule rows all carry the default 1,
        // so the counter can only say "the second version this slot has ever
        // recorded". It counts recorded versions, and it never went back to
        // invent numbers for rows written before anything was counting. It DOES
        // have to see them, though — they are the same slot under its old name.
        expect(current[0].slotVersion).toBe(2);
    });
});

describe('rows written before the slot was renamed (กทล.1 v2 fold, spec 2026-09-01)', () => {
    /**
     * The fold moved the canon of six slots, and documentType is written from the
     * canon of the day. So an application that has been open since before this
     * branch holds `documentType='LICENSE_BT11', currentForSlot='LICENSE_BT11'`,
     * and the next upload into that same paper derives 'CONTROLLED_HERB_LICENSE'.
     *
     * If the release step (application-document-sync.js:124) matches
     * currentForSlot by EXACT string, the old row is never released: the
     * application ends up with TWO rows that are both "the current document" for
     * one กทล.1 attachment, which is the F-G4-15 invariant this whole file
     * defends, and the unique index does not catch it because the two strings
     * differ. The slot's version history restarts at 1 as well, so the officer
     * cannot see that the file was replaced.
     *
     * Nothing rewrites the old rows (no data migration — spec §7), so the release
     * has to be by SLOT, not by spelling.
     */
    const RENAMED = [
        { legacyType: 'LICENSE_BT11', slotId: 'CONTROLLED_HERB_LICENSE', canonical: 'CONTROLLED_HERB_LICENSE' },
        { legacyType: 'LAND_DEED', slotId: 'LAND_TITLE', canonical: 'LAND_RIGHTS' },
        { legacyType: 'ID_CARD', slotId: 'id-card', canonical: 'ID_HOUSE_REG' },
        { legacyType: 'COMPANY_REG', slotId: 'company-reg', canonical: 'JURISTIC_REG_6M' },
        { legacyType: 'SITE_MAP', slotId: 'SITE_MAP', canonical: 'SITE_MAP_COORDS' },
        { legacyType: 'PHOTOS_EXTERIOR', slotId: 'EXTERIOR_PHOTOS', canonical: 'SITE_PHOTOS' },
    ];

    test.each(RENAMED)(
        'a current $legacyType row is released by the $canonical upload that replaces it',
        async ({ legacyType, slotId, canonical }) => {
            const prisma = makeFakeDocumentStore();
            const legacy = await prisma.applicationDocument.create({
                data: {
                    applicationId: APP_ID,
                    documentType: legacyType,
                    fileUrl: '/uploads/application-drafts/filed-last-year.pdf',
                    fileName: 'filed-last-year.pdf',
                    currentForSlot: legacyType,
                    slotVersion: 1,
                },
            });

            const replacement = await upload(prisma, { slotId, fileName: 'replacement.pdf' });

            // ONE current document for the slot, whichever name it was filed under.
            const stillCurrent = prisma.allRows().filter((row) => row.currentForSlot !== null);
            expect(stillCurrent).toHaveLength(1);
            expect(stillCurrent[0].id).toBe(replacement.id);
            expect(stillCurrent[0].currentForSlot).toBe(canonical);

            // And the row it replaced says so, so the history reads forwards.
            const released = prisma.allRows().find((row) => row.id === legacy.id);
            expect(released.currentForSlot).toBeNull();
            expect(released.supersededById).toBe(replacement.id);
            expect(released.supersededAt).toBeInstanceOf(Date);

            // The version counter counts the slot, not the spelling.
            expect(stillCurrent[0].slotVersion).toBe(2);
            expect(logger.warn).not.toHaveBeenCalled();
        },
    );

    test('a row of a DIFFERENT slot that merely folded elsewhere is not released', async () => {
        // land_rights and controlled_herb_license both took old spellings in the
        // fold. Releasing "anything that ever folded" would be as wrong as
        // releasing nothing.
        const prisma = makeFakeDocumentStore();
        const landDeed = await prisma.applicationDocument.create({
            data: {
                applicationId: APP_ID,
                documentType: 'LAND_DEED',
                fileUrl: '/uploads/application-drafts/deed.pdf',
                fileName: 'deed.pdf',
                currentForSlot: 'LAND_DEED',
                slotVersion: 1,
            },
        });

        await upload(prisma, { slotId: 'CONTROLLED_HERB_LICENSE', fileName: 'permit.pdf' });

        const deedRow = prisma.allRows().find((row) => row.id === landDeed.id);
        expect(deedRow.currentForSlot).toBe('LAND_DEED');
        expect(deedRow.supersededAt).toBeNull();
    });
});

describe('two DIFFERENT papers the wizard still asks for separately', () => {
    /**
     * The release above is by SLOT, which is right for a rename and destructive
     * for a merge. กทล.1 puts the ID card and the house registration in ONE
     * attachment (spec §2.1 `ID_HOUSE_REG`), but the wizard that ships today still
     * renders two required controls side by side
     * (documents-step-config.tsx:137,138) and the applicant fills both. If both
     * ids fold onto one canon before one control holds them both, the house
     * registration upload releases the ID card row, `documents-step.tsx:131-137`
     * keeps both rows green in local state, and the officer opens one file.
     *
     * So: until T6 writes one card per กทล.1 slot, an id whose paper still has its
     * own control keeps its own current row. Each case below is a real pair of
     * controls a farmer sees at the same time.
     */
    test.each([
        // สำเนาบัตรประชาชน then สำเนาทะเบียนบ้าน — INDIVIDUAL, documents-step-config.tsx:137,138
        { first: 'IND_ID_CARD', second: 'IND_HOUSE_REG' },
        // หนังสือสำคัญ สวช.01 then ทะเบียนรายชื่อสมาชิก ท.ว.ช.3 — :142,143
        { first: 'COM_SVC01', second: 'COM_TVC03' },
        // หนังสือมอบอำนาจ then บัญชีรายชื่อกรรมการ — :152,154
        { first: 'JUR_POA', second: 'JUR_DIRECTOR_LIST' },
        // แปลนอาคาร then ภาพถ่ายภายใน — :252,288
        { first: 'BUILDING_PLAN', second: 'INTERIOR_PHOTOS' },
        // โฉนดที่ดินของแปลงหนึ่ง then ส.ป.ก. ของอีกแปลง — the farm step renders the four
        // land papers as four cards with four file inputs and tells the farmer to
        // attach every kind they hold (farm-info-plots-land-sections.tsx:163,241-249).
        // Two plots, two papers, one sitting: the second must not release the first.
        { first: 'CHANOTE', second: 'SPK' },
        { first: 'NS3', second: 'CHANOTE' },
    ])('$second does not take the slot away from $first', async ({ first, second }) => {
        const prisma = makeFakeDocumentStore();
        const paperA = await upload(prisma, { slotId: first, fileName: 'paper-a.pdf' });
        const paperB = await upload(prisma, { slotId: second, fileName: 'paper-b.pdf' });

        // What the server is left holding: BOTH papers, each current for its own
        // slot. One current row here would mean a document the applicant attached,
        // and still sees on screen, is gone.
        const current = prisma.allRows().filter((row) => row.currentForSlot !== null);
        expect(current.map((row) => row.fileName).sort()).toEqual(['paper-a.pdf', 'paper-b.pdf']);
        expect(current.map((row) => row.id).sort()).toEqual([paperA.id, paperB.id].sort());
        expect(prisma.allRows().every((row) => row.supersededAt === null)).toBe(true);
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
