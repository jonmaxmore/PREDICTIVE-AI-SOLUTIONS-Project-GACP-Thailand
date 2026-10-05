/**
 * Bug 2.3 [MED] — /prepare + /draft overwrite formData of a NON-DRAFT owned
 * application (no server status gate).
 *
 * RED-first regression test.
 *
 * An owner could POST /prepare (or /draft autosave) with `{applicationId}` for
 * an ASSIGNED_FOR_REVIEW (or any non-draft) app they own. The explicit-id
 * lookup (`findApplicationByIdForHealth`) has NO status filter, so it returned
 * the row → a shallow formData spread BLANKED reviewer-facing data while the
 * status column stayed unchanged.
 *
 * Fix under test: `findOrCreateApplicationForHealth` gates an explicit-id row
 * on EDITABLE_STATUSES = {DRAFT, REGISTERED, REVISION_REQUESTED, CAR_PENDING}.
 * A non-editable status → throw 409 APPLICATION_NOT_EDITABLE (no fall-through
 * to findLatestOpenDraftForHealth, no overwrite). This one gate protects
 * /prepare, /draft (autosave), and the draft-document routes uniformly.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const passHealthUser = (req, _res, next) => {
        req.user = {
            id: 'user-1',
            healthId: 'health-1',
            canonicalRole: 'health',
            role: 'HEALTH_USER',
        };
        next();
    };
    return {
        authenticateHealth: passHealthUser,
        authenticateAny: passHealthUser,
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

// the project rules rule: mock prisma-database (process.exit(1) without DATABASE_URL).
// holder-access (spec 2026-09-30 §3.1-3.2): user-1 is the ACTIVE owner of
// ent-1, so an explicit id under ent-1 is in the caller's edit set.
jest.mock('../../services/prisma-database', () => ({
    prisma: { entityMembership: { findMany: async () => [{ entityId: 'ent-1', role: 'OWNER' }] } },
}));

jest.mock('../../services/storage-service', () => ({
    createUploader: jest.fn(() => ({
        single: jest.fn(() => (_req, _res, next) => next()),
    })),
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));

jest.mock('../../shared/workflow-event-builder', () => ({
    buildWorkflowEvent: jest.fn((event) => ({ ...event, id: 'evt-1', createdAt: '2026-04-21T00:00:00.000Z' })),
}));

jest.mock('../../routes/api/helpers/applications-helpers', () => ({
    getHealthScopeOptions: jest.fn((user) => ({ healthId: user.healthId, strictHealthScope: true })),
}));

jest.mock('../../routes/api/helpers/application-constants', () => ({
    MASTER_STEPS: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    asObject: (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
    asArray: (value) => (Array.isArray(value) ? value : []),
    upper: (value) => String(value || '').toUpperCase(),
    ensureApplicationNumber: jest.fn(() => 'APP-TEST-001'),
    mergeMasterSteps: jest.fn((formData, payload) => ({
        ...((formData && formData.steps) || {}),
        ...((payload && payload.steps) || {}),
    })),
    validateMasterSubmission: jest.fn(() => ({ isValid: true, missingByStep: {} })),
    // F-G4-14 — the REAL allowlist: what POST /draft may write out of
    // `payload.formData` is a security decision, so it is never stubbed.
    pickWizardOwnedFormData: jest.requireActual('../../routes/api/helpers/application-constants').pickWizardOwnedFormData,
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
const applicationsRouter = require('../../routes/api/applications/applications');

function makeApp(status, overrides = {}) {
    const now = new Date('2026-04-21T00:00:00.000Z');
    return {
        id: 'app-1',
        applicationNumber: 'APP-2026-000001',
        status,
        serviceType: 'new_application',
        areaType: 'OUTDOOR',
        entityId: 'ent-1',
        submitterId: 'user-1',
        formData: {
            steps: { '1': { plantId: 'cannabis' } },
            applicantData: { firstName: 'reviewer-visible' },
            certificationPurposes: ['EXPORT'],
        },
        workflowHistory: [],
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

describe('Bug 2.3 — /prepare + /draft cannot overwrite a non-editable owned application', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/applications', applicationsRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: 'health-1' });
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue(null);
    });

    describe('non-editable status → 409, no write', () => {
        it('POST /prepare with an ASSIGNED_FOR_REVIEW id is rejected 409 APPLICATION_NOT_EDITABLE', async () => {
            applicationService.findApplicationByIdForHealth.mockResolvedValue(makeApp('ASSIGNED_FOR_REVIEW'));

            const response = await request(app)
                .post('/api/applications/prepare')
                .send({ applicationId: 'app-1', applicantData: { firstName: 'blanked' } });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPLICATION_NOT_EDITABLE');
            // The row's formData must never have been touched.
            expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
            // And we must NOT have fallen through to the latest-open-draft lookup.
            expect(applicationService.findLatestOpenDraftForHealth).not.toHaveBeenCalled();
        });

        it('POST /draft with an ASSIGNED_FOR_REVIEW id is rejected 409 APPLICATION_NOT_EDITABLE', async () => {
            applicationService.findApplicationByIdForHealth.mockResolvedValue(makeApp('ASSIGNED_FOR_REVIEW'));

            const response = await request(app)
                .post('/api/applications/draft')
                .send({ applicationId: 'app-1', step: 1, steps: { '1': { plantId: 'x' } } });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPLICATION_NOT_EDITABLE');
            expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
            expect(applicationService.findLatestOpenDraftForHealth).not.toHaveBeenCalled();
        });

        it('POST /prepare with a DOC_APPROVED id (another non-editable state) is rejected 409', async () => {
            applicationService.findApplicationByIdForHealth.mockResolvedValue(makeApp('DOC_APPROVED'));

            const response = await request(app)
                .post('/api/applications/prepare')
                .send({ applicationId: 'app-1', applicantData: { firstName: 'blanked' } });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPLICATION_NOT_EDITABLE');
            expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
        });
    });

    describe('editable status → still works (guard does not over-block)', () => {
        it('POST /prepare with a DRAFT id proceeds (200, update called)', async () => {
            const draft = makeApp('DRAFT');
            applicationService.findApplicationByIdForHealth.mockResolvedValue(draft);
            applicationService.updateApplicantDraftColumns.mockResolvedValue({
                id: 'app-1', applicationNumber: 'APP-2026-000001', status: 'DRAFT',
            });

            const response = await request(app)
                .post('/api/applications/prepare')
                .send({ applicationId: 'app-1', applicantData: { firstName: 'ok' } });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalledTimes(1);
        });

        it('POST /draft with a REVISION_REQUESTED id proceeds (200, update called)', async () => {
            const rev = makeApp('REVISION_REQUESTED');
            applicationService.findApplicationByIdForHealth.mockResolvedValue(rev);
            applicationService.updateApplicantDraftColumns.mockResolvedValue({
                id: 'app-1', applicationNumber: 'APP-2026-000001', status: 'REVISION_REQUESTED',
            });

            const response = await request(app)
                .post('/api/applications/draft')
                .send({ applicationId: 'app-1', step: 2, steps: { '2': { area: 5 } } });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalledTimes(1);
        });
    });

    // Spec 2026-09-30 §3.1 (Task 3, R1): the explicit id and the resume fallback are
    // loaded within the caller's holders AND, in R1, with the pre-R1 filer healthId
    // pin (operator ruling C1) — so another member's draft is never loaded here.
    describe('holder scope + R1 filer pin on the draft lookups', () => {
        const SCOPE = { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] };

        it('the explicit-id lookup takes the caller\'s holder scope and the filer healthId', async () => {
            applicationService.findApplicationByIdForHealth.mockResolvedValue(makeApp('DRAFT'));
            applicationService.updateApplicantDraftColumns.mockResolvedValue({ id: 'app-1', status: 'DRAFT' });

            await request(app).post('/api/applications/prepare').send({ applicationId: 'app-1' });

            expect(applicationService.findApplicationByIdForHealth).toHaveBeenCalledWith('app-1', {
                holderScope: SCOPE,
                filerHealthId: 'health-1',
            });
        });

        it('an id the filer lookup does not find is refused with 404, never written and never redirected to another draft', async () => {
            // main (staging-walk-0930 round 5): an explicit id that does not resolve for
            // this user is APPLICATION_NOT_FOUND before anything is written; it no longer
            // falls through to the caller's latest draft.
            applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
            applicationService.findLatestOpenDraftForHealth.mockResolvedValue(makeApp('DRAFT', { id: 'app-own' }));

            const res = await request(app)
                .post('/api/applications/prepare')
                .send({ applicationId: 'app-someone-else', applicantData: { firstName: 'x' } });

            expect(res.status).toBe(404);
            expect(applicationService.findApplicationByIdForHealth).toHaveBeenCalledWith('app-someone-else', {
                holderScope: SCOPE,
                filerHealthId: 'health-1',
            });
            expect(applicationService.findLatestOpenDraftForHealth).not.toHaveBeenCalled();
            expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
        });
    });
});
