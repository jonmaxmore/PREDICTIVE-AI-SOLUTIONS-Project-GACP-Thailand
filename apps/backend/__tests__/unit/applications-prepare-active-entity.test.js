// Wave C PR-5 — verify /prepare prefers req.activeEntity over the
// legacy applicantData → ensureEntityFromApplicantData fallback.

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const passUser = (req, _res, next) => {
        req.user = {
            id: 'user-1',
            healthId: '1100000000008',
            organizationId: 'org-1',
            canonicalRole: 'health',
            role: 'HEALTH_USER',
        };
        // The test sets globalThis.__testActiveEntity to inject context.
        if (globalThis.__testActiveEntity) {
            req.activeEntity = globalThis.__testActiveEntity;
        }
        next();
    };
    return { authenticateHealth: passUser, authenticateAny: passUser };
});

jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(),
    deleteDraft: jest.fn(),
    // Batch 11 (2026-05-16) — applications.js now calls these service
    // methods instead of reaching into prisma.* directly.
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

jest.mock('../../services/prisma-database', () => ({
    prisma: {},
}));

// M1 PR-C: keep the real CAPABILITIES tables — the submit guard's engine reads
// them at import time (entity-effective-permissions-service.js:54) and a
// one-function stub makes that read explode before any test runs.
jest.mock('../../services/entity-service', () => ({
    ...jest.requireActual('../../services/entity-service'),
    ensureEntityFromApplicantData: jest.fn(),
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    // Tier 18: receipt-numbering-service uses { createLogger } destructure
    // so the mock must expose createLogger as a factory.
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});
jest.mock('../../services/notification-service', () => ({
  createNotification: jest.fn().mockResolvedValue(null),
  createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));


jest.mock('../../shared/workflow-event-builder', () => ({
    buildWorkflowEvent: jest.fn((event) => ({ ...event, id: 'we-1', createdAt: '2026-05-02T00:00:00.000Z' })),
}));

jest.mock('../../routes/api/helpers/applications-helpers', () => ({
    getHealthScopeOptions: jest.fn((u) => ({ healthId: u.healthId, strictHealthScope: true })),
}));

jest.mock('../../routes/api/helpers/application-constants', () => ({
    MASTER_STEPS: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    AUDITOR_ROLES: [],
    REJECTABLE_STATUSES: [],
    REVISION_DECISION_TYPES: [],
    asObject: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    asArray: (v) => (Array.isArray(v) ? v : []),
    upper: (v) => String(v || '').toUpperCase(),
    ensureApplicationNumber: jest.fn(() => 'APP-2026-100'),
    isMissingApplicationCommentsTableError: () => false,
    mergeMasterSteps: jest.fn((fd, p) => ({ ...((fd && fd.steps) || {}), ...((p && p.steps) || {}) })),
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

jest.mock('../../services/storage-service', () => ({
    createUploader: jest.fn(() => ({ single: jest.fn(() => (_req, _res, next) => next()) })),
}));

const applicationService = require('../../services/application-service');
const entityService = require('../../services/entity-service');
const router = require('../../routes/api/applications/applications');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', router);
    return app;
}

describe('Wave C PR-5 — /prepare uses req.activeEntity', () => {
    let app;
    beforeAll(() => { app = makeApp(); });

    beforeEach(() => {
        jest.clearAllMocks();
        globalThis.__testActiveEntity = null;
        applicationService.resolveHealthIdentity.mockResolvedValue({
            userId: 'user-1', healthId: '1100000000008',
        });
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue(null);
        applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
        applicationService.findUserOrganizationId.mockResolvedValue('org-1');
    });

    it('uses req.activeEntity.entityId as Application.entityId', async () => {
        globalThis.__testActiveEntity = { entityId: 'ent-juristic-active', role: 'OWNER' };
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue({
            id: 'app-1', healthId: '1100000000008',
            entityId: 'ent-personal',  // currently bound to personal
            submitterId: 'user-1',
            formData: {}, workflowHistory: [],
        });
        applicationService.updateApplicantDraftColumns.mockResolvedValue({ id: 'app-1', applicationNumber: 'APP-1', status: 'DRAFT' });

        const r = await request(app).post('/api/applications/prepare').send({});

        expect(r.status).toBe(200);
        expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalledWith(
            'app-1',
            expect.objectContaining({ entityId: 'ent-juristic-active' }),
            expect.any(Object),
        );
        // Legacy applicantData materialise was NOT triggered.
        expect(entityService.ensureEntityFromApplicantData).not.toHaveBeenCalled();
    });

    // M1.5 H1 (FLIPPED) — this used to pin "falls back to legacy applicantData
    // when no activeEntity is set". That fallback re-materialised an entity
    // from a PUBLIC registration number typed into the form and made the caller
    // its OWNER, and it only ever woke up when the active-entity middleware
    // fail-opened. The branch is gone: /prepare keeps the application's own
    // entityId and never materialises from form data. Spec §H1.
    it('does NOT materialise from legacy applicantData — entityId stays the application\'s own', async () => {
        globalThis.__testActiveEntity = null;
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue({
            id: 'app-1', healthId: '1100000000008',
            entityId: 'ent-personal', submitterId: 'user-1',
            formData: {}, workflowHistory: [],
        });
        applicationService.updateApplicantDraftColumns.mockResolvedValue({ id: 'app-1', applicationNumber: 'APP-1', status: 'DRAFT' });

        const r = await request(app).post('/api/applications/prepare').send({
            applicantData: { applicantType: 'JURISTIC', taxId: '0105561234560', companyName: 'X Co.' },
        });

        expect(r.status).toBe(200);
        expect(entityService.ensureEntityFromApplicantData).not.toHaveBeenCalled();
        expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalledWith(
            'app-1',
            expect.objectContaining({ entityId: 'ent-personal' }),
            expect.any(Object),
        );
    });

    it('does not re-materialise when activeEntity is set even with applicantData=JURISTIC', async () => {
        globalThis.__testActiveEntity = { entityId: 'ent-from-header', role: 'OWNER' };
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue({
            id: 'app-1', healthId: '1100000000008',
            entityId: 'ent-personal', submitterId: 'user-1',
            formData: {}, workflowHistory: [],
        });
        applicationService.updateApplicantDraftColumns.mockResolvedValue({ id: 'app-1', applicationNumber: 'APP-1', status: 'DRAFT' });

        await request(app).post('/api/applications/prepare').send({
            applicantData: { applicantType: 'JURISTIC', taxId: '0105561234560', companyName: 'X Co.' },
        });

        expect(entityService.ensureEntityFromApplicantData).not.toHaveBeenCalled();
        expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalledWith(
            'app-1',
            expect.objectContaining({ entityId: 'ent-from-header' }),
            expect.any(Object),
        );
    });

    it('keeps existing application.entityId when neither activeEntity nor applicantData present', async () => {
        globalThis.__testActiveEntity = null;
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue({
            id: 'app-1', healthId: '1100000000008',
            entityId: 'ent-personal-already', submitterId: 'user-1',
            formData: {}, workflowHistory: [],
        });
        applicationService.updateApplicantDraftColumns.mockResolvedValue({ id: 'app-1', applicationNumber: 'APP-1', status: 'DRAFT' });

        await request(app).post('/api/applications/prepare').send({});

        expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalledWith(
            'app-1',
            expect.objectContaining({ entityId: 'ent-personal-already' }),
            expect.any(Object),
        );
    });
});
