'use strict';

/**
 * M2a audit F2 — who holds the pen over `Application.formData` on a revision
 * resubmit.
 *
 * submitRevision merged the applicant's request body straight over the stored
 * blob. formData is ONE column written by two parties (shared/form-data-ownership.js
 * :1-27), so that spread handed the applicant every server-owned key in it —
 * including `serverRequirementSnapshot`, the record of WHICH document law judged
 * this filing. An applicant who can write that key chooses the law that judges
 * them: send `{ slotIds: [] }` once and every later resubmit demands nothing.
 *
 * This suite drives the real service method against a mocked prisma (pattern:
 * application-review-revision-methods.test.js:69-113) and reads back exactly what
 * would be persisted — `writeApplicationStatus`'s `additionalData.formData`,
 * which is the blob the writer puts in the column.
 *
 * Two directions are pinned here, and they are not the same claim:
 *   • CLIENT → the applicant's keys merge; server-owned keys are stripped and the
 *     stored value survives untouched (applyClientFormData).
 *   • SERVER → a door that legitimately has something to record (the first-submit
 *     stamp, PUT /:id/revision on a DRAFT) passes it as `serverFormDataPatch`,
 *     a parameter no request body can reach.
 */

const {
    createApplicationReviewRevisionMethods,
} = require('../../services/application-service/application-review-revision-methods');
const { writeApplicationStatus } = require('../../services/application-status-writer');

jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(),
}));
jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: jest.fn(async () => null),
}));
jest.mock('../../services/audit-trail', () => ({
    logAction: jest.fn(),
    ACTIONS: { APPROVE: 'APPROVE', REJECT: 'REJECT' },
    ENTITIES: { APPLICATION: 'APPLICATION' },
    SEVERITY: { INFO: 'INFO', WARNING: 'WARNING' },
}));
// F-REVISION-DOOR-NO-QUOTATION fix (task-3) — the DRAFT leg now requires
// quotation-service (fire-and-forget issuance once PENDING_DOC_FEE is
// reached); this suite is about formData ownership, not billing, so stub it.
jest.mock('../../services/quotation-service', () => ({
    issueQuotationsForApplication: jest.fn().mockResolvedValue(undefined),
}));
// MAJOR-2 fix (Ruling 7, task-3 fix round 1) — the DRAFT leg now runs the
// shared wizard-completeness gate before hop 1. This suite's DRAFT fixture
// (`revisionRow`) is intentionally minimal and would fail the REAL Zod
// validators for reasons unrelated to formData ownership (missing plots/
// production/harvest/documents) — stub the gate to "complete" so this file
// keeps testing exactly what it says it tests. The gate itself is proven
// against real validators in canonical-application-validator.test.js and
// the new 422 test in application-review-revision-methods.test.js.
jest.mock('../../validation/application-submission-validator', () => ({
    validateSubmissionPayload: jest.fn().mockReturnValue({ isValid: true }),
}));

const ACTOR = { userId: 'u-1', healthId: 'h-1', actorIdentity: 'u-1', actorRole: 'HEALTH' };
const FUTURE_DUE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

/** the stamp the SERVER wrote at first submit */
const STORED_STAMP = Object.freeze({
    stampedAt: '2026-08-01T00:00:00.000Z',
    ruleIds: ['m2a-seed-juristic-company-reg'],
    slotIds: ['company_reg'],
});

/** what an applicant would send to be judged by no law at all */
const FORGED_STAMP = Object.freeze({
    stampedAt: '1999-01-01T00:00:00.000Z',
    ruleIds: [],
    slotIds: [],
});

/** what a first-submit door would legitimately record */
const FRESH_STAMP = Object.freeze({
    stampedAt: '2026-08-15T00:00:00.000Z',
    ruleIds: ['rule-fresh'],
    slotIds: ['company_reg'],
});

beforeEach(() => {
    writeApplicationStatus.mockReset();
});

function buildMock(application) {
    const captured = {};
    writeApplicationStatus.mockImplementation(async (args) => {
        captured.writerArgs = args;
        return { ...application, status: args.toStatus };
    });
    const prisma = {
        application: {
            findFirst: jest.fn(async () => application),
            findUnique: jest.fn(async () => ({ ...application })),
        },
        revisionDeadline: {
            findUnique: jest.fn(async () => null),
            updateMany: jest.fn(async () => ({ count: 1 })),
        },
        user: { findMany: jest.fn(async () => []) },
        // No correction round is seeded, so the append-only snapshot is a no-op
        // here (same as application-review-revision-methods.test.js:96-99).
        correctionRound: { findFirst: jest.fn(async () => null) },
        correctionSubmissionVersion: {
            create: jest.fn(async (args) => ({ id: 'csv-mock', ...args.data })),
        },
    };
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    return { captured, prisma };
}

function methodsFor(prisma) {
    return createApplicationReviewRevisionMethods({
        prisma,
        sendNotification: jest.fn(),
        NotifyType: { NEW_APPLICATION: 'NEW_APPLICATION' },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
}

function persistedFormData(captured) {
    return captured.writerArgs.additionalData.formData;
}

function revisionRow(formData) {
    return {
        id: 'app-1',
        applicationNumber: 'GACP-2026-0001',
        status: 'REVISION_REQUESTED',
        healthId: 'h-1',
        formData: {
            applicantData: { fullName: 'สมชาย' },
            farmData: { farmName: 'ไร่เดิม' },
            revisionDueAt: FUTURE_DUE,
            ...formData,
        },
        workflowHistory: [],
    };
}

describe('submitRevision — the applicant may not write server-owned keys (F2)', () => {
    it('a forged serverRequirementSnapshot in the request body does not reach the column — the stored stamp survives', async () => {
        const app = revisionRow({ serverRequirementSnapshot: STORED_STAMP });
        const mock = buildMock(app);

        const res = await methodsFor(mock.prisma).submitRevision(
            'app-1',
            { formData: { serverRequirementSnapshot: FORGED_STAMP, farmData: { farmName: 'ไร่ใหม่' } }, notes: 'fixed' },
            ACTOR,
        );

        expect(res.status).toBe(200);
        const written = persistedFormData(mock.captured);
        expect(written.serverRequirementSnapshot).toEqual(STORED_STAMP);
        expect(written.serverRequirementSnapshot).not.toEqual(FORGED_STAMP);
        // the applicant's own answer in the same body still lands
        expect(written.farmData).toEqual({ farmName: 'ไร่ใหม่' });
    });

    it('an application with NO stamp does not acquire one from the request body', async () => {
        const app = revisionRow({});
        const mock = buildMock(app);

        await methodsFor(mock.prisma).submitRevision(
            'app-1',
            { formData: { serverRequirementSnapshot: FORGED_STAMP }, notes: 'n' },
            ACTOR,
        );

        expect(persistedFormData(mock.captured).serverRequirementSnapshot).toBeUndefined();
    });

    it('the other server-owned keys are refused by the same one rule, not by a list of special cases', async () => {
        const app = revisionRow({ auditResult: 'FAIL' });
        const mock = buildMock(app);

        await methodsFor(mock.prisma).submitRevision(
            'app-1',
            {
                formData: {
                    auditResult: 'PASS',
                    auditedAt: '2026-08-15T00:00:00.000Z',
                    uploadedDocuments: [{ filePath: '/etc/passwd' }],
                },
                notes: 'n',
            },
            ACTOR,
        );

        const written = persistedFormData(mock.captured);
        // certificate-service reads auditResult + auditedAt as proof of a passing
        // audit (form-data-ownership.js:41-43) — the stored FAIL stands.
        expect(written.auditResult).toBe('FAIL');
        expect(written.auditedAt).toBeUndefined();
        // filePath from here reaches fs.unlink() (form-data-ownership.js:61-63)
        expect(written.uploadedDocuments).toBeUndefined();
    });

    // PIN (green before the fix too): the merge must not become a replacement.
    // applyClientFormData alone drops applicant keys the client did not resend.
    it('applicant answers already stored survive a partial resubmit', async () => {
        const app = revisionRow({ serverRequirementSnapshot: STORED_STAMP });
        const mock = buildMock(app);

        await methodsFor(mock.prisma).submitRevision(
            'app-1',
            { formData: { farmData: { farmName: 'ไร่ใหม่' } }, notes: 'n' },
            ACTOR,
        );

        const written = persistedFormData(mock.captured);
        expect(written.applicantData).toEqual({ fullName: 'สมชาย' });
        expect(written.farmData).toEqual({ farmName: 'ไร่ใหม่' });
    });
});

describe('submitRevision — a door may record server truth through serverFormDataPatch', () => {
    it('the patch is persisted (this is how the fifth door stamps a DRAFT first submit)', async () => {
        const app = { ...revisionRow({}), status: 'DRAFT' };
        const mock = buildMock(app);

        const res = await methodsFor(mock.prisma).submitRevision(
            'app-1',
            { formData: { farmData: { farmName: 'ไร่ใหม่' } }, notes: 'first' },
            ACTOR,
            { serverFormDataPatch: { serverRequirementSnapshot: FRESH_STAMP } },
        );

        expect(res.status).toBe(200);
        const written = persistedFormData(mock.captured);
        expect(written.serverRequirementSnapshot).toEqual(FRESH_STAMP);
        expect(written.farmData).toEqual({ farmName: 'ไร่ใหม่' });
        // F-REVISION-DOOR-NO-QUOTATION fix (task-3): the DRAFT leg now lands at
        // PENDING_DOC_FEE (via the two SSOT-legal hops), not bare SUBMITTED —
        // `mock.captured.writerArgs` holds the LAST writeApplicationStatus call
        // (buildMock overwrites on every call), i.e. hop 2.
        expect(mock.captured.writerArgs.toStatus).toBe('PENDING_DOC_FEE');
        expect(mock.captured.writerArgs.fromStatus).toBe('SUBMITTED');
    });

    it('the patch outranks a forged key sent in the same request', async () => {
        const app = { ...revisionRow({}), status: 'DRAFT' };
        const mock = buildMock(app);

        await methodsFor(mock.prisma).submitRevision(
            'app-1',
            { formData: { serverRequirementSnapshot: FORGED_STAMP }, notes: 'first' },
            ACTOR,
            { serverFormDataPatch: { serverRequirementSnapshot: FRESH_STAMP } },
        );

        expect(persistedFormData(mock.captured).serverRequirementSnapshot).toEqual(FRESH_STAMP);
    });

    it('the patch cannot rewrite the lifecycle keys the method owns itself', async () => {
        const app = revisionRow({ serverRequirementSnapshot: STORED_STAMP });
        const mock = buildMock(app);

        await methodsFor(mock.prisma).submitRevision(
            'app-1',
            { formData: {}, notes: 'n' },
            ACTOR,
            { serverFormDataPatch: { workflowState: 'APPROVED' } },
        );

        // H1 (audit 2.9 follow-up): the resubmit target is the one truth here
        expect(persistedFormData(mock.captured).workflowState).toBe('ASSIGNED_FOR_REVIEW');
    });

    // PIN: every existing caller passes three arguments.
    it('omitting the fourth argument changes nothing', async () => {
        const app = revisionRow({ serverRequirementSnapshot: STORED_STAMP });
        const mock = buildMock(app);

        const res = await methodsFor(mock.prisma).submitRevision('app-1', { formData: {}, notes: 'n' }, ACTOR);

        expect(res.status).toBe(200);
        expect(persistedFormData(mock.captured).serverRequirementSnapshot).toEqual(STORED_STAMP);
    });
});
