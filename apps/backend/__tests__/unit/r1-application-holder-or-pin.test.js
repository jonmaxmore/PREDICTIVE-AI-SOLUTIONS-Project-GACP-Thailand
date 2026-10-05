'use strict';

/**
 * r1ApplicationHolderOrPin (final review C1, 2026-10-03; R1-legacy-pin: removed in Task 12).
 *
 * The R1 applicant Application where is { OR: [fragment, legacy(pin)], AND: [pin] }.
 * Its rows are exactly the pin's rows whether or not an entity context is bound:
 *   - context bound: tenantInjectExtension adds entityId = active, the same as pre-R1;
 *   - no context (a user with no personal entity, or the active-entity
 *     middleware's catch path): nothing rewrites the where, and the OR keeps the
 *     filings whose holder is null or outside R, as pre-R1 did.
 * The old form, fragment AND pin, dropped those filings without a context.
 *
 * Evaluated here with a small where-evaluator over plain rows (equality, `in`,
 * AND, OR) so the row sets, not only the shape, are pinned. The real Postgres
 * proof is r1-application-reads-neutral-real-postgres.test.js (actor N and the
 * `transient` rows).
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: { entityMembership: { findMany: jest.fn(), findFirst: jest.fn() } },
}));

const { r1ApplicationHolderOrPin, holderReadWhere, hasHolderMarker } = require('../../services/holder-access');
const { createApplicationIdentityMethods } = require('../../services/application-service/application-identity-methods');
const { createApplicationDraftQueryMethods } = require('../../services/application-service/application-draft-query-methods');

function matches(row, where) {
    return Object.entries(where).every(([key, cond]) => {
        if (key === 'AND') { return [].concat(cond).every((w) => matches(row, w)); }
        if (key === 'OR') { return cond.some((w) => matches(row, w)); }
        if (cond && typeof cond === 'object' && Array.isArray(cond.in)) { return cond.in.includes(row[key]); }
        return row[key] === cond;
    });
}

const ROWS = [
    { id: 'own-null', healthId: 'h-me', entityId: null },
    { id: 'own-left', healthId: 'h-me', entityId: 'ent-left' },
    { id: 'own-c', healthId: 'h-me', entityId: 'ent-c' },
    { id: 'other-c', healthId: 'h-other', entityId: 'ent-c' },
];
const ids = (where) => ROWS.filter((r) => matches(r, where)).map((r) => r.id).sort();
const PIN = { healthId: 'h-me' };

describe('r1ApplicationHolderOrPin', () => {
    test('shape: OR [marked fragment, marked legacy pin] and the pin as the only AND member', () => {
        const scope = { userId: 'u', readIds: ['ent-c'] };
        const where = r1ApplicationHolderOrPin(scope, PIN);
        expect(Object.keys(where).sort()).toEqual(['AND', 'OR']);
        expect(where.OR).toHaveLength(2);
        expect(hasHolderMarker(where.OR[0])).toBe(true);
        expect(where.OR[0].entityId).toEqual(holderReadWhere(scope, 'Application').entityId);
        expect(hasHolderMarker(where.OR[1])).toBe(true);
        expect(JSON.parse(JSON.stringify(where.OR[1]))).toEqual(PIN);
        expect(where.AND).toEqual([PIN]);
    });

    test('no entity at all (readIds = []), no context: exactly the pin\'s rows, as pre-R1', () => {
        const where = r1ApplicationHolderOrPin({ userId: 'u', readIds: [] }, PIN);
        expect(ids(where)).toEqual(['own-c', 'own-left', 'own-null']);
        expect(ids(where)).toEqual(ids(PIN));
    });

    test('a member of C with no context (middleware catch path): still exactly the pin\'s rows', () => {
        const where = r1ApplicationHolderOrPin({ userId: 'u', readIds: ['ent-c'] }, PIN);
        expect(ids(where)).toEqual(ids(PIN));
    });

    test('with a context the extension adds entityId = active: the same rows as pin AND active', () => {
        const where = { ...r1ApplicationHolderOrPin({ userId: 'u', readIds: ['ent-c'] }, PIN), entityId: 'ent-c' };
        expect(ids(where)).toEqual(ids({ ...PIN, entityId: 'ent-c' }));
    });

    test('the old form (fragment AND pin) narrowed without a context — the defect this replaces', () => {
        const old = { ...holderReadWhere({ userId: 'u', readIds: [] }, 'Application'), AND: [PIN] };
        expect(ids(old)).toEqual([]);
    });

    test('a missing or empty pin matches nothing', () => {
        for (const pin of [null, undefined, {}]) {
            expect(ids(r1ApplicationHolderOrPin({ userId: 'u', readIds: ['ent-c'] }, pin))).toEqual([]);
        }
    });
});

describe('getById with a scope but no pre-R1 where keeps where { id }', () => {
    test('legacy branch is the id itself, so the rows equal { id }', async () => {
        const findFirst = jest.fn().mockResolvedValue(null);
        const prisma = { application: { findFirst } };
        const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
        const service = {};
        Object.assign(
            service,
            createApplicationIdentityMethods({ prisma, logger }),
            createApplicationDraftQueryMethods({ prisma, feeService: {}, sendNotification: jest.fn(), NotifyType: {}, logger }),
        );
        // A non-UUID identity with no healthId: buildHealthWhereClause returns null.
        await service.getById('own-null', 'not-a-uuid', { holderScope: { userId: 'u', readIds: [] } });
        const { where } = findFirst.mock.calls[0][0];
        expect(where.id).toBe('own-null');
        expect(JSON.parse(JSON.stringify(where.OR[1]))).toEqual({ id: 'own-null' });
        expect(ids(where)).toEqual(['own-null']);
    });
});
