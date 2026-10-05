/**
 * Farm-worker Wave B, Chunk 6 — drill-flagged follow-ups.
 *
 * (a) findPersonalEntity DETERMINISM: every findFirst that resolves the
 *     personal INDIVIDUAL entity / OWNER membership must carry a stable
 *     ordering (orderBy createdAt asc) so a user with duplicate candidate
 *     rows always lands on the SAME personal entity.
 *     Site: entity-service.ensurePersonalIndividualEntity (owner-membership
 *     link + national-ID dedup lookup). R2 Task 12 removed the other two
 *     resolvers this file pinned (active-entity-middleware.findPersonalEntity
 *     and findPersonalEntityForHealthIdentity, which had no caller left).
 *
 * (b) Personal-entity invites are BY DESIGN: a solo farmer hires a worker
 *     without creating a company — the personal INDIVIDUAL entity IS
 *     invitable. Pins: the invite works, and the worker gets NO permissions
 *     by default beyond their role. (The workspace-header context case was
 *     removed with the header in R2 Task 12.)
 */

'use strict';

jest.mock('../../services/prisma-database', () => {
    const mockPrisma = {
        entity: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
        },
        entityMembership: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            upsert: jest.fn(),
        },
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
const { getEffectiveEntityPermissions } = require('../../services/entity-effective-permissions-service');

const ASC = { createdAt: 'asc' };

beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.entityMemberPermissionGrant.findMany.mockResolvedValue([]);
    prisma.entityMembershipEvent.create.mockResolvedValue({ id: 'evt' });
    delete process.env.AUTH_LOOKUP_USE_HMAC;
});

describe('(a) findPersonalEntity determinism — ensurePersonalIndividualEntity', () => {
    const USER = {
        id: 'user-1', healthId: '1100000000008', organizationId: 'org-1',
        firstName: 'A', lastName: 'B', email: 'a@b.co',
    };

    it('owner-membership link lookup orders by createdAt asc', async () => {
        prisma.entityMembership.findFirst.mockResolvedValue({
            entity: { id: 'ent-personal', type: 'INDIVIDUAL' },
        });
        prisma.entityMembership.upsert.mockResolvedValue({ id: 'mem-1' });

        await entityService.ensurePersonalIndividualEntity({ user: USER });

        expect(prisma.entityMembership.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ orderBy: ASC }),
        );
    });

    it('national-ID dedup entity lookup orders by createdAt asc', async () => {
        prisma.entityMembership.findFirst.mockResolvedValue(null);
        prisma.entity.findFirst.mockResolvedValue({ id: 'ent-personal', organizationId: 'org-1' });
        prisma.entityMembership.upsert.mockResolvedValue({ id: 'mem-1' });

        await entityService.ensurePersonalIndividualEntity({ user: USER });

        expect(prisma.entity.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ orderBy: ASC }),
        );
    });
});

describe('(b) personal-workspace invites — binding design pins', () => {
    it('addMember INTO a personal INDIVIDUAL entity works (solo farmer hires a worker) and seeds role-only permissions', async () => {
        // The entity being invited into is the employer's personal INDIVIDUAL one.
        prisma.entity.findUnique.mockResolvedValue({
            id: 'ent-personal', organizationId: 'org-1', isDeleted: false, type: 'INDIVIDUAL',
        });
        prisma.entityMembership.findUnique.mockResolvedValue(null); // fresh invite
        prisma.entityMembership.upsert.mockResolvedValue({
            id: 'mem-worker', userId: 'worker-1', role: 'VIEWER', permissions: [], status: 'PENDING',
        });

        const membership = await entityService.addMember({
            entityId: 'ent-personal',
            userId: 'worker-1',
            role: 'VIEWER',
            invitedBy: 'employer-1',
        });

        expect(membership.status).toBe('PENDING');
        // Role-only default: VIEWER seeds an EMPTY permissions[] — the worker
        // gets NOTHING beyond the role until the OWNER grants per-permission.
        expect(prisma.entityMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ role: 'VIEWER', permissions: [] }),
        }));
        // INVITED audit row written in the same transaction.
        expect(prisma.entityMembershipEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ eventType: 'INVITED', targetUserId: 'worker-1' }),
        }));
    });

    it('the worker has NO effective permissions by default beyond the role (VIEWER → none)', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({
            id: 'mem-worker', role: 'VIEWER', permissions: [], status: 'ACTIVE',
        });

        const { effective } = await getEffectiveEntityPermissions({
            userId: 'worker-1', entityId: 'ent-personal', prisma,
        });
        expect(effective).toEqual([]);
    });
});
