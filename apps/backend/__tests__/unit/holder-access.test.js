'use strict';

/**
 * holder-access — the membership-set read rule (spec 2026-09-30 §3.1).
 *
 * R(user) = entities the user holds an ACTIVE membership in (any role), whose
 * entity is not soft-deleted. Every health read spreads a where-fragment built
 * from R and tagged with the HOLDER_SCOPED marker; a missing marker is what the
 * witness (Task 2) counts. Pinned here with a mocked membership query:
 *   - the membership matrix (roles, PENDING/REVOKED, deleted entity, lookup failure);
 *   - fail closed on an empty set;
 *   - the exact fragment per watched model;
 *   - the marker survives spread and one level of AND/OR;
 *   - no workspace narrows the scope (R2 Task 12 removed the R1 intersection);
 *   - one membership query per request;
 *   - the destructive-grade owner-or-creator rule (spec §3.3).
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        entityMembership: { findMany: jest.fn(), findFirst: jest.fn() },
    },
}));

const mockLogError = jest.fn();
jest.mock('../../shared/logger', () => {
    const noop = () => {};
    return {
        debug: noop, info: noop, warn: noop, error: noop,
        createLogger: () => ({ debug: noop, info: noop, warn: noop, error: (...a) => mockLogError(...a) }),
    };
});

const mockAssertEntityAction = jest.fn();
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertEntityActionPermission: (...a) => mockAssertEntityAction(...a),
}));

const { prisma } = require('../../services/prisma-database');
const {
    HOLDER_SCOPED,
    WATCHED_MODELS,
    isWatchedModel,
    holderScope,
    holderScopeForUser,
    holderReadWhere,
    hasHolderMarker,
    markHolderScoped,
    assertHolderCapability,
    resolveHolderOwnerOrCreator,
} = require('../../services/holder-access');
const { buildFarmAccessWhere } = require('../../services/farm-access');

const U = 'user-1';
const memberships = (rows) => prisma.entityMembership.findMany.mockResolvedValue(rows);

beforeEach(() => {
    jest.clearAllMocks();
    prisma.entityMembership.findMany.mockReset();
    prisma.entityMembership.findFirst.mockReset();
});

describe('holder-access — the marker constants', () => {
    test('HOLDER_SCOPED is the registered symbol gacp.holderScoped', () => {
        expect(HOLDER_SCOPED).toBe(Symbol.for('gacp.holderScoped'));
    });

    test('WATCHED_MODELS cannot be mutated, and isWatchedModel answers from a private set', () => {
        expect(Object.isFrozen(WATCHED_MODELS)).toBe(true);
        expect(() => { WATCHED_MODELS.push('Plot'); }).toThrow(TypeError);
        expect(typeof WATCHED_MODELS.add).toBe('undefined');
        expect(isWatchedModel('Plot')).toBe(false);
        for (const model of WATCHED_MODELS) { expect(isWatchedModel(model)).toBe(true); }
        expect(isWatchedModel('constructor')).toBe(false);
    });

    test('WATCHED_MODELS names exactly the eleven holder-bearing models', () => {
        expect([...WATCHED_MODELS].sort()).toEqual([
            'Application', 'ApplicationDocument', 'Certificate', 'CheckoutDocument', 'CheckoutOrder',
            'DocumentPrecheck', 'Farm', 'Invoice', 'PaymentTransaction', 'Quotation', 'Quote',
        ]);
    });
});

describe('holder-access — R(user), the membership matrix', () => {
    test('R(user) includes ACTIVE memberships of every role', async () => {
        memberships([
            { entityId: 'e-owner', role: 'OWNER' },
            { entityId: 'e-admin', role: 'ADMIN' },
            { entityId: 'e-manager', role: 'MANAGER' },
            { entityId: 'e-viewer', role: 'VIEWER' },
        ]);
        const scope = await holderScopeForUser(U);
        expect(scope.userId).toBe(U);
        expect([...scope.readIds].sort()).toEqual(['e-admin', 'e-manager', 'e-owner', 'e-viewer']);
        expect([...scope.editIds].sort()).toEqual(['e-admin', 'e-manager', 'e-owner']);
    });

    test('PENDING and REVOKED grant nothing, and a soft-deleted entity grants nothing (the query asks)', async () => {
        memberships([]);
        await holderScopeForUser(U);
        expect(prisma.entityMembership.findMany).toHaveBeenCalledTimes(1);
        const { where } = prisma.entityMembership.findMany.mock.calls[0][0];
        expect(where).toEqual({ userId: U, status: 'ACTIVE', entity: { isDeleted: false } });
    });

    test('lookup failure yields [] and logs', async () => {
        prisma.entityMembership.findMany.mockRejectedValue(new Error('db down'));
        const scope = await holderScopeForUser(U);
        expect(scope.readIds).toEqual([]);
        expect(scope.editIds).toEqual([]);
        expect(mockLogError).toHaveBeenCalledTimes(1);
    });

    test('a missing user id queries nothing and yields []', async () => {
        const scope = await holderScopeForUser('');
        expect(scope.readIds).toEqual([]);
        expect(prisma.entityMembership.findMany).not.toHaveBeenCalled();
    });
});

describe('holder-access — fragments', () => {
    const ids = ['e-1', 'e-2'];
    const scope = { userId: U, readIds: ids, editIds: ['e-1'] };
    const byApplication = { application: { entityId: { in: ids } } };

    test('empty set fails closed', () => {
        const where = holderReadWhere({ userId: U, readIds: [], editIds: [] }, 'Application');
        expect(where).toEqual(markHolderScoped({ entityId: { in: [] } }));
        expect(hasHolderMarker(where)).toBe(true);
    });

    test.each([
        ['Application', { entityId: { in: ids } }],
        ['Certificate', byApplication],
        ['Invoice', byApplication],
        ['Quote', byApplication],
        ['Quotation', byApplication],
        ['PaymentTransaction', byApplication],
        ['CheckoutOrder', byApplication],
        ['ApplicationDocument', byApplication],
        ['DocumentPrecheck', byApplication],
        ['CheckoutDocument', { checkoutOrder: byApplication }],
    ])('fragments per model: %s', (model, expected) => {
        const where = holderReadWhere(scope, model);
        expect(where).toEqual(markHolderScoped({ ...expected }));
        expect(hasHolderMarker(where)).toBe(true);
        expect(where[HOLDER_SCOPED].map((v) => v.key)).toEqual(Object.keys(expected));
    });

    test('fragments per model: Farm deep-equals buildFarmAccessWhere(userId, ids, ids)', () => {
        const where = holderReadWhere(scope, 'Farm');
        expect(where).toEqual(buildFarmAccessWhere(U, ids, ids));
        expect(hasHolderMarker(where)).toBe(true);
    });

    test('every watched model has a fragment', () => {
        for (const model of WATCHED_MODELS) {
            expect(hasHolderMarker(holderReadWhere(scope, model))).toBe(true);
        }
    });

    test('an unknown model throws', () => {
        expect(() => holderReadWhere(scope, 'Plot')).toThrow(/Plot/);
    });

    test('the fragment does not share its id array with the scope', () => {
        // The fragment is deep-frozen (Task 2), so it cannot be pushed into; the
        // copy is what keeps that freeze off the caller's scope.readIds. A fresh
        // scope here: other tests in this block freeze the shared `ids` through
        // their own markHolderScoped(expected) calls.
        const own = { userId: U, readIds: ['e-1', 'e-2'], editIds: [] };
        const where = holderReadWhere(own, 'Application');
        expect(where.entityId.in).not.toBe(own.readIds);
        expect(Object.isFrozen(where.entityId.in)).toBe(true);
        expect(Object.isFrozen(own.readIds)).toBe(false);
        own.readIds.push('e-later');
        expect(where.entityId.in).toEqual(['e-1', 'e-2']);
    });
});

describe('holder-access — the marker', () => {
    const scope = { userId: U, readIds: ['e-1'], editIds: ['e-1'] };

    test('marker survives spread', () => {
        const frag = holderReadWhere(scope, 'Invoice');
        expect(hasHolderMarker({ ...frag, status: 'PAID' })).toBe(true);
        expect(hasHolderMarker({ AND: [frag, { id: 'x' }] })).toBe(true);
        expect(hasHolderMarker({ id: 'x' })).toBe(false);
    });

    test('one level deep only, and AND may be a single object', () => {
        const frag = holderReadWhere(scope, 'Application');
        expect(hasHolderMarker({ AND: frag })).toBe(true);
        expect(hasHolderMarker({ AND: [{ AND: [frag] }] })).toBe(false);
        expect(hasHolderMarker({ application: frag })).toBe(false);
    });

    test('OR counts only when every branch is scoped', () => {
        const frag = holderReadWhere(scope, 'Application');
        expect(hasHolderMarker({ OR: [frag, holderReadWhere(scope, 'Application')] })).toBe(true);
        expect(hasHolderMarker({ OR: [frag, { id: 'x' }] })).toBe(false);
        expect(hasHolderMarker({ OR: [] })).toBe(false);
    });

    test('override of entityId after a spread reads as unscoped', () => {
        const frag = holderReadWhere(scope, 'Application');
        expect(hasHolderMarker({ ...frag, entityId: 'victim' })).toBe(false);
        expect(hasHolderMarker({ ...frag, entityId: { in: ['e-1'] } })).toBe(false);
    });

    test.each([
        'Certificate', 'Invoice', 'Quote', 'Quotation', 'PaymentTransaction',
        'CheckoutOrder', 'ApplicationDocument', 'DocumentPrecheck',
    ])('override of application after a spread reads as unscoped: %s', (model) => {
        const frag = holderReadWhere(scope, model);
        expect(hasHolderMarker({ ...frag, application: { entityId: 'victim' } })).toBe(false);
        expect(hasHolderMarker({ ...frag, application: undefined })).toBe(false);
    });

    test('override of checkoutOrder on CheckoutDocument reads as unscoped', () => {
        const frag = holderReadWhere(scope, 'CheckoutDocument');
        expect(hasHolderMarker({ ...frag, checkoutOrder: {} })).toBe(false);
    });

    test('override of the Farm OR reads as unscoped', () => {
        const frag = holderReadWhere(scope, 'Farm');
        expect(hasHolderMarker({ ...frag, isDeleted: false })).toBe(true);
        expect(hasHolderMarker({ ...frag, OR: [{ ownerId: U }] })).toBe(false);
    });

    test('deleting the vouched key reads as unscoped', () => {
        const where = { ...holderReadWhere(scope, 'Invoice') };
        delete where.application;
        expect(hasHolderMarker(where)).toBe(false);
    });

    test('spread plus an unrelated key stays scoped', () => {
        const frag = holderReadWhere(scope, 'Application');
        expect(hasHolderMarker({ ...frag, status: 'DRAFT', isDeleted: false })).toBe(true);
        expect(hasHolderMarker({ id: 'x', ...frag })).toBe(true);
    });

    test('a forged marker whose ref does not match reads as unscoped', () => {
        const forged = { entityId: { in: ['e-1'] } };
        forged[HOLDER_SCOPED] = true;
        expect(hasHolderMarker(forged)).toBe(false);
        const frag = holderReadWhere(scope, 'Application');
        const copied = { entityId: { in: ['e-1'] } };
        copied[HOLDER_SCOPED] = frag[HOLDER_SCOPED];
        expect(hasHolderMarker(copied)).toBe(false);
    });

    test('markHolderScoped refuses a where with nothing to vouch for', () => {
        expect(() => markHolderScoped({})).toThrow(TypeError);
        expect(() => markHolderScoped({ entityId: undefined })).toThrow(TypeError);
    });

    test('non-objects carry no marker', () => {
        expect(hasHolderMarker(undefined)).toBe(false);
        expect(hasHolderMarker(null)).toBe(false);
        expect(hasHolderMarker('x')).toBe(false);
    });

    test('markHolderScoped tags and returns the same object', () => {
        const where = { id: 'x' };
        expect(markHolderScoped(where)).toBe(where);
        expect(hasHolderMarker(where)).toBe(true);
        expect(Object.keys(where)).toEqual(['id']);
    });
});

describe('holder-access — no workspace narrows the scope (R2 Task 12)', () => {
    beforeEach(() => memberships([
        { entityId: 'e-a', role: 'OWNER' },
        { entityId: 'e-c', role: 'VIEWER' },
    ]));

    test('holderScopeForUser: R, whatever else is passed', async () => {
        const scope = await holderScopeForUser(U, { activeEntityId: 'e-c' });
        expect([...scope.readIds].sort()).toEqual(['e-a', 'e-c']);
        expect(scope.editIds).toEqual(['e-a']);
    });

    test('holderScope(req) ignores a req.activeEntity left by anything (the middleware is gone)', async () => {
        const scope = await holderScope({ user: { id: U }, activeEntity: { entityId: 'e-c' } });
        expect({ ...scope, readIds: [...scope.readIds].sort() }).toEqual({ userId: U, readIds: ['e-a', 'e-c'], editIds: ['e-a'] });
    });

    test('the R1 pin helpers are gone', () => {
        const access = require('../../services/holder-access');
        for (const name of ['r1LegacyApplicantPin', 'r1LegacyFilerFragment', 'r1HolderOrLegacy',
            'r1HolderOrLegacyWhenScoped', 'r1ApplicationHolderOrPin']) {
            expect(access[name]).toBeUndefined();
        }
    });
});

describe('holder-access — holderReadWhereIfScoped and dataSubjectReadWhere', () => {
    const { holderReadWhereIfScoped, dataSubjectReadWhere } = require('../../services/holder-access');

    test('no scope → {} (staff, jobs keep their where); a scope → the marked fragment', () => {
        expect(holderReadWhereIfScoped(null, 'Application')).toEqual({});
        expect(holderReadWhereIfScoped({ userId: U }, 'Application')).toEqual({});
        const where = holderReadWhereIfScoped({ userId: U, readIds: ['e-a'] }, 'Application');
        expect(JSON.parse(JSON.stringify(where))).toEqual({ entityId: { in: ['e-a'] } });
        expect(hasHolderMarker(where)).toBe(true);
    });

    test('dataSubjectReadWhere: a marked copy of the subject key; an empty key matches nothing; unwatched models throw', () => {
        const key = { healthId: 'hid-1' };
        const where = dataSubjectReadWhere('Application', key);
        expect(JSON.parse(JSON.stringify(where))).toEqual({ healthId: 'hid-1' });
        expect(where).not.toBe(key);
        expect(hasHolderMarker(where)).toBe(true);
        expect(JSON.parse(JSON.stringify(dataSubjectReadWhere('Invoice', {})))).toEqual({ id: { in: [] } });
        expect(() => dataSubjectReadWhere('User', key)).toThrow(/not a holder-bearing model/);
    });
});

describe('holder-access — holderScope(req) with no request', () => {
    test('holderScope(undefined) rejects instead of throwing synchronously', async () => {
        let pending;
        expect(() => { pending = holderScope(undefined); }).not.toThrow();
        await expect(pending).rejects.toThrow(TypeError);
        await expect(holderScope(null)).rejects.toThrow(TypeError);
        expect(prisma.entityMembership.findMany).not.toHaveBeenCalled();
    });

    test('a request with no user fails closed', async () => {
        await expect(holderScope({})).resolves.toEqual({ userId: '', readIds: [], editIds: [] });
    });
});

describe('holder-access — holderScope(req) is memoized', () => {
    test('two holderScope(req) calls → one findMany', async () => {
        memberships([{ entityId: 'e-1', role: 'OWNER' }]);
        const req = { user: { id: U } };
        const first = await holderScope(req);
        const second = await holderScope(req);
        expect(second).toBe(first);
        expect(prisma.entityMembership.findMany).toHaveBeenCalledTimes(1);
    });

    test('a different request queries again', async () => {
        memberships([{ entityId: 'e-1', role: 'OWNER' }]);
        await holderScope({ user: { id: U } });
        await holderScope({ user: { id: U } });
        expect(prisma.entityMembership.findMany).toHaveBeenCalledTimes(2);
    });
});

describe('holder-access — resolveHolderOwnerOrCreator (spec §3.3)', () => {
    const membership = (row) => prisma.entityMembership.findFirst.mockResolvedValue(row);
    const app = (submitterId) => ({ entityId: 'e-1', submitterId });

    test('creator + ACTIVE MANAGER → true', async () => {
        membership({ role: 'MANAGER' });
        await expect(resolveHolderOwnerOrCreator(app(U), U)).resolves.toBe(true);
    });

    test('creator + VIEWER → false', async () => {
        membership({ role: 'VIEWER' });
        await expect(resolveHolderOwnerOrCreator(app(U), U)).resolves.toBe(false);
    });

    test('non-creator OWNER → true', async () => {
        membership({ role: 'OWNER' });
        await expect(resolveHolderOwnerOrCreator(app('someone-else'), U)).resolves.toBe(true);
    });

    test('non-creator ADMIN → false', async () => {
        membership({ role: 'ADMIN' });
        await expect(resolveHolderOwnerOrCreator(app('someone-else'), U)).resolves.toBe(false);
    });

    test('lookup throws → false', async () => {
        prisma.entityMembership.findFirst.mockRejectedValue(new Error('db down'));
        await expect(resolveHolderOwnerOrCreator(app(U), U)).resolves.toBe(false);
    });

    test('no ACTIVE membership on a live holder → false, and the lookup asks for exactly that', async () => {
        membership(null);
        await expect(resolveHolderOwnerOrCreator(app(U), U)).resolves.toBe(false);
        expect(prisma.entityMembership.findFirst).toHaveBeenCalledWith({
            where: { userId: U, entityId: 'e-1', status: 'ACTIVE', entity: { isDeleted: false } },
            select: { role: true },
        });
    });

    test('a null holder → false without a lookup (no filer fallback)', async () => {
        await expect(resolveHolderOwnerOrCreator({ entityId: null, submitterId: U }, U)).resolves.toBe(false);
        expect(prisma.entityMembership.findFirst).not.toHaveBeenCalled();
    });
});

describe('holder-access — assertHolderCapability', () => {
    test('delegates to assertEntityActionPermission and resolves to undefined', async () => {
        mockAssertEntityAction.mockResolvedValue({ allowed: true, via: 'ENTITY_PERMISSION' });
        await expect(assertHolderCapability(U, 'e-1', 'SUBMIT_APPLICATION')).resolves.toBeUndefined();
        expect(mockAssertEntityAction).toHaveBeenCalledWith({
            userId: U, entityId: 'e-1', permission: 'SUBMIT_APPLICATION',
        });
    });

    test('a denial propagates', async () => {
        const denied = Object.assign(new Error('denied'), { code: 'ENTITY_PERMISSION_DENIED', statusCode: 403 });
        mockAssertEntityAction.mockRejectedValue(denied);
        await expect(assertHolderCapability(U, 'e-1', 'PRINT_QR')).rejects.toBe(denied);
    });
});
