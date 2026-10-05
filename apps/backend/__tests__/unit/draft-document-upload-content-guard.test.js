'use strict';

/**
 * F-G4-08 — POST /api/applications/draft-documents refuses a file that is not
 * what the slot asked for, on the SERVER.
 *
 * This is the half that counts. The browser check is a courtesy that gives an
 * instant answer; anyone can post to this endpoint directly, and in the G4 walk
 * a 70-byte 1x1 PNG went into three slots whose own label says "รองรับ .pdf" and
 * was stored, mirrored into application_documents, and later "reviewed" by an
 * officer who could not have seen anything.
 *
 * The uploader is the REAL one (storage-service.createUploader with its real
 * multer diskStorage), so these requests write real bytes to the real uploads
 * directory — which is exactly what makes the cleanup assertion meaningful: a
 * refused upload must leave NOTHING behind, and nothing that fails the guard may
 * reach an application row or a document record.
 *
 * Before the guard, every case below returned 200.
 */

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

jest.mock('../../middleware/auth-middleware', () => {
    const asHealthUser = (req, _res, next) => {
        req.user = { id: 'user-1', role: 'health', canonicalRole: 'health', healthId: 'health-1' };
        return next();
    };
    return {
        authenticateHealth: asHealthUser,
        authenticateAny: asHealthUser,
        authenticateProvider: asHealthUser,
    };
});

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

const mockSyncApplicationDocument = jest.fn(async () => null);
jest.mock('../../services/application-document-sync', () => ({
    syncApplicationDocument: (...a) => mockSyncApplicationDocument(...a),
    removeApplicationDocument: jest.fn(async () => undefined),
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

const DRAFT_DIR = path.join(storageService.BASE_UPLOAD_DIR, 'application-drafts');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', applicationsRouter);
    // What a real Express app does with an unhandled error. If the guard ever
    // throws instead of answering 400, these tests see a 500 rather than a pass.
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, error: 'INTERNAL', message: err.message }));
    return app;
}

/** The exact 70-byte pixel from the walk. */
const WALK_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
);

/** A PDF the size of the smallest real one-page Thai document in this system. */
function realisticPdf(bytes = 14029) {
    const header = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n', 'utf8');
    return Buffer.concat([header, Buffer.alloc(Math.max(0, bytes - header.length), 0x20)]);
}

function listDraftDir() {
    try {
        return new Set(fs.readdirSync(DRAFT_DIR));
    } catch {
        return new Set();
    }
}

/** Files this suite left behind, so a passing upload does not litter the repo. */
const createdFiles = new Set();

function captureNewFiles(before) {
    const after = listDraftDir();
    const added = [...after].filter((name) => !before.has(name));
    added.forEach((name) => createdFiles.add(name));
    return added;
}

beforeEach(() => {
    jest.clearAllMocks();
    applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: 'health-1' });
    applicationService.findApplicationByIdForHealth.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-2026-000001',
        status: 'DRAFT',
        entityId: 'ent-1',
        submitterId: 'user-1',
        formData: { draftDocuments: [] },
        workflowHistory: [],
    });
    applicationService.updateApplicantDraftColumns.mockResolvedValue({ id: 'app-1', formData: {} });
});

afterAll(() => {
    for (const name of createdFiles) {
        try { fs.unlinkSync(path.join(DRAFT_DIR, name)); } catch { /* best-effort */ }
    }
});

describe('POST /draft-documents — the walk pixel', () => {
    test('the 70-byte PNG is refused by the ภท.11 slot, in Thai, naming the cause', async () => {
        const before = listDraftDir();
        const res = await request(buildApp())
            .post('/api/applications/draft-documents')
            .field('applicationId', 'app-1')
            .field('slotId', 'LICENCE_PT11')
            .field('stepKey', 'documents')
            .attach('file', WALK_PIXEL_PNG, { filename: 'pixel.png', contentType: 'image/png' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FILE_TYPE_MISMATCH');
        expect(res.body.message).toContain('PDF');
        expect(res.body.message).toContain('คุณสามารถ');
        // Nothing is left on disk, and nothing was recorded anywhere.
        expect(captureNewFiles(before)).toEqual([]);
        expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
        expect(mockSyncApplicationDocument).not.toHaveBeenCalled();
    });

    test('the same pixel is refused by a slot that DOES take images, for having no content', async () => {
        const before = listDraftDir();
        const res = await request(buildApp())
            .post('/api/applications/draft-documents')
            .field('applicationId', 'app-1')
            .field('slotId', 'EXTERIOR_PHOTOS')
            .attach('file', WALK_PIXEL_PNG, { filename: 'pixel.png', contentType: 'image/png' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FILE_TOO_SMALL');
        expect(captureNewFiles(before)).toEqual([]);
        expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
    });
});

describe('POST /draft-documents — a sender who lies about the file', () => {
    test('a PNG named deed.pdf and declared application/pdf is refused', async () => {
        // The pre-existing fileFilter checks the mimetype against the filename
        // extension. Both agree here, and both are written by the sender, so it
        // passed. Only the leading bytes tell the truth.
        const before = listDraftDir();
        const bigPng = Buffer.concat([WALK_PIXEL_PNG, Buffer.alloc(60000, 0x00)]);
        const res = await request(buildApp())
            .post('/api/applications/draft-documents')
            .field('applicationId', 'app-1')
            .field('slotId', 'LICENCE_PT11')
            .attach('file', bigPng, { filename: 'deed.pdf', contentType: 'application/pdf' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FILE_TYPE_MISMATCH');
        expect(captureNewFiles(before)).toEqual([]);
    });

    test('an executable renamed permit.pdf is refused as unreadable', async () => {
        const before = listDraftDir();
        const exe = Buffer.concat([Buffer.from('MZ\x90\x00', 'latin1'), Buffer.alloc(40000, 0x41)]);
        const res = await request(buildApp())
            .post('/api/applications/draft-documents')
            .field('applicationId', 'app-1')
            .field('slotId', 'LICENCE_PT11')
            .attach('file', exe, { filename: 'permit.pdf', contentType: 'application/pdf' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FILE_TYPE_UNREADABLE');
        expect(captureNewFiles(before)).toEqual([]);
    });

    test('a file over the ceiling is refused with a Thai 413, not a 500', async () => {
        // Measured 2026-08-26 before the fix: multer aborted the write, the error
        // reached Express's default handler, and the farmer got HTTP 500 with the
        // English words "File too large". A size limit is a rule they can act on.
        // 413 since BACK-16 (2026-09-17): the same status every other door gives a
        // multer size refusal (middleware/request-limit-errors.js).
        const before = listDraftDir();
        const oversize = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(21 * 1024 * 1024, 0x20)]);
        const res = await request(buildApp())
            .post('/api/applications/draft-documents')
            .field('applicationId', 'app-1')
            .field('slotId', 'LICENCE_PT11')
            .attach('file', oversize, { filename: 'huge-scan.pdf', contentType: 'application/pdf' });

        expect(res.status).toBe(413);
        expect(res.body.code).toBe('FILE_TOO_LARGE');
        expect(res.body.message).toContain('20 MB');
        expect(res.body.message).toContain('คุณสามารถ');
        expect(res.body.message).not.toContain('File too large');
        // multer removes its own partial write; nothing is left behind.
        expect(captureNewFiles(before)).toEqual([]);
    });

    test('a zero-byte file is refused', async () => {
        const before = listDraftDir();
        const res = await request(buildApp())
            .post('/api/applications/draft-documents')
            .field('applicationId', 'app-1')
            .field('slotId', 'LICENCE_PT11')
            .attach('file', Buffer.alloc(0), { filename: 'scan.pdf', contentType: 'application/pdf' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FILE_EMPTY');
        expect(captureNewFiles(before)).toEqual([]);
    });
});

describe('POST /draft-documents — the legitimate case still works', () => {
    test('a real one-page permit PDF is accepted, stored, and recorded', async () => {
        const before = listDraftDir();
        const res = await request(buildApp())
            .post('/api/applications/draft-documents')
            .field('applicationId', 'app-1')
            .field('slotId', 'LICENCE_PT11')
            .field('stepKey', 'documents')
            .attach('file', realisticPdf(), { filename: 'ภท.11.pdf', contentType: 'application/pdf' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.fileUrl).toMatch(/^\/uploads\/application-drafts\/.+\.pdf$/);
        expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalledTimes(1);
        expect(mockSyncApplicationDocument).toHaveBeenCalledTimes(1);
        // Exactly one new file on disk — the one that was accepted.
        expect(captureNewFiles(before)).toHaveLength(1);
    });

    test('a real site photo is accepted by the photo slot', async () => {
        const before = listDraftDir();
        const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40000, 0x11)]);
        const res = await request(buildApp())
            .post('/api/applications/draft-documents')
            .field('applicationId', 'app-1')
            .field('slotId', 'EXTERIOR_PHOTOS')
            .attach('file', jpeg, { filename: 'IMG_0431.jpg', contentType: 'image/jpeg' });

        expect(res.status).toBe(200);
        expect(captureNewFiles(before)).toHaveLength(1);
    });
});
