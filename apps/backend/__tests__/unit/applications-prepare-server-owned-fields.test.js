/**
 * SEC — POST /api/applications/prepare must not let an applicant write
 * SERVER-OWNED keys into Application.formData.
 *
 * formData is a single JSON blob shared by two writers: the applicant's wizard
 * answers, and staff/server records (audit outcome, assignment, SLA deadlines,
 * admin overrides). /prepare spread the ENTIRE request body into it —
 *
 *     formData: { ...existingFormData, ...payload, steps, lastPreparedAt, workflowState }
 *
 * — so an applicant could write any of the staff-owned keys on their own
 * application. Only `steps`, `lastPreparedAt` and `workflowState` were pinned
 * after the spread; everything else was attacker-controlled.
 *
 * The sharpest consequence is the certificate gate. certificate-service.js:220
 * reads `formData.auditResult === 'PASS'` plus `formData.auditedAt` and treats
 * that pair as PROOF OF A PASSING AUDIT — one of the two accepted sources for
 * issuing a GACP certificate. An applicant could pre-plant that proof on their
 * own draft, so the gate stopped being a gate: it would be satisfied the moment
 * the application reached a post-audit status by any route.
 *
 * Others in the same blob: PROVIDERAssignment (who audits this), carDueAt /
 * revisionDueAt (the applicant's own CAR and revision SLA deadlines),
 * adminOverrides, auditSchedule, auditExecution, rescheduleRequests.
 *
 * Direction of the fix: server-owned keys travel server -> client only. An
 * applicant payload never writes them, so `{...existingFormData, ...payload}`
 * keeps whatever the server already recorded.
 */

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

// R2 Task 8: the caller may edit for ent-1 (the draft door checks the
// application's holder against the scope's editIds; no header, no activeEntity).
jest.mock('../../services/holder-access', () => ({
    ...jest.requireActual('../../services/holder-access'),
    holderScope: jest.fn(async () => ({ userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] })),
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
const router = require('../../routes/api/applications/applications');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', router);
    return app;
}

function storedFormData() {
    const call = applicationService.updateApplicantDraftColumns.mock.calls[0];
    return call[1].formData;
}

describe('SEC — /prepare rejects server-owned formData keys', () => {
    let app;
    beforeAll(() => { app = makeApp(); });

    // Every /prepare names its draft (spec 2026-09-30 §3.2: all writes carry an id).
    const prepare = (body) => request(app).post('/api/applications/prepare').send({ applicationId: 'app-1', ...body });

    beforeEach(() => {
        jest.clearAllMocks();
        applicationService.resolveHealthIdentity.mockResolvedValue({
            userId: 'user-1', healthId: '1100000000008',
        });
        applicationService.findUserOrganizationId.mockResolvedValue('org-1');
        applicationService.findApplicationByIdForHealth.mockResolvedValue({
            id: 'app-1', healthId: '1100000000008', entityId: 'ent-1',
            submitterId: 'user-1', status: 'DRAFT',
            formData: { applicantType: 'JURISTIC' }, workflowHistory: [],
        });
        applicationService.updateApplicantDraftColumns.mockResolvedValue({
            id: 'app-1', applicationNumber: 'APP-1', status: 'DRAFT',
        });
    });

    it('does not persist a forged audit-pass record', async () => {
        const r = await prepare({
            auditResult: 'PASS',
            auditedAt: '2026-07-01T00:00:00.000Z',
        });

        expect(r.status).toBe(200);
        const fd = storedFormData();
        // certificate-service.js:220 accepts exactly this pair as proof of a
        // passing audit. An applicant must never be able to write it.
        expect(fd.auditResult).toBeUndefined();
        expect(fd.auditedAt).toBeUndefined();
    });

    it('does not let the applicant set their own CAR / revision SLA deadlines', async () => {
        const r = await prepare({
            carDueAt: '2099-01-01T00:00:00.000Z',
            car_due_at: '2099-01-01T00:00:00.000Z',
            revisionDueAt: '2099-01-01T00:00:00.000Z',
            revision_due_at: '2099-01-01T00:00:00.000Z',
        });

        expect(r.status).toBe(200);
        const fd = storedFormData();
        expect(fd.carDueAt).toBeUndefined();
        expect(fd.car_due_at).toBeUndefined();
        expect(fd.revisionDueAt).toBeUndefined();
        expect(fd.revision_due_at).toBeUndefined();
    });

    it('does not let the applicant assign their own auditor or override admin settings', async () => {
        const r = await prepare({
            PROVIDERAssignment: { auditorId: 'friendly-auditor' },
            adminOverrides: { skipPayment: true },
            auditSchedule: { date: '2026-09-09' },
            auditExecution: { checklist: [] },
            auditMode: 'ONLINE',
            rescheduleRequests: [{ approved: true }],
        });

        expect(r.status).toBe(200);
        const fd = storedFormData();
        expect(fd.PROVIDERAssignment).toBeUndefined();
        expect(fd.adminOverrides).toBeUndefined();
        expect(fd.auditSchedule).toBeUndefined();
        expect(fd.auditExecution).toBeUndefined();
        expect(fd.auditMode).toBeUndefined();
        expect(fd.rescheduleRequests).toBeUndefined();
    });

    it('preserves what the server already recorded, rather than the applicant payload', async () => {
        applicationService.findApplicationByIdForHealth.mockResolvedValue({
            id: 'app-1', healthId: '1100000000008', entityId: 'ent-1',
            submitterId: 'user-1', status: 'DRAFT',
            formData: {
                auditResult: 'FAIL',
                PROVIDERAssignment: { auditorId: 'real-auditor' },
                carDueAt: '2026-08-10T00:00:00.000Z',
            },
            workflowHistory: [],
        });

        const r = await prepare({
            auditResult: 'PASS',
            PROVIDERAssignment: { auditorId: 'friendly-auditor' },
            carDueAt: '2099-01-01T00:00:00.000Z',
        });

        expect(r.status).toBe(200);
        const fd = storedFormData();
        expect(fd.auditResult).toBe('FAIL');
        expect(fd.PROVIDERAssignment).toEqual({ auditorId: 'real-auditor' });
        expect(fd.carDueAt).toBe('2026-08-10T00:00:00.000Z');
    });

    it('still persists the applicant own wizard answers', async () => {
        const r = await prepare({
            applicantData: { applicantType: 'INDIVIDUAL', firstName: 'สมชาย' },
            farmData: { farmName: 'ไร่สมชาย' },
            plantName: 'ขมิ้นชัน',
            certificationPurposes: ['RESEARCH'],
        });

        expect(r.status).toBe(200);
        const fd = storedFormData();
        expect(fd.applicantData).toEqual({ applicantType: 'INDIVIDUAL', firstName: 'สมชาย' });
        expect(fd.farmData).toEqual({ farmName: 'ไร่สมชาย' });
        expect(fd.plantName).toBe('ขมิ้นชัน');
        expect(fd.certificationPurposes).toEqual(['RESEARCH']);
    });

    // R2 Task 8 (spec 2026-09-30 §3.2, B11): /prepare never re-homes and never
    // takes the declared type from the body.
    it('ignores and strips a body entityId: the update writes no entityId, formData carries none', async () => {
        const r = await prepare({ entityId: 'ent-other', plantName: 'ขมิ้นชัน' });

        expect(r.status).toBe(200);
        const data = applicationService.updateApplicantDraftColumns.mock.calls[0][1];
        expect(Object.prototype.hasOwnProperty.call(data, 'entityId')).toBe(false);
        expect(data.formData.entityId).toBeUndefined();
        expect(data.formData.plantName).toBe('ขมิ้นชัน');
    });

    it('ignores a body applicantType: the stored one survives', async () => {
        const r = await prepare({ applicantType: 'INDIVIDUAL' });

        expect(r.status).toBe(200);
        expect(storedFormData().applicantType).toBe('JURISTIC');
    });

    // R2 Task 9 (spec §4 case 3): a holder the caller reads but may not edit is a
    // visible refusal (403), not a missing row; a row outside the scope stays 404.
    it('a draft whose holder the caller may read but not edit → 403 ENTITY_PERMISSION_DENIED, nothing written', async () => {
        applicationService.findApplicationByIdForHealth.mockResolvedValue({
            id: 'app-1', healthId: '1100000000008', entityId: 'ent-viewer-only',
            submitterId: 'user-1', status: 'DRAFT', formData: {}, workflowHistory: [],
        });

        const r = await prepare({ plantName: 'ห้ามเขียน' });

        expect(r.status).toBe(403);
        expect(r.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
    });

    it('a draft outside the caller\'s holders → 404, nothing written', async () => {
        applicationService.findApplicationByIdForHealth.mockResolvedValue(null);

        const r = await prepare({ plantName: 'ห้ามเขียน' });

        expect(r.status).toBe(404);
        expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
    });
});
