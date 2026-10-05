'use strict';

/**
 * Application health reads carry the holder fragment (spec 2026-09-30 §3.1, Task 3)
 * and, since R2 Task 12, the fragment alone: the R1 filer pins
 * (r1ApplicationHolderOrPin = { OR: [fragment, legacy(pin)], AND: [pin] }) are gone.
 *
 * Every applicant-side read method of the application service takes the
 * request's holder scope in its options bag (`{ holderScope }`). Pinned here with
 * a prisma double that records the args:
 *   - the fragment is spread at the top level, unaltered, carrying the HOLDER_SCOPED
 *     marker; no OR legacy branch, no AND pin, no filer key;
 *   - by-id reads are findFirst({ where: { id, ...fragment } }), never findUnique;
 *   - the resume read adds the caller's own draft on a holder it edits as the AND member;
 *   - no scope fails closed on the health-only methods (no query at all), and staff
 *     callers of the shared methods keep their where.
 *
 * The runtime witness is pinned on a real Postgres in
 * application-health-reads-real-postgres.test.js and holder-scope-real-postgres.test.js.
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

let prisma;
let service;
beforeEach(() => {
    prisma = makeDouble();
    service = makeService(prisma);
});

/** R2 Task 9: the fragment alone, spread at the top level; no filer pin anywhere. */
function expectFragmentOnly(where) {
    expect(hasHolderMarker(where)).toBe(true);
    expect(where.entityId).toEqual({ in: SCOPE.readIds });
    expect(where.OR).toBeUndefined();
    expect(where.AND).toBeUndefined();
    for (const key of FILER_PIN_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(where, key)).toBe(false);
    }
}

describe('R2 Task 9: list and draft reads carry the fragment alone (buildHealthWhereClause deleted)', () => {
    test('buildHealthWhereClause and its alias are gone from the service', () => {
        expect(service.buildHealthWhereClause).toBeUndefined();
        expect(service.buildHEALTH_USERWhereClause).toBeUndefined();
    });

    test('getHealthApplications → findMany({ where: { ...fragment, isDeleted: false } })', async () => {
        await service.getHealthApplications(USER, { holderScope: SCOPE, take: 5 });
        const where = onlyWhere(prisma.application.findMany);
        expectFragmentOnly(where);
        expect(where.isDeleted).toBe(false);
        expect(prisma.application.findMany.mock.calls[0][0].take).toBe(5);
    });

    test('getHealthUserApplications (alias) → the same scoped findMany', async () => {
        await service.getHealthUserApplications(USER, { holderScope: SCOPE });
        expectFragmentOnly(onlyWhere(prisma.application.findMany));
    });

    test('getDraft → findFirst scoped, status DRAFT', async () => {
        await service.getDraft(USER, { holderScope: SCOPE });
        const where = onlyWhere(prisma.application.findFirst);
        expectFragmentOnly(where);
        expect(where.status).toBe('DRAFT');
    });
});

describe('R2 Task 12: the latest-draft read is the fragment plus the caller\'s own draft on a holder it edits', () => {
    const RESUME = { holderScope: SCOPE, submitterId: USER, editIds: SCOPE.editIds };
    function expectResumeWhere(where) {
        expect(hasHolderMarker(where)).toBe(true);
        expect(where.entityId).toEqual({ in: SCOPE.readIds });
        expect(where.OR).toBeUndefined();
        for (const key of FILER_PIN_KEYS) {
            expect(Object.prototype.hasOwnProperty.call(where, key)).toBe(false);
        }
        expect(where.AND).toEqual([{ submitterId: USER, entityId: { in: SCOPE.editIds } }]);
    }

    test('findLatestOpenDraftForHealth → the caller\'s own open draft on a holder it edits', async () => {
        await service.findLatestOpenDraftForHealth(RESUME);
        const where = onlyWhere(prisma.application.findFirst);
        expectResumeWhere(where);
        expect(where.status).toEqual({ in: ['DRAFT'] });
    });

    test('getLatestOpenDraftForApplicant → the same read', async () => {
        await service.getLatestOpenDraftForApplicant(RESUME);
        expectResumeWhere(onlyWhere(prisma.application.findFirst));
    });

    test('findLatestOpenDraftForHealth without submitterId or editIds → null, no query (fail closed)', async () => {
        await expect(service.findLatestOpenDraftForHealth({ holderScope: SCOPE, editIds: SCOPE.editIds }))
            .resolves.toBeNull();
        await expect(service.findLatestOpenDraftForHealth({ holderScope: SCOPE, submitterId: USER }))
            .resolves.toBeNull();
        expect(prisma.application.findFirst).not.toHaveBeenCalled();
    });
});

describe('by-id reads are findFirst({ where: { id, ...fragment } }), never findUnique', () => {
    const byId = [
        ['findForPaymentOwnership', (s) => s.findForPaymentOwnership(APP, { holderScope: SCOPE })],
        ['findOwnedApplicationForApplicant', (s) => s.findOwnedApplicationForApplicant(APP, { holderScope: SCOPE })],
    ];

    test.each(byId)('%s', async (_name, call) => {
        await call(service);
        expect(prisma.application.findUnique).not.toHaveBeenCalled();
        const where = onlyWhere(prisma.application.findFirst);
        expectFragmentOnly(where);
        expect(where.id).toBe(APP);
    });

    // R2 Task 9: the draft-edit door and the scoped by-id read carry the fragment alone.
    test('getById with a scope → findFirst({ where: { id, ...fragment } })', async () => {
        await service.getById(APP, USER, { holderScope: SCOPE });
        expect(prisma.application.findUnique).not.toHaveBeenCalled();
        const where = onlyWhere(prisma.application.findFirst);
        expectFragmentOnly(where);
        expect(where.id).toBe(APP);
    });

    test('findApplicationByIdForHealth → findFirst({ where: { id, ...fragment, isDeleted: false } }), no filer needed', async () => {
        await service.findApplicationByIdForHealth(APP, { holderScope: SCOPE });
        const where = onlyWhere(prisma.application.findFirst);
        expectFragmentOnly(where);
        expect(where.id).toBe(APP);
        expect(where.isDeleted).toBe(false);
    });

    test('findForPaymentOwnership keeps its lean projection and the soft-delete filter', async () => {
        await service.findForPaymentOwnership(APP, { holderScope: SCOPE });
        const args = prisma.application.findFirst.mock.calls[0][0];
        expect(args.select).toEqual({ id: true, status: true });
        expect(args.where.isDeleted).toBe(false);
    });

    test('the fragment is spread unaltered: its entityId value is the frozen one holderReadWhere built', async () => {
        await service.findOwnedApplicationForApplicant(APP, { holderScope: SCOPE });
        const where = onlyWhere(prisma.application.findFirst);
        expect(Object.isFrozen(where.entityId)).toBe(true);
        expect(where.entityId).toEqual(holderReadWhere(SCOPE, 'Application').entityId);
    });

    test('findDraftForSubmit without an id → the caller\'s own latest filing (submitterId) within the fragment', async () => {
        await service.findDraftForSubmit({ healthId: HEALTH, holderScope: SCOPE });
        const where = onlyWhere(prisma.application.findFirst);
        expect(hasHolderMarker(where)).toBe(true);
        expect(where.entityId).toEqual({ in: SCOPE.readIds });
        expect(where.submitterId).toBe(USER);
        expect(where.OR).toBeUndefined();
        expect(where.AND).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(where, 'healthId')).toBe(false);
    });

    test('getApplicationSlice with a scope → findFirst({ where: { id, ...fragment } })', async () => {
        await service.getApplicationSlice(APP, { select: { id: true }, holderScope: SCOPE });
        const where = onlyWhere(prisma.application.findFirst);
        expectFragmentOnly(where);
        expect(where.id).toBe(APP);
    });
});

describe('R2 Task 9: deleteDraft reads with the fragment, then applies spec §3.3 (owner or creator)', () => {
    const { prisma: globalPrisma } = require('../../services/prisma-database');
    const DRAFT = { id: APP, entityId: 'entity-c', submitterId: 'someone-else' };

    test('findFirst where = { id, ...fragment, DRAFT, not deleted }, no filer pin; selects the holder and the creator', async () => {
        prisma.application.findFirst.mockResolvedValue(DRAFT);
        globalPrisma.entityMembership.findFirst.mockResolvedValue({ role: 'OWNER' });
        await service.deleteDraft(USER, APP, { holderScope: SCOPE });
        const args = prisma.application.findFirst.mock.calls[0][0];
        expectFragmentOnly(args.where);
        expect(args.where).toMatchObject({ id: APP, status: 'DRAFT', isDeleted: false });
        expect(args.select).toEqual({ id: true, entityId: true, submitterId: true });
    });

    test('the holder OWNER deletes a draft someone else created', async () => {
        prisma.application.findFirst.mockResolvedValue(DRAFT);
        globalPrisma.entityMembership.findFirst.mockResolvedValue({ role: 'OWNER' });
        await expect(service.deleteDraft(USER, APP, { holderScope: SCOPE })).resolves.toEqual({ id: APP });
        expect(prisma.application.update).toHaveBeenCalledTimes(1);
    });

    test('a MANAGER who did not create it → 403 ENTITY_PERMISSION_DENIED, nothing updated', async () => {
        prisma.application.findFirst.mockResolvedValue(DRAFT);
        globalPrisma.entityMembership.findFirst.mockResolvedValue({ role: 'MANAGER' });
        await expect(service.deleteDraft(USER, APP, { holderScope: SCOPE }))
            .rejects.toMatchObject({ statusCode: 403, code: 'ENTITY_PERMISSION_DENIED' });
        expect(prisma.application.update).not.toHaveBeenCalled();
    });

    test('a draft the caller cannot see → null, nothing updated', async () => {
        prisma.application.findFirst.mockResolvedValue(null);
        await expect(service.deleteDraft(USER, APP, { holderScope: SCOPE })).resolves.toBeNull();
        expect(prisma.application.update).not.toHaveBeenCalled();
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
        // A scope but no submitter for the resume rule: nothing is resumed.
        ['findLatestOpenDraftForHealth, no submitter', (s) => s.findLatestOpenDraftForHealth({ holderScope: SCOPE }), null],
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
    test('listAuditNotesForApplicant → findFirst({ where: { id, ...fragment, isDeleted: false } })', async () => {
        await listAuditNotesForApplicant({ prisma, applicationId: APP, holderScope: SCOPE });
        const where = onlyWhere(prisma.application.findFirst);
        expectFragmentOnly(where);
        expect(where.id).toBe(APP);
        expect(where.isDeleted).toBe(false);
    });

    test('without a scope it answers 404 and reads nothing', async () => {
        await expect(listAuditNotesForApplicant({ prisma, applicationId: APP })).rejects.toMatchObject({ statusCode: 404 });
        expect(prisma.application.findFirst).not.toHaveBeenCalled();
    });
});
