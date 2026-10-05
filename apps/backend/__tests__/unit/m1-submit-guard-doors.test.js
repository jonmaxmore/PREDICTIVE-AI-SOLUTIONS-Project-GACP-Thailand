'use strict';

/**
 * M1 PR-C — the OTHER three submit doors ask in whose name (plan D4).
 *
 * `applications-submit-capability-gate.test.js` covers the front door
 * (POST /api/applications/submit). Enforcing one door and leaving the rest open
 * is not enforcement, so this suite drives the three that the plan's D4 set
 * names alongside it, plus the create-side seed rule:
 *
 *   • POST   /api/applications/bundles/:id/submit   (had NO entity check at all)
 *   • PUT    /api/applications/revision-deadline/:id/submit (provider bypass — D13)
 *   • POST   /api/applications/:id/car
 *   • POST   /api/applications/renewals            (create-side: seed or 400)
 *
 * The DB-level proof (a real AuditLog FAILURE row, a real GRANT letting a
 * non-owner through) lives in `__tests__/integration/m1-submit-enforcement.test.js`
 * and only runs where DATABASE_URL exists. What is proven HERE is the wiring:
 * which entity is asked about, what the refusal looks like, and that nothing is
 * written when the answer is no.
 */

const express = require('express');
const request = require('supertest');

// ── shared stubs ─────────────────────────────────────────────────────────────

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../middleware/auth-middleware', () => {
    const passUser = (req, _res, next) => {
        req.user = globalThis.__testUser;
        next();
    };
    return {
        authenticateHealth: passUser,
        authenticateAny: passUser,
        authenticateProvider: passUser,
    };
});

jest.mock('../../middleware/role-middleware', () => ({
    providerOnly: (_req, _res, next) => next(),
}));

// multer is constructed at module load; hand the CAR route a middleware that
// injects an already-"uploaded" file so the handler reaches the guard.
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

const mockTransaction = jest.fn(async (cb) => cb({
    __tx: true,
    applicationBundle: { update: jest.fn(async () => ({ id: 'bundle-1', status: 'SUBMITTED', applications: [] })) },
    revisionDeadline: { updateMany: jest.fn(async () => ({ count: 1 })) },
    correctionRound: { findFirst: jest.fn(async () => null) },
    correctionSubmissionVersion: { create: jest.fn(async (a) => ({ id: 'csv', ...a.data })) },
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        $transaction: (...a) => mockTransaction(...a),
        application: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        applicationBundle: {
            findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(),
        },
        revisionDeadline: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
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
    getApplicationSlice: jest.fn(),
    submitRevision: jest.fn(),
}));

jest.mock('../../services/renewal-service', () => ({
    createRenewalApplication: jest.fn(),
    listUpcomingExpiry: jest.fn(),
}));

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    sendNotification: jest.fn().mockResolvedValue({}),
    NotifyType: {},
}));
jest.mock('../../services/provider-user-service', () => ({
    listActiveProviders: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../services/correction-submission-version-service', () => ({
    snapshotCorrectionSubmission: jest.fn().mockResolvedValue({ id: 'csv-1' }),
}));

// M2a — the submit doors now also ask the document law, which reads three
// models this suite's prisma mock does not carry (entity / requirementRule /
// applicationDocument). Stubbed to "nothing is missing" so these tests keep
// asking their own question (in whose name may this be submitted?); the engine
// and its wiring are proven in m2a-doc-requirements{,-doors}.test.js. The error
// class and the mode constants stay REAL, so a door that catches the wrong
// thing still fails here.
jest.mock('../../services/application-document-requirements', () => {
    const actual = jest.requireActual('../../services/application-document-requirements');
    return {
        ...actual,
        assertRequiredDocumentsPresent: jest.fn().mockResolvedValue({ appliedRules: [] }),
    };
});

// The two guard dependencies, mocked with their REAL shapes: the engine
// primitive resolves on allow and rejects with the canonical denial
// (entity-effective-permissions-service.js:403-426), and auditLogger.log()
// opens its own transaction in production (audit-logger.js:479).
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertEntityActionPermission: jest.fn(),
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

const { prisma: prismaMock } = require('../../services/prisma-database');
const applicationService = require('../../services/application-service');
const renewalService = require('../../services/renewal-service');
const { assertEntityActionPermission } = require('../../services/entity-effective-permissions-service');
const { auditLogger } = require('../../middleware/audit-logger');

const HEALTH_USER = {
    id: 'user-1',
    healthId: '1100000000008',
    canonicalId: 'canon-1',
    organizationId: 'org-1',
    canonicalRole: 'health',
    role: 'HEALTH_USER',
};

function engineDenial() {
    return Object.assign(new Error('denied'), { status: 403, code: 'ENTITY_PERMISSION_DENIED' });
}

function auditCalls() {
    return auditLogger.log.mock.calls.map(([arg]) => arg);
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
    applicationService.resolveHealthIdentity.mockResolvedValue({
        userId: 'user-1', healthId: '1100000000008',
    });
    applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue(null);
    mockWriteApplicationStatus.mockResolvedValue({ id: 'app-1' });
});

// ── door 2: bundle submit ────────────────────────────────────────────────────

describe('M1 — POST /bundles/:id/submit asks the guard about EVERY linked case', () => {
    let app;
    beforeAll(() => { app = mount('/api/applications/bundles', '../../routes/api/applications/application-bundles'); });

    const submit = () => request(app).post('/api/applications/bundles/bundle-1/submit').send({});

    function bundleWith(applications) {
        prismaMock.applicationBundle.findFirst.mockResolvedValue({
            id: 'bundle-1', status: 'DRAFT', applications,
        });
        prismaMock.applicationBundle.update.mockResolvedValue({
            id: 'bundle-1', status: 'SUBMITTED', applications: [],
        });
    }

    it('a linked case with no entityId (nothing to heal) → 400 VALIDATION_ERROR, no transaction opened', async () => {
        bundleWith([
            { id: 'app-a', status: 'DRAFT', entityId: 'ent-a' },
            { id: 'app-b', status: 'DRAFT', entityId: null },
        ]);

        const r = await submit();

        expect(r.status).toBe(400);
        expect(r.body.code).toBe('VALIDATION_ERROR');
        // The refusal lands BEFORE the transaction — a FAILURE audit row must
        // not be rolled back with the business write (plan Step 2b).
        expect(mockTransaction).not.toHaveBeenCalled();
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
    });

    it('a linked case the caller may not act for → 403 ENTITY_PERMISSION_DENIED + audit FAILURE, nothing written', async () => {
        bundleWith([
            { id: 'app-a', status: 'DRAFT', entityId: 'ent-a' },
            { id: 'app-b', status: 'DRAFT', entityId: 'ent-foreign' },
        ]);
        assertEntityActionPermission.mockImplementation(async ({ entityId }) => {
            if (entityId === 'ent-foreign') { throw engineDenial(); }
            return { allowed: true, via: 'ENTITY_PERMISSION' };
        });

        const r = await submit();

        expect(r.status).toBe(403);
        expect(r.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(mockTransaction).not.toHaveBeenCalled();
        expect(auditCalls()).toContainEqual(expect.objectContaining({
            result: 'FAILURE',
            metadata: expect.objectContaining({ onBehalfOfEntityId: 'ent-foreign' }),
        }));
    });

    it('every allowed case is asked about by its OWN entityId, then submitted', async () => {
        bundleWith([
            { id: 'app-a', status: 'DRAFT', entityId: 'ent-a' },
            { id: 'app-b', status: 'DRAFT', entityId: 'ent-b' },
        ]);

        const r = await submit();

        expect(r.status).toBe(200);
        expect(assertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-a', userId: 'user-1', permission: 'SUBMIT_APPLICATION',
        }));
        expect(assertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-b', userId: 'user-1', permission: 'SUBMIT_APPLICATION',
        }));
        // Audit F3 — the accepted act is part of AC3, so its envelope is pinned:
        // deleting logBundleSubmitAccepted must not stay green.
        expect(auditCalls()).toContainEqual(expect.objectContaining({
            result: 'SUCCESS', action: 'APPLICATION_SUBMIT_ACCEPTED',
            metadata: expect.objectContaining({ onBehalfOfEntityId: 'ent-a' }),
        }));
        expect(auditCalls()).toContainEqual(expect.objectContaining({
            result: 'SUCCESS',
            metadata: expect.objectContaining({ onBehalfOfEntityId: 'ent-b' }),
        }));
        // Audit F3 — reverting the M1 projection (entityId off the linked-app
        // select) must not stay green: production would refuse every bundle.
        expect(JSON.stringify(prismaMock.applicationBundle.findFirst.mock.calls[0])).toContain('"entityId":true');
    });

    it('heals a pre-Phase-66 linked case from the personal entity instead of refusing it', async () => {
        bundleWith([{ id: 'app-a', status: 'DRAFT', entityId: null }]);
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue({ id: 'ent-personal' });
        applicationService.healDraftEntityColumns.mockResolvedValue({ id: 'app-a', entityId: 'ent-personal' });

        const r = await submit();

        expect(r.status).toBe(200);
        expect(assertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-personal',
        }));
    });
});

// ── door 3: revision-deadline submit ─────────────────────────────────────────

describe('M1 — PUT /revision-deadline/:id/submit', () => {
    let app;
    beforeAll(() => { app = mount('/api/revision-deadline', '../../routes/api/applications/revision-deadline'); });

    const submit = () => request(app).put('/api/revision-deadline/app-1/submit').send({});

    beforeEach(() => {
        prismaMock.application.findFirst.mockResolvedValue({ id: 'app-1', entityId: 'ent-1' });
        prismaMock.revisionDeadline.findUnique.mockResolvedValue({
            applicationId: 'app-1', status: 'PENDING', revisionDue: new Date(Date.now() + 86400000),
        });
        prismaMock.revisionDeadline.update.mockResolvedValue({
            id: 'rd-1', applicationId: 'app-1', status: 'SUBMITTED', revisionDue: new Date(), submittedAt: new Date(),
        });
    });

    it('health user who may not act for the application entity → 403, deadline row untouched', async () => {
        assertEntityActionPermission.mockRejectedValue(engineDenial());

        const r = await submit();

        expect(r.status).toBe(403);
        expect(r.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(prismaMock.revisionDeadline.update).not.toHaveBeenCalled();
    });

    it('health user who may act → submits, and the row records in whose name', async () => {
        const r = await submit();

        expect(r.status).toBe(200);
        expect(assertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-1', userId: 'user-1', permission: 'SUBMIT_APPLICATION',
        }));
        expect(auditCalls()).toContainEqual(expect.objectContaining({
            result: 'SUCCESS',
            metadata: expect.objectContaining({ onBehalfOfEntityId: 'ent-1' }),
        }));
    });

    // D13 — the officer bypass stays (the real delegation path is M2), but it
    // stops being invisible: every use writes an actorType PROVIDER row naming
    // the entity the officer acted for.
    it('provider bypass survives, but ALWAYS writes an actorType PROVIDER row naming the entity', async () => {
        // 'reviewer' normalizes to CANONICAL_ROLES.DOCUMENT_REVIEWER; the raw
        // spelling 'DOC_REVIEWER' normalizes to null, which the route reads as
        // "not a provider" (shared/canonical-rbac.js).
        globalThis.__testUser = {
            id: 'officer-1', role: 'document_reviewer', canonicalRole: 'document_reviewer', organizationId: 'org-1',
        };

        const r = await submit();

        expect(r.status).toBe(200);
        // the membership question is NOT asked of an officer …
        expect(assertEntityActionPermission).not.toHaveBeenCalled();
        // … but the act is on the record, with the entity it was done for
        expect(auditCalls()).toContainEqual(expect.objectContaining({
            actorType: 'PROVIDER',
            actorId: 'officer-1',
            metadata: expect.objectContaining({ onBehalfOfEntityId: 'ent-1' }),
        }));
    });
});

// ── door 4: CAR submit ───────────────────────────────────────────────────────

describe('M1 — POST /applications/:id/car', () => {
    let app;
    beforeAll(() => { app = mount('/api/applications', '../../routes/api/applications/applications-car'); });

    const post = () => request(app).post('/api/applications/app-1/car').send({ notes: 'ส่งหลักฐาน' });

    const CAR_ROW = {
        id: 'app-1',
        applicationNumber: 'GACP-2026-0001',
        status: 'CAR_PENDING',
        healthId: '1100000000008',
        entityId: 'ent-1',
        formData: { workflowState: 'CAR_PENDING', carDueAt: '2099-01-01T00:00:00.000Z' },
        workflowHistory: [],
    };

    beforeEach(() => {
        applicationService.findOwnedApplicationForApplicant.mockResolvedValue(
            JSON.parse(JSON.stringify(CAR_ROW)),
        );
    });

    it('refuses with 403 when the caller may not act for the application entity — nothing written', async () => {
        assertEntityActionPermission.mockRejectedValue(engineDenial());

        const r = await post();

        expect(r.status).toBe(403);
        expect(r.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
        expect(auditCalls()).toContainEqual(expect.objectContaining({
            result: 'FAILURE',
            metadata: expect.objectContaining({ onBehalfOfEntityId: 'ent-1' }),
        }));
    });

    it('refuses with 400 when the row names no entity and nothing can be healed', async () => {
        applicationService.findOwnedApplicationForApplicant.mockResolvedValue({
            ...JSON.parse(JSON.stringify(CAR_ROW)), entityId: null,
        });

        const r = await post();

        expect(r.status).toBe(400);
        expect(r.body.code).toBe('VALIDATION_ERROR');
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
    });

    it('allows the owner through, asking about the application row entity', async () => {
        const r = await post();

        expect(r.status).toBe(200);
        expect(assertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-1', userId: 'user-1', permission: 'SUBMIT_APPLICATION',
        }));
        // Audit F3 — pin the accepted-act envelope on this door too.
        expect(auditCalls()).toContainEqual(expect.objectContaining({
            result: 'SUCCESS', action: 'APPLICATION_CAR_SUBMIT_ACCEPTED',
            metadata: expect.objectContaining({ onBehalfOfEntityId: 'ent-1' }),
        }));
    });
});

// ── door 5 (audit F1): the workflow-handlers revision door ───────────────────
//
// PUT /api/applications/:id/revision (application-workflow-handlers.js) carries
// a DRAFT to SUBMITTED through submitRevision's isDraftSubmit leg — a live
// submit door the plan's D4 set missed. Same rules as every other door.

describe('M1 — PUT /applications/:id/revision (workflow-handlers) asks the guard too', () => {
    let app;
    beforeAll(() => { app = mount('/api/applications', '../../routes/api/applications/application-workflow-handlers'); });

    const put = () => request(app).put('/api/applications/app-1/revision').send({ formData: {}, notes: 'n' });

    beforeEach(() => {
        applicationService.findOwnedApplicationForApplicant.mockResolvedValue({
            id: 'app-1', entityId: 'ent-1', submitterId: 'user-1',
        });
        applicationService.submitRevision.mockResolvedValue({ status: 200, body: { success: true } });
    });

    it('no entityId and nothing to heal → 400 VALIDATION_ERROR, submitRevision never runs', async () => {
        applicationService.findOwnedApplicationForApplicant.mockResolvedValue({
            id: 'app-1', entityId: null, submitterId: null,
        });

        const r = await put();

        expect(r.status).toBe(400);
        expect(r.body.code).toBe('VALIDATION_ERROR');
        expect(applicationService.submitRevision).not.toHaveBeenCalled();
    });

    it('caller who may not act for the entity → 403 + audit FAILURE, submitRevision never runs', async () => {
        assertEntityActionPermission.mockRejectedValue(engineDenial());

        const r = await put();

        expect(r.status).toBe(403);
        expect(r.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(applicationService.submitRevision).not.toHaveBeenCalled();
        expect(auditCalls()).toContainEqual(expect.objectContaining({
            result: 'FAILURE',
            metadata: expect.objectContaining({ onBehalfOfEntityId: 'ent-1' }),
        }));
    });

    it('allowed → asks about the row entity, submits, and records the accepted act (AC3)', async () => {
        const r = await put();

        expect(r.status).toBe(200);
        expect(assertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-1', userId: 'user-1', permission: 'SUBMIT_APPLICATION',
        }));
        expect(applicationService.submitRevision).toHaveBeenCalled();
        expect(auditCalls()).toContainEqual(expect.objectContaining({
            result: 'SUCCESS', action: 'APPLICATION_REVISION_SUBMIT_ACCEPTED',
            metadata: expect.objectContaining({ onBehalfOfEntityId: 'ent-1' }),
        }));
    });

    it('heals a pre-Phase-66 row from the personal entity before deciding', async () => {
        applicationService.findOwnedApplicationForApplicant.mockResolvedValue({
            id: 'app-1', entityId: null, submitterId: null,
        });
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue({ id: 'ent-personal' });
        applicationService.healDraftEntityColumns.mockResolvedValue({ id: 'app-1', entityId: 'ent-personal' });

        const r = await put();

        expect(r.status).toBe(200);
        expect(assertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-personal',
        }));
    });
});

// ── create side: a renewal draft is born naming an entity, or not at all ─────

describe('M1 — POST /applications/renewals seeds entityId or refuses', () => {
    let app;
    beforeAll(() => { app = mount('/api/applications/renewals', '../../routes/api/applications/renewals'); });

    const create = () => request(app).post('/api/applications/renewals').send({ originalCertificateId: 'cert-1' });

    beforeEach(() => {
        renewalService.createRenewalApplication.mockResolvedValue({
            applicationId: 'app-renewal-1', renewalOf: 'cert-1',
        });
    });

    it('carried an entityId from the source application → 201', async () => {
        applicationService.getApplicationSlice.mockResolvedValue({ id: 'app-renewal-1', entityId: 'ent-1' });

        const r = await create();

        expect(r.status).toBe(201);
        expect(applicationService.healDraftEntityColumns).not.toHaveBeenCalled();
    });

    it('source had none → heals from the personal entity → 201', async () => {
        applicationService.getApplicationSlice.mockResolvedValue({ id: 'app-renewal-1', entityId: null });
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue({ id: 'ent-personal' });
        applicationService.healDraftEntityColumns.mockResolvedValue({ id: 'app-renewal-1', entityId: 'ent-personal' });

        const r = await create();

        expect(r.status).toBe(201);
        expect(applicationService.healDraftEntityColumns).toHaveBeenCalledWith('app-renewal-1',
            expect.objectContaining({ entityId: 'ent-personal' }));
    });

    it('nothing to seed and nothing to heal → 400 VALIDATION_ERROR (never a draft that can never be submitted)', async () => {
        applicationService.getApplicationSlice.mockResolvedValue({ id: 'app-renewal-1', entityId: null });
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue(null);

        const r = await create();

        expect(r.status).toBe(400);
        expect(r.body.error).toBe('VALIDATION_ERROR');
    });
});
