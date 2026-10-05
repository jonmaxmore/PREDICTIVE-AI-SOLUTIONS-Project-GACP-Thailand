/**
 * B3 — deleting a draft attachment must remove the BYTES, not just the row.
 *
 * DELETE /api/applications/draft-documents/:documentId used to drop the entry
 * from `Application.formData.draftDocuments` and hard-delete the mirrored
 * `application_documents` row (application-document-sync.js:74-81) while leaving
 * the uploaded file on disk. Because that row was the ONLY owner record the
 * static `/uploads` gate could resolve, the delete turned a file that answered
 * 404 for every non-owner into a file that answered 200 with the bytes for any
 * logged-in user (proven live twice — reports/design-cleanup-2026-08-21/07-BUG-HUNT.md
 * row B3). Deleting made the file MORE accessible than not deleting it.
 *
 * The gate now fails closed (middleware/uploads-access.js), and this suite pins
 * the other half: the delete unlinks the file, so there is nothing left to serve.
 *
 * Confinement: the path is derived from the stored fileUrl and proved to live
 * under the uploads root before unlink (storage-service.resolveWithinUploads),
 * so a poisoned record can never become an arbitrary file delete. The cases
 * marked "moved" came from wizard-draft-document-path-confinement.test.js when
 * the /api/wizard door was deleted (R2 Task 10); this is the one delete door.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const path = require('path');

jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, _res, next) => {
        req.user = { id: 'user-1', role: 'health', canonicalRole: 'health', healthId: 'health-1' };
        return next();
    };
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
    };
});

const mockUnlink = jest.fn(async () => undefined);
jest.mock('fs/promises', () => ({
    ...jest.requireActual('fs/promises'),
    unlink: (...a) => mockUnlink(...a),
}));

jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(),
    deleteDraft: jest.fn(),
    findApplicationByIdForHealth: jest.fn(),
    findLatestOpenDraftForHealth: jest.fn(),
    healDraftEntityColumns: jest.fn(),
    createDraftForHealth: jest.fn(),
    updateApplicantDraftColumns: jest.fn(),
    findDraftForSubmit: jest.fn(),
    getApplicationSlice: jest.fn(),
    findUserOrganizationId: jest.fn(),
    getApplicantReadinessSnapshot: jest.fn(),
    getLatestOpenDraftForApplicant: jest.fn(),
}));
// R2 Task 8: every draft write names its draft, and the caller edits for its holder.
jest.mock('../../services/holder-access', () => ({
    ...jest.requireActual('../../services/holder-access'),
    holderScope: jest.fn(async () => ({ userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] })),
}));

jest.mock('../../services/entity-service', () => ({
    ...jest.requireActual('../../services/entity-service'),
    assertCapability: jest.fn(),
    ensureEntityFromApplicantData: jest.fn(),
}));

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../services/fee-service', () => ({
    calculatePhase1Fee: jest.fn(() => ({})),
    calculatePhase2Fee: jest.fn(() => ({})),
}));

// The confinement check + the upload root are the REAL implementations —
// stubbing them would make this suite assert against a decision production
// never makes.
jest.mock('../../services/storage-service', () => {
    const actual = jest.requireActual('../../services/storage-service');
    return {
        createUploader: jest.fn(() => ({ single: jest.fn(() => (_req, _res, next) => next()) })),
        decodeMultipartFilename: actual.decodeMultipartFilename,
        resolveWithinUploads: actual.resolveWithinUploads,
        BASE_UPLOAD_DIR: actual.BASE_UPLOAD_DIR,
        BUCKETS: actual.BUCKETS,
        deleteObject: jest.fn(async () => undefined),
    };
});

const mockRemoveApplicationDocument = jest.fn(async () => undefined);
jest.mock('../../services/application-document-sync', () => ({
    syncApplicationDocument: jest.fn(async () => null),
    removeApplicationDocument: (...a) => mockRemoveApplicationDocument(...a),
}));

jest.mock('../../services/application-status-writer', () => ({ writeApplicationStatus: jest.fn() }));
jest.mock('../../services/quotation-service', () => ({ issueQuotationsForApplication: jest.fn().mockResolvedValue(null) }));
jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));
jest.mock('../../services/working-days-service', () => ({
    addWorkingDays: jest.fn((d) => d),
    loadHolidaySet: jest.fn().mockResolvedValue(new Set()),
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../shared/workflow-event-builder', () => ({
    buildWorkflowEvent: jest.fn((event) => ({ ...event, id: 'wf-1' })),
}));

jest.mock('../../routes/api/helpers/applications-helpers', () => ({
    mapHealthApplication: jest.fn((app) => app),
    getHealthScopeOptions: jest.fn((user) => ({ healthId: user?.healthId, strictHealthScope: true })),
    getActorIdentity: jest.fn((user) => user?.id || null),
}));

jest.mock('../../routes/api/helpers/application-constants', () => ({
    MASTER_STEPS: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    AUDITOR_ROLES: new Set(['auditor', 'admin']),
    REJECTABLE_STATUSES: new Set(['SUBMITTED']),
    REVISION_DECISION_TYPES: new Set(['DOC_REVISION']),
    asObject: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    asArray: (v) => (Array.isArray(v) ? v : []),
    upper: (v) => String(v || '').toUpperCase(),
    ensureApplicationNumber: jest.fn(() => 'APP-TEST-001'),
    isMissingApplicationCommentsTableError: jest.fn(() => false),
    mergeMasterSteps: jest.fn(() => ({})),
    validateMasterSubmission: jest.fn(() => ({ isValid: true, missingByStep: {} })),
}));

jest.mock('../../routes/api/preview/preview-utils', () => ({
    normalizeDocuments: jest.fn(() => []),
    summarizeCompletion: jest.fn(() => ({ isComplete: true, missingFields: [] })),
}));

jest.mock('../../validation/application-schemas', () => ({
    validateStep: jest.fn(() => ({ success: true, errors: [] })),
    validateAllSteps: jest.fn(() => ({ isValid: true, errorsByStep: {} })),
}));

jest.mock('../../routes/api/applications/application-listing-handlers', () => require('express').Router());
jest.mock('../../routes/api/applications/application-workflow-handlers', () => require('express').Router());

const applicationService = require('../../services/application-service');
const storageService = require('../../services/storage-service');
const applicationsRouter = require('../../routes/api/applications/applications');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', applicationsRouter);
    return app;
}

const DOC_ID = 'doc-1';
const FILE_URL = '/uploads/application-drafts/1716000000000-abc.png';

function seedDraft(docs) {
    applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: 'health-1' });
    applicationService.findApplicationByIdForHealth.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-2026-000001',
        status: 'DRAFT',
        entityId: 'ent-1',
        submitterId: 'user-1',
        formData: { draftDocuments: docs },
        workflowHistory: [],
    });
    applicationService.updateApplicantDraftColumns.mockResolvedValue({ id: 'app-1', formData: {} });
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('B3 — DELETE /draft-documents/:id removes the bytes', () => {
    test('unlinks the stored file inside the uploads root', async () => {
        seedDraft([{ documentId: DOC_ID, fileUrl: FILE_URL, fileName: 'probe.png' }]);
        const res = await request(buildApp()).delete(`/api/applications/draft-documents/${DOC_ID}?applicationId=app-1`);
        expect(res.status).toBe(200);
        expect(res.body?.data?.deleted).toBe(true);
        expect(mockUnlink).toHaveBeenCalledTimes(1);
        const expected = path.join(storageService.BASE_UPLOAD_DIR, 'application-drafts', '1716000000000-abc.png');
        expect(path.resolve(mockUnlink.mock.calls[0][0])).toBe(path.resolve(expected));
    });

    test('still removes the mirrored application_documents row', async () => {
        seedDraft([{ documentId: DOC_ID, fileUrl: FILE_URL }]);
        await request(buildApp()).delete(`/api/applications/draft-documents/${DOC_ID}?applicationId=app-1`);
        expect(mockRemoveApplicationDocument).toHaveBeenCalledWith(expect.anything(), 'app-1', DOC_ID);
    });

    test('a fileUrl pointing outside the uploads root is REFUSED, not unlinked', async () => {
        seedDraft([{ documentId: DOC_ID, fileUrl: '/uploads/application-drafts/../../../../etc/passwd' }]);
        const res = await request(buildApp()).delete(`/api/applications/draft-documents/${DOC_ID}?applicationId=app-1`);
        expect(res.status).toBe(200);
        expect(mockUnlink).not.toHaveBeenCalled();
    });

    test('moved: a fileUrl that is an absolute path outside /uploads is REFUSED, not unlinked', async () => {
        seedDraft([{ documentId: DOC_ID, fileUrl: '/etc/passwd' }]);
        const res = await request(buildApp()).delete(`/api/applications/draft-documents/${DOC_ID}?applicationId=app-1`);
        expect(res.status).toBe(200);
        expect(mockUnlink).not.toHaveBeenCalled();
    });

    test('moved: a sibling directory that merely shares the root prefix is REFUSED', async () => {
        seedDraft([{ documentId: DOC_ID, fileUrl: '/uploads/../uploads-evil/x.pdf' }]);
        const res = await request(buildApp()).delete(`/api/applications/draft-documents/${DOC_ID}?applicationId=app-1`);
        expect(res.status).toBe(200);
        expect(mockUnlink).not.toHaveBeenCalled();
    });

    test('moved: the record is removed from formData even when its path is refused', async () => {
        seedDraft([
            { documentId: DOC_ID, fileUrl: '/etc/passwd' },
            { documentId: 'doc-2', fileUrl: FILE_URL },
        ]);
        const res = await request(buildApp()).delete(`/api/applications/draft-documents/${DOC_ID}?applicationId=app-1`);
        expect(res.status).toBe(200);
        expect(res.body?.data?.deleted).toBe(true);
        const written = JSON.stringify(applicationService.updateApplicantDraftColumns.mock.calls.map((c) => c.slice(1)));
        expect(written).toContain('doc-2');
        expect(written).not.toContain('/etc/passwd');
        expect(mockUnlink).not.toHaveBeenCalled();
    });

    test('a documentId that matches nothing unlinks nothing', async () => {
        seedDraft([{ documentId: 'other', fileUrl: FILE_URL }]);
        const res = await request(buildApp()).delete('/api/applications/draft-documents/doc-missing?applicationId=app-1');
        expect(res.status).toBe(200);
        expect(res.body?.data?.deleted).toBe(false);
        expect(mockUnlink).not.toHaveBeenCalled();
    });

    test('an unlink failure does not fail the delete (the record is already gone)', async () => {
        seedDraft([{ documentId: DOC_ID, fileUrl: FILE_URL }]);
        mockUnlink.mockRejectedValueOnce(new Error('ENOENT'));
        const res = await request(buildApp()).delete(`/api/applications/draft-documents/${DOC_ID}?applicationId=app-1`);
        expect(res.status).toBe(200);
        expect(res.body?.data?.deleted).toBe(true);
    });
});

// Final review I2 (document pre-check): the file's pre-check goes with the file
// — retired (SUPERSEDED, text and snippets cleared) — and, like the pre-check
// hook on the upload, it never changes the delete's response.
describe('DELETE /draft-documents/:id retires the document\'s pre-check', () => {
    const documentPrecheck = require('../../services/document-precheck/service');

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function seedOrgDraft(docs) {
        seedDraft(docs);
        applicationService.findApplicationByIdForHealth.mockResolvedValue({
            id: 'app-1',
            organizationId: 'org-1',
            applicationNumber: 'APP-2026-000001',
            status: 'DRAFT',
            entityId: 'ent-1',
            submitterId: 'user-1',
            formData: { draftDocuments: docs },
            workflowHistory: [],
        });
    }

    test('the deleted document\'s pre-check is retired, bound to this application and its organisation', async () => {
        const retire = jest.spyOn(documentPrecheck, 'retireForDocument').mockResolvedValue(1);
        seedOrgDraft([{ documentId: DOC_ID, fileUrl: FILE_URL, slotId: 'land_deed' }]);

        const res = await request(buildApp()).delete(`/api/applications/draft-documents/${DOC_ID}?applicationId=app-1`);

        expect(res.status).toBe(200);
        expect(retire).toHaveBeenCalledTimes(1);
        expect(retire).toHaveBeenCalledWith(DOC_ID, { applicationId: 'app-1', organizationId: 'org-1' });
    });

    test('a retire that throws leaves the delete\'s response exactly as it was', async () => {
        seedOrgDraft([{ documentId: DOC_ID, fileUrl: FILE_URL, slotId: 'land_deed' }]);
        jest.spyOn(documentPrecheck, 'retireForDocument').mockResolvedValue(1);
        const baseline = await request(buildApp()).delete(`/api/applications/draft-documents/${DOC_ID}?applicationId=app-1`);

        seedOrgDraft([{ documentId: DOC_ID, fileUrl: FILE_URL, slotId: 'land_deed' }]);
        const retire = jest.spyOn(documentPrecheck, 'retireForDocument').mockRejectedValue(new Error('database down'));
        const res = await request(buildApp()).delete(`/api/applications/draft-documents/${DOC_ID}?applicationId=app-1`);

        expect(retire).toHaveBeenCalled();
        expect(res.status).toBe(200);
        expect(res.body).toEqual(baseline.body);
        expect(mockUnlink).toHaveBeenCalledTimes(2);
    });

    test('a documentId that matches nothing retires nothing', async () => {
        const retire = jest.spyOn(documentPrecheck, 'retireForDocument').mockResolvedValue(0);
        seedOrgDraft([{ documentId: 'other', fileUrl: FILE_URL }]);

        await request(buildApp()).delete('/api/applications/draft-documents/doc-missing?applicationId=app-1');

        expect(retire).not.toHaveBeenCalled();
    });
});
