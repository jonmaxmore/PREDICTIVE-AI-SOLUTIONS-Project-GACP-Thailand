/**
 * F-G4-11 — the API door onto a wizard step.
 *
 * The address bar was not the only way past the wizard's step gating: POST
 * /api/applications/draft accepted any `step` a caller named, and POST
 * /api/applications/prepare accepted a step-9 preparation from an application
 * with nothing in it. These pin the door, not the table (the table is pinned in
 * `wizard-step-prerequisites.test.js`).
 *
 * Every case here fails on the code as it stood before the fix.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const passHealthUser = (req, _res, next) => {
        req.user = { id: 'user-1', healthId: 'health-1', canonicalRole: 'health', role: 'HEALTH_USER' };
        next();
    };
    return { authenticateHealth: passHealthUser, authenticateAny: passHealthUser };
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
// R2 Task 8: the caller's holder scope (editIds) — the draft door checks it.
jest.mock('../../services/holder-access', () => ({
    ...jest.requireActual('../../services/holder-access'),
    holderScope: jest.fn(async () => ({ userId: 'user-1', readIds: ['entity-1'], editIds: ['entity-1'] })),
}));

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../services/storage-service', () => ({
    createUploader: jest.fn(() => ({ single: jest.fn(() => (_req, _res, next) => next()) })),
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
    buildWorkflowEvent: jest.fn((event) => ({ ...event, id: 'workflow-event-1' })),
}));

jest.mock('../../routes/api/helpers/applications-helpers', () => ({
    getHealthScopeOptions: jest.fn((user) => ({ healthId: user.healthId, strictHealthScope: true })),
}));

jest.mock('../../routes/api/preview/preview-utils', () => ({
    normalizeDocuments: jest.fn(() => []),
    summarizeCompletion: jest.fn(() => ({ isComplete: true, missingFields: [] })),
}));

jest.mock('../../routes/api/applications/application-listing-handlers', () => require('express').Router());
jest.mock('../../routes/api/applications/application-workflow-handlers', () => require('express').Router());

const applicationService = require('../../services/application-service');
const applicationsRouter = require('../../routes/api/applications/applications');

// R2 Task 8 (spec 2026-09-30 §3.2): a draft write without an id names its holder;
// the caller edits for entity-1 (the resume path finds the mocked draft).
const named = (body) => ({ entityId: 'entity-1', ...body });

/** Canonical wizard data that clears every step the server judges. */
function completeWizardData(overrides = {}) {
    return {
        plantId: 'cannabis',
        serviceType: 'new_application',
        certificationPurposes: ['EXPORT'],
        cultivationMethods: ['OUTDOOR'],
        applicantData: { applicantType: 'INDIVIDUAL', firstName: 'สมชาย', lastName: 'ใจดี', idCard: '1234567890123' },
        farmData: { farmName: 'ไร่ใจดี', address: '99 หมู่ 3' },
        plots: [{ name: 'แปลง 1', areaUnit: 'Sqm' }],
        productionData: { propagationType: ['SEED'], plantParts: ['LEAF'] },
        harvestData: { harvestMethod: 'MANUAL' },
        documents: [{ slotId: 'ID_CARD', uploaded: true }],
        ...overrides,
    };
}

function makeDraft(overrides = {}) {
    const now = new Date('2026-08-26T00:00:00.000Z');
    return {
        id: 'draft-1',
        applicationNumber: 'APP-2569-000001',
        status: 'DRAFT',
        serviceType: 'new_application',
        areaType: 'OUTDOOR',
        entityId: 'entity-1',
        submitterId: 'user-1',
        formData: { steps: {}, workflowState: 'DRAFT' },
        workflowHistory: [],
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

/** What the route handed to the persistence layer on this request. */
function savedPayload() {
    return applicationService.updateApplicantDraftColumns.mock.calls[0][1];
}

describe('F-G4-11 — POST /draft: the step a caller claims', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/applications', applicationsRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: 'health-1' });
        applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
        const draft = makeDraft();
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(draft);
        applicationService.updateApplicantDraftColumns.mockResolvedValue(draft);
    });

    it('records only the step the data has earned, not the step the caller named', async () => {
        // The URL trick as an API call: an empty wizard declaring step 9.
        const response = await request(app)
            .post('/api/applications/draft')
            .send(named({ step: 9, formData: {} }));

        expect(response.status).toBe(200);
        expect(response.body.data.savedStep).toBe(2);
        expect(response.body.data.allowedStep).toBe(2);
        expect(response.body.data.stepClamped).toBe(true);
        expect(savedPayload().formData.lastDraftStep).toBe(2);
    });

    it('never throws away the data to punish the wrong step number', async () => {
        // The autosave posts the whole store on a debounce. Refusing the write
        // would cost a farmer their typing; only the claim is corrected.
        const response = await request(app)
            .post('/api/applications/draft')
            .send(named({ step: 9, certificationPurposes: ['EXPORT'], formData: {} }));

        expect(response.status).toBe(200);
        expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalledTimes(1);
        expect(savedPayload().certificationPurposes).toEqual(['EXPORT']);
    });

    it('the audit trail records the earned step too, so history and lastDraftStep cannot disagree', async () => {
        await request(app).post('/api/applications/draft').send(named({ step: 9, formData: {} }));

        const event = savedPayload().workflowHistory.at(-1);
        expect(event.action).toBe('APPLICATION_DRAFT_SAVED');
        expect(event.metadata.step).toBe(2);
    });

    it('honours the claim of an applicant who really is on that step', async () => {
        const onStepSeven = completeWizardData({ harvestData: {} });
        const response = await request(app)
            .post('/api/applications/draft')
            .send(named({ step: 7, formData: onStepSeven }));

        expect(response.status).toBe(200);
        expect(response.body.data.savedStep).toBe(7);
        expect(response.body.data.stepClamped).toBe(false);
        expect(savedPayload().formData.lastDraftStep).toBe(7);
    });

    it('lets a farmer go BACK to a finished step', async () => {
        const response = await request(app)
            .post('/api/applications/draft')
            .send(named({ step: 4, formData: completeWizardData() }));

        expect(response.status).toBe(200);
        expect(response.body.data.savedStep).toBe(4);
        expect(response.body.data.stepClamped).toBe(false);
    });

    it('REFUSES step-scoped legacy data written into a step that has not been earned', async () => {
        // `steps: { "8": … }` is data belonging to one numbered step, so unlike
        // the whole-store save there is nothing else in the request to lose.
        const response = await request(app)
            .post('/api/applications/draft')
            .send(named({ step: 8, steps: { 8: { files: [{ name: 'x.pdf' }] } }, formData: {} }));

        expect(response.status).toBe(422);
        expect(response.body.error).toBe('STEP_PREREQUISITE_UNMET');
        expect(response.body.requestedStep).toBe(8);
        expect(response.body.allowedStep).toBe(2);
        expect(response.body.message).toContain('ขั้นตอนที่ 2');
        // Refused means refused: nothing was written.
        expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
    });

    it('accepts step-scoped legacy data for a step that HAS been earned', async () => {
        const response = await request(app)
            .post('/api/applications/draft')
            .send(named({ step: 8, steps: { 8: { files: [{ name: 'x.pdf' }] } }, formData: completeWizardData() }));

        expect(response.status).toBe(200);
        expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalledTimes(1);
    });

    it('leaves a save that names no step alone', async () => {
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(
            makeDraft({ formData: { steps: {}, lastDraftStep: 5 } }),
        );

        const response = await request(app)
            .post('/api/applications/draft')
            .send(named({ certificationPurposes: ['EXPORT'] }));

        expect(response.status).toBe(200);
        expect(response.body.data.savedStep).toBeNull();
        expect(response.body.data.stepClamped).toBe(false);
        // The previously recorded position survives an unnumbered save.
        expect(savedPayload().formData.lastDraftStep).toBe(5);
    });
});

describe('F-G4-11 — POST /prepare: the step-9 door', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/applications', applicationsRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: 'health-1' });
        applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(makeDraft());
        applicationService.updateApplicantDraftColumns.mockResolvedValue({
            id: 'draft-1', applicationNumber: 'APP-2569-000001', status: 'DRAFT',
        });
    });

    it('REFUSES step-scoped legacy data for a step this application has not earned', async () => {
        const response = await request(app)
            .post('/api/applications/prepare')
            .send(named({ ...completeWizardData({ farmData: {}, plots: [] }), steps: { 7: { harvest_method: 'MANUAL' } } }));

        expect(response.status).toBe(422);
        expect(response.body.error).toBe('STEP_PREREQUISITE_UNMET');
        expect(response.body.requestedStep).toBe(7);
        expect(response.body.allowedStep).toBe(5);
        expect(response.body.message).toContain('ขั้นตอนที่ 5');
        expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
    });

    it('accepts step-scoped legacy data for a step that HAS been earned', async () => {
        const response = await request(app)
            .post('/api/applications/prepare')
            .send(named({ ...completeWizardData(), steps: { 7: { harvest_method: 'MANUAL' } } }));

        expect(response.status).toBe(200);
        expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalledTimes(1);
    });

    it('still accepts a partial preparation — saving part of an application is what it is for', async () => {
        // Completeness is POST /submit's decision, against a higher bar. A
        // second gate here would be that decision written twice, and would
        // break the partial writes this route exists to accept.
        const response = await request(app).post('/api/applications/prepare').send(named({}));

        expect(response.status).toBe(200);
        expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalledTimes(1);
    });

    it('accepts a complete preparation — the wizard walked through, not around', async () => {
        const response = await request(app).post('/api/applications/prepare').send(named(completeWizardData()));

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalledTimes(1);
    });

    it('does NOT ask for the consent flags the wizard never sends', async () => {
        // review-step.tsx and submit-step.tsx both omit consentedPDPA /
        // acknowledgedStandards from the prepare payload. Judging step 1 here
        // would refuse every real applicant; consent is the consent record's job.
        const payload = completeWizardData();
        expect(payload.consentedPDPA).toBeUndefined();

        const response = await request(app)
            .post('/api/applications/prepare')
            .send(named({ ...payload, steps: { 8: { files: [{ name: 'a.pdf' }] } } }));
        expect(response.status).toBe(200);
    });

    it('counts documents uploaded through the draft-documents route', async () => {
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(
            makeDraft({ formData: { steps: {}, draftDocuments: [{ documentId: 'd1', fileName: 'a.pdf' }] } }),
        );

        const response = await request(app)
            .post('/api/applications/prepare')
            // Claims step 9, which is only earned if step 8's documents count.
            .send(named({ ...completeWizardData({ documents: [] }), steps: { 9: { reviewed: true } } }));

        expect(response.status).toBe(200);
    });
});
