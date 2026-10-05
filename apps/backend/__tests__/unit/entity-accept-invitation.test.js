// Wave D — accept-invitation / decline-invitation / GET /invitations.
//
// Closes the UX gap where addMember created PENDING rows but no flow
// existed for the invitee to convert their own PENDING row to ACTIVE
// (the only existing path was admin re-invocation, which is wrong UX).

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const passUser = (req, _res, next) => {
        req.user = {
            id: 'invitee-1',
            healthId: '1100000000009',
            organizationId: 'org-1',
            canonicalRole: 'health',
            role: 'HEALTH_USER',
        };
        next();
    };
    return { authenticateHealth: passUser, authenticateAny: passUser };
});

const mockMemberships = new Map();
const mockKey = (userId, entityId) => `${userId}::${entityId}`;
const mockSeed = (rows) => {
    mockMemberships.clear();
    rows.forEach((r) => mockMemberships.set(mockKey(r.userId, r.entityId), r));
};

jest.mock('../../services/prisma-database', () => {
    const mockPrisma = {
        entityMembership: {
            findUnique: jest.fn(({ where }) => {
                const k = `${where.userId_entityId.userId}::${where.userId_entityId.entityId}`;
                return Promise.resolve(mockMemberships.get(k) || null);
            }),
            findMany: jest.fn(),
            update: jest.fn(({ where, data }) => {
                const k = `${where.userId_entityId.userId}::${where.userId_entityId.entityId}`;
                const existing = mockMemberships.get(k);
                if (!existing) {return Promise.resolve(null);}
                const next = { ...existing, ...data };
                mockMemberships.set(k, next);
                return Promise.resolve(next);
            }),
        },
        entityMembershipEvent: {
            create: jest.fn(({ data }) => Promise.resolve({ id: 'evt-1', createdAt: new Date(), ...data })),
        },
        entity: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
        },
        user: { findMany: jest.fn() },
    };
    mockPrisma.$transaction = jest.fn(async (fn) => fn(mockPrisma));
    return { prisma: mockPrisma };
});

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    // Wave B: routes/api/entities now pulls the entity permission engine,
    // which uses createLogger.
    return { ...l, createLogger: jest.fn(() => l) };
});

const { prisma } = require('../../services/prisma-database');
const entityService = require('../../services/entity-service');
const entitiesRouter = require('../../routes/api/entities/index');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/entities', entitiesRouter);
    return app;
}

const ENTITY_ID = 'ent-juristic';

describe('Wave D — acceptInvitation helper', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSeed([
            { id: 'mem-1', userId: 'invitee-1', entityId: ENTITY_ID, role: 'MANAGER',
              status: 'PENDING', invitedBy: 'user-owner', organizationId: 'org-1' },
        ]);
    });

    it('flips PENDING → ACTIVE and writes ACCEPTED audit row atomically', async () => {
        const result = await entityService.acceptInvitation({
            entityId: ENTITY_ID, userId: 'invitee-1',
            ipAddress: '203.0.113.5', userAgent: 'browser/1',
        });
        expect(result.status).toBe('ACTIVE');
        expect(result.acceptedAt).toBeInstanceOf(Date);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.entityMembershipEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                eventType: 'ACCEPTED',
                actorUserId: 'invitee-1',
                targetUserId: 'invitee-1',
                metadata: { role: 'MANAGER' },
                ipAddress: '203.0.113.5',
                userAgent: 'browser/1',
                organizationId: 'org-1',
            }),
        });
    });

    it('throws NOT_INVITED when there is no membership row', async () => {
        await expect(entityService.acceptInvitation({
            entityId: ENTITY_ID, userId: 'stranger',
        })).rejects.toMatchObject({ code: 'NOT_INVITED' });
        expect(prisma.entityMembershipEvent.create).not.toHaveBeenCalled();
    });

    it('throws NOT_PENDING when the row is already ACTIVE', async () => {
        mockSeed([
            { id: 'mem-1', userId: 'invitee-1', entityId: ENTITY_ID, role: 'MANAGER',
              status: 'ACTIVE', organizationId: 'org-1' },
        ]);
        await expect(entityService.acceptInvitation({
            entityId: ENTITY_ID, userId: 'invitee-1',
        })).rejects.toMatchObject({ code: 'NOT_PENDING', status: 'ACTIVE' });
        expect(prisma.entityMembershipEvent.create).not.toHaveBeenCalled();
    });

    it('throws NOT_PENDING when the row is REVOKED', async () => {
        mockSeed([
            { id: 'mem-1', userId: 'invitee-1', entityId: ENTITY_ID, role: 'MANAGER',
              status: 'REVOKED', organizationId: 'org-1' },
        ]);
        await expect(entityService.acceptInvitation({
            entityId: ENTITY_ID, userId: 'invitee-1',
        })).rejects.toMatchObject({ code: 'NOT_PENDING', status: 'REVOKED' });
    });
});

describe('Wave D — declineInvitation helper', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSeed([
            { id: 'mem-1', userId: 'invitee-1', entityId: ENTITY_ID, role: 'MANAGER',
              status: 'PENDING', invitedBy: 'user-owner', organizationId: 'org-1' },
        ]);
    });

    it('flips PENDING → REVOKED with reason=DECLINED in audit', async () => {
        const result = await entityService.declineInvitation({
            entityId: ENTITY_ID, userId: 'invitee-1',
        });
        expect(result.status).toBe('REVOKED');
        expect(prisma.entityMembershipEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                eventType: 'REVOKED',
                actorUserId: 'invitee-1',
                targetUserId: 'invitee-1',
                metadata: { role: 'MANAGER', reason: 'DECLINED' },
            }),
        });
    });

    it('throws NOT_PENDING when row is already ACTIVE (cannot decline an accepted invite)', async () => {
        mockSeed([
            { id: 'mem-1', userId: 'invitee-1', entityId: ENTITY_ID, role: 'MANAGER',
              status: 'ACTIVE', organizationId: 'org-1' },
        ]);
        await expect(entityService.declineInvitation({
            entityId: ENTITY_ID, userId: 'invitee-1',
        })).rejects.toMatchObject({ code: 'NOT_PENDING' });
    });
});

describe('Wave D — listPendingInvitations helper', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns flattened invitations with inviter info', async () => {
        prisma.entityMembership.findMany.mockResolvedValueOnce([
            {
                id: 'mem-1', userId: 'invitee-1', entityId: 'ent-1',
                role: 'MANAGER', status: 'PENDING',
                invitedBy: 'user-owner', invitedAt: new Date('2026-05-02T10:00:00Z'),
                entity: {
                    id: 'ent-1', type: 'JURISTIC', slug: 'abc-co',
                    displayName: 'ABC Co.', isDeleted: false, status: 'ACTIVE',
                },
            },
        ]);
        prisma.user.findMany.mockResolvedValueOnce([
            { id: 'user-owner', firstName: 'Owner', lastName: 'X', email: 'o@x.co' },
        ]);

        const out = await entityService.listPendingInvitations({ userId: 'invitee-1' });
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            entityId: 'ent-1',
            slug: 'abc-co',
            type: 'JURISTIC',
            displayName: 'ABC Co.',
            role: 'MANAGER',
            invitedBy: { id: 'user-owner', displayName: 'Owner X' },
        });
    });

    it('filters out invitations whose entity is soft-deleted', async () => {
        prisma.entityMembership.findMany.mockResolvedValueOnce([
            {
                id: 'mem-1', userId: 'invitee-1', entityId: 'ent-deleted',
                role: 'MANAGER', status: 'PENDING', invitedBy: 'user-owner',
                entity: {
                    id: 'ent-deleted', type: 'JURISTIC', slug: 'gone',
                    displayName: 'Gone Co.', isDeleted: true, status: 'DELETED',
                },
            },
        ]);
        prisma.user.findMany.mockResolvedValueOnce([]);
        const out = await entityService.listPendingInvitations({ userId: 'invitee-1' });
        expect(out).toEqual([]);
    });

    it('returns empty list when no pending invitations', async () => {
        prisma.entityMembership.findMany.mockResolvedValueOnce([]);
        const out = await entityService.listPendingInvitations({ userId: 'invitee-1' });
        expect(out).toEqual([]);
        expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
});

describe('Wave D — POST /api/entities/:id/accept-invitation', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => {
        jest.clearAllMocks();
        mockSeed([
            { id: 'mem-1', userId: 'invitee-1', entityId: ENTITY_ID, role: 'MANAGER',
              status: 'PENDING', invitedBy: 'user-owner', organizationId: 'org-1' },
        ]);
    });

    it('200 + flips status when caller has a PENDING row', async () => {
        const r = await request(app).post(`/api/entities/${ENTITY_ID}/accept-invitation`).send({});
        expect(r.status).toBe(200);
        expect(r.body.data).toMatchObject({ status: 'ACTIVE', role: 'MANAGER' });
    });

    it('404 NOT_INVITED when caller has no membership row', async () => {
        mockSeed([]);
        const r = await request(app).post(`/api/entities/ent-other/accept-invitation`).send({});
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('NOT_INVITED');
    });

    it('409 NOT_PENDING when row is already ACTIVE', async () => {
        mockSeed([
            { id: 'mem-1', userId: 'invitee-1', entityId: ENTITY_ID, role: 'MANAGER',
              status: 'ACTIVE', organizationId: 'org-1' },
        ]);
        const r = await request(app).post(`/api/entities/${ENTITY_ID}/accept-invitation`).send({});
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('NOT_PENDING');
        expect(r.body.status).toBe('ACTIVE');
    });
});

describe('Wave D — POST /api/entities/:id/decline-invitation', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => {
        jest.clearAllMocks();
        mockSeed([
            { id: 'mem-1', userId: 'invitee-1', entityId: ENTITY_ID, role: 'MANAGER',
              status: 'PENDING', invitedBy: 'user-owner', organizationId: 'org-1' },
        ]);
    });

    it('200 + REVOKED when caller declines a PENDING invite', async () => {
        const r = await request(app).post(`/api/entities/${ENTITY_ID}/decline-invitation`).send({});
        expect(r.status).toBe(200);
        expect(r.body.data.status).toBe('REVOKED');
        // Audit row carries reason=DECLINED so the log distinguishes
        // "admin revoked" from "invitee declined".
        expect(prisma.entityMembershipEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                metadata: expect.objectContaining({ reason: 'DECLINED' }),
            }),
        });
    });

    it('404 NOT_INVITED', async () => {
        mockSeed([]);
        const r = await request(app).post(`/api/entities/ent-other/decline-invitation`).send({});
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('NOT_INVITED');
    });
});

describe('Wave D — GET /api/entities/invitations', () => {
    let app;
    beforeAll(() => { app = makeApp(); });

    beforeEach(() => {
        jest.clearAllMocks();
        // mockResolvedValueOnce builds a queue that jest.clearAllMocks
        // does NOT drain in Jest 29. Reset both findMany spies so this
        // describe block's tests see a clean slate even if earlier
        // describes left items in the queue.
        prisma.entityMembership.findMany.mockReset();
        prisma.user.findMany.mockReset();
    });

    it('returns the caller\'s pending invitations', async () => {
        prisma.entityMembership.findMany.mockResolvedValueOnce([
            {
                id: 'mem-1', userId: 'invitee-1', entityId: 'ent-1',
                role: 'MANAGER', status: 'PENDING',
                invitedBy: 'user-owner', invitedAt: new Date('2026-05-02T10:00:00Z'),
                entity: {
                    id: 'ent-1', type: 'JURISTIC', slug: 'abc-co',
                    displayName: 'ABC Co.', isDeleted: false, status: 'ACTIVE',
                },
            },
        ]);
        prisma.user.findMany.mockResolvedValueOnce([
            { id: 'user-owner', firstName: 'Owner', lastName: 'X', email: 'o@x.co' },
        ]);

        const r = await request(app).get('/api/entities/invitations');
        expect(r.status).toBe(200);
        expect(r.body.data).toHaveLength(1);
        expect(r.body.data[0]).toMatchObject({
            entityId: 'ent-1',
            displayName: 'ABC Co.',
            role: 'MANAGER',
            invitedBy: { displayName: 'Owner X' },
        });
    });

    it('"invitations" path string is NOT mistaken for an entity id', async () => {
        // Regression guard: Express routes are order-sensitive.
        // GET /invitations must come before GET /:id.
        prisma.entityMembership.findMany.mockResolvedValueOnce([]);
        prisma.user.findMany.mockResolvedValueOnce([]);
        const r = await request(app).get('/api/entities/invitations');
        expect(r.status).toBe(200);
        // listPendingInvitations was called (proves the right route ran).
        expect(prisma.entityMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ userId: 'invitee-1', status: 'PENDING' }),
        }));
    });
});
