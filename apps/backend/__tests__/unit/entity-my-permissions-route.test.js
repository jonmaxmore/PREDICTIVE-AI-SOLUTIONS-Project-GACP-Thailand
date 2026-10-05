/**
 * Farm-worker Wave C, Chunk 1 — member self-view of effective permissions:
 *
 *   GET /api/entities/:id/my-permissions
 *
 * The Wave-B admin GET (…/members/:memberUserId/permissions) is OWNER-only,
 * so a worker cannot read their OWN effective set — but the FE needs it to
 * gate operation buttons (Wave C chunk 3). This endpoint is the self-view:
 *
 *   - authenticateAny; requester must hold an ACTIVE membership on :id →
 *     404 otherwise (anti-probing, same convention as the sibling routes)
 *   - returns { entityId, role, personal, effective } — REUSES
 *     getEffectiveEntityPermissions (grants applied, REVOKE wins)
 *   - NO grants breakdown (that is the OWNER's admin view)
 *   - `personal` = the requester's own personal INDIVIDUAL entity
 *     (role OWNER on an INDIVIDUAL entity — the exact Wave-A S1 predicate)
 *
 * REAL entity-service + REAL effective-permissions engine over a mocked
 * prisma — proves the whole vertical except the DB.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const passUser = (req, _res, next) => {
        req.user = {
            id: global.__testRequesterId || 'user-worker',
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
            findFirst: jest.fn(),
        },
        entityMemberPermissionGrant: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
        },
        entityMembershipEvent: {
            create: jest.fn().mockResolvedValue({ id: 'evt-mock' }),
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
const WORKER_ID = 'user-worker';

const WORKER_MEMBERSHIP_ROW = {
    id: 'mem-worker', userId: WORKER_ID, entityId: ENTITY_ID,
    role: 'MANAGER', permissions: [], status: 'ACTIVE', organizationId: 'org-1',
};

/** getEntityForMember → entity.findFirst include members (the requester's). */
function primeRequesterMembership({ role = 'MANAGER', entityType = 'JURISTIC', present = true } = {}) {
    prisma.entity.findFirst.mockResolvedValue(present ? {
        id: ENTITY_ID, type: entityType, displayName: 'ABC', status: 'ACTIVE',
        organizationId: 'org-1', isDeleted: false, createdAt: new Date(), updatedAt: new Date(),
        members: [{ role, permissions: [], status: 'ACTIVE' }],
    } : null);
    // the engine's own membership resolve (userId + entityId unique)
    prisma.entityMembership.findUnique.mockResolvedValue(
        present ? { ...WORKER_MEMBERSHIP_ROW, role } : null,
    );
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/entities', entitiesRouter);
    return app;
}

const MY_PATH = `/api/entities/${ENTITY_ID}/my-permissions`;

let app;
beforeAll(() => { app = buildApp(); });
beforeEach(() => {
    jest.clearAllMocks();
    global.__testRequesterId = WORKER_ID;
    prisma.entityMemberPermissionGrant.findMany.mockResolvedValue([]);
});
afterAll(() => { delete global.__testRequesterId; });

describe('GET /entities/:id/my-permissions', () => {
    it('ACTIVE member → 200 with role + effective (role baseline) + personal:false on a workspace', async () => {
        primeRequesterMembership({ role: 'MANAGER' });

        const res = await request(app).get(MY_PATH);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.entityId).toBe(ENTITY_ID);
        expect(res.body.data.role).toBe('MANAGER');
        expect(res.body.data.personal).toBe(false);
        // MANAGER role default includes HARVEST_RECORD but NOT EDIT_FARM
        expect(res.body.data.effective).toContain('HARVEST_RECORD');
        expect(res.body.data.effective).not.toContain('EDIT_FARM');
        // self-view: NO grants breakdown (OWNER's admin view only)
        expect(res.body.data.grants).toBeUndefined();
    });

    it('grants are applied — a REVOKE drops the permission from effective', async () => {
        primeRequesterMembership({ role: 'MANAGER' });
        prisma.entityMemberPermissionGrant.findMany.mockResolvedValue([
            { permission: 'HARVEST_RECORD', effect: 'REVOKE' },
        ]);

        const res = await request(app).get(MY_PATH);

        expect(res.status).toBe(200);
        expect(res.body.data.effective).not.toContain('HARVEST_RECORD');
        // untouched siblings survive
        expect(res.body.data.effective).toContain('UNIT_MANAGE');
    });

    it('GRANT widens a VIEWER (empty baseline) to exactly the granted code', async () => {
        primeRequesterMembership({ role: 'VIEWER' });
        prisma.entityMemberPermissionGrant.findMany.mockResolvedValue([
            { permission: 'ACTIVITY_IRRIGATION', effect: 'GRANT' },
        ]);

        const res = await request(app).get(MY_PATH);

        expect(res.status).toBe(200);
        expect(res.body.data.effective).toEqual(['ACTIVITY_IRRIGATION']);
    });

    it('requester with NO membership on the entity → 404 (anti-probing)', async () => {
        primeRequesterMembership({ present: false });
        const res = await request(app).get(MY_PATH);
        expect(res.status).toBe(404);
    });

    it('PENDING / REVOKED membership → 404 (getEntityForMember filters ACTIVE)', async () => {
        // ACTIVE-filtered include comes back empty ⇒ getEntityForMember → null
        prisma.entity.findFirst.mockResolvedValue({
            id: ENTITY_ID, type: 'JURISTIC', displayName: 'ABC', status: 'ACTIVE',
            organizationId: 'org-1', isDeleted: false, createdAt: new Date(), updatedAt: new Date(),
            members: [],
        });
        prisma.entityMembership.findUnique.mockResolvedValue({
            ...WORKER_MEMBERSHIP_ROW, status: 'PENDING',
        });
        const res = await request(app).get(MY_PATH);
        expect(res.status).toBe(404);
    });

    it('OWNER on their own personal INDIVIDUAL entity → personal:true', async () => {
        primeRequesterMembership({ role: 'OWNER', entityType: 'INDIVIDUAL' });
        const res = await request(app).get(MY_PATH);
        expect(res.status).toBe(200);
        expect(res.body.data.personal).toBe(true);
        expect(res.body.data.role).toBe('OWNER');
    });

    it('non-OWNER member of someone else\'s INDIVIDUAL entity → personal:false (real workspace)', async () => {
        primeRequesterMembership({ role: 'MANAGER', entityType: 'INDIVIDUAL' });
        const res = await request(app).get(MY_PATH);
        expect(res.status).toBe(200);
        expect(res.body.data.personal).toBe(false);
    });
});
