'use strict';

/**
 * F-G4-15, applicant side — re-uploading a document REPLACES the one in the slot.
 *
 * `Application.formData.draftDocuments` is the canonical upload store: it is what
 * the wizard lists back to the farmer, what the mandatory-document check reads as
 * evidence (services/application-document-requirements.js:107), and what a
 * correction round freezes into CorrectionSubmissionVersion.attachments. It
 * already dropped the previous entry on re-upload — but by comparing the posted
 * slotId to the stored one as raw strings, while every other reader of that same
 * array canonicalises through the alias table. So 'LICENCE_PT11' and
 * 'licence_pt11' — one slot, two spellings, both live in the wizard's own config
 * (documents-step-dedupe.ts) — left TWO ภท.11 entries in a farmer's list, with
 * nothing saying which was theirs.
 *
 * The uploader, the content guard and the slot alias table are all the REAL
 * ones, so these requests write real bytes the same way the browser does.
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
    findPersonalEntityForHealthIdentity: jest.fn(),
    healDraftEntityColumns: jest.fn(),
    createDraftForHealth: jest.fn(),
    updateApplicantDraftColumns: jest.fn(),
    findDraftForSubmit: jest.fn(),
    getApplicationSlice: jest.fn(),
    findUserOrganizationId: jest.fn(),
    getApplicantReadinessSnapshot: jest.fn(),
    getLatestOpenDraftForApplicant: jest.fn(),
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
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, error: 'INTERNAL', message: err.message }));
    return app;
}

/** A PDF the size of the smallest real one-page Thai permit in this system. */
function realisticPdf(bytes = 14029) {
    const header = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n', 'utf8');
    return Buffer.concat([header, Buffer.alloc(Math.max(0, bytes - header.length), 0x20)]);
}

/** Files this suite leaves on disk, cleaned up at the end. */
const createdFiles = new Set();
function listDraftDir() {
    try {
        return new Set(fs.readdirSync(DRAFT_DIR));
    } catch {
        return new Set();
    }
}

/**
 * The draft as the route will next read it. The route reads formData from the
 * application row, so the stored draftDocuments must reflect the previous upload
 * — the same way the real DB would.
 */
let draftDocuments = [];

function uploadPermit(slotId, filename) {
    return request(buildApp())
        .post('/api/applications/draft-documents')
        .field('slotId', slotId)
        .field('stepKey', 'documents')
        .attach('file', realisticPdf(), { filename, contentType: 'application/pdf' });
}

beforeEach(() => {
    jest.clearAllMocks();
    draftDocuments = [];
    applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: 'health-1' });
    applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
    applicationService.findLatestOpenDraftForHealth.mockImplementation(async () => ({
        id: 'app-1',
        applicationNumber: 'APP-2026-000001',
        status: 'DRAFT',
        entityId: 'ent-1',
        submitterId: 'user-1',
        formData: { draftDocuments },
        workflowHistory: [],
    }));
    applicationService.updateApplicantDraftColumns.mockImplementation(async (_id, patch) => {
        draftDocuments = patch.formData.draftDocuments;
        return { id: 'app-1', formData: patch.formData };
    });
});

afterAll(() => {
    for (const name of createdFiles) {
        try { fs.unlinkSync(path.join(DRAFT_DIR, name)); } catch { /* best-effort */ }
    }
});

describe('POST /draft-documents — the slot holds one document', () => {
    test('re-uploading the same slot replaces the entry instead of adding one', async () => {
        const before = listDraftDir();

        const first = await uploadPermit('LICENCE_PT11', 'wrong-permit.pdf');
        expect(first.status).toBe(200);
        expect(draftDocuments).toHaveLength(1);

        const second = await uploadPermit('LICENCE_PT11', 'right-permit.pdf');
        expect(second.status).toBe(200);

        expect(draftDocuments).toHaveLength(1);
        expect(draftDocuments[0].fileName).toBe('right-permit.pdf');
        expect(draftDocuments[0].documentId).toBe(second.body.data.documentId);

        [...listDraftDir()].filter((name) => !before.has(name)).forEach((name) => createdFiles.add(name));
    });

    test('two spellings of the ภท.11 slot are ONE slot, not two entries', async () => {
        const before = listDraftDir();

        const first = await uploadPermit('LICENCE_PT11', 'first-upload.pdf');
        expect(first.status).toBe(200);
        const second = await uploadPermit('licence_pt11', 'second-upload.pdf');
        expect(second.status).toBe(200);

        // Before the fix this was 2: the raw string compare saw two slots.
        expect(draftDocuments).toHaveLength(1);
        expect(draftDocuments[0].fileName).toBe('second-upload.pdf');

        [...listDraftDir()].filter((name) => !before.has(name)).forEach((name) => createdFiles.add(name));
    });

    test('a different slot keeps its own document', async () => {
        const before = listDraftDir();

        await uploadPermit('LICENCE_PT11', 'permit.pdf');
        await uploadPermit('LAND_TITLE', 'deed.pdf');
        await uploadPermit('LICENCE_PT11', 'permit-corrected.pdf');

        expect(draftDocuments).toHaveLength(2);
        expect(draftDocuments.map((doc) => doc.fileName).sort()).toEqual(['deed.pdf', 'permit-corrected.pdf']);

        [...listDraftDir()].filter((name) => !before.has(name)).forEach((name) => createdFiles.add(name));
    });

    test('every upload is still mirrored into application_documents, which keeps the history', async () => {
        const before = listDraftDir();

        await uploadPermit('LICENCE_PT11', 'permit.pdf');
        await uploadPermit('LICENCE_PT11', 'permit-corrected.pdf');

        // The JSON store keeps only what is live; the relational store is the
        // record of what was replaced, so both calls must reach it.
        expect(mockSyncApplicationDocument).toHaveBeenCalledTimes(2);
        expect(mockSyncApplicationDocument.mock.calls[0][1].slotId).toBe('LICENCE_PT11');
        expect(mockSyncApplicationDocument.mock.calls[1][1].slotId).toBe('LICENCE_PT11');

        [...listDraftDir()].filter((name) => !before.has(name)).forEach((name) => createdFiles.add(name));
    });
});
