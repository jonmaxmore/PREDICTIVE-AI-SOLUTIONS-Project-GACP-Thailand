'use strict';

/**
 * Application health reads carry the holder fragment (spec 2026-09-30 §3.1, Task 3),
 * and in R1 keep their pre-R1 filer pin beside it (operator ruling C1, Task 3 fix
 * round 1: R1 returns exactly what the pre-R1 code returned).
 *
 * Every applicant-side read method of the application service takes the
 * request's holder scope in its options bag (`{ holderScope }`). In R1 its where
 * is r1ApplicationHolderOrPin(scope, pin) = { OR: [fragment, legacy(pin)], AND: [pin] }
 * (final review C1, 2026-10-03: `fragment AND pin` narrowed whenever no entity
 * context was bound, e.g. for a user with no personal entity). Task 12 replaces
 * it with `...holderReadWhere(scope, 'Application')`. Pinned here with a prisma
 * double that records the args:
 *   - the first OR branch is the fragment, unaltered, carrying the HOLDER_SCOPED marker;
 *     the second is the pre-R1 pin, marked (registered) as the legacy branch;
 *   - no filer pin at the top level; the pre-R1 pin is the AND member, verbatim;
 *   - by-id reads are findFirst({ where: { id, OR: [fragment, pin], AND: [pin] } }), never findUnique;
 *   - deleteDraft keeps its strict filer pin AND the fragment (Task 9 replaces the pin);
 *   - no scope, or no filer for the pin, fails closed on the health-only methods
 *     (no query at all), and staff callers of the shared methods keep their where.
 *
 * The runtime witness and the pre-R1 equality are pinned on a real Postgres in
 * application-health-reads-real-postgres.test.js and
 * r1-application-reads-neutral-real-postgres.test.js.
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: { entityMembership: { findMany: jest.fn(), findFirst: jest.fn() } },
}));

const { hasHolderMarker, holderReadWhere } = require('../../services/holder-access');
const { createApplicationIdentityMethods } = require('../../services/application-service/application-identity-methods');
const { createApplicationDraftQueryMethods } = require('../../services/application-service/application-draft-query-methods');
const { createApplicationApplicantQueryMethods } = require('../../services/application-service/application-applicant-query-methods');
const { listAuditNotesForApplicant } = require('../../services/audit-notes-disclosure');

const USER = '11111111-1111-4111-8111-111111111111';
const APP = '22222222-2222-4222-8222-222222222222';
const SCOPE = Object.freeze({ userId: USER, readIds: ['entity-c', 'entity-p'], editIds: ['entity-c'] });

const FILER_PIN_KEYS = ['applicant', 'healthId', 'userId'];

function makeDouble() {
    const application = {
        findFirst: jest.fn().mockResolvedValue({ id: APP }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: APP }),
        update: jest.fn().mockResolvedValue({ id: APP }),
        count: jest.fn().mockResolvedValue(0),
    };
    return {
        application,
        farmAuditChecklistItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
}

function makeService(prisma) {
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const service = {};
    Object.assign(
        service,
        createApplicationIdentityMethods({ prisma, logger }),
        createApplicationDraftQueryMethods({ prisma, feeService: {}, sendNotification: jest.fn(), NotifyType: {}, logger }),
        createApplicationApplicantQueryMethods({ prisma }),
    );
    return service;
}

/** The where of the only call to `fn`. */
function onlyWhere(fn) {
    expect(fn).toHaveBeenCalledTimes(1);
    return fn.mock.calls[0][0].where;
}

const HEALTH = 'health-token-1';
const APPLICANT_PIN = { applicant: { id: USER, isDeleted: false } }; // buildHealthWhereClause, personal
const HEALTH_PIN = { healthId: HEALTH };
const FILER_PIN = { applicant: { id: USER } };

/** OR: [fragment, legacy pin] (both marked), and the pre-R1 pin as the AND member. */
function expectScopedWithLegacyPin(where, pin) {
    expect(Object.prototype.hasOwnProperty.call(where, 'entityId')).toBe(false);
    expect(where.OR).toHaveLength(2);
    expect(hasHolderMarker(where.OR[0])).toBe(true);
    expect(where.OR[0].entityId).toEqual({ in: SCOPE.readIds });
    expect(hasHolderMarker(where.OR[1])).toBe(true);
    expect(JSON.parse(JSON.stringify(where.OR[1]))).toEqual(pin); // string keys only (the marker is a symbol)
    for (const key of FILER_PIN_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(where, key)).toBe(false);
    }
    expect(where.AND).toEqual([pin]);
}

let prisma;
let service;
beforeEach(() => {
    prisma = makeDouble();
    service = makeService(prisma);
});

describe('list and latest-draft reads: OR [fragment, pin] + the pre-R1 pin as the AND member', () => {
    test('getHealthApplications → findMany({ where: { OR: [fragment, pin], AND: [pre-R1 where], isDeleted: false } })', async () => {
        await service.getHealthApplications(USER, { holderScope: SCOPE, take: 5 });
        const where = onlyWhere(prisma.application.findMany);
        expectScopedWithLegacyPin(where, APPLICANT_PIN);
        expect(where.isDeleted).toBe(false);
        expect(prisma.application.findMany.mock.calls[0][0].take).toBe(5);
    });

    test('getHealthUserApplications (alias) → the same scoped findMany', async () => {
        await service.getHealthUserApplications(USER, { holderScope: SCOPE });
        expectScopedWithLegacyPin(onlyWhere(prisma.application.findMany), APPLICANT_PIN);
    });

    test('getHealthApplications in a company workspace: the pre-R1 relaxed where is the legacy branch and the AND member', async () => {
        const { runWithEntityContext } = require('../../services/entity-context');
        await runWithEntityContext({ entityId: 'entity-c', role: 'MANAGER', personal: false },
            () => service.getHealthApplications(USER, { holderScope: SCOPE }));
        expectScopedWithLegacyPin(onlyWhere(prisma.application.findMany), { entityId: 'entity-c' });
    });

    test('getDraft → findFirst scoped, status DRAFT', async () => {
        await service.getDraft(USER, { holderScope: SCOPE });
        const where = onlyWhere(prisma.application.findFirst);
        expectScopedWithLegacyPin(where, APPLICANT_PIN);
        expect(where.status).toBe('DRAFT');
    });

    test('findLatestOpenDraftForHealth → the filer\'s open draft within the holders (pre-R1 healthId pin)', async () => {
        await service.findLatestOpenDraftForHealth({ holderScope: SCOPE, filerHealthId: HEALTH });
        const where = onlyWhere(prisma.application.findFirst);
        expectScopedWithLegacyPin(where, HEALTH_PIN);
        expect(where.status).toEqual({ in: ['DRAFT'] });
    });

    test('getLatestOpenDraftForApplicant → the same read', async () => {
        await service.getLatestOpenDraftForApplicant({ holderScope: SCOPE, filerHealthId: HEALTH });
        expectScopedWithLegacyPin(onlyWhere(prisma.application.findFirst), HEALTH_PIN);
    });
});

describe('by-id reads are findFirst({ where: { id, OR: [fragment, pin], AND: [pin] } }), never findUnique', () => {
    const byId = [
        ['getById', (s) => s.getById(APP, USER, { holderScope: SCOPE }), APPLICANT_PIN],
        ['findForPaymentOwnership', (s) => s.findForPaymentOwnership(APP, { holderScope: SCOPE, filerHealthId: HEALTH }), HEALTH_PIN],
        ['findOwnedApplicationForApplicant', (s) => s.findOwnedApplicationForApplicant(APP, { holderScope: SCOPE, filerUserId: USER }), FILER_PIN],
        ['findApplicationByIdForHealth', (s) => s.findApplicationByIdForHealth(APP, { holderScope: SCOPE, filerHealthId: HEALTH }), HEALTH_PIN],
    ];

    test.each(byId)('%s', async (_name, call, pin) => {
        await call(service);
        expect(prisma.application.findUnique).not.toHaveBeenCalled();
        const where = onlyWhere(prisma.application.findFirst);
        expectScopedWithLegacyPin(where, pin);
        expect(where.id).toBe(APP);
    });

    test('findForPaymentOwnership keeps its lean projection and the soft-delete filter', async () => {
        await service.findForPaymentOwnership(APP, { holderScope: SCOPE, filerHealthId: HEALTH });
        const args = prisma.application.findFirst.mock.calls[0][0];
        expect(args.select).toEqual({ id: true, status: true });
        expect(args.where.isDeleted).toBe(false);
    });

    test('the fragment is spread unaltered: its entityId value is the frozen one holderReadWhere built', async () => {
        await service.findOwnedApplicationForApplicant(APP, { holderScope: SCOPE, filerUserId: USER });
        const where = onlyWhere(prisma.application.findFirst);
        expect(Object.isFrozen(where.OR[0].entityId)).toBe(true);
        expect(where.OR[0].entityId).toEqual(holderReadWhere(SCOPE, 'Application').entityId);
    });
});

describe('deleteDraft keeps its strict filer pin AND the fragment in R1 (Task 9 replaces the pin)', () => {
    test('findFirst where = OR [fragment, strict applicant pin] + the pin as AND member + id + DRAFT', async () => {
        await service.deleteDraft(USER, APP, { holderScope: SCOPE });
        const where = onlyWhere(prisma.application.findFirst);
        expectScopedWithLegacyPin(where, APPLICANT_PIN);
        expect(where.id).toBe(APP);
        expect(where.status).toBe('DRAFT');
    });

    test('without a scope nothing is read or deleted', async () => {
        await expect(service.deleteDraft(USER, APP, {})).resolves.toBeNull();
        expect(prisma.application.findFirst).not.toHaveBeenCalled();
        expect(prisma.application.update).not.toHaveBeenCalled();
    });
});

describe('no scope: health-only reads fail closed without a query; staff callers keep their where', () => {
    test.each([
        ['getHealthApplications', (s) => s.getHealthApplications(USER, {}), []],
        ['getDraft', (s) => s.getDraft(USER, {}), null],
        ['findForPaymentOwnership', (s) => s.findForPaymentOwnership(APP, {}), null],
        ['findOwnedApplicationForApplicant', (s) => s.findOwnedApplicationForApplicant(APP), null],
        // An options object with no scope; a missing or positional argument throws
        // (applicant-draft-lookups-refuse-positional-args.test.js, final review I1).
        ['findApplicationByIdForHealth', (s) => s.findApplicationByIdForHealth(APP, {}), null],
        ['findLatestOpenDraftForHealth', (s) => s.findLatestOpenDraftForHealth({}), null],
        // A scope but no filer for the pre-R1 pin: R1 never reads without it.
        ['findForPaymentOwnership, no filer', (s) => s.findForPaymentOwnership(APP, { holderScope: SCOPE }), null],
        ['findOwnedApplicationForApplicant, no filer', (s) => s.findOwnedApplicationForApplicant(APP, { holderScope: SCOPE }), null],
        ['findApplicationByIdForHealth, no filer', (s) => s.findApplicationByIdForHealth(APP, { holderScope: SCOPE }), null],
        ['findLatestOpenDraftForHealth, no filer', (s) => s.findLatestOpenDraftForHealth({ holderScope: SCOPE }), null],
    ])('%s fails closed', async (_name, call, expected) => {
        await expect(call(service)).resolves.toEqual(expected);
        expect(prisma.application.findFirst).not.toHaveBeenCalled();
        expect(prisma.application.findMany).not.toHaveBeenCalled();
    });

    test('a filer id in the scope slot is not a scope (the old positional healthId fails closed)', async () => {
        await expect(service.findForPaymentOwnership(APP, 'some-health-id')).resolves.toBeNull();
        await expect(service.findOwnedApplicationForApplicant(APP, USER)).resolves.toBeNull();
        // findApplicationByIdForHealth refuses the positional form loudly instead (final review I1).
        await expect(service.findApplicationByIdForHealth(APP, HEALTH)).rejects.toThrow(TypeError);
        expect(prisma.application.findFirst).not.toHaveBeenCalled();
    });

    test('getById with no scope (staff) keeps where { id }', async () => {
        await service.getById(APP);
        const where = onlyWhere(prisma.application.findFirst);
        expect(where).toEqual({ id: APP });
        expect(hasHolderMarker(where)).toBe(false);
    });

    test('getApplicationSlice with no scope (staff/system) keeps findUnique({ where: { id } })', async () => {
        await service.getApplicationSlice(APP, { select: { id: true } });
        expect(prisma.application.findUnique).toHaveBeenCalledWith({ where: { id: APP }, select: { id: true } });
        expect(prisma.application.findFirst).not.toHaveBeenCalled();
    });
});

describe('audit-notes disclosure (PDPA ม.30) reads the filing through the fragment', () => {
    test('listAuditNotesForApplicant → findFirst({ where: { id, OR: [fragment, { healthId }], AND: [{ healthId }], isDeleted: false } })', async () => {
        await listAuditNotesForApplicant({ prisma, applicationId: APP, holderScope: SCOPE, healthId: HEALTH });
        const where = onlyWhere(prisma.application.findFirst);
        expectScopedWithLegacyPin(where, HEALTH_PIN);
        expect(where.id).toBe(APP);
    });

    test('without a scope it answers 404 and reads nothing', async () => {
        await expect(listAuditNotesForApplicant({ prisma, applicationId: APP })).rejects.toMatchObject({ statusCode: 404 });
        expect(prisma.application.findFirst).not.toHaveBeenCalled();
    });
});
