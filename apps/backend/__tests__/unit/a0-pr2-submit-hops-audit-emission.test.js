'use strict';

// 2026-09-05 — every POST to /api/applications/submit below now carries
// `declarationsAccepted: true`. The submit door gates on กทล.๑ ส่วนที่ ๔
// (services/application-declarations-gate.js): a filing nobody certified may not
// reach the department, and the server — not the browser — writes the timestamp.
// A real client sends this field, so these fixtures do too; sending `{}` was
// testing a request no applicant can make.

/**
 * A0-AUDIT-EMISSION / PR-A0-2 — the submit hops (#8, #9, #10, #12).
 *
 * design-decision.md §3 (row PR-A0-2): "ส่ง tx ที่ hop ซึ่งมี multi-write
 * รอบข้าง". After PR-A0-1 the writer emits the canonical transition row itself;
 * when the caller hands it a BARE client it opens a SHORT INTERNAL transaction
 * so UPDATE + audit INSERT are atomic with each other
 * (application-status-writer.js:796-816). That closes the audit hole but NOT the
 * consistency hole between a hop and the writes AROUND it: on a bare client each
 * hop commits in its own transaction, so a failure between two hops leaves the
 * pair half-applied — and the audit trail faithfully records the half.
 *
 * The two hops covered here are exactly that shape:
 *
 *   #8/#9  applications.js:654/:684 — the initial submit walks TWO legal edges
 *          (DRAFT→SUBMITTED→PENDING_DOC_FEE, WF-F5). Both used a bare client, so
 *          a failure on hop 2 left the application parked in SUBMITTED with a
 *          committed DRAFT→SUBMITTED audit row and no doc-fee leg.
 *   #12    application-bundles.js:352/:360 — the bundle row is flipped to
 *          SUBMITTED and THEN each linked application is walked in a loop. A
 *          failure part-way left a SUBMITTED bundle containing DRAFT cases.
 *
 * What this suite asserts per hop:
 *   (a) the client handed to `writeApplicationStatus` is the CALLER'S tx handle
 *       (so the default emission joins it — writer :805-815), and
 *   (b) `onAudit` is still omitted, i.e. the canonical row keeps coming from the
 *       writer's default emitter and no second emitter is introduced (guards
 *       against a double row — writer :818-821).
 *
 * NOT asserted here (by design, design-decision.md §4:147-155): that a row
 * actually reaches Postgres, and that it is atomic with the UPDATE. Those are
 * transaction semantics; a mock has none. They belong to the integration file
 * `__tests__/integration/a0-pr2-per-hop-invariant.test.js`, which self-skips
 * without DATABASE_URL.
 *
 * #10 (correction resubmit, applications.js:723) and the CAR hops already passed
 * a tx before this PR — they are PINS, not fixes, and are labelled as such.
 */

const express = require('express');
const request = require('supertest');

// ─────────────────────────────────────────────────────────────────────────────
// Shared stubs
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../middleware/auth-middleware', () => {
    const passUser = (req, _res, next) => {
        req.user = {
            id: 'user-1',
            healthId: '1100000000008',
            canonicalId: '1100000000008',
            organizationId: 'org-1',
            canonicalRole: 'health',
            role: 'HEALTH_USER',
        };
        next();
    };
    return { authenticateHealth: passUser, authenticateAny: passUser, authenticateProvider: passUser };
});

// A tx handle is recognisable by identity AND by shape: a real Prisma
// interactive-tx client exposes the model namespaces but NOT `$transaction`
// (the discriminator the writer itself uses — application-status-writer.js:328).
const TX = { __tx: 'submit-tx' };

const mockTransaction = jest.fn(async (cb) => cb(TX));
const mockWriteApplicationStatus = jest.fn().mockResolvedValue({ id: 'app-1' });
jest.mock('../../services/application-status-writer', () => {
    const actual = jest.requireActual('../../services/application-status-writer');
    return {
        writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
        // The bundle router imports the terminal set from the writer (SSOT) —
        // keep the real one so this suite never re-lists state names.
        TERMINAL_STATUSES: actual.TERMINAL_STATUSES,
    };
});

// M1 PR-C — both doors under test now run the central submit guard first.
// Its two dependencies are mocked here with their real shapes so this suite
// keeps measuring TRANSACTION structure and nothing else:
//   • the engine primitive (entity-effective-permissions-service.js:403-426)
//     resolves = "this user may act for this entity";
//   • auditLogger.log() opens its OWN transaction by design (audit-logger.js:479,
//     advisory lock at :505-506). Left real, it would run on the mocked client
//     above and inflate `mockTransaction`'s count — the very number the
//     "exactly ONE transaction" assertions are made of.
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertEntityActionPermission: jest.fn(async () => ({ allowed: true, via: 'ENTITY_PERMISSION' })),
}));
// M2a — same reasoning, one door later: the document check reads models this
// suite's prisma mock does not carry, and a 422 there would end the request
// before a single transaction opened. Stubbed to "nothing is missing"; the law
// itself is proven in m2a-doc-requirements{,-doors}.test.js.
jest.mock('../../services/application-document-requirements', () => {
    const actual = jest.requireActual('../../services/application-document-requirements');
    return {
        ...actual,
        assertRequiredDocumentsPresent: jest.fn(async () => ({ appliedRules: [] })),
    };
});
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

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        $transaction: (...a) => mockTransaction(...a),
        applicationBundle: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        application: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
    },
}));

/** every writeApplicationStatus call, in order */
function writerCalls() {
    return mockWriteApplicationStatus.mock.calls.map(([arg]) => arg);
}

/**
 * The two-part per-hop contract of PR-A0-2. Kept in one helper so a future hop
 * cannot be added with half of it.
 */
function expectDefaultEmissionInCallerTx(call, txHandle) {
    // (a) the writer runs inside the caller's transaction …
    expect(call.prisma).toBe(txHandle);
    // … which is the shape the writer treats as "somebody else's tx"
    expect(typeof call.prisma.$transaction).not.toBe('function');
    // (b) … and the canonical row still comes from the writer's DEFAULT emitter:
    // `onAudit` must be absent entirely (not null, not a function, not false).
    expect(Object.prototype.hasOwnProperty.call(call, 'onAudit')).toBe(false);
}

// ─────────────────────────────────────────────────────────────────────────────
// #8 / #9 / #10 — POST /api/applications/submit
// ─────────────────────────────────────────────────────────────────────────────

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

const mockSnapshotCorrectionSubmission = jest.fn().mockResolvedValue({ id: 'csv-1' });
jest.mock('../../services/correction-submission-version-service', () => ({
    snapshotCorrectionSubmission: (...a) => mockSnapshotCorrectionSubmission(...a),
}));

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
    sendNotification: jest.fn().mockResolvedValue({}),
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
    mergeMasterSteps: jest.fn(() => ({ 1: { plantId: 'cannabis' } })),
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
jest.mock('../../services/fee-service', () => ({}));
jest.mock('../../services/quotation-service', () => ({
    issueQuotationsForApplication: jest.fn().mockResolvedValue(undefined),
    ensurePhase1Quotations: jest.fn().mockResolvedValue(undefined),
}));

const applicationService = require('../../services/application-service');
const submitRouter = require('../../routes/api/applications/applications');
const bundlesRouter = require('../../routes/api/applications/application-bundles');
const { prisma: prismaMock } = require('../../services/prisma-database');

function mountSubmit() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', submitRouter);
    return app;
}

function mountBundles() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications/bundles', bundlesRouter);
    return app;
}

const DRAFT_ROW = {
    id: 'app-1',
    applicationNumber: 'APP-2026-100',
    status: 'DRAFT',
    healthId: '1100000000008',
    entityId: 'ent-1',
    submitterId: 'user-1',
    formData: { steps: { 1: { plantId: 'cannabis' } }, certificationPurposes: ['EXPORT'] },
    workflowHistory: [],
};

describe('PR-A0-2 #8/#9 — initial submit: BOTH hops share ONE caller transaction', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockTransaction.mockImplementation(async (cb) => cb(TX));
        mockWriteApplicationStatus.mockResolvedValue({ id: 'app-1' });
        applicationService.resolveHealthIdentity.mockResolvedValue({
            userId: 'user-1', healthId: '1100000000008',
        });
        applicationService.findDraftForSubmit.mockResolvedValue(JSON.parse(JSON.stringify(DRAFT_ROW)));
        applicationService.getApplicationSlice.mockResolvedValue({
            id: 'app-1', applicationNumber: 'APP-2026-100', status: 'PENDING_DOC_FEE',
        });
        app = mountSubmit();
    });

    const submit = () => request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

    test('hop #8 (DRAFT→SUBMITTED) runs in the caller tx with default emission', async () => {
        const res = await submit();
        expect(res.status).not.toBe(403);

        const [hop1] = writerCalls();
        expect(hop1).toMatchObject({ fromStatus: 'DRAFT', toStatus: 'SUBMITTED' });
        expectDefaultEmissionInCallerTx(hop1, TX);
    });

    test('hop #9 (SUBMITTED→PENDING_DOC_FEE) runs in the SAME caller tx with default emission', async () => {
        await submit();

        const [, hop2] = writerCalls();
        expect(hop2).toMatchObject({ fromStatus: 'SUBMITTED', toStatus: 'PENDING_DOC_FEE' });
        expectDefaultEmissionInCallerTx(hop2, TX);
    });

    test('exactly ONE transaction is opened for the pair (not one per hop)', async () => {
        await submit();

        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(writerCalls()).toHaveLength(2);
    });

    test('WF-F5 regression pin: the illegal DRAFT→PENDING_DOC_FEE edge is still never written', async () => {
        await submit();

        expect(writerCalls().some((c) => c.fromStatus === 'DRAFT' && c.toStatus === 'PENDING_DOC_FEE'))
            .toBe(false);
    });

    // ── failure path (PR-A0-2 audit round 1, F5) ────────────────────────────
    //
    // Wrapping the pair in a transaction only pays off if a rejected hop
    // actually aborts the request. What is asserted here is the caller-side
    // half: hop 2 rejecting must reach the route's catch and must NOT produce a
    // success body. The other half — that hop 1's UPDATE and its canonical row
    // are really gone — is transaction semantics and is claimed only where it
    // can be observed: `a0-pr2-work-activity-fence.test.js` (stateful fake) and
    // the Postgres integration file.

    test('hop 2 rejecting aborts the whole request — no success response', async () => {
        mockWriteApplicationStatus
            .mockResolvedValueOnce({ id: 'app-1' })                      // hop 1
            .mockRejectedValueOnce(new Error('hop 2 rejected by the writer fence')); // hop 2

        const res = await submit();

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.body.success).not.toBe(true);
        // both hops were attempted, and both were attempted in the caller tx
        expect(writerCalls()).toHaveLength(2);
        expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    test('hop 2 rejecting propagates OUT of the caller transaction (so Prisma rolls it back)', async () => {
        // The rejection must escape `prisma.$transaction`'s callback. If the
        // route swallowed it inside the callback, Prisma would COMMIT hop 1 —
        // the exact split state the wrapper exists to prevent.
        const txOutcomes = [];
        mockTransaction.mockImplementation(async (cb) => {
            try {
                const out = await cb(TX);
                txOutcomes.push('committed');
                return out;
            } catch (e) {
                txOutcomes.push('rolled-back');
                throw e;
            }
        });
        mockWriteApplicationStatus
            .mockResolvedValueOnce({ id: 'app-1' })
            .mockRejectedValueOnce(new Error('hop 2 rejected by the writer fence'));

        await submit();

        expect(txOutcomes).toEqual(['rolled-back']);
    });

    test('hop 1 rejecting never attempts hop 2', async () => {
        mockWriteApplicationStatus.mockRejectedValueOnce(new Error('hop 1 rejected'));

        const res = await submit();

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(writerCalls()).toHaveLength(1);
    });
});

describe('PR-A0-2 #10 — correction resubmit already ran in a tx (PIN, not a fix)', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockTransaction.mockImplementation(async (cb) => cb(TX));
        mockWriteApplicationStatus.mockResolvedValue({ id: 'app-1' });
        applicationService.resolveHealthIdentity.mockResolvedValue({
            userId: 'user-1', healthId: '1100000000008',
        });
        applicationService.findDraftForSubmit.mockResolvedValue({
            ...JSON.parse(JSON.stringify(DRAFT_ROW)),
            status: 'REVISION_REQUESTED',
            formData: {
                steps: { 1: { plantId: 'cannabis' } },
                certificationPurposes: ['EXPORT'],
                revisionDueAt: new Date(Date.now() + 86400000).toISOString(),
            },
        });
        applicationService.getApplicationSlice.mockResolvedValue({
            id: 'app-1', applicationNumber: 'APP-2026-100', status: 'ASSIGNED_FOR_REVIEW',
        });
        app = mountSubmit();
    });

    test('the resubmit hop and its append-only snapshot share one tx, default emission', async () => {
        await request(app).post('/api/applications/submit').send({ declarationsAccepted: true });

        const calls = writerCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            fromStatus: 'REVISION_REQUESTED',
            toStatus: 'ASSIGNED_FOR_REVIEW',
        });
        expectDefaultEmissionInCallerTx(calls[0], TX);
        // the sibling write of this hop is in the same tx (R2 M7 / D-6)
        expect(mockSnapshotCorrectionSubmission).toHaveBeenCalledWith(
            expect.objectContaining({ prisma: TX }),
        );
    });
});

describe('PR-A0-2 #12 — bundle submit: bundle flip + every linked case in ONE transaction', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockTransaction.mockImplementation(async (cb) => cb(TX));
        mockWriteApplicationStatus.mockResolvedValue({ id: 'app-1' });
        app = mountBundles();

        // M1 PR-C: the linked-app select carries `entityId` now (the bundle
        // door asks the guard about each case), so the fixture carries it too.
        prismaMock.applicationBundle.findFirst.mockResolvedValue({
            id: 'bundle-1',
            status: 'DRAFT',
            applications: [
                { id: 'app-a', status: 'DRAFT', entityId: 'ent-a' },
                { id: 'app-b', status: 'DRAFT', entityId: 'ent-b' },
            ],
        });
        TX.applicationBundle = {
            update: jest.fn(async () => ({ id: 'bundle-1', status: 'SUBMITTED', applications: [] })),
        };
        prismaMock.applicationBundle.update.mockResolvedValue({
            id: 'bundle-1', status: 'SUBMITTED', applications: [],
        });
    });

    afterEach(() => {
        delete TX.applicationBundle;
    });

    const submitBundle = () => request(app).post('/api/applications/bundles/bundle-1/submit').send({});

    test('every linked case is written through the caller tx with default emission', async () => {
        const res = await submitBundle();

        expect(res.status).toBe(200);
        const calls = writerCalls();
        expect(calls).toHaveLength(2);
        for (const call of calls) {
            expect(call.toStatus).toBe('SUBMITTED');
            expectDefaultEmissionInCallerTx(call, TX);
        }
    });

    test('the bundle status flip is in the SAME transaction as the case writes', async () => {
        await submitBundle();

        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(TX.applicationBundle.update).toHaveBeenCalledTimes(1);
        // and NOT through the bare client any more
        expect(prismaMock.applicationBundle.update).not.toHaveBeenCalled();
    });

    test('a rejected case aborts the whole bundle submit — no success response (F5)', async () => {
        mockWriteApplicationStatus
            .mockResolvedValueOnce({ id: 'app-a' })
            .mockRejectedValueOnce(new Error('case 2 rejected by the writer fence'));
        const txOutcomes = [];
        mockTransaction.mockImplementation(async (cb) => {
            try {
                const out = await cb(TX);
                txOutcomes.push('committed');
                return out;
            } catch (e) {
                txOutcomes.push('rolled-back');
                throw e;
            }
        });

        const res = await submitBundle();

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.body.success).not.toBe(true);
        // the rejection escaped the callback, so Prisma rolls the flip back too
        expect(txOutcomes).toEqual(['rolled-back']);
    });

    test('R1a regression pin: a linked TERMINAL case still blocks the whole submit, no tx opened', async () => {
        prismaMock.applicationBundle.findFirst.mockResolvedValue({
            id: 'bundle-1',
            status: 'DRAFT',
            applications: [{ id: 'app-term', status: 'REJECTED' }],
        });

        const res = await submitBundle();

        expect(res.status).toBe(409);
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
        expect(mockTransaction).not.toHaveBeenCalled();
    });
});
