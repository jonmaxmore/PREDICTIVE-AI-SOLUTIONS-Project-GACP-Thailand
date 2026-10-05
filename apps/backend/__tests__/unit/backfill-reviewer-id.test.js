/**
 * Unit tests for scripts/backfill-reviewer-id.js — the legacy-JSON →
 * Application.reviewerId column backfill. Focus on the risky bit: resolving an
 * ambiguous JSON value (User.id vs User.providerId) and the idempotent,
 * dry-run-safe row processing.
 */

'use strict';

const { backfill, resolveUserId } = require('../../scripts/backfill-reviewer-id');

function makePrisma({ users = [], applications = [] } = {}) {
    const updates = [];
    return {
        updates,
        user: {
            findUnique: jest.fn(async ({ where }) => users.find((u) => u.id === where.id) || null),
            findFirst: jest.fn(async ({ where }) => users.find((u) => u.providerId === where.providerId) || null),
        },
        application: {
            findMany: jest.fn(async () => applications),
            update: jest.fn(async ({ where, data }) => { updates.push({ id: where.id, data }); return { id: where.id, ...data }; }),
        },
    };
}

describe('backfill-reviewer-id / resolveUserId', () => {
    test('resolves directly when value is a User.id', async () => {
        const prisma = makePrisma({ users: [{ id: 'u-1', providerId: 'p-1' }] });
        await expect(resolveUserId(prisma, 'u-1')).resolves.toEqual({ resolvedId: 'u-1', via: 'id' });
    });

    test('resolves via providerId when value is not a User.id', async () => {
        const prisma = makePrisma({ users: [{ id: 'u-2', providerId: 'prov-xyz' }] });
        await expect(resolveUserId(prisma, 'prov-xyz')).resolves.toEqual({ resolvedId: 'u-2', via: 'providerId' });
    });

    test('returns null when neither id nor providerId matches', async () => {
        const prisma = makePrisma({ users: [{ id: 'u-3', providerId: 'p-3' }] });
        await expect(resolveUserId(prisma, 'ghost')).resolves.toBeNull();
    });

    test('returns null for a falsy value without hitting the DB', async () => {
        const prisma = makePrisma();
        await expect(resolveUserId(prisma, null)).resolves.toBeNull();
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
});

describe('backfill-reviewer-id / backfill', () => {
    const apps = [
        { id: 'a-1', applicationNumber: 'GACP-1', formData: { PROVIDERAssignment: { reviewerId: 'u-1' } } }, // by id
        { id: 'a-2', applicationNumber: 'GACP-2', formData: { PROVIDERAssignment: { reviewerId: 'prov-2' } } }, // by providerId
        { id: 'a-3', applicationNumber: 'GACP-3', formData: { PROVIDERAssignment: { reviewerId: 'ghost' } } }, // unresolved
        { id: 'a-4', applicationNumber: 'GACP-4', formData: { reviewProgress: {} } }, // no JSON assignment
    ];
    const users = [{ id: 'u-1', providerId: 'p-1' }, { id: 'u-2', providerId: 'prov-2' }];

    test('dry-run resolves + reports WITHOUT writing', async () => {
        const prisma = makePrisma({ users, applications: apps });
        const result = await backfill({ prisma, dryRun: true });
        expect(prisma.application.update).not.toHaveBeenCalled();
        expect(result.totals).toMatchObject({
            scanned: 4, candidates: 3, updated: 2, skippedNoJson: 1, unresolved: 1, errors: 0,
        });
    });

    test('live run writes the resolved column (id + providerId paths) and skips the rest', async () => {
        const prisma = makePrisma({ users, applications: apps });
        const result = await backfill({ prisma, dryRun: false });
        expect(result.totals).toMatchObject({ updated: 2, unresolved: 1, skippedNoJson: 1 });
        expect(prisma.updates).toEqual([
            { id: 'a-1', data: { reviewerId: 'u-1' } },
            { id: 'a-2', data: { reviewerId: 'u-2' } },
        ]);
    });
});
