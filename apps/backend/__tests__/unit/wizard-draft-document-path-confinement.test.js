/**
 * SEC — an applicant must not be able to delete arbitrary files off the server.
 *
 * Two wizard endpoints compose into arbitrary deletion:
 *
 *   1. POST /api/wizard/draft (wizardController.saveDraft) wrote
 *      `formData: formData || {}` — the client's blob REPLACING the stored one
 *      wholesale, with no ownership filter.
 *   2. DELETE /api/wizard/draft-documents/:documentId
 *      (wizardController.deleteDraftDocument) looks the document up inside
 *      `formData.uploadedDocuments`, then passes the entry's own `filePath`
 *      straight to `fs.unlink()` and its own `s3Key` to
 *      `storageService.deleteObject()`.
 *
 * `uploadedDocuments` is written by the upload handler from multer's output, so
 * it is a SERVER record — but step 1 let the applicant author it. Planting
 * `{ documentId: 'x', filePath: '<any path>' }` and then calling step 2 unlinked
 * that path as the node process user. The `.catch(() => {})` on the unlink means
 * it fails silently, so the attack leaves no error trace.
 *
 * Two independent controls, because either alone leaves a gap:
 *
 *   • Ownership — saveDraft keeps the SERVER's uploadedDocuments and ignores the
 *     client's. This closes the only route that poisons the record today.
 *   • Confinement — deleteDraftDocument resolves filePath and refuses anything
 *     outside the uploads root. This holds even if some future writer
 *     reintroduces a poisoned path, and costs one path.resolve comparison.
 *
 * The confinement check uses path.resolve + a separator-terminated prefix test,
 * so `/uploads-evil/x` does not pass as a child of `/uploads`, and `..`
 * traversal is normalised away before the comparison rather than after.
 */

'use strict';

const path = require('path');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

const mockUnlink = jest.fn(async () => undefined);
jest.mock('fs/promises', () => ({
    unlink: (...a) => mockUnlink(...a),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
}));

const mockDeleteObject = jest.fn(async () => undefined);
jest.mock('../../services/storage-service', () => ({
    deleteObject: (...a) => mockDeleteObject(...a),
    BUCKETS: { uploads: 'uploads' },
    createUploader: jest.fn(() => ({ single: jest.fn(() => (_req, _res, next) => next()) })),
    // The confinement check itself is the REAL implementation — stubbing it
    // would make this suite assert against a decision production never makes.
    resolveWithinUploads: jest.requireActual('../../services/storage-service').resolveWithinUploads,
}));

const mockDraftUpdate = jest.fn(async () => ({}));
const mockDraftFindUnique = jest.fn();
const mockDraftUpsert = jest.fn(async (args) => ({ id: 'draft-1', ...args.update }));
const mockDraftCreate = jest.fn(async (args) => ({ id: 'draft-1', ...args.data }));
const mockDraftUpdateMany = jest.fn(async () => ({ count: 1 }));
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        applicationDraft: {
            update: (...a) => mockDraftUpdate(...a),
            findUnique: (...a) => mockDraftFindUnique(...a),
            upsert: (...a) => mockDraftUpsert(...a),
            create: (...a) => mockDraftCreate(...a),
            updateMany: (...a) => mockDraftUpdateMany(...a),
        },
    },
}));

jest.mock('../../services/application-service', () => ({}));
jest.mock('../../services/fee-service', () => ({}));

const wizardController = require('../../controllers/wizard-controller');

// apps/backend/public/uploads — the root storage-service writes into.
const UPLOAD_ROOT = path.join(__dirname, '../../public/uploads');
const LEGIT_FILE = path.join(UPLOAD_ROOT, 'wizard-drafts', '1234-abcd.pdf');

function buildRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

function draftWithDocs(docs) {
    return {
        id: 'draft-1',
        userId: 'user-1',
        status: 'DRAFT',
        isDeleted: false,
        formData: { uploadedDocuments: docs },
    };
}

describe('SEC — wizard draft-document deletion is confined to the uploads root', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(wizardController, 'resolveHealthContext')
            .mockResolvedValue({ userId: 'user-1', healthId: '1100000000008' });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    async function deleteDoc(documentId, docs) {
        jest.spyOn(wizardController, 'getOrCreateActiveDraft')
            .mockResolvedValue(draftWithDocs(docs));
        const res = buildRes();
        await wizardController.deleteDraftDocument(
            { params: { documentId }, query: {}, user: { id: 'user-1' } },
            res,
        );
        return res;
    }

    it('refuses to unlink an absolute path outside the uploads root', async () => {
        await deleteDoc('doc-1', [{ documentId: 'doc-1', filePath: '/etc/passwd' }]);

        expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('refuses to unlink a traversal path that escapes the uploads root', async () => {
        await deleteDoc('doc-1', [{
            documentId: 'doc-1',
            filePath: path.join(UPLOAD_ROOT, '..', '..', '..', 'shared', 'logger.js'),
        }]);

        expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('refuses a sibling directory that merely shares the root prefix', async () => {
        await deleteDoc('doc-1', [{ documentId: 'doc-1', filePath: `${UPLOAD_ROOT}-evil/x.pdf` }]);

        expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('still unlinks a genuine upload inside the root', async () => {
        await deleteDoc('doc-1', [{ documentId: 'doc-1', filePath: LEGIT_FILE }]);

        expect(mockUnlink).toHaveBeenCalledWith(LEGIT_FILE);
    });

    it('removes the record from formData even when the path is refused', async () => {
        const res = await deleteDoc('doc-1', [
            { documentId: 'doc-1', filePath: '/etc/passwd' },
            { documentId: 'doc-2', filePath: LEGIT_FILE },
        ]);

        expect(res.json).toHaveBeenCalled();
        const written = mockDraftUpdate.mock.calls[0][0].data.formData.uploadedDocuments;
        expect(written.map((d) => d.documentId)).toEqual(['doc-2']);
    });
});

describe('SEC — saveDraft cannot author the server-owned uploadedDocuments record', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDraftFindUnique.mockResolvedValue({
            id: 'draft-1',
            userId: 'user-1',
            status: 'DRAFT',
            isDeleted: false,
            version: 3,
            formData: { uploadedDocuments: [{ documentId: 'real', filePath: LEGIT_FILE }] },
        });
    });

    it('keeps the stored uploadedDocuments when the client sends its own', async () => {
        const res = buildRes();
        await wizardController.saveDraft({
            user: { id: 'user-1' },
            body: {
                plantId: 'p1',
                serviceType: 'new_application',
                currentStep: 3,
                formData: {
                    farmName: 'ไร่ทดสอบ',
                    uploadedDocuments: [{ documentId: 'evil', filePath: '/etc/passwd' }],
                },
            },
        }, res);

        const written = mockDraftUpsert.mock.calls[0][0].update.formData;
        // The applicant's wizard answers are kept …
        expect(written.farmName).toBe('ไร่ทดสอบ');
        // … but the upload record stays the server's.
        expect(written.uploadedDocuments).toEqual([{ documentId: 'real', filePath: LEGIT_FILE }]);
    });

    it('keeps the stored uploadedDocuments on the version-checked update path', async () => {
        const res = buildRes();
        await wizardController.saveDraft({
            user: { id: 'user-1' },
            body: {
                plantId: 'p1',
                serviceType: 'new_application',
                currentStep: 3,
                expectedVersion: 3,
                formData: {
                    uploadedDocuments: [{ documentId: 'evil', filePath: '/etc/passwd' }],
                },
            },
        }, res);

        const written = mockDraftUpdateMany.mock.calls[0][0].data.formData;
        expect(written.uploadedDocuments).toEqual([{ documentId: 'real', filePath: LEGIT_FILE }]);
    });
});
