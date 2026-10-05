'use strict';

// 2026-09-05 — every POST to /api/applications/submit below now carries
// `declarationsAccepted: true`. The submit door gates on กทล.๑ ส่วนที่ ๔
// (services/application-declarations-gate.js): a filing nobody certified may not
// reach the department, and the server — not the browser — writes the timestamp.
// A real client sends this field, so these fixtures do too; sending `{}` was
// testing a request no applicant can make.

/**
 * (fix round 3 copy of the door harness) M2a Task 4 — the FIVE submit doors read the document law (spec §3, AC1-3).
 *
 * `m2a-doc-requirements.test.js` proves the engine. This suite proves the
 * WIRING, which is where a rules engine usually dies: one door left unwired is
 * a door every applicant will find. Pattern and scope follow
 * `m1-submit-guard-doors.test.js` — the DB-level proof (real rows, real 422 on
 * Postgres) is `__tests__/integration/m2a-submit-enforcement.test.js`.
 *
 * The service is NOT mocked here. Each request runs door → service → rulesAt →
 * prisma, so an assertion about `requirementRule.findMany` is an assertion about
 * which question the door really asked:
 *
 *   • it was asked at all      → the rule table was read (mode 'first-submit')
 *   • it was NOT asked         → the stamp on the application decided it
 *                                (mode 'resubmit'), or the door deliberately
 *                                skips the check (officer bypass, D13)
 *
 * What is pinned per door: the 422 lands BEFORE anything is written, the stamp
 * is written INSIDE the door's existing formData write (never replacing the
 * applicant's blob), and the officer bypass keeps its documented shape.
 */

const express = require('express');
const request = require('supertest');

// ── stubs shared by every door ───────────────────────────────────────────────

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../middleware/auth-middleware', () => {
    const passUser = (req, _res, next) => { req.user = globalThis.__testUser; next(); };
    return { authenticateHealth: passUser, authenticateAny: passUser, authenticateProvider: passUser };
});

jest.mock('../../middleware/role-middleware', () => ({ providerOnly: (_req, _res, next) => next() }));

jest.mock('multer', () => {
    const multer = () => ({
        array: () => (req, _res, next) => {
            req.files = [{ filename: 'car-1.pdf', originalname: 'car.pdf', size: 1234 }];
            next();
        },
    });
    multer.diskStorage = () => ({});
    return multer;
});

const TX = {
    __tx: true,
    applicationBundle: { update: jest.fn(async () => ({ id: 'bundle-1', status: 'SUBMITTED', applications: [] })) },
    revisionDeadline: { updateMany: jest.fn(async () => ({ count: 1 })) },
    correctionRound: { findFirst: jest.fn(async () => null) },
    correctionSubmissionVersion: { create: jest.fn(async (a) => ({ id: 'csv', ...a.data })) },
};
const mockTransaction = jest.fn(async (cb) => cb(TX));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        $transaction: (...a) => mockTransaction(...a),
        application: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        applicationBundle: {
            findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(),
        },
        revisionDeadline: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        // M2a — the three reads the requirement engine makes.
        entity: { findUnique: jest.fn() },
        requirementRule: { findMany: jest.fn() },
        applicationDocument: { findMany: jest.fn() },
        // holder-access (spec 2026-09-30 §3.1): the caller may edit ent-1's filings.
        entityMembership: { findMany: jest.fn(async () => [{ entityId: 'ent-1', role: 'OWNER' }]) },
    },
}));

const mockWriteApplicationStatus = jest.fn().mockResolvedValue({ id: 'app-1' });
jest.mock('../../services/application-status-writer', () => {
    const actual = jest.requireActual('../../services/application-status-writer');
    return {
        writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
        TERMINAL_STATUSES: actual.TERMINAL_STATUSES,
    };
});

jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(),
    findPersonalEntityForHealthIdentity: jest.fn(),
    healDraftEntityColumns: jest.fn(),
    findOwnedApplicationForApplicant: jest.fn(),
    findDraftForSubmit: jest.fn(),
    findApplicationByIdForHealth: jest.fn(),
    findLatestOpenDraftForHealth: jest.fn(),
    createDraftForHealth: jest.fn(),
    updateApplicantDraftColumns: jest.fn(),
    getApplicationSlice: jest.fn(),
    submitRevision: jest.fn(),
    deleteDraft: jest.fn(),
    findUserOrganizationId: jest.fn(),
    getApplicantReadinessSnapshot: jest.fn(),
    getLatestOpenDraftForApplicant: jest.fn(),
}));

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
    sendNotification: jest.fn().mockResolvedValue({}),
    NotifyType: {},
}));
jest.mock('../../services/provider-user-service', () => ({ listActiveProviders: jest.fn().mockResolvedValue([]) }));
jest.mock('../../services/correction-submission-version-service', () => ({
    snapshotCorrectionSubmission: jest.fn().mockResolvedValue({ id: 'csv-1' }),
}));
jest.mock('../../services/quotation-service', () => ({
    issueQuotationsForApplication: jest.fn().mockResolvedValue(undefined),
    ensurePhase1Quotations: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/storage-service', () => ({
    createUploader: jest.fn(() => ({ single: jest.fn(() => (_req, _res, next) => next()) })),
    decodeMultipartFilename: jest.fn((n) => n),
    // รากของโฟลเดอร์อัปโหลด — ประกาศไว้ที่เดียวในโมดูลจริง และ applications-car.js อ่านค่านี้
    // ตอนโหลดโมดูล mock ที่ไม่มีคีย์นี้จะทำให้ path.join ได้ undefined แล้ว router พังตั้งแต่ require
    BASE_UPLOAD_DIR: '/tmp/gacp-test-uploads',
}));
jest.mock('../../services/fee-service', () => ({}));

// The guard says yes throughout this suite: authority is M1's question and is
// answered before this one (plan Step 3 — สิทธิ์ก่อน แล้วค่อยความครบเอกสาร).
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertEntityActionPermission: jest.fn(),
}));
jest.mock('../../middleware/audit-logger', () => {
    const actual = jest.requireActual('../../middleware/audit-logger');
    return {
        ...actual,
        auditLogger: { log: jest.fn().mockResolvedValue({ id: 'audit-1' }), logWithin: jest.fn(() => jest.fn()) },
    };
});

// Wizard completeness is a DIFFERENT 422 with a different body (errorsByStep).
// It is stubbed to "complete" so every failure this suite reports is the
// document law and nothing else.
jest.mock('../../routes/api/helpers/application-constants', () => {
    const actual = jest.requireActual('../../routes/api/helpers/application-constants');
    return { ...actual, mergeMasterSteps: jest.fn(() => ({ 1: { plantId: 'cannabis' } })) };
});
jest.mock('../../validation/application-schemas', () => ({
    validateStep: jest.fn(() => ({ success: true, errors: [] })),
    validateAllSteps: jest.fn(() => ({ isValid: true, errorsByStep: {} })),
}));
jest.mock('../../routes/api/preview/preview-utils', () => ({
    normalizeDocuments: jest.fn(() => []),
    summarizeCompletion: jest.fn(() => ({ isComplete: true, missingFields: [] })),
}));
jest.mock('../../routes/api/applications/application-listing-handlers', () => require('express').Router());

const { prisma: prismaMock } = require('../../services/prisma-database');
const applicationService = require('../../services/application-service');
const { assertEntityActionPermission } = require('../../services/entity-effective-permissions-service');
const {
    SERVER_OWNED_FORM_DATA_KEYS,
    applyClientFormData,
} = require('../../shared/form-data-ownership');

const HEALTH_USER = {
    id: 'user-1',
    healthId: '1100000000008',
    canonicalId: 'canon-1',
    organizationId: 'org-1',
    canonicalRole: 'health',
    role: 'HEALTH_USER',
};

const YESTERDAY = new Date(Date.now() - 86400000);
const COMPANY_REG_RULE = {
    id: 'm2a-seed-juristic-company-reg',
    holderType: 'JURISTIC',
    requestType: null,
    plantCode: null,
    slotId: 'company_reg',
    isRequired: true,
    maxDocumentAgeMonths: 6,
    effectiveFrom: YESTERDAY,
    effectiveTo: null,
    createdBy: 'SYSTEM-M2A-SEED',
};

/** the stamp a first submit leaves behind */
const STAMP = {
    stampedAt: '2026-08-15T00:00:00.000Z',
    ruleIds: ['m2a-seed-juristic-company-reg'],
    slotIds: ['company_reg'],
};

// The company registration, plus the issued licence the EXPORT purpose of APPLICANT_ANSWERS
// requires (operator ruling 2026-10-05) — so a filing "with its papers on file" stays complete.
const PAPERS_ON_FILE = [
    { documentId: 'd1', slotId: 'company_reg', fileUrl: '/uploads/1.pdf' },
    { documentId: 'd2', slotId: 'licence_pt10', fileUrl: '/uploads/2.pdf' },
];
const LICENCE_PT10_MISSING = {
    slotId: 'licence_pt10',
    labelTH: 'ใบอนุญาตให้ส่งออกสมุนไพรควบคุมเพื่อการค้า (ภ.ท. 10)',
};

/** the applicant's own answers — they must survive every stamp we write */
// `plantId` is part of every real filing's answers: since 2026-09-05 a filing that names no
// plant is refused at the gate rather than judged by whatever law binds every plant.
const APPLICANT_ANSWERS = { plantId: 'cannabis', certificationPurposes: ['EXPORT'], farmData: { farmName: 'ไร่ทดสอบ' }, applicantData: { fullName: 'สมชาย' } };

function writerCalls() {
    return mockWriteApplicationStatus.mock.calls.map(([arg]) => arg);
}

function mount(mountPath, routerPath) {
    const app = express();
    app.use(express.json());
    app.use(mountPath, require(routerPath));
    return app;
}

beforeEach(() => {
    jest.clearAllMocks();
    globalThis.__testUser = { ...HEALTH_USER };
    assertEntityActionPermission.mockResolvedValue({ allowed: true, via: 'ENTITY_PERMISSION' });
    applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: '1100000000008' });
    applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue(null);
    applicationService.getApplicationSlice.mockResolvedValue({
        id: 'app-1', applicationNumber: 'GACP-2026-0001', status: 'PENDING_DOC_FEE',
    });
    mockWriteApplicationStatus.mockResolvedValue({ id: 'app-1' });
    mockTransaction.mockImplementation(async (cb) => cb(TX));
    // A JURISTIC holder, and the seed rule that binds them.
    prismaMock.entity.findUnique.mockResolvedValue({ type: 'JURISTIC' });
    prismaMock.requirementRule.findMany.mockResolvedValue([COMPANY_REG_RULE]);
    prismaMock.applicationDocument.findMany.mockResolvedValue([]);
});

// ── fix round 3 (2026-10-05): one purpose check on every door that writes or submits purposes ──
const CO_ONLY = [{ ...COMPANY_REG_RULE, id: 'law-cannabis', holderType: null, plantCode: 'cannabis', slotId: 'company_reg' }];
const COMPANY_ONLY = [{ documentId: 'd1', slotId: 'company_reg', fileUrl: '/uploads/1.pdf' }];
const ANSWERS_NO_PURPOSE = { plantId: 'cannabis', certificationPurposes: [], farmData: { farmName: 'ไร่ทดสอบ' } };

describe('round 3 - PUT /applications/:id/revision judges the formData that WILL be stored', () => {
    let app;
    beforeAll(() => { app = mount('/api/applications', '../../routes/api/applications/application-workflow-handlers'); });
    const put = (formData) => request(app).put('/api/applications/app-1/revision').send({ formData, notes: 'n' });
    beforeEach(() => {
        prismaMock.requirementRule.findMany.mockResolvedValue(CO_ONLY);
        applicationService.submitRevision.mockResolvedValue({ status: 200, body: { success: true } });
    });
    const stored = (status, extra = {}) => ({
        id: 'app-1', status, entityId: 'ent-1', submitterId: 'user-1',
        formData: { ...ANSWERS_NO_PURPOSE, ...extra },
    });

    it('draft first-submit leg: a MEDICAL purpose written by the revision body is refused', async () => {
        applicationService.findOwnedApplicationForApplicant.mockResolvedValue(stored('DRAFT', { draftDocuments: COMPANY_ONLY }));
        const r = await put({ certificationPurposes: ['MEDICAL'] });
        expect(r.status).toBe(422);
        expect(JSON.stringify(r.body)).toContain('CERTIFICATION_PURPOSE_INVALID');
        expect(applicationService.submitRevision).not.toHaveBeenCalled();
    });

    it('resubmit leg (REVISION_REQUESTED): MEDICAL / COMMERCIAL is refused as well', async () => {
        applicationService.findOwnedApplicationForApplicant.mockResolvedValue(stored('REVISION_REQUESTED', {
            certificationPurposes: ['EXPORT'], serverRequirementSnapshot: STAMP, draftDocuments: PAPERS_ON_FILE,
        }));
        const r = await put({ certificationPurposes: ['COMMERCIAL'] });
        expect(r.status).toBe(422);
        expect(JSON.stringify(r.body)).toContain('CERTIFICATION_PURPOSE_INVALID');
        expect(applicationService.submitRevision).not.toHaveBeenCalled();
    });

    it('draft first-submit leg: stored [] + body [EXPORT] on cannabis without pt10 -> APPLICATION_INCOMPLETE naming licence_pt10', async () => {
        applicationService.findOwnedApplicationForApplicant.mockResolvedValue(stored('DRAFT', { draftDocuments: COMPANY_ONLY }));
        const r = await put({ certificationPurposes: ['EXPORT'] });
        expect(r.status).toBe(422);
        expect(r.body.code || r.body.error).toBe('APPLICATION_INCOMPLETE');
        expect(r.body.missingSlots).toEqual([LICENCE_PT10_MISSING]);
        expect(applicationService.submitRevision).not.toHaveBeenCalled();
    });

    it('draft first-submit leg: no purpose at all (stored [] and body silent) is refused', async () => {
        applicationService.findOwnedApplicationForApplicant.mockResolvedValue(stored('DRAFT', { draftDocuments: COMPANY_ONLY }));
        const r = await put({});
        expect(r.status).toBe(422);
        expect(JSON.stringify(r.body)).toContain('CERTIFICATION_PURPOSE_INVALID');
        expect(applicationService.submitRevision).not.toHaveBeenCalled();
    });

    it('draft first-submit leg: a valid purpose with its licence on file goes through', async () => {
        applicationService.findOwnedApplicationForApplicant.mockResolvedValue(stored('DRAFT', { draftDocuments: PAPERS_ON_FILE }));
        const r = await put({ certificationPurposes: ['EXPORT'] });
        expect(r.status).toBe(200);
        expect(applicationService.submitRevision).toHaveBeenCalled();
    });

    it('resubmit leg: a purpose ADDED by the revision body brings its licence with it', async () => {
        applicationService.findOwnedApplicationForApplicant.mockResolvedValue(stored('REVISION_REQUESTED', {
            certificationPurposes: ['RESEARCH'], serverRequirementSnapshot: { ...STAMP, slotIds: ['company_reg'] },
            draftDocuments: COMPANY_ONLY,
        }));
        const r = await put({ certificationPurposes: ['RESEARCH', 'EXPORT'] });
        expect(r.status).toBe(422);
        expect(r.body.missingSlots).toEqual([LICENCE_PT10_MISSING]);
    });
});

describe('round 3 - POST /bundles/:id/submit refuses a filing with no purpose', () => {
    let app;
    beforeAll(() => { app = mount('/api/applications/bundles', '../../routes/api/applications/application-bundles'); });
    it('a cannabis case with [] is refused for the whole bundle, no transaction opened', async () => {
        prismaMock.requirementRule.findMany.mockResolvedValue(CO_ONLY);
        prismaMock.applicationBundle.findFirst.mockResolvedValue({
            id: 'bundle-1', status: 'DRAFT',
            applications: [{ id: 'app-a', status: 'DRAFT', entityId: 'ent-a', formData: { ...ANSWERS_NO_PURPOSE, draftDocuments: COMPANY_ONLY } }],
        });
        const r = await request(app).post('/api/applications/bundles/bundle-1/submit').send({});
        expect(r.status).toBe(422);
        expect(JSON.stringify(r.body)).toContain('CERTIFICATION_PURPOSE_INVALID');
        expect(mockTransaction).not.toHaveBeenCalled();
    });
});
