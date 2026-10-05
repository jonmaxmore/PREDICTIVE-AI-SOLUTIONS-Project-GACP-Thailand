'use strict';

// 2026-09-05 — every POST to /api/applications/submit below now carries
// `declarationsAccepted: true`. The submit door gates on กทล.๑ ส่วนที่ ๔
// (services/application-declarations-gate.js): a filing nobody certified may not
// reach the department, and the server — not the browser — writes the timestamp.
// A real client sends this field, so these fixtures do too; sending `{}` was
// testing a request no applicant can make.
/**
 * The two submit doors are WIRED to the loud-issuance helper — proven through
 * the doors themselves, not through the helper alone (fix round 1, reviewer m2).
 *
 * The helper had five passing tests and neither door had one. Dropping the
 * `await` at the front door, dropping `actorRole`, or dropping the `quotation`
 * field from the response body broke nothing: the only suites that mention the
 * helper were the helper's own, and the route suites that touch submit stub
 * issuance to a resolved promise and never look at it. So this file drives the
 * real Express route and the real revision-method factory and reads what comes
 * back out.
 *
 * Three things per door:
 *   1. the failure reaches the CALLER (the response body), the AUDIT TRAIL and
 *      the ADMIN QUEUE — all three, because any one of them alone leaves an
 *      applicant who cannot pay and nobody who knows it;
 *   2. the issuance is AWAITED — a response that leaves before issuance
 *      settles cannot carry its outcome, which is the whole point of R3;
 *   3. a RESUBMIT leg, which issues nothing, says so instead of claiming
 *      { issued: true } (reviewer m6).
 */

const express = require('express');
const request = require('supertest');

// ── shared mocks ─────────────────────────────────────────────────────────────

const mockIssue = jest.fn();
jest.mock('../../services/quotation-service', () => ({
    issueQuotationsForApplication: (...a) => mockIssue(...a),
    ensurePhase1Quotations: jest.fn().mockResolvedValue(undefined),
}));

const mockNotifyAdmin = jest.fn(async () => {});
jest.mock('../../services/notification/domain-helpers', () => {
    const actual = jest.requireActual('../../services/notification/domain-helpers');
    return { ...actual, notifyAdminQuotationIssueFailed: (...a) => mockNotifyAdmin(...a) };
});

const mockAuditLog = jest.fn(async () => ({ id: 'audit-1' }));
jest.mock('../../middleware/audit-logger', () => {
    const actual = jest.requireActual('../../middleware/audit-logger');
    return {
        ...actual,
        auditLogger: { log: (...a) => mockAuditLog(...a), logWithin: jest.fn(() => jest.fn()) },
    };
});

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

/** Every audit row this run wrote under the given action. */
const auditRows = (action) => mockAuditLog.mock.calls
    .map(([entry]) => entry)
    .filter((entry) => entry && entry.action === action);

// ── door 1: POST /api/applications/submit ────────────────────────────────────

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
    return { authenticateHealth: passUser, authenticateAny: passUser, authenticateProvider: passUser };
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

jest.mock('../../services/prisma-database', () => {
    const prisma = {};
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    return { prisma };
});

jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertEntityActionPermission: jest.fn(),
}));
jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
    NotifyType: {},
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
jest.mock('../../services/correction-submission-version-service', () => ({
    snapshotCorrectionSubmission: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../validation/application-submission-validator', () => ({
    validateSubmissionPayload: jest.fn(() => ({ isValid: true })),
}));
// The document-requirement gate reads the holder's own row through a real
// prisma delegate. It is not what this file measures and it sits BEFORE every
// write in the handler, so it is stubbed to "requirements met"; the gate itself
// is proven in m2a-doc-requirements-doors.test.js.
jest.mock('../../services/application-document-requirements', () => {
    const actual = jest.requireActual('../../services/application-document-requirements');
    return {
        ...actual,
        assertRequiredDocumentsPresent: jest.fn(async () => ({ appliedRules: [] })),
        buildRequirementSnapshot: jest.fn(() => null),
    };
});

const applicationService = require('../../services/application-service');
const { assertEntityActionPermission } = require('../../services/entity-effective-permissions-service');
const applicationsRouter = require('../../routes/api/applications/applications');
const {
    createApplicationReviewRevisionMethods,
} = require('../../services/application-service/application-review-revision-methods');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', applicationsRouter);
    return app;
}

/** The minimal complete canonical filing the front door accepts. */
function completeFormData() {
    return {
        plantId: 'cannabis',
        serviceType: 'NEW',
        certificationPurposes: ['EXPORT'],
        locationType: 'OUTDOOR',
        cultivationMethods: ['outdoor'],
        consentedPDPA: true,
        acknowledgedStandards: true,
        applicantData: {
            applicantType: 'INDIVIDUAL',
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            idCard: '1100000000008',
            phone: '0812345678',
            email: 'somchai@example.com',
            address: '123 หมู่ 4',
        },
        farmData: {
            farmName: 'ฟาร์มสมชาย',
            address: '123 หมู่ 4',
            province: 'สมุทรปราการ',
            district: 'บางพลี',
            subdistrict: 'บางพลีใหญ่',
            postalCode: '10540',
            totalAreaSize: '5',
            totalAreaUnit: 'Rai',
            landOwnership: 'OWN',
            gpsLat: '13.12',
            gpsLng: '100.65',
        },
        plots: [{ id: 'p1', name: 'แปลงที่ 1', areaSize: '2', areaUnit: 'Rai', solarSystem: 'OUTDOOR' }],
        productionData: { propagationType: ['SEED'], plantParts: ['FLOWER'] },
        harvestData: { harvestMethod: 'MANUAL', dryingMethod: 'SUN', storageSystem: 'AMBIENT' },
        documents: [{ type: 'ID_CARD', name: 'บัตรประชาชน', uploaded: true, url: '/uploads/id.pdf' }],
    };
}

function seedFrontDoor(status = 'DRAFT') {
    applicationService.resolveHealthIdentity.mockResolvedValue({
        userId: 'user-1', healthId: '1100000000008',
    });
    assertEntityActionPermission.mockResolvedValue({ allowed: true, via: 'ENTITY_PERMISSION' });
    applicationService.findDraftForSubmit.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-2026-100',
        status,
        healthId: '1100000000008',
        entityId: 'ent-1',
        submitterId: 'user-1',
        formData: completeFormData(),
        workflowHistory: [],
    });
    // HONOURS `select`, the way Prisma does. A stand-in that returns the whole
    // row regardless would let this file "prove" that the audit row carries the
    // application's organization while the route never asked for that column —
    // which is exactly the defect (reviewer m4).
    applicationService.getApplicationSlice.mockImplementation(async (_id, opts = {}) => {
        const row = {
            id: 'app-1',
            applicationNumber: 'APP-2026-100',
            status: status === 'DRAFT' ? 'PENDING_DOC_FEE' : 'ASSIGNED_FOR_REVIEW',
            organizationId: 'org-1',
        };
        if (!opts.select) { return row; }
        return Object.fromEntries(Object.entries(row).filter(([k]) => opts.select[k]));
    });
}

describe('door 1 — POST /api/applications/submit', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => { jest.clearAllMocks(); });

    it('reports a failed issuance to the caller, the audit trail AND the admin queue', async () => {
        seedFrontDoor('DRAFT');
        mockIssue.mockRejectedValue(Object.assign(new Error('numbering down'), { code: 'SEQ_LOCK' }));

        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        expect(r.status).toBe(200);
        expect(r.body.quotation).toEqual({ issued: false, error: 'QUOTATION_ISSUE_FAILED' });
        expect(auditRows('QUOTATION_ISSUE_FAILED')).toHaveLength(1);
        expect(mockNotifyAdmin).toHaveBeenCalledWith(expect.objectContaining({
            applicationId: 'app-1', applicationNumber: 'APP-2026-100',
        }));
    });

    it('stamps that audit row with the caller\'s role AND the application\'s own organization', async () => {
        // Reviewer m4: `updated` selected {id, applicationNumber, status} only,
        // so organizationId was always undefined here and the row fell back to
        // tenant-context / default-org resolution (middleware/audit-logger.js)
        // — on the exact door whose audit row exists to be findable.
        // actorRole is NOT NULL in the schema: omit it and there is no row.
        seedFrontDoor('DRAFT');
        mockIssue.mockRejectedValue(new Error('boom'));

        await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        expect(auditRows('QUOTATION_ISSUE_FAILED')[0]).toMatchObject({
            resourceId: 'app-1',
            actorId: 'user-1',
            actorRole: 'health',
            organizationId: 'org-1',
        });
    });

    it('AWAITS the issuance — the response cannot leave before it settles', async () => {
        seedFrontDoor('DRAFT');
        let settled = false;
        mockIssue.mockImplementation(async () => {
            await new Promise((res) => setTimeout(res, 25));
            settled = true;
            return { company: { id: 'qt-1' }, dtam: null, platform: { id: 'qt-1' } };
        });

        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        expect(settled).toBe(true);
        expect(r.body.quotation).toEqual({ issued: true });
    });

    it('a resubmit leg says NOT_AN_ISSUANCE_LEG instead of claiming a price of record', async () => {
        // Reviewer m6. A REVISION_REQUESTED resubmit issues nothing —
        // quotations are once per lifecycle — and used to answer
        // { issued: true }, which reads as "this application has a price of
        // record". For the one applicant this task is about (initial issuance
        // failed, then a revision resubmit) that sentence is false.
        seedFrontDoor('REVISION_REQUESTED');

        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        expect(mockIssue).not.toHaveBeenCalled();
        expect(r.body.quotation).toEqual({ issued: null, reason: 'NOT_AN_ISSUANCE_LEG' });
    });
});

// ── door 2: application-review-revision-methods.submitRevision ────────────────

describe('door 2 — submitRevision', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    function buildPrisma(application) {
        const prisma = {
            application: {
                findFirst: jest.fn(async () => application),
                findUnique: jest.fn(async () => ({ ...application, status: 'PENDING_DOC_FEE' })),
            },
            revisionDeadline: {
                findUnique: jest.fn(async () => null),
                updateMany: jest.fn(async () => ({ count: 1 })),
            },
            user: { findMany: jest.fn(async () => []) },
            correctionRound: { findFirst: jest.fn(async () => null) },
            correctionSubmissionVersion: { create: jest.fn(async () => ({ id: 'csv-1' })) },
        };
        prisma.$transaction = jest.fn(async (fn) => fn(prisma));
        return prisma;
    }

    function methodsFor(prisma) {
        return createApplicationReviewRevisionMethods({
            prisma,
            sendNotification: jest.fn(),
            NotifyType: { NEW_APPLICATION: 'NEW_APPLICATION' },
            logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        });
    }

    const actor = { userId: 'u-1', healthId: 'h-1', actorIdentity: 'u-1', actorRole: 'health' };

    it('reports a failed issuance to the caller, the audit trail AND the admin queue', async () => {
        mockIssue.mockRejectedValue(Object.assign(new Error('numbering down'), { code: 'SEQ_LOCK' }));
        const prisma = buildPrisma({
            id: 'app-2', applicationNumber: 'GACP-2026-0002', status: 'DRAFT',
            healthId: 'h-1', organizationId: 'org-2', formData: {}, workflowHistory: [],
        });

        const result = await methodsFor(prisma)
            .submitRevision('app-2', { formData: {}, notes: 'submit' }, actor);

        expect(result.body.quotation).toEqual({ issued: false, error: 'QUOTATION_ISSUE_FAILED' });
        expect(auditRows('QUOTATION_ISSUE_FAILED')).toHaveLength(1);
        expect(auditRows('QUOTATION_ISSUE_FAILED')[0]).toMatchObject({
            resourceId: 'app-2', actorId: 'u-1', actorRole: 'health',
        });
        expect(mockNotifyAdmin).toHaveBeenCalledWith(expect.objectContaining({
            applicationId: 'app-2',
        }));
    });

    it('AWAITS the issuance — the return value cannot be built before it settles', async () => {
        let settled = false;
        mockIssue.mockImplementation(async () => {
            await new Promise((res) => setTimeout(res, 25));
            settled = true;
            return { company: { id: 'qt-1' }, dtam: null, platform: { id: 'qt-1' } };
        });
        const prisma = buildPrisma({
            id: 'app-2', applicationNumber: 'GACP-2026-0002', status: 'DRAFT',
            healthId: 'h-1', formData: {}, workflowHistory: [],
        });

        const result = await methodsFor(prisma)
            .submitRevision('app-2', { formData: {}, notes: 'submit' }, actor);

        expect(settled).toBe(true);
        expect(result.body.quotation).toEqual({ issued: true });
    });

    it('a REVISION_REQUESTED leg says NOT_AN_ISSUANCE_LEG instead of claiming a price of record', async () => {
        const futureDue = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        const prisma = buildPrisma({
            id: 'app-3', applicationNumber: 'GACP-2026-0003', status: 'REVISION_REQUESTED',
            healthId: 'h-1', formData: { revisionDueAt: futureDue }, workflowHistory: [],
        });

        const result = await methodsFor(prisma)
            .submitRevision('app-3', { formData: {}, notes: 'fixed' }, actor);

        expect(mockIssue).not.toHaveBeenCalled();
        expect(result.body.quotation).toEqual({ issued: null, reason: 'NOT_AN_ISSUANCE_LEG' });
    });
});
