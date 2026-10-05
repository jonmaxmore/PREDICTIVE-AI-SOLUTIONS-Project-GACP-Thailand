// 2026-09-05 — every POST to /api/applications/submit below now carries
// `declarationsAccepted: true`. The submit door gates on กทล.๑ ส่วนที่ ๔
// (services/application-declarations-gate.js): a filing nobody certified may not
// reach the department, and the server — not the browser — writes the timestamp.
// A real client sends this field, so these fixtures do too; sending `{}` was
// testing a request no applicant can make.
// Wave C PR-6 — POST /submit capability gate.
// VIEWER and MANAGER cannot submit; ADMIN and OWNER can.
//
// M1 PR-C (2026-08-15) — the same door now also runs the central submit guard
// (services/application-submit-guard.js). Two things changed for this suite:
//   • the role gate above is unchanged and still owns CAPABILITY_DENIED, so
//     every assertion below it stands;
//   • the "no activeEntity → no gate" case is FLIPPED (plan D7): an application
//     row that names no entity is now 400 VALIDATION_ERROR, because the gate
//     was opt-out by omission — a caller that simply sent no active-entity
//     header skipped it.
// The engine primitive and the audit writer are therefore dependencies of this
// route now and are mocked with their REAL shapes (plan D5, review M1).
//
// M1.5 H4 (2026-08-15) — the first bullet above is SUPERSEDED by spec
// design note 2026-08-15-m1.5-hardening-design §H4: the role gate
// is deleted and CAPABILITY_DENIED is gone from this route. The refusal for a
// VIEWER/MANAGER without a grant keeps its meaning but now comes from the
// effective-permission engine (role defaults ∪ GRANT − REVOKE) as
// ENTITY_PERMISSION_DENIED, so a MANAGER who DOES hold a grant can submit even
// when the client sends x-active-entity — the case the old gate killed.

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

jest.mock('../../services/prisma-database', () => {
    // R2 M7: the /submit resubmit branch wraps its formData write + append-only
    // snapshot in prisma.$transaction. No correction round is seeded here
    // (findFirst → null) so the snapshot is a no-op for these capability-gate
    // cases; the $transaction passthrough runs the callback with this same mock.
    const prisma = {
        correctionRound: { findFirst: jest.fn(async () => null) },
        correctionSubmissionVersion: { create: jest.fn(async (a) => ({ id: 'csv', ...a.data })) },
    };
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    return { prisma };
});

// M2a — /submit now asks the document law after the capability question. It
// reads entity / requirementRule / applicationDocument, none of which exist on
// the prisma mock above, and its 422 would land before the writes these tests
// measure. Stubbed to "nothing is missing" so this suite keeps measuring
// CAPABILITY; the law is proven in m2a-doc-requirements{,-doors}.test.js.
jest.mock('../../services/application-document-requirements', () => {
    const actual = jest.requireActual('../../services/application-document-requirements');
    return {
        ...actual,
        assertRequiredDocumentsPresent: jest.fn(async () => ({ appliedRules: [] })),
    };
});

// M1 PR-C — the engine primitive the guard delegates to. Shape mirrors
// entity-effective-permissions-service.js:403-426 exactly: resolves on allow,
// rejects with { status: 403, code: 'ENTITY_PERMISSION_DENIED' } on deny.
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertEntityActionPermission: jest.fn(),
}));

// M1 PR-C — the guard writes its rejection rows through auditLogger.log()
// (own transaction, own advisory lock — plan D10). Keep every real constant so
// consent-manager (which shares this module) still resolves AuditCategory.
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
    // Tier 18: receipt-numbering-service uses { createLogger } destructure
    // so the mock must expose createLogger as a factory.
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
    mergeMasterSteps: jest.fn(() => ({ '1': { plantId: 'cannabis' } })),
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
jest.mock('../../services/storage-service', () => ({
    createUploader: jest.fn(() => ({ single: jest.fn(() => (_req, _res, next) => next()) })),
}));
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(),
}));
jest.mock('../../services/fee-service', () => ({}));

const applicationService = require('../../services/application-service');
const { assertEntityActionPermission } = require('../../services/entity-effective-permissions-service');
const { auditLogger } = require('../../middleware/audit-logger');
const router = require('../../routes/api/applications/applications');

/** The engine's canonical refusal — reused verbatim, never re-invented (D5). */
function engineDenial() {
    return Object.assign(new Error('denied'), { status: 403, code: 'ENTITY_PERMISSION_DENIED' });
}

/** every auditLogger.log() envelope, in order */
function auditCalls() {
    return auditLogger.log.mock.calls.map(([arg]) => arg);
}

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', router);
    return app;
}

describe('Wave C PR-6 — POST /submit capability gate', () => {
    let app;
    beforeAll(() => { app = makeApp(); });

    beforeEach(() => {
        jest.clearAllMocks();
        globalThis.__testActiveEntity = null;
        // M1: the engine allows by default here so the ROLE gate stays the
        // subject of the four cases below; the guard's own cases override it.
        assertEntityActionPermission.mockResolvedValue({ allowed: true, via: 'ENTITY_PERMISSION' });
        applicationService.resolveHealthIdentity.mockResolvedValue({
            userId: 'user-1', healthId: '1100000000008',
        });
        applicationService.findDraftForSubmit.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'APP-2026-100',
            status: 'DRAFT',
            healthId: '1100000000008',
            entityId: 'ent-juristic',
            submitterId: 'user-1',
            formData: { steps: { '1': { plantId: 'cannabis' } }, certificationPurposes: ['EXPORT'] },
            workflowHistory: [],
        });
        applicationService.getApplicationSlice.mockResolvedValue({
            id: 'app-1', applicationNumber: 'APP-2026-100', status: 'PENDING_DOC_FEE',
        });
    });

    // FLIPPED by M1.5 H4 (spec §H4, AC1). Both cases used to assert the ROLE
    // gate's own answer (403 CAPABILITY_DENIED, echoing capability + role off
    // the x-active-entity header). That gate is deleted; the outcome for a
    // VIEWER/MANAGER without a grant is unchanged — still 403 — but it is the
    // engine that refuses, so the code is the engine's ENTITY_PERMISSION_DENIED.
    it('VIEWER without a grant → 403 ENTITY_PERMISSION_DENIED (the engine refuses)', async () => {
        globalThis.__testActiveEntity = { entityId: 'ent-juristic', role: 'VIEWER' };
        assertEntityActionPermission.mockRejectedValue(engineDenial());
        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });
        expect(r.status).toBe(403);
        expect(r.body).toMatchObject({ success: false, code: 'ENTITY_PERMISSION_DENIED' });
        expect(require('../../services/application-status-writer').writeApplicationStatus)
            .not.toHaveBeenCalled();
    });

    it('MANAGER without a grant → 403 ENTITY_PERMISSION_DENIED (the engine refuses)', async () => {
        globalThis.__testActiveEntity = { entityId: 'ent-juristic', role: 'MANAGER' };
        assertEntityActionPermission.mockRejectedValue(engineDenial());
        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('ENTITY_PERMISSION_DENIED');
    });

    // AC2 of spec §H4 — the case that is broken on the real web client today:
    // a MANAGER who holds an explicit SUBMIT_APPLICATION grant, submitting with
    // the x-active-entity header the FE always sends. The role gate answered
    // 403 before the engine was ever asked. This case is the mutation detector
    // for that gate: put it back and this goes red.
    it('MANAGER holding a GRANT, with the active-entity header sent → 200', async () => {
        globalThis.__testActiveEntity = { entityId: 'ent-juristic', role: 'MANAGER' };
        assertEntityActionPermission.mockResolvedValue({ allowed: true, via: 'GRANT' });

        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        expect(r.status).toBe(200);
        expect(assertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-juristic', userId: 'user-1', permission: 'SUBMIT_APPLICATION',
        }));
    });

    it('ADMIN can submit', async () => {
        globalThis.__testActiveEntity = { entityId: 'ent-juristic', role: 'ADMIN' };
        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });
        // 200 / 201 / similar — anything other than 403 is enough for the gate test.
        expect(r.status).not.toBe(403);
    });

    it('OWNER can submit', async () => {
        globalThis.__testActiveEntity = { entityId: 'ent-juristic', role: 'OWNER' };
        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });
        expect(r.status).not.toBe(403);
    });

    // FLIPPED by M1 PR-C (plan D7). This case used to read "no activeEntity →
    // no gate (legacy / picker-less clients)" and asserted the submit went
    // through: the gate only ran when the CALLER chose to send an
    // active-entity header, so omitting the header was a supported way past
    // it. The application row itself decides now — and a row that names no
    // entity has no legal submitter to check against.
    it('no entityId on the application row (and nothing to heal from) → 400 VALIDATION_ERROR', async () => {
        globalThis.__testActiveEntity = null;
        applicationService.findDraftForSubmit.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'APP-2026-100',
            status: 'DRAFT',
            healthId: '1100000000008',
            entityId: null,
            submitterId: 'user-1',
            formData: { steps: { '1': { plantId: 'cannabis' } }, certificationPurposes: ['EXPORT'] },
            workflowHistory: [],
        });
        // nothing to lazy-heal from (no personal entity for this user)
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue(null);

        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        expect(r.status).toBe(400);
        expect(r.body.code).toBe('VALIDATION_ERROR');
        // nothing was written
        expect(require('../../services/application-status-writer').writeApplicationStatus)
            .not.toHaveBeenCalled();
        // and the refusal is on the record, naming no entity (plan D9/D10)
        expect(auditCalls()).toContainEqual(expect.objectContaining({
            result: 'FAILURE',
            actorId: 'user-1',
            metadata: expect.objectContaining({ onBehalfOfEntityId: null }),
        }));
    });

    // M2 from the senior-swe review: /submit uses findDraftForSubmit, which does
    // NOT lazy-heal (heal lives on /draft and /prepare only). Without healing
    // here, a pre-Phase-66 row whose owner never re-opened the wizard would be
    // hard-400 forever.
    it('heals a null entityId from the personal entity, then submits in its name', async () => {
        globalThis.__testActiveEntity = null;
        applicationService.findDraftForSubmit.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'APP-2026-100',
            status: 'DRAFT',
            healthId: '1100000000008',
            entityId: null,
            submitterId: null,
            formData: { steps: { '1': { plantId: 'cannabis' } }, certificationPurposes: ['EXPORT'] },
            workflowHistory: [],
        });
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue({ id: 'ent-personal' });
        applicationService.healDraftEntityColumns.mockResolvedValue({
            id: 'app-1', entityId: 'ent-personal', submitterId: 'user-1',
        });

        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        expect(r.status).not.toBe(400);
        expect(r.status).not.toBe(403);
        expect(applicationService.healDraftEntityColumns).toHaveBeenCalledWith('app-1',
            expect.objectContaining({ entityId: 'ent-personal', submitterId: 'user-1' }));
        // the healed entity is the one the permission question is asked about
        expect(assertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-personal', userId: 'user-1', permission: 'SUBMIT_APPLICATION',
        }));
    });

    it('asks the engine about the APPLICATION row entity, not the x-active-entity header', async () => {
        // Header says "acting as ent-header"; the draft belongs to ent-juristic.
        globalThis.__testActiveEntity = { entityId: 'ent-header', role: 'OWNER' };

        await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        expect(assertEntityActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            entityId: 'ent-juristic', userId: 'user-1', permission: 'SUBMIT_APPLICATION',
        }));
    });

    it('engine denial → 403 ENTITY_PERMISSION_DENIED + audit FAILURE naming the entity', async () => {
        globalThis.__testActiveEntity = null;
        assertEntityActionPermission.mockRejectedValue(engineDenial());

        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        expect(r.status).toBe(403);
        expect(r.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(require('../../services/application-status-writer').writeApplicationStatus)
            .not.toHaveBeenCalled();
        expect(auditCalls()).toContainEqual(expect.objectContaining({
            result: 'FAILURE',
            metadata: expect.objectContaining({ onBehalfOfEntityId: 'ent-juristic' }),
        }));
    });

    // AC3 — a successful submit records in whose name it was made.
    it('successful submit writes a SUCCESS audit row carrying onBehalfOfEntityId', async () => {
        globalThis.__testActiveEntity = null;

        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        expect(r.status).not.toBe(403);
        expect(auditCalls()).toContainEqual(expect.objectContaining({
            result: 'SUCCESS',
            actorId: 'user-1',
            metadata: expect.objectContaining({ onBehalfOfEntityId: 'ent-juristic' }),
        }));
    });
});

// M1 PR-C — the create side of the same rule (plan Task C2 Step 2). A draft
// that is born without an entity is a draft that can never be submitted; the
// wizard would only discover it at the very end. Refuse at creation instead.
describe('M1 — POST /draft refuses to create a draft that names no entity', () => {
    let app;
    beforeAll(() => { app = makeApp(); });

    beforeEach(() => {
        jest.clearAllMocks();
        globalThis.__testActiveEntity = null;
        applicationService.resolveHealthIdentity.mockResolvedValue({
            userId: 'user-1', healthId: '1100000000008',
        });
        applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue(null);
    });

    it('no active entity and no personal entity → 400 APPLICANT_ENTITY_MISSING, no row created', async () => {
        // W4 2026-08-22 — the code used to be a bare VALIDATION_ERROR. That is
        // the response every wizard document upload returned for a whole class
        // of accounts, and it named neither the cause (this account has no
        // legal applicant) nor the fix, on a request where nothing the client
        // sent was actually invalid. The refusal itself is UNCHANGED — still
        // 400, still no row created; only the code now says what happened.
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue(null);

        const r = await request(app).post('/api/applications/draft').send({ step: 1 });

        expect(r.status).toBe(400);
        expect(r.body.code).toBe('APPLICANT_ENTITY_MISSING');
        expect(r.body.messageTh).toContain('ผู้ยื่นตามกฎหมาย');
        expect(applicationService.createDraftForHealth).not.toHaveBeenCalled();
    });

    it('a personal entity exists → the draft is created in its name (unchanged path)', async () => {
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue({ id: 'ent-personal' });
        applicationService.createDraftForHealth.mockResolvedValue({
            id: 'app-new', applicationNumber: 'APP-2026-101', status: 'DRAFT',
            entityId: 'ent-personal', formData: { steps: {} }, workflowHistory: [],
        });
        applicationService.updateApplicantDraftColumns.mockResolvedValue({
            id: 'app-new', applicationNumber: 'APP-2026-101', status: 'DRAFT', formData: { steps: {} },
        });

        const r = await request(app).post('/api/applications/draft').send({ step: 1 });

        expect(r.status).toBe(200);
        expect(applicationService.createDraftForHealth).toHaveBeenCalledWith(
            expect.objectContaining({ entityId: 'ent-personal' }),
        );
    });
});

describe('WF-F5 — initial submit walks DRAFT → SUBMITTED → PENDING_DOC_FEE (no illegal edge skip)', () => {
    const { writeApplicationStatus } = require('../../services/application-status-writer');
    let app;
    beforeAll(() => { app = makeApp(); });

    beforeEach(() => {
        jest.clearAllMocks();
        globalThis.__testActiveEntity = null;
        // jest.clearAllMocks() clears CALLS, not implementations — the guard
        // cases above leave a rejection behind, so restate the default.
        assertEntityActionPermission.mockResolvedValue({ allowed: true, via: 'ENTITY_PERMISSION' });
        applicationService.resolveHealthIdentity.mockResolvedValue({
            userId: 'user-1', healthId: '1100000000008',
        });
        applicationService.findDraftForSubmit.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'APP-2026-100',
            status: 'DRAFT',
            healthId: '1100000000008',
            entityId: 'ent-juristic',
            submitterId: 'user-1',
            formData: { steps: { '1': { plantId: 'cannabis' } }, certificationPurposes: ['EXPORT'] },
            workflowHistory: [],
        });
        applicationService.getApplicationSlice.mockResolvedValue({
            id: 'app-1', applicationNumber: 'APP-2026-100', status: 'PENDING_DOC_FEE',
        });
    });

    it('writes the two legal hops in order (never the illegal DRAFT->PENDING_DOC_FEE)', async () => {
        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });
        expect(r.status).not.toBe(403);

        // Both writer calls happen, in canonical order.
        expect(writeApplicationStatus).toHaveBeenCalledTimes(2);
        const [hop1] = writeApplicationStatus.mock.calls[0];
        const [hop2] = writeApplicationStatus.mock.calls[1];

        expect(hop1).toMatchObject({ fromStatus: 'DRAFT', toStatus: 'SUBMITTED' });
        expect(hop2).toMatchObject({ fromStatus: 'SUBMITTED', toStatus: 'PENDING_DOC_FEE' });

        // The illegal direct edge must never be written.
        const wroteIllegalEdge = writeApplicationStatus.mock.calls.some(
            ([arg]) => arg.fromStatus === 'DRAFT' && arg.toStatus === 'PENDING_DOC_FEE',
        );
        expect(wroteIllegalEdge).toBe(false);
    });

    it('the legacy REGISTERED source state is no longer a submit path (PR 2c)', async () => {
        // REGISTERED was a second spelling of DRAFT-that-has-been-submitted,
        // handled by its own branch in the resubmit config. Nothing writes it
        // (PR 2b) and no row holds it, so the branch was removed rather than
        // kept as an unreachable duplicate of the DRAFT path above.
        applicationService.findDraftForSubmit.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'APP-2026-100',
            status: 'REGISTERED',
            healthId: '1100000000008',
            entityId: 'ent-juristic',
            submitterId: 'user-1',
            formData: { steps: { '1': { plantId: 'cannabis' } }, certificationPurposes: ['EXPORT'] },
            workflowHistory: [],
        });
        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });
        expect(r.status).not.toBe(403);
        // No transition is attempted for an unrecognised source state.
        expect(writeApplicationStatus).not.toHaveBeenCalled();
    });

    it('resubmit from REVISION_REQUESTED stays a single direct transition (not affected by WF-F5)', async () => {
        applicationService.findDraftForSubmit.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'APP-2026-100',
            status: 'REVISION_REQUESTED',
            healthId: '1100000000008',
            entityId: 'ent-juristic',
            submitterId: 'user-1',
            formData: { steps: { '1': { plantId: 'cannabis' } }, certificationPurposes: ['EXPORT'] },
            workflowHistory: [],
        });
        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });
        expect(r.status).not.toBe(403);
        expect(writeApplicationStatus).toHaveBeenCalledTimes(1);
        expect(writeApplicationStatus.mock.calls[0][0]).toMatchObject({
            fromStatus: 'REVISION_REQUESTED',
            toStatus: 'ASSIGNED_FOR_REVIEW',
        });
    });
});

// Bug 6.5 — the primary /submit RESUBMIT path must enforce the 5-working-day
// revision deadline (previously only submitRevision did, so overdue applicants
// slipped past through the front door).
describe('Bug 6.5 — /submit RESUBMIT enforces the revision deadline', () => {
    const { writeApplicationStatus } = require('../../services/application-status-writer');
    let app;
    beforeAll(() => { app = makeApp(); });

    beforeEach(() => {
        jest.clearAllMocks();
        globalThis.__testActiveEntity = null;
        assertEntityActionPermission.mockResolvedValue({ allowed: true, via: 'ENTITY_PERMISSION' });
        applicationService.resolveHealthIdentity.mockResolvedValue({
            userId: 'user-1', healthId: '1100000000008',
        });
        applicationService.getApplicationSlice.mockResolvedValue({
            id: 'app-1', applicationNumber: 'APP-2026-100', status: 'ASSIGNED_FOR_REVIEW',
        });
    });

    it('OVERDUE REVISION_REQUESTED resubmit → 400 REVISION_DEADLINE_EXCEEDED (no resubmit write)', async () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        applicationService.findDraftForSubmit.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'APP-2026-100',
            status: 'REVISION_REQUESTED',
            healthId: '1100000000008',
            entityId: 'ent-juristic',
            submitterId: 'user-1',
            formData: { steps: { '1': { plantId: 'cannabis' } }, revisionDueAt: yesterday },
            workflowHistory: [],
        });

        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        expect(r.status).toBe(400);
        expect(r.body).toMatchObject({ success: false, code: 'REVISION_DEADLINE_EXCEEDED' });
        // The only writer call was the EXPIRE transition; the resubmit transition
        // (→ ASSIGNED_FOR_REVIEW) must NOT have run.
        const wroteResubmit = writeApplicationStatus.mock.calls.some(
            ([arg]) => arg.toStatus === 'ASSIGNED_FOR_REVIEW',
        );
        expect(wroteResubmit).toBe(false);
        const wroteExpire = writeApplicationStatus.mock.calls.some(
            ([arg]) => arg.toStatus === 'EXPIRED',
        );
        expect(wroteExpire).toBe(true);
    });

    it('WITHIN-deadline REVISION_REQUESTED resubmit → allowed (advances to ASSIGNED_FOR_REVIEW)', async () => {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        applicationService.findDraftForSubmit.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'APP-2026-100',
            status: 'REVISION_REQUESTED',
            healthId: '1100000000008',
            entityId: 'ent-juristic',
            submitterId: 'user-1',
            formData: { steps: { '1': { plantId: 'cannabis' } }, certificationPurposes: ['EXPORT'], revisionDueAt: tomorrow },
            workflowHistory: [],
        });

        const r = await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        expect(r.status).not.toBe(400);
        expect(r.status).not.toBe(403);
        expect(writeApplicationStatus).toHaveBeenCalledTimes(1);
        expect(writeApplicationStatus.mock.calls[0][0]).toMatchObject({
            fromStatus: 'REVISION_REQUESTED',
            toStatus: 'ASSIGNED_FOR_REVIEW',
        });
    });
});
