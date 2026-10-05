/**
 * F-G4-14 — the autosave that threw the farmer's work away.
 *
 * The wizard posts its whole store under `payload.formData` every few seconds.
 * POST /draft read `payload.steps` and nothing else, so eleven uploaded
 * document slots answered 200 and came back empty after a reload (walk ledger
 * F-G4-14). These pin BOTH halves of the fix, because either half alone is a
 * defect:
 *
 *   • the wizard's own keys now round-trip through a reload, and
 *   • the server's facts in the SAME blob — workflowState, the audit outcome,
 *     the auditor assignment, SLA deadlines, anything fee- or review-shaped —
 *     are not writable from an autosave, because the merge is an ALLOWLIST.
 *
 * Every case here fails on the code as it stood before the fix: the first
 * group because nothing was written, the second because a wholesale merge
 * (the obvious fix) writes everything.
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
const {
    WIZARD_OWNED_FORM_DATA_KEYS,
    pickWizardOwnedFormData,
} = require('../../routes/api/helpers/application-constants');
const { SERVER_OWNED_FORM_DATA_KEYS } = require('../../shared/form-data-ownership');

/**
 * What the live autosave sends: the whole wizard store under `formData`.
 * Key list mirrors use-auto-save.ts (apps/web-app/.../hooks/use-auto-save.ts).
 */
function autosaveFormData(overrides = {}) {
    return {
        plantId: 'cannabis',
        serviceType: 'new_application',
        certificationPurposes: ['EXPORT'],
        cultivationMethods: ['OUTDOOR'],
        applicantData: { applicantType: 'INDIVIDUAL', firstName: 'สมชาย', lastName: 'ใจดี', idCard: '1234567890123' },
        farmData: { farmName: 'ไร่ใจดี', address: '99 หมู่ 3 ตำบลบ้านนา' },
        plots: [{ name: 'แปลง 1', areaRai: 3, areaUnit: 'Rai' }],
        productionData: { propagationType: ['SEED'], plantParts: ['LEAF'] },
        harvestData: { harvestMethod: 'MANUAL' },
        cultivationDetails: { waterSource: 'บ่อบาดาล' },
        stepDocuments: [{ slotId: 'ID_CARD', fileName: 'id.pdf' }],
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

describe('F-G4-14 — POST /draft writes the wizard store the autosave sends', () => {
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
        applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
        const draft = makeDraft();
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(draft);
        applicationService.updateApplicantDraftColumns.mockResolvedValue(draft);
    });

    it('round-trips applicantData / farmData / plots through a reload', async () => {
        const sent = autosaveFormData();

        const saveResponse = await request(app)
            .post('/api/applications/draft')
            .send({ step: 3, formData: sent });

        expect(saveResponse.status).toBe(200);
        const stored = savedPayload().formData;
        expect(stored.applicantData).toEqual(sent.applicantData);
        expect(stored.farmData).toEqual(sent.farmData);
        expect(stored.plots).toEqual(sent.plots);
        expect(stored.stepDocuments).toEqual(sent.stepDocuments);
        expect(stored.productionData).toEqual(sent.productionData);
        expect(stored.cultivationDetails).toEqual(sent.cultivationDetails);

        // The reload: the row now holds what was saved, and GET /draft is what
        // the wizard rehydrates from. Before the fix this came back empty and
        // the farmer retyped everything.
        applicationService.getLatestOpenDraftForApplicant.mockResolvedValue(makeDraft({ formData: stored }));
        const reload = await request(app).get('/api/applications/draft');

        expect(reload.status).toBe(200);
        expect(reload.body.data.formData.applicantData).toEqual(sent.applicantData);
        expect(reload.body.data.formData.farmData).toEqual(sent.farmData);
        expect(reload.body.data.formData.plots).toEqual(sent.plots);
        expect(reload.body.data.formData.documents).toEqual(sent.documents);
    });

    it('keeps a wizard answer the farmer cleared — an empty list is an edit, not a missing field', async () => {
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(
            makeDraft({ formData: { steps: {}, plots: [{ name: 'แปลงเก่า' }] } }),
        );

        await request(app)
            .post('/api/applications/draft')
            .send({ step: 2, formData: autosaveFormData({ plots: [] }) });

        expect(savedPayload().formData.plots).toEqual([]);
    });

    it('an autosave with no formData behaves exactly as before', async () => {
        const stored = { steps: { 1: { plantId: 'cannabis' } }, workflowState: 'DRAFT', certificationPurposes: ['EXPORT'] };
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(makeDraft({ formData: stored }));

        const response = await request(app)
            .post('/api/applications/draft')
            .send({ serviceType: 'new_application', areaType: 'OUTDOOR', step: 1, steps: { 1: { plantId: 'cannabis' } } });

        expect(response.status).toBe(200);
        const saved = savedPayload().formData;
        // Only the keys this route has always written are added: the merged
        // steps and the two server stamps. Nothing else appears from nowhere.
        expect(Object.keys(saved).sort()).toEqual(
            ['certificationPurposes', 'lastDraftSavedAt', 'lastDraftStep', 'steps', 'workflowState'],
        );
        expect(saved.workflowState).toBe('DRAFT');
        expect(saved.steps['1']).toMatchObject({ plantId: 'cannabis' });
        expect(savedPayload().certificationPurposes).toEqual(['EXPORT']);
    });

    it('does not let an empty certificationPurposes inside formData wipe the saved selection (Bug 8.2, new door)', async () => {
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(
            makeDraft({ formData: { steps: {}, certificationPurposes: ['EXPORT'] } }),
        );

        await request(app)
            .post('/api/applications/draft')
            .send({ step: 2, formData: autosaveFormData({ certificationPurposes: [] }) });

        expect(savedPayload().certificationPurposes).toEqual(['EXPORT']);
        expect(savedPayload().formData.certificationPurposes).toEqual(['EXPORT']);
    });
});

describe('F-G4-14 — POST /draft refuses the server-owned half of the same blob', () => {
    let app;

    /** Facts the SERVER wrote, which downstream code reads back as true. */
    const serverFacts = {
        workflowState: 'DOC_APPROVED',
        workflowStateUpdatedAt: '2026-08-20T03:00:00.000Z',
        submittedAt: '2026-08-19T03:00:00.000Z',
        auditResult: 'FAIL',
        auditedAt: '2026-08-22T03:00:00.000Z',
        PROVIDERAssignment: { reviewerId: 'reviewer-9', assignedAt: '2026-08-20T03:00:00.000Z' },
        reviewerName: 'เจ้าหน้าที่ตรวจเอกสาร',
        reviewProgress: { step: 4 },
        onsiteAuditId: 'audit-77',
        carDueAt: '2026-09-01T03:00:00.000Z',
        revisionDueAt: '2026-09-01T03:00:00.000Z',
        adminOverrides: { feeWaived: false },
        draftDocuments: [{ documentId: 'd1', fileName: 'real.pdf', filePath: '/uploads/real.pdf' }],
        serverRequirementSnapshot: { stampedAt: '2026-08-19T03:00:00.000Z', ruleIds: ['rule-1'] },
        lastDraftStep: 4,
    };

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/applications', applicationsRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: 'health-1' });
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue(null);
        applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
        const draft = makeDraft({ formData: { steps: {}, ...serverFacts } });
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(draft);
        applicationService.updateApplicantDraftColumns.mockResolvedValue(draft);
    });

    it('does not let an autosave overwrite workflowState, the audit outcome, the assignment or the deadlines', async () => {
        const forged = autosaveFormData({
            workflowState: 'CERTIFIED',
            auditResult: 'PASS',
            auditedAt: '2026-08-26T03:00:00.000Z',
            PROVIDERAssignment: { reviewerId: 'user-1' },
            reviewerName: 'ตัวเอง',
            reviewProgress: { step: 9 },
            onsiteAuditId: 'audit-mine',
            carDueAt: '2027-01-01T00:00:00.000Z',
            revisionDueAt: '2027-01-01T00:00:00.000Z',
            adminOverrides: { feeWaived: true },
            draftDocuments: [{ documentId: 'forged', filePath: '/uploads/someone-elses.pdf' }],
            serverRequirementSnapshot: { ruleIds: [] },
            submittedAt: '2020-01-01T00:00:00.000Z',
            workflowStateUpdatedAt: '2020-01-01T00:00:00.000Z',
        });

        const response = await request(app)
            .post('/api/applications/draft')
            .send({ step: 3, formData: forged });

        expect(response.status).toBe(200);
        const saved = savedPayload().formData;
        for (const [key, value] of Object.entries(serverFacts)) {
            if (key === 'lastDraftStep') { continue; } // the route stamps this one itself
            expect(saved[key]).toEqual(value);
        }
        // …and the applicant's own answers in the same request were still saved.
        expect(saved.farmData).toEqual(forged.farmData);
    });

    it('does not let an autosave price its own application', async () => {
        // Fees are recomputed by modules/billing from the applicant's declared
        // cultivation methods; no amount is stored in formData. A money-shaped
        // key the wizard does not own must therefore not survive the merge —
        // the allowlist fails CLOSED, so it never has to be enumerated.
        const response = await request(app)
            .post('/api/applications/draft')
            .send({
                step: 3,
                formData: autosaveFormData({
                    estimatedFee: 1,
                    phase1Amount: 1,
                    phase2Amount: 1,
                    pricing: { total: 1 },
                    feeOverride: { total: 0 },
                    quotation: { total: 0 },
                }),
            });

        expect(response.status).toBe(200);
        const saved = savedPayload().formData;
        for (const key of ['estimatedFee', 'phase1Amount', 'phase2Amount', 'pricing', 'feeOverride', 'quotation']) {
            expect(saved).not.toHaveProperty(key);
        }
        // The declaration the fee IS derived from is the applicant's to make.
        expect(saved.cultivationMethods).toEqual(['OUTDOOR']);
    });

    it('does not let a client claim a step by hiding `steps` inside formData', async () => {
        // The step-claim gate reads `payload.steps`. If formData could carry a
        // `steps` map, it would be a second, ungated way to write the same thing.
        const response = await request(app)
            .post('/api/applications/draft')
            .send({ step: 2, formData: autosaveFormData({ steps: { 9: { internal_audit_date: '2026-08-26' } } }) });

        expect(response.status).toBe(200);
        expect(savedPayload().formData.steps).not.toHaveProperty('9');
    });
});

describe('F-G4-14 — the step-claim door is unchanged', () => {
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
        applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
        const draft = makeDraft();
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(draft);
        applicationService.updateApplicantDraftColumns.mockResolvedValue(draft);
    });

    it('still clamps a step an empty wizard has not earned', async () => {
        const response = await request(app)
            .post('/api/applications/draft')
            .send({ step: 9, formData: {} });

        expect(response.status).toBe(200);
        expect(response.body.data.savedStep).toBe(2);
        expect(response.body.data.stepClamped).toBe(true);
        expect(savedPayload().formData.lastDraftStep).toBe(2);
    });

    it('still refuses step-scoped legacy data for an unearned step, writing nothing', async () => {
        const response = await request(app)
            .post('/api/applications/draft')
            .send({ step: 8, steps: { 8: { files: [{ name: 'x.pdf' }] } }, formData: {} });

        expect(response.status).toBe(422);
        expect(response.body.error).toBe('STEP_PREREQUISITE_UNMET');
        expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
    });

    it('a saved wizard store does not let the NEXT save claim a step it has not earned', async () => {
        // The data written by an autosave is judged on the next request exactly
        // as the caller's own blob is: writing it must not hand out progress.
        await request(app).post('/api/applications/draft').send({ step: 2, formData: autosaveFormData({ harvestData: {}, productionData: {} }) });

        const stored = savedPayload().formData;
        jest.clearAllMocks();
        applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: 'health-1' });
        applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(makeDraft({ formData: stored }));
        applicationService.updateApplicantDraftColumns.mockResolvedValue(makeDraft({ formData: stored }));

        const response = await request(app).post('/api/applications/draft').send({ step: 9 });

        expect(response.status).toBe(200);
        expect(response.body.data.stepClamped).toBe(true);
        expect(response.body.data.savedStep).toBeLessThan(9);
    });
});

describe('F-G4-14 — the allowlist itself', () => {
    it('never contains a server-owned key', () => {
        // The two lists are the two halves of one blob. An overlap would mean
        // the door that writes wizard data also writes a fact the server, the
        // fee engine or the certificate gate reads back as true.
        const overlap = WIZARD_OWNED_FORM_DATA_KEYS.filter((key) => SERVER_OWNED_FORM_DATA_KEYS.includes(key));
        expect(overlap).toEqual([]);
    });

    it('never contains a key the server derives on this route', () => {
        const serverDerived = ['steps', 'lastDraftStep', 'lastDraftSavedAt', 'lastPreparedAt', 'workflowStateUpdatedAt', 'submittedAt'];
        const overlap = WIZARD_OWNED_FORM_DATA_KEYS.filter((key) => serverDerived.includes(key));
        expect(overlap).toEqual([]);
    });

    it('is frozen and free of duplicates, so the list stays the single statement of what may be written', () => {
        expect(Object.isFrozen(WIZARD_OWNED_FORM_DATA_KEYS)).toBe(true);
        expect(new Set(WIZARD_OWNED_FORM_DATA_KEYS).size).toBe(WIZARD_OWNED_FORM_DATA_KEYS.length);
    });

    it('picks nothing at all from a payload with no formData', () => {
        expect(pickWizardOwnedFormData(undefined)).toEqual({});
        expect(pickWizardOwnedFormData(null)).toEqual({});
        expect(pickWizardOwnedFormData('not-an-object')).toEqual({});
        expect(pickWizardOwnedFormData([{ farmData: {} }])).toEqual({});
    });

    it('keeps falsy answers the farmer actually gave', () => {
        const picked = pickWizardOwnedFormData({ consentedPDPA: false, qrCount: 0, lots: [], youtubeUrl: '' });
        expect(picked).toEqual({ consentedPDPA: false, qrCount: 0, lots: [], youtubeUrl: '' });
    });
});
