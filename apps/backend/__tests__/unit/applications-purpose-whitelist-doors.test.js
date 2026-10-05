'use strict';
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

// A0 / PR-A0-2: the initial-submit branch now walks its two hops inside one
// `prisma.$transaction`. The old `{ prisma: {} }` stub had no entry point, so
// case (a) below reached the route's catch and passed on `not.toBe(422)` alone —
// a 500 is also not a 422. Pass-through so the suite exercises the submit path
// it was written for. (Same idiom as applications-submit-capability-gate.test.js:51.)
jest.mock('../../services/prisma-database', () => {
    const prisma = {};
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    return { prisma };
});

// M1 PR-C — /submit now runs the central guard before it validates anything,
// so the permission engine and the audit writer are dependencies of this route.
// Mocked with the REAL engine shape (entity-effective-permissions-service.js:403-426).
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertEntityActionPermission: jest.fn(),
}));
// R2: reads and new drafts are scoped by membership, and a new draft names its holder.
jest.mock('../../services/holder-access', () => ({
    ...jest.requireActual('../../services/holder-access'),
    holderScope: jest.fn(async () => ({ userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] })),
}));
jest.mock('../../middleware/audit-logger', () => {
    const actual = jest.requireActual('../../middleware/audit-logger');
    return {
        ...actual,
        auditLogger: {
            log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
            logWithin: jest.fn(() => jest.fn()),
        },
    };
});

jest.mock('../../shared/logger', () => {
    const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));

jest.mock('../../shared/workflow-event-builder', () => ({
    buildWorkflowEvent: jest.fn((event) => ({ ...event, id: 'we-1' })),
}));

jest.mock('../../routes/api/helpers/applications-helpers', () => ({
    getHealthScopeOptions: jest.fn((u) => ({ healthId: u.healthId, strictHealthScope: true })),
    mapHealthApplication: jest.fn((a) => a),
    getActorIdentity: jest.fn(() => 'user-1'),
}));

jest.mock('../../routes/api/applications/application-listing-handlers', () => require('express').Router());
jest.mock('../../routes/api/applications/application-workflow-handlers', () => require('express').Router());
jest.mock('../../services/storage-service', () => ({
    createUploader: jest.fn(() => ({ single: jest.fn(() => (_req, _res, next) => next()) })),
}));
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/fee-service', () => ({}));
jest.mock('../../services/quotation-service', () => ({
    issueQuotationsForApplication: jest.fn().mockResolvedValue(undefined),
    ensurePhase1Quotations: jest.fn().mockResolvedValue(undefined),
}));
// IMPORTANT: do NOT mock application-constants, preview-utils, application-schemas,
// or the canonical validator — this suite exercises REAL validation.


const applicationService = require('../../services/application-service');
const { assertEntityActionPermission } = require('../../services/entity-effective-permissions-service');
const router = require('../../routes/api/applications/applications');

/**
 * มติ operator 2026-10-05 — วัตถุประสงค์ต้องเป็นหนึ่งในสามคำที่มีใบอนุญาต ภ.ท. รองรับ
 * ทั้งประตูบันทึกร่างและประตูยื่นคำขอ · คำอื่น (MEDICAL, COMMERCIAL, ว่าง) ได้ 400 พร้อมรหัสใหม่
 * ไม่มีการแปลงหรือเปลี่ยนชื่อค่าเก่าเงียบ ๆ
 */
const CODE = 'CERTIFICATION_PURPOSE_INVALID';

const app = express();
app.use(express.json());
app.use('/api/applications', router);

function draftRow(formData = {}) {
    return {
        id: 'draft-1', applicationNumber: 'APP-2569-000001', status: 'DRAFT',
        serviceType: 'new_application', areaType: 'OUTDOOR', entityId: 'ent-1', submitterId: 'user-1',
        healthId: '1100000000008', formData: { steps: {}, workflowState: 'DRAFT', ...formData },
        workflowHistory: [], createdAt: new Date(), updatedAt: new Date(),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: '1100000000008' });
    applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue(null);
    applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
    assertEntityActionPermission.mockResolvedValue({ allowed: true, via: 'ENTITY_PERMISSION' });
});

describe('POST /draft', () => {
    beforeEach(() => {
        const draft = draftRow();
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(draft);
        applicationService.updateApplicantDraftColumns.mockResolvedValue(draft);
    });

    test.each([
        ['MEDICAL', { certificationPurposes: ['MEDICAL'] }],
        ['COMMERCIAL', { certificationPurposes: ['COMMERCIAL'] }],
        ['EXPORT + MEDICAL', { certificationPurposes: ['EXPORT', 'MEDICAL'] }],
        ['inside formData', { formData: { certificationPurposes: ['MEDICAL'] } }],
        ['legacy single', { purpose: 'COMMERCIAL' }],
    ])('refuses %s with 400 and the new code, and writes nothing', async (_name, body) => {
        const res = await request(app).post('/api/applications/draft').send({ step: 2, ...body });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(CODE);
        expect(res.body.messageTh).toMatch(/ภ\.ท\. 09/);
        expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
    });

    test.each([
        ['one purpose', ['EXPORT']],
        ['three purposes', ['RESEARCH', 'EXPORT', 'PROCESSING']],
        ['empty while the wizard is incomplete', []],
    ])('accepts %s', async (_name, list) => {
        const res = await request(app).post('/api/applications/draft')
            .send({ step: 1, entityId: 'ent-1', certificationPurposes: list });
        expect(res.status).toBe(200);
        expect(applicationService.updateApplicantDraftColumns).toHaveBeenCalled();
    });

    test('a save that says nothing about purposes still saves', async () => {
        const res = await request(app).post('/api/applications/draft').send({ step: 1, entityId: 'ent-1', formData: {} });
        expect(res.status).toBe(200);
    });
});

describe('POST /submit', () => {
    const mockDraft = (formData) => {
        applicationService.findDraftForSubmit.mockResolvedValue(draftRow(formData));
        applicationService.getApplicationSlice.mockResolvedValue({ id: 'draft-1', status: 'PENDING_DOC_FEE' });
    };

    test.each([
        ['MEDICAL', ['MEDICAL']],
        ['COMMERCIAL', ['COMMERCIAL']],
        ['empty', []],
        ['EXPORT + MEDICAL', ['EXPORT', 'MEDICAL']],
    ])('refuses %s with 400 and the new code', async (_name, list) => {
        mockDraft({ plantId: 'cannabis', certificationPurposes: list });
        const res = await request(app).post('/api/applications/submit').send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(CODE);
        expect(res.body.messageTh).toMatch(/ภ\.ท\. 10/);
    });

    test('a valid purpose is not refused on this ground', async () => {
        mockDraft({ plantId: 'cannabis', certificationPurposes: ['EXPORT'] });
        const res = await request(app).post('/api/applications/submit').send({});
        expect(res.body.code).not.toBe(CODE);
    });
});

// fix round 4 — POST /prepare merged the purposes with no vocabulary check
describe('POST /prepare', () => {
    beforeEach(() => {
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(draftRow());
        applicationService.updateApplicantDraftColumns.mockResolvedValue(draftRow());
        applicationService.createDraftForHealth.mockResolvedValue(draftRow());
    });

    test.each([
        ['MEDICAL', { certificationPurposes: ['MEDICAL'] }],
        ['inside formData', { formData: { certificationPurposes: ['COMMERCIAL'] } }],
        ['legacy single', { purpose: 'COMMERCIAL' }],
    ])('refuses %s with 400 and the same code, and writes nothing', async (_name, body) => {
        const res = await request(app).post('/api/applications/prepare').send(body);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(CODE);
        expect(applicationService.createDraftForHealth).not.toHaveBeenCalled();
        expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
    });

    test('a valid purpose is not refused on this ground', async () => {
        const res = await request(app).post('/api/applications/prepare').send({ certificationPurposes: ['EXPORT'] });
        expect(res.body.code).not.toBe(CODE);
    });
});
