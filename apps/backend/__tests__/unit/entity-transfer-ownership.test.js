// Wave D — transferOwnership helper + POST /api/entities/:id/transfer-ownership.
//
// Closes the production gap where revokeMember refused to remove an
// OWNER but no path existed to actually transfer ownership. After this
// PR, an OWNER can hand the role to another active member; the OWNER
// row is demoted to ADMIN; both updates atomic.

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const passUser = (req, _res, next) => {
        req.user = {
            id: 'user-owner',
            healthId: '1100000000008',
            organizationId: 'org-1',
            canonicalRole: 'health',
            role: 'HEALTH_USER',
        };
        next();
    };
    return { authenticateHealth: passUser, authenticateAny: passUser };
});

// Lightweight in-memory entityMembership store. Names prefixed with
// `mock` so Jest 29 lets the jest.mock() factory reach them — the
// documented escape hatch for outer-scope refs.
const mockMemberships = new Map();
const mockKey = (userId, entityId) => `${userId}::${entityId}`;
const mockSeed = (rows) => {
    mockMemberships.clear();
    rows.forEach((r) => mockMemberships.set(mockKey(r.userId, r.entityId), r));
};

jest.mock('../../services/prisma-database', () => {
    const txClient = {
        entityMembership: {
            findUnique: jest.fn(({ where }) => {
                const k = `${where.userId_entityId.userId}::${where.userId_entityId.entityId}`;
                return Promise.resolve(mockMemberships.get(k) || null);
            }),
            update: jest.fn(({ where, data }) => {
                const k = `${where.userId_entityId.userId}::${where.userId_entityId.entityId}`;
                const existing = mockMemberships.get(k);
                if (!existing) {return Promise.resolve(null);}
                const next = { ...existing, ...data };
                mockMemberships.set(k, next);
                return Promise.resolve(next);
            }),
            findMany: jest.fn(),
            upsert: jest.fn(),
        },
        entity: {
            findFirst: jest.fn(),
            findUnique: jest.fn(({ where }) => Promise.resolve({
                id: where.id, organizationId: 'org-1', isDeleted: false,
            })),
        },
        // Wave D — audit table
        entityMembershipEvent: {
            create: jest.fn(({ data }) => Promise.resolve({ id: 'evt-1', createdAt: new Date(), ...data })),
            findMany: jest.fn(),
        },
        // S6 — transferOwnership clears both memberships' grant rows in the
        // same tx (dedicated suite covers the behaviour; default = no grants).
        entityMemberPermissionGrant: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        $transaction: jest.fn(async (fn) => fn(txClient)),
    };
    return { prisma: txClient };
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

const ENTITY_ID = 'ent-1';
const ENTITY_FIXTURE = {
    id: ENTITY_ID, type: 'JURISTIC', slug: 'abc-co', displayName: 'ABC Co.',
    status: 'ACTIVE', organizationId: 'org-1', payload: null, juristicId: '0105561234560',
    communityRegNo: null, thaiCitizenId: null, isDeleted: false,
    createdAt: new Date(), updatedAt: new Date(),
};

function mockEntityWithCallerRole(role, permissions) {
    prisma.entity.findFirst.mockResolvedValueOnce({
        ...ENTITY_FIXTURE,
        members: [{ role, permissions: permissions || [], status: 'ACTIVE' }],
    });
}

describe('Wave D — transferOwnership helper', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSeed([
            { id: 'mem-owner', userId: 'user-owner', entityId: ENTITY_ID, role: 'OWNER',
              permissions: ['TRANSFER_OWNERSHIP', 'INVITE_MEMBER'], status: 'ACTIVE' },
            { id: 'mem-admin', userId: 'user-admin', entityId: ENTITY_ID, role: 'ADMIN',
              permissions: ['INVITE_MEMBER'], status: 'ACTIVE' },
            { id: 'mem-viewer', userId: 'user-viewer', entityId: ENTITY_ID, role: 'VIEWER',
              permissions: [], status: 'ACTIVE' },
        ]);
    });

    it('demotes OWNER to ADMIN and promotes target atomically', async () => {
        const result = await entityService.transferOwnership({
            entityId: ENTITY_ID,
            fromUserId: 'user-owner',
            toUserId: 'user-admin',
            ipAddress: '203.0.113.5',
            userAgent: 'jest-smoke/1.0',
        });
        expect(result.from.role).toBe('ADMIN');
        expect(result.to.role).toBe('OWNER');
        // Permissions reset to defaults on transfer (intentional clean break).
        expect(result.to.permissions).toContain('SUBMIT_APPLICATION');
        expect(result.to.permissions).toContain('TRANSFER_OWNERSHIP');
        expect(result.from.permissions).toContain('INVITE_MEMBER');
        expect(result.from.permissions).not.toContain('TRANSFER_OWNERSHIP');
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        // Wave D — audit row written inside the same transaction.
        expect(result.audit).toBeDefined();
        expect(prisma.entityMembershipEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                eventType: 'OWNERSHIP_TRANSFER',
                actorUserId: 'user-owner',
                targetUserId: 'user-admin',
                ipAddress: '203.0.113.5',
                userAgent: 'jest-smoke/1.0',
                organizationId: 'org-1',
                metadata: expect.objectContaining({
                    fromUserId: 'user-owner',
                    toUserId: 'user-admin',
                    demotedFrom: 'OWNER',
                    demotedTo: 'ADMIN',
                    promotedFrom: 'ADMIN',
                    promotedTo: 'OWNER',
                }),
            }),
        });
    });

    it('does NOT write an audit row when validation rejects (atomic rollback)', async () => {
        await expect(entityService.transferOwnership({
            entityId: ENTITY_ID,
            fromUserId: 'user-admin', // not the owner
            toUserId: 'user-viewer',
        })).rejects.toMatchObject({ code: 'NOT_OWNER' });
        // The throw happens inside $transaction → Prisma rolls back the
        // whole tx, so the audit-row create call is never made.
        expect(prisma.entityMembershipEvent.create).not.toHaveBeenCalled();
    });

    it('rejects when fromUser is not the active OWNER', async () => {
        await expect(entityService.transferOwnership({
            entityId: ENTITY_ID,
            fromUserId: 'user-admin', // not the owner
            toUserId: 'user-viewer',
        })).rejects.toMatchObject({ code: 'NOT_OWNER' });
    });

    it('rejects when toUser is not an active member', async () => {
        await expect(entityService.transferOwnership({
            entityId: ENTITY_ID,
            fromUserId: 'user-owner',
            toUserId: 'user-stranger',
        })).rejects.toMatchObject({ code: 'TARGET_NOT_MEMBER' });
    });

    it('rejects same-user transfer', async () => {
        await expect(entityService.transferOwnership({
            entityId: ENTITY_ID,
            fromUserId: 'user-owner',
            toUserId: 'user-owner',
        })).rejects.toMatchObject({ code: 'SAME_USER' });
    });

    it('rejects when toUser is somehow already an OWNER', async () => {
        // Defensive — should never happen but seed it directly.
        mockMemberships.set(mockKey('user-second-owner', ENTITY_ID), {
            id: 'mem-2nd', userId: 'user-second-owner', entityId: ENTITY_ID,
            role: 'OWNER', permissions: [], status: 'ACTIVE',
        });
        await expect(entityService.transferOwnership({
            entityId: ENTITY_ID,
            fromUserId: 'user-owner',
            toUserId: 'user-second-owner',
        })).rejects.toMatchObject({ code: 'TARGET_ALREADY_OWNER' });
    });
});

describe('Wave D — POST /api/entities/:id/transfer-ownership', () => {
    let app;
    beforeAll(() => { app = makeApp(); });

    beforeEach(() => {
        jest.clearAllMocks();
        // jest.clearAllMocks only clears .mock.calls; the
        // mockResolvedValueOnce queue persists across tests. Wipe the
        // queue on findFirst explicitly so each test starts clean.
        prisma.entity.findFirst.mockReset();
        mockSeed([
            { id: 'mem-owner', userId: 'user-owner', entityId: ENTITY_ID, role: 'OWNER',
              permissions: ['TRANSFER_OWNERSHIP'], status: 'ACTIVE' },
            { id: 'mem-admin', userId: 'user-admin', entityId: ENTITY_ID, role: 'ADMIN',
              permissions: [], status: 'ACTIVE' },
        ]);
    });

    it('OWNER can transfer to ADMIN', async () => {
        mockEntityWithCallerRole('OWNER', ['TRANSFER_OWNERSHIP']);
        const r = await request(app)
            .post(`/api/entities/${ENTITY_ID}/transfer-ownership`)
            .send({ toUserId: 'user-admin' });
        expect(r.status).toBe(200);
        expect(r.body.data.fromMembership.role).toBe('ADMIN');
        expect(r.body.data.toMembership.role).toBe('OWNER');
    });

    it('400 when toUserId missing', async () => {
        mockEntityWithCallerRole('OWNER', ['TRANSFER_OWNERSHIP']);
        const r = await request(app)
            .post(`/api/entities/${ENTITY_ID}/transfer-ownership`)
            .send({});
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('MISSING_TARGET');
    });

    it('400 when transferring to self', async () => {
        // No need to mockEntityWithCallerRole — this short-circuits before
        // the membership lookup.
        const r = await request(app)
            .post(`/api/entities/${ENTITY_ID}/transfer-ownership`)
            .send({ toUserId: 'user-owner' });
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('SAME_USER');
    });

    it('403 when caller is ADMIN (not OWNER) — TRANSFER_OWNERSHIP denied', async () => {
        mockEntityWithCallerRole('ADMIN', []);
        const r = await request(app)
            .post(`/api/entities/${ENTITY_ID}/transfer-ownership`)
            .send({ toUserId: 'user-admin' });
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('CAPABILITY_DENIED');
        expect(r.body.capability).toBe('TRANSFER_OWNERSHIP');
    });

    it('404 when caller is not a member', async () => {
        prisma.entity.findFirst.mockResolvedValueOnce({ ...ENTITY_FIXTURE, members: [] });
        const r = await request(app)
            .post(`/api/entities/${ENTITY_ID}/transfer-ownership`)
            .send({ toUserId: 'user-admin' });
        expect(r.status).toBe(404);
    });

    it('409 TARGET_NOT_MEMBER when toUserId is a stranger', async () => {
        mockEntityWithCallerRole('OWNER', ['TRANSFER_OWNERSHIP']);
        const r = await request(app)
            .post(`/api/entities/${ENTITY_ID}/transfer-ownership`)
            .send({ toUserId: 'user-stranger' });
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('TARGET_NOT_MEMBER');
    });

    it('GET /audit-log returns events for a member', async () => {
        mockEntityWithCallerRole('OWNER', ['TRANSFER_OWNERSHIP']);
        prisma.entityMembershipEvent.findMany.mockResolvedValueOnce([
            {
                id: 'evt-1', createdAt: new Date('2026-05-02T12:00:00Z'),
                eventType: 'OWNERSHIP_TRANSFER',
                actorUser:  { id: 'user-owner', healthId: '1100000000008', firstName: 'A', lastName: 'B' },
                targetUser: { id: 'user-admin', healthId: '1100000000009', firstName: 'C', lastName: 'D' },
                metadata: { fromUserId: 'user-owner', toUserId: 'user-admin' },
                ipAddress: '203.0.113.5', userAgent: 'jest/1',
            },
        ]);

        const r = await request(app).get(`/api/entities/${ENTITY_ID}/audit-log`);
        expect(r.status).toBe(200);
        expect(r.body.data).toHaveLength(1);
        expect(r.body.data[0]).toMatchObject({
            id: 'evt-1',
            eventType: 'OWNERSHIP_TRANSFER',
            actor:  { id: 'user-owner', displayName: 'A B' },
            target: { id: 'user-admin', displayName: 'C D' },
        });
    });

    it('GET /audit-log returns 404 when caller is not a member', async () => {
        prisma.entity.findFirst.mockResolvedValueOnce({ ...ENTITY_FIXTURE, members: [] });
        const r = await request(app).get(`/api/entities/${ENTITY_ID}/audit-log`);
        expect(r.status).toBe(404);
        expect(prisma.entityMembershipEvent.findMany).not.toHaveBeenCalled();
    });

    it('GET /audit-log clamps limit to [1, 200]', async () => {
        mockEntityWithCallerRole('OWNER', ['TRANSFER_OWNERSHIP']);
        prisma.entityMembershipEvent.findMany.mockResolvedValueOnce([]);
        await request(app).get(`/api/entities/${ENTITY_ID}/audit-log?limit=10000`);
        expect(prisma.entityMembershipEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
            take: 200,
        }));
    });

    it('after transfer, revokeMember error message points to the right flow', async () => {
        // Confirms the docstring + error message stay in sync — Phase 5b
        // will pick this thread up if anyone later wires a UI hint to the
        // error message text.
        try {
            await entityService.revokeMember({ entityId: ENTITY_ID, userId: 'user-owner' });
            throw new Error('expected throw');
        } catch (e) {
            expect(e.code).toBe('CANNOT_REVOKE_OWNER');
            expect(e.message).toMatch(/transferOwnership/);
        }
    });
});
