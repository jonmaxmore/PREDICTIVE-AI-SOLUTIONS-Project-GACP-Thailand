/**
 * Farm-worker Wave B, Chunk 5 — OWNER-only per-member permission admin API:
 *
 *   GET    /api/entities/:id/members/:memberUserId/permissions
 *   PUT    /api/entities/:id/members/:memberUserId/permissions   { permission, effect, reason? }
 *   DELETE /api/entities/:id/members/:memberUserId/permissions/:permission (inherit)
 *
 * Guards (owner decisions, binding plan): requester must be the entity's
 * OWNER (NOT ADMIN — stricter than the Wave-2 provider pattern); self-guard
 * on writes (SELF_PERMISSION_CHANGE_FORBIDDEN); target must be an ACTIVE
 * member (404); only the FARM-OPERATION taxonomy is grantable (workspace-
 * management codes 400). Writes are transactional with their
 * EntityMembershipEvent audit row (mirrors addMember/revokeMember) and
 * return the fresh GET payload.
 *
 * REAL entity-service + REAL effective-permissions engine over a mocked
 * prisma — the suite proves the whole vertical except the DB.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const passUser = (req, _res, next) => {
        req.user = {
            id: global.__testRequesterId || 'user-owner',
            healthId: '1100000000008',
            organizationId: 'org-1',
            canonicalRole: 'health',
            role: 'HEALTH_USER',
        };
        next();
    };
    return { authenticateHealth: passUser, authenticateAny: passUser };
});

jest.mock('../../services/prisma-database', () => {
    const mockPrisma = {
        entity: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
        },
        entityMembership: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
        },
        entityMemberPermissionGrant: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            upsert: jest.fn(),
            delete: jest.fn(),
        },
        entityMembershipEvent: {
            create: jest.fn().mockResolvedValue({ id: 'evt-mock' }),
            findMany: jest.fn(),
        },
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
const entitiesRouter = require('../../routes/api/entities');

const ENTITY_ID = 'ent-1';
const OWNER_ID = 'user-owner';
const WORKER_ID = 'user-worker';

const OWNER_MEMBERSHIP = { role: 'OWNER', permissions: [], status: 'ACTIVE' };
const WORKER_MEMBERSHIP = {
    id: 'mem-worker', userId: WORKER_ID, entityId: ENTITY_ID,
    role: 'VIEWER', permissions: [], status: 'ACTIVE', organizationId: 'org-1',
};

function primeRequesterIsOwner(role = 'OWNER') {
    // getEntityForMember → entity.findFirst include members (the requester's)
    prisma.entity.findFirst.mockResolvedValue({
        id: ENTITY_ID, type: 'JURISTIC', displayName: 'ABC', status: 'ACTIVE',
        organizationId: 'org-1', isDeleted: false, createdAt: new Date(), updatedAt: new Date(),
        members: [{ ...OWNER_MEMBERSHIP, role }],
    });
}

function primeTarget(membership = WORKER_MEMBERSHIP) {
    prisma.entityMembership.findUnique.mockResolvedValue(membership);
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/entities', entitiesRouter);
    return app;
}

const PERM_PATH = `/api/entities/${ENTITY_ID}/members/${WORKER_ID}/permissions`;

let app;
beforeAll(() => { app = buildApp(); });
beforeEach(() => {
    jest.clearAllMocks();
    global.__testRequesterId = OWNER_ID;
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.entityMembershipEvent.create.mockResolvedValue({ id: 'evt-mock' });
    prisma.entityMemberPermissionGrant.findMany.mockResolvedValue([]);
    prisma.entityMemberPermissionGrant.findUnique.mockResolvedValue(null);
    prisma.entityMemberPermissionGrant.upsert.mockResolvedValue({});
    prisma.entityMemberPermissionGrant.delete.mockResolvedValue({});
});
afterAll(() => { delete global.__testRequesterId; });

describe('GET /entities/:id/members/:userId/permissions', () => {
    it('OWNER sees role/legacy/grants/effective + the farm-operation catalog', async () => {
        primeRequesterIsOwner();
        primeTarget();
        prisma.entityMemberPermissionGrant.findMany.mockResolvedValue([
            { permission: 'HARVEST_RECORD', effect: 'GRANT' },
        ]);

        const res = await request(app).get(PERM_PATH);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            entityId: ENTITY_ID,
            userId: WORKER_ID,
            membershipId: 'mem-worker',
            role: 'VIEWER',
        });
        expect(res.body.data.effective).toContain('HARVEST_RECORD');
        expect(res.body.data.grants).toEqual([{ permission: 'HARVEST_RECORD', effect: 'GRANT' }]);
        // catalog = the grantable farm-operation taxonomy only
        const keys = res.body.data.catalog.map((c) => c.key);
        expect(keys).toContain('HARVEST_RECORD');
        expect(keys).toContain('EDIT_FARM');
        expect(keys).not.toContain('INVITE_MEMBER');
        expect(res.body.data.catalog.every((c) => typeof c.label === 'string' && c.label.length > 0)).toBe(true);
    });

    it('requester with role ADMIN → 403 (OWNER only, stricter than Wave-2)', async () => {
        primeRequesterIsOwner('ADMIN');
        primeTarget();
        const res = await request(app).get(PERM_PATH);
        expect(res.status).toBe(403);
    });

    it('requester not a member of the entity → 404 (no probing)', async () => {
        prisma.entity.findFirst.mockResolvedValue(null);
        const res = await request(app).get(PERM_PATH);
        expect(res.status).toBe(404);
    });

    it('target not an ACTIVE member → 404', async () => {
        primeRequesterIsOwner();
        primeTarget({ ...WORKER_MEMBERSHIP, status: 'REVOKED' });
        const res = await request(app).get(PERM_PATH);
        expect(res.status).toBe(404);
    });
});

describe('PUT /entities/:id/members/:userId/permissions', () => {
    it('valid GRANT → upsert keyed by (membershipId, permission), grantedBy = requester UUID, org mirrored; returns fresh payload', async () => {
        primeRequesterIsOwner();
        primeTarget();

        const res = await request(app).put(PERM_PATH)
            .send({ permission: 'HARVEST_RECORD', effect: 'GRANT', reason: 'ทดลองงานผ่านแล้ว' });

        expect(res.status).toBe(200);
        expect(prisma.entityMemberPermissionGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { membershipId_permission: { membershipId: 'mem-worker', permission: 'HARVEST_RECORD' } },
            create: expect.objectContaining({
                membershipId: 'mem-worker',
                permission: 'HARVEST_RECORD',
                effect: 'GRANT',
                grantedBy: OWNER_ID, // User.id UUID — never a national ID
                organizationId: 'org-1',
            }),
        }));
        // audit row in the same transaction
        expect(prisma.entityMembershipEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                actorUserId: OWNER_ID,
                entityId: ENTITY_ID,
                eventType: 'ENTITY_PERMISSION_GRANTED',
                targetUserId: WORKER_ID,
                metadata: expect.objectContaining({ permission: 'HARVEST_RECORD', effect: 'GRANT' }),
            }),
        }));
        // fresh GET payload comes back so the FE re-renders without a round-trip
        expect(res.body.data.membershipId).toBe('mem-worker');
        expect(Array.isArray(res.body.data.effective)).toBe(true);
    });

    it('REVOKE audits ENTITY_PERMISSION_REVOKED', async () => {
        primeRequesterIsOwner();
        primeTarget({ ...WORKER_MEMBERSHIP, role: 'MANAGER' });

        const res = await request(app).put(PERM_PATH)
            .send({ permission: 'HARVEST_RECORD', effect: 'REVOKE' });

        expect(res.status).toBe(200);
        expect(prisma.entityMembershipEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ eventType: 'ENTITY_PERMISSION_REVOKED' }),
        }));
    });

    it('workspace-management code (INVITE_MEMBER) → 400 INVALID_PERMISSION (not grantable v1)', async () => {
        primeRequesterIsOwner();
        primeTarget();
        const res = await request(app).put(PERM_PATH)
            .send({ permission: 'INVITE_MEMBER', effect: 'GRANT' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_PERMISSION');
        expect(prisma.entityMemberPermissionGrant.upsert).not.toHaveBeenCalled();
    });

    it('garbage permission → 400; bad effect → 400', async () => {
        primeRequesterIsOwner();
        primeTarget();
        let res = await request(app).put(PERM_PATH).send({ permission: 'FARM_DELETE', effect: 'GRANT' });
        expect(res.status).toBe(400);
        res = await request(app).put(PERM_PATH).send({ permission: 'HARVEST_RECORD', effect: 'MAYBE' });
        expect(res.status).toBe(400);
    });

    it('self-guard: owner editing their OWN grants → 403 SELF_PERMISSION_CHANGE_FORBIDDEN', async () => {
        primeRequesterIsOwner();
        const res = await request(app)
            .put(`/api/entities/${ENTITY_ID}/members/${OWNER_ID}/permissions`)
            .send({ permission: 'HARVEST_RECORD', effect: 'REVOKE' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('SELF_PERMISSION_CHANGE_FORBIDDEN');
    });

    it('ADMIN requester → 403 (OWNER only)', async () => {
        primeRequesterIsOwner('ADMIN');
        primeTarget();
        const res = await request(app).put(PERM_PATH)
            .send({ permission: 'HARVEST_RECORD', effect: 'GRANT' });
        expect(res.status).toBe(403);
        expect(prisma.entityMemberPermissionGrant.upsert).not.toHaveBeenCalled();
    });

    it('target not ACTIVE → 404, nothing written', async () => {
        primeRequesterIsOwner();
        primeTarget({ ...WORKER_MEMBERSHIP, status: 'PENDING' });
        const res = await request(app).put(PERM_PATH)
            .send({ permission: 'HARVEST_RECORD', effect: 'GRANT' });
        expect(res.status).toBe(404);
        expect(prisma.entityMemberPermissionGrant.upsert).not.toHaveBeenCalled();
    });
});

describe('DELETE /entities/:id/members/:userId/permissions/:permission (inherit)', () => {
    it('deletes the grant row, audits ENTITY_PERMISSION_RESET, returns fresh payload', async () => {
        primeRequesterIsOwner();
        primeTarget();

        const res = await request(app).delete(`${PERM_PATH}/HARVEST_RECORD`);

        expect(res.status).toBe(200);
        expect(prisma.entityMemberPermissionGrant.delete).toHaveBeenCalledWith(expect.objectContaining({
            where: { membershipId_permission: { membershipId: 'mem-worker', permission: 'HARVEST_RECORD' } },
        }));
        expect(prisma.entityMembershipEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ eventType: 'ENTITY_PERMISSION_RESET' }),
        }));
        expect(res.body.data.membershipId).toBe('mem-worker');
    });

    it('idempotent: P2025 (row already absent) still 200 — inherit IS the target state', async () => {
        primeRequesterIsOwner();
        primeTarget();
        const p2025 = new Error('not found');
        p2025.code = 'P2025';
        prisma.entityMemberPermissionGrant.delete.mockRejectedValue(p2025);

        const res = await request(app).delete(`${PERM_PATH}/HARVEST_RECORD`);
        expect(res.status).toBe(200);
    });

    it('self-guard applies to DELETE too', async () => {
        primeRequesterIsOwner();
        const res = await request(app)
            .delete(`/api/entities/${ENTITY_ID}/members/${OWNER_ID}/permissions/HARVEST_RECORD`);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('SELF_PERMISSION_CHANGE_FORBIDDEN');
    });

    it('invalid permission in the path → 400', async () => {
        primeRequesterIsOwner();
        primeTarget();
        const res = await request(app).delete(`${PERM_PATH}/INVITE_MEMBER`);
        expect(res.status).toBe(400);
    });
});
