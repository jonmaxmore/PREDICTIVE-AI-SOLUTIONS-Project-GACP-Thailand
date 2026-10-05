'use strict';

/**
 * F-QA-01 (deep-qa 2026-09-06) — ensurePersonalIndividualEntity opens with
 * "does this user already own a personal INDIVIDUAL entity?". For the
 * registration caller that question has a known answer: the User row was
 * created one statement earlier inside the SAME transaction, so no
 * EntityMembership can reference its id. On staging that dead probe cost a
 * measured 364 ms (Bangkok app, Seoul database) on every registration.
 *
 * `isNewUser: true` skips ONLY that probe. Everything the flag must NOT skip
 * is pinned below — above all the national-ID dedup lookup, which protects the
 * @@unique([type, thaiCitizenId*]) invariant and CAN match for a brand-new
 * user (an entity may have been backfilled before the account existed).
 */

jest.mock('../../services/prisma-database', () => {
    const mockPrisma = {
        entity: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
        entityMembership: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
        entityMemberPermissionGrant: { findMany: jest.fn().mockResolvedValue([]) },
        entityMembershipEvent: { create: jest.fn().mockResolvedValue({ id: 'evt' }) },
        user: { findFirst: jest.fn(), findMany: jest.fn() },
    };
    mockPrisma.$transaction = jest.fn(async (fn) => fn(mockPrisma));
    return { prisma: mockPrisma };
});

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { prisma } = require('../../services/prisma-database');
const entityService = require('../../services/entity-service');

const USER = {
    id: 'user-1',
    healthId: '1100000000008',
    organizationId: 'org-1',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    email: 'a@b.co',
};

beforeEach(() => {
    jest.clearAllMocks();
    prisma.entity.findFirst.mockResolvedValue(null);
    prisma.entity.create.mockResolvedValue({ id: 'ent-1', type: 'INDIVIDUAL' });
    prisma.entityMembership.findFirst.mockResolvedValue(null);
    prisma.entityMembership.upsert.mockResolvedValue({ id: 'mem-1' });
});

describe('ensurePersonalIndividualEntity — isNewUser skips only the impossible probe', () => {
    it('does not ask for an OWNER membership of a user created a statement ago', async () => {
        await entityService.ensurePersonalIndividualEntity({ user: USER, isNewUser: true });

        expect(prisma.entityMembership.findFirst).not.toHaveBeenCalled();
    });

    it('still runs the national-ID dedup lookup, and still creates the entity + OWNER membership', async () => {
        const result = await entityService.ensurePersonalIndividualEntity({ user: USER, isNewUser: true });

        // dedup lookup on the national-ID hash — an entity CAN pre-exist the user
        expect(prisma.entity.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ type: 'INDIVIDUAL' }),
        }));
        expect(prisma.entity.create).toHaveBeenCalledTimes(1);
        expect(prisma.entityMembership.upsert).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ fresh: true });
    });

    it('reuses a pre-existing entity found by the dedup lookup instead of minting a second one', async () => {
        prisma.entity.findFirst.mockResolvedValueOnce({ id: 'ent-backfilled', type: 'INDIVIDUAL' });

        const result = await entityService.ensurePersonalIndividualEntity({ user: USER, isNewUser: true });

        expect(prisma.entity.create).not.toHaveBeenCalled();
        expect(result.entity).toMatchObject({ id: 'ent-backfilled' });
        expect(result.fresh).toBe(false);
    });

    it('every other caller keeps the probe — the default is unchanged', async () => {
        prisma.entityMembership.findFirst.mockResolvedValue({
            entity: { id: 'ent-personal', type: 'INDIVIDUAL' },
        });

        const result = await entityService.ensurePersonalIndividualEntity({ user: USER });

        expect(prisma.entityMembership.findFirst).toHaveBeenCalledTimes(1);
        expect(result.entity).toMatchObject({ id: 'ent-personal' });
        expect(prisma.entity.create).not.toHaveBeenCalled();
    });
});
