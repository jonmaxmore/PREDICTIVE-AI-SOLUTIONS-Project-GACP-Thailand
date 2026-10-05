// Wave C PR-4 — workspace management endpoints under /api/entities.
// Covers POST / (create), GET /:id, PATCH /:id, GET /:id/members,
// POST /:id/members (invite), DELETE /:id/members/:memberUserId.

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

jest.mock('../../services/prisma-database', () => {
    // Wave D — addMember / revokeMember now wrap their writes in
    // prisma.$transaction(fn) and write EntityMembershipEvent rows
    // atomically. Stub both, plus a $transaction that just runs the
    // callback with the same `prisma` mock so existing assertions
    // about findUnique/upsert/update still see the calls.
    const mockPrisma = {
        entity: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
        },
        entityMembership: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
        },
        entityContextSwitch: { create: jest.fn() },
        // S6 — revoke/re-invite/transfer clear the membership's grant rows
        // in the same tx (dedicated suite covers it; default = no grants).
        entityMemberPermissionGrant: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        // Wave D PR — audit table for INVITED / ROLE_CHANGED / REVOKED
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
    // Wave B: routes/api/entities pulls the entity permission engine, which
    // uses createLogger (suite failed at require without it).
    return { ...l, createLogger: jest.fn(() => l) };
});

// External-services cleanup T1 (2026-08-19, operator decision
// shared/notification-view.js:16-19): the invite courtesy-email leg was
// DELETED — the in-app /health/workspaces pending list is the sole
// authoritative invite channel now. services/email-service.js itself was
// deleted on 2026-09-15 (no email in the system), so there is nothing left to
// mock; second-factor-is-totp-only.test.js fails if any source requires it again.

const { prisma } = require('../../services/prisma-database');
const entitiesRouter = require('../../routes/api/entities/index');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/entities', entitiesRouter);
    return app;
}

const BASE_ENTITY = {
    id: 'ent-juristic',
    type: 'JURISTIC',
    slug: 'abc-co',
    displayName: 'ABC Co.',
    status: 'ACTIVE',
    organizationId: 'org-1',
    payload: null,
    juristicId: '0105561234560',
    communityRegNo: null,
    thaiCitizenId: null,
    isDeleted: false,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
};

function mockEntityFound({ role = 'OWNER', permissions = ['SUBMIT_APPLICATION', 'INVITE_MEMBER', 'REVOKE_MEMBER', 'EDIT_ENTITY_PROFILE'] } = {}, entity = BASE_ENTITY) {
    prisma.entity.findFirst.mockResolvedValueOnce({
        ...entity,
        members: [{ role, permissions, status: 'ACTIVE' }],
    });
}

describe('Wave C PR-4 — POST /api/entities (create workspace)', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => { jest.clearAllMocks(); });

    it('creates a JURISTIC workspace', async () => {
        prisma.entity.findFirst.mockResolvedValue(null); // no existing
        prisma.entity.create.mockResolvedValue({ ...BASE_ENTITY, id: 'ent-new' });
        prisma.entityMembership.upsert.mockResolvedValue({ id: 'mem-new', role: 'OWNER' });

        const r = await request(app).post('/api/entities').send({
            type: 'JURISTIC',
            applicantData: {
                applicantType: 'JURISTIC',
                taxId: '0105561234560',
                companyName: 'XYZ Co.',
            },
        });

        expect(r.status).toBe(200);
        expect(r.body.data).toMatchObject({ type: 'JURISTIC', role: 'OWNER' });
    });

    it('rejects INDIVIDUAL with 400', async () => {
        const r = await request(app).post('/api/entities').send({
            type: 'INDIVIDUAL',
            applicantData: { idCard: '1100000000008' },
        });
        expect(r.status).toBe(400);
    });

    it('rejects with 400 on validation failure', async () => {
        const r = await request(app).post('/api/entities').send({
            type: 'JURISTIC',
            applicantData: { taxId: '1100000000008', companyName: 'X' }, // not starting 0
        });
        expect(r.status).toBe(400);
        expect(r.body.validationErrors).toBeDefined();
    });
});

describe('Wave C PR-4 — GET /api/entities/:id', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => { jest.clearAllMocks(); });

    it('returns the entity when caller is a member (by uuid)', async () => {
        mockEntityFound();
        const r = await request(app).get('/api/entities/00000000-0000-0000-0000-000000000abc');
        expect(r.status).toBe(200);
        expect(r.body.data).toMatchObject({ id: 'ent-juristic', role: 'OWNER' });
    });

    it('returns the entity when caller is a member (by slug)', async () => {
        mockEntityFound();
        const r = await request(app).get('/api/entities/abc-co');
        expect(r.status).toBe(200);
        expect(prisma.entity.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ slug: 'abc-co' }),
        }));
    });

    it('returns 404 when not a member (no membership probing)', async () => {
        prisma.entity.findFirst.mockResolvedValue({ ...BASE_ENTITY, members: [] });
        const r = await request(app).get('/api/entities/some-other-co');
        expect(r.status).toBe(404);
    });
});

describe('Wave C PR-4 — PATCH /api/entities/:id (rename)', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => { jest.clearAllMocks(); });

    it('OWNER can rename', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.entity.findFirst.mockResolvedValueOnce(null); // slug collision check
        prisma.entity.update.mockResolvedValue({ ...BASE_ENTITY, displayName: 'ABC New Name' });

        const r = await request(app).patch('/api/entities/00000000-0000-0000-0000-000000000abc').send({
            displayName: 'ABC New Name',
        });
        expect(r.status).toBe(200);
        expect(r.body.data.displayName).toBe('ABC New Name');
    });

    it('VIEWER gets 403', async () => {
        mockEntityFound({ role: 'VIEWER', permissions: [] });
        const r = await request(app).patch('/api/entities/00000000-0000-0000-0000-000000000abc').send({
            displayName: 'Hack',
        });
        expect(r.status).toBe(403);
    });

    it('400 when no fields supplied', async () => {
        mockEntityFound();
        const r = await request(app).patch('/api/entities/00000000-0000-0000-0000-000000000abc').send({});
        expect(r.status).toBe(400);
    });
});

describe('Wave C PR-4 — POST /api/entities/:id/members (invite)', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => { jest.clearAllMocks(); });

    it('OWNER invites a MANAGER by healthId', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.user.findFirst.mockResolvedValue({
            id: 'invitee-1', healthId: '1100000000009', firstName: 'B', lastName: 'C', email: null,
        });
        // Existing membership lookup inside addMember (Wave D added
        // this to decide INVITED vs ROLE_CHANGED): no row → INVITED.
        prisma.entityMembership.findUnique.mockResolvedValueOnce(null);
        prisma.entityMembership.upsert.mockResolvedValue({
            id: 'mem-2', userId: 'invitee-1', role: 'MANAGER',
            permissions: ['EDIT_FARM', 'PRINT_QR'], status: 'PENDING',
            invitedBy: 'user-owner', invitedAt: new Date(),
        });
        // entity lookup inside addMember
        prisma.entity.findUnique = jest.fn().mockResolvedValue({ id: 'ent-juristic', organizationId: 'org-1', isDeleted: false });

        const r = await request(app)
            .post('/api/entities/00000000-0000-0000-0000-000000000abc/members')
            .send({
                inviteIdentifier: { type: 'healthId', value: '1100000000009' },
                role: 'MANAGER',
            });

        expect(r.status).toBe(200);
        expect(r.body.data).toMatchObject({ userId: 'invitee-1', role: 'MANAGER', status: 'PENDING' });
    });

    it('rejects role=OWNER (transfer-ownership only)', async () => {
        mockEntityFound({ role: 'OWNER' });
        const r = await request(app)
            .post('/api/entities/00000000-0000-0000-0000-000000000abc/members')
            .send({
                inviteIdentifier: { type: 'healthId', value: '1100000000009' },
                role: 'OWNER',
            });
        expect(r.status).toBe(400);
    });

    it('ADMIN cannot invite another ADMIN', async () => {
        mockEntityFound({ role: 'ADMIN', permissions: ['INVITE_MEMBER'] });
        const r = await request(app)
            .post('/api/entities/00000000-0000-0000-0000-000000000abc/members')
            .send({
                inviteIdentifier: { type: 'healthId', value: '1100000000009' },
                role: 'ADMIN',
            });
        expect(r.status).toBe(403);
    });

    it('returns 404 when invitee not found', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.user.findFirst.mockResolvedValue(null);
        const r = await request(app)
            .post('/api/entities/00000000-0000-0000-0000-000000000abc/members')
            .send({
                inviteIdentifier: { type: 'healthId', value: '0000000000000' },
                role: 'MANAGER',
            });
        expect(r.status).toBe(404);
    });

    it('returns 409 AMBIGUOUS_INVITEE on email collision', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
        const r = await request(app)
            .post('/api/entities/00000000-0000-0000-0000-000000000abc/members')
            .send({
                inviteIdentifier: { type: 'email', value: 'shared@b.co' },
                role: 'MANAGER',
            });
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('AMBIGUOUS_INVITEE');
    });

    // Cleanup T1 removal pin: the courtesy email is gone even when the
    // invitee HAS an email on file (the case that used to fire it). RED
    // against pre-cleanup code (email IS sent today) → GREEN after T1
    // deletes the block. The in-app PENDING membership row (the
    // authoritative channel per the route's own comment) is pinned
    // separately by 'OWNER invites a MANAGER by healthId' above.
    it('never sends an invitation email, even when invitee has email on file (email leg removed T1)', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.user.findFirst.mockResolvedValue({
            id: 'invitee-1', healthId: '1100000000009',
            firstName: 'Bee', lastName: 'Bun', email: 'bee@example.com',
        });
        prisma.entityMembership.findUnique.mockResolvedValueOnce(null);
        prisma.entityMembership.upsert.mockResolvedValue({
            id: 'mem-2', userId: 'invitee-1', role: 'MANAGER',
            permissions: ['EDIT_FARM', 'PRINT_QR'], status: 'PENDING',
            invitedBy: 'user-owner', invitedAt: new Date(),
        });
        prisma.entity.findUnique = jest.fn().mockResolvedValue({
            id: 'ent-juristic', organizationId: 'org-1', isDeleted: false,
        });

        const r = await request(app)
            .post('/api/entities/00000000-0000-0000-0000-000000000abc/members')
            .send({
                inviteIdentifier: { type: 'healthId', value: '1100000000009' },
                role: 'MANAGER',
            });

        expect(r.status).toBe(200);
        expect(r.body.data).toMatchObject({ userId: 'invitee-1', role: 'MANAGER', status: 'PENDING' });
        // Flush any microtasks a lingering fire-and-forget call might use.
        await new Promise((resolve) => setImmediate(resolve));
    });

    it('skips invitation email when invitee has no email on file', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.user.findFirst.mockResolvedValue({
            id: 'invitee-1', healthId: '1100000000009',
            firstName: 'B', lastName: 'C', email: null, // no email
        });
        prisma.entityMembership.findUnique.mockResolvedValueOnce(null);
        prisma.entityMembership.upsert.mockResolvedValue({
            id: 'mem-2', userId: 'invitee-1', role: 'MANAGER',
            permissions: [], status: 'PENDING',
            invitedBy: 'user-owner', invitedAt: new Date(),
        });
        prisma.entity.findUnique = jest.fn().mockResolvedValue({
            id: 'ent-juristic', organizationId: 'org-1', isDeleted: false,
        });

        const r = await request(app)
            .post('/api/entities/00000000-0000-0000-0000-000000000abc/members')
            .send({
                inviteIdentifier: { type: 'healthId', value: '1100000000009' },
                role: 'MANAGER',
            });

        expect(r.status).toBe(200);
        await new Promise((resolve) => setImmediate(resolve));
    });

    it('VIEWER cannot invite (403)', async () => {
        mockEntityFound({ role: 'VIEWER', permissions: [] });
        const r = await request(app)
            .post('/api/entities/00000000-0000-0000-0000-000000000abc/members')
            .send({
                inviteIdentifier: { type: 'healthId', value: '1100000000009' },
                role: 'MANAGER',
            });
        expect(r.status).toBe(403);
    });

    // Wave D — INVITED + ROLE_CHANGED audit rows.
    it('writes an INVITED audit row when inviting a fresh member', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.user.findFirst.mockResolvedValue({
            id: 'invitee-2', healthId: '1100000000009', firstName: 'B', lastName: 'C', email: null,
        });
        prisma.entityMembership.findUnique.mockResolvedValueOnce(null); // fresh
        prisma.entityMembership.upsert.mockResolvedValue({
            id: 'mem-3', userId: 'invitee-2', role: 'MANAGER',
            permissions: [], status: 'PENDING', invitedBy: 'user-owner',
            invitedAt: new Date(),
        });
        prisma.entity.findUnique.mockResolvedValue({
            id: 'ent-juristic', organizationId: 'org-1', isDeleted: false,
        });

        await request(app)
            .post('/api/entities/00000000-0000-0000-0000-000000000abc/members')
            .send({
                inviteIdentifier: { type: 'healthId', value: '1100000000009' },
                role: 'MANAGER',
            });

        expect(prisma.entityMembershipEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                eventType: 'INVITED',
                actorUserId: 'user-owner',
                targetUserId: 'invitee-2',
                metadata: { role: 'MANAGER' },
                organizationId: 'org-1',
            }),
        });
    });

    it('writes a ROLE_CHANGED audit row when promoting an existing member', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.user.findFirst.mockResolvedValue({
            id: 'invitee-3', healthId: '1100000000009', firstName: 'B', lastName: 'C', email: null,
        });
        // Existing member, current role MANAGER → being promoted to ADMIN.
        prisma.entityMembership.findUnique.mockResolvedValueOnce({
            id: 'mem-4', role: 'MANAGER', status: 'ACTIVE',
        });
        prisma.entityMembership.upsert.mockResolvedValue({
            id: 'mem-4', userId: 'invitee-3', role: 'ADMIN',
            permissions: [], status: 'ACTIVE',
        });
        prisma.entity.findUnique.mockResolvedValue({
            id: 'ent-juristic', organizationId: 'org-1', isDeleted: false,
        });

        await request(app)
            .post('/api/entities/00000000-0000-0000-0000-000000000abc/members')
            .send({
                inviteIdentifier: { type: 'healthId', value: '1100000000009' },
                role: 'ADMIN',
            });

        expect(prisma.entityMembershipEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                eventType: 'ROLE_CHANGED',
                actorUserId: 'user-owner',
                targetUserId: 'invitee-3',
                metadata: { fromRole: 'MANAGER', toRole: 'ADMIN' },
            }),
        });
    });

    it('writes NO audit row on idempotent re-invite (same role, no change)', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.user.findFirst.mockResolvedValue({
            id: 'invitee-4', healthId: '1100000000009', firstName: 'B', lastName: 'C', email: null,
        });
        prisma.entityMembership.findUnique.mockResolvedValueOnce({
            id: 'mem-5', role: 'MANAGER', status: 'ACTIVE',
        });
        prisma.entityMembership.upsert.mockResolvedValue({
            id: 'mem-5', userId: 'invitee-4', role: 'MANAGER',
            permissions: [], status: 'ACTIVE',
        });
        prisma.entity.findUnique.mockResolvedValue({
            id: 'ent-juristic', organizationId: 'org-1', isDeleted: false,
        });

        await request(app)
            .post('/api/entities/00000000-0000-0000-0000-000000000abc/members')
            .send({
                inviteIdentifier: { type: 'healthId', value: '1100000000009' },
                role: 'MANAGER',
            });

        expect(prisma.entityMembershipEvent.create).not.toHaveBeenCalled();
    });
});

describe('Wave C PR-4 — DELETE /api/entities/:id/members/:memberUserId', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => { jest.clearAllMocks(); });

    it('OWNER revokes a MANAGER', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.entityMembership.findUnique.mockResolvedValue({
            role: 'MANAGER', status: 'ACTIVE', organizationId: 'org-1',
        });
        prisma.entityMembership.update.mockResolvedValue({ id: 'mem-2', status: 'REVOKED' });

        const r = await request(app).delete('/api/entities/00000000-0000-0000-0000-000000000abc/members/invitee-1');
        expect(r.status).toBe(200);
        expect(r.body.data).toEqual({ revoked: true, membershipId: 'mem-2' });
    });

    // Wave D — REVOKED audit row.
    it('writes a REVOKED audit row alongside the membership update', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.entityMembership.findUnique.mockResolvedValue({
            role: 'MANAGER', status: 'ACTIVE', organizationId: 'org-1',
        });
        prisma.entityMembership.update.mockResolvedValue({ id: 'mem-2', status: 'REVOKED' });

        await request(app).delete('/api/entities/00000000-0000-0000-0000-000000000abc/members/invitee-1');

        expect(prisma.entityMembershipEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                eventType: 'REVOKED',
                actorUserId: 'user-owner',
                targetUserId: 'invitee-1',
                metadata: { role: 'MANAGER' },
                organizationId: 'org-1',
            }),
        });
    });

    it('writes NO audit row on idempotent re-revoke (already REVOKED)', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.entityMembership.findUnique.mockResolvedValue({
            role: 'MANAGER', status: 'REVOKED', organizationId: 'org-1',
        });

        await request(app).delete('/api/entities/00000000-0000-0000-0000-000000000abc/members/invitee-1');

        expect(prisma.entityMembershipEvent.create).not.toHaveBeenCalled();
        expect(prisma.entityMembership.update).not.toHaveBeenCalled();
    });

    it('blocks revoking OWNER (transfer-ownership only)', async () => {
        mockEntityFound({ role: 'OWNER' });
        prisma.entityMembership.findUnique.mockResolvedValue({ role: 'OWNER', status: 'ACTIVE' });

        const r = await request(app).delete('/api/entities/00000000-0000-0000-0000-000000000abc/members/another-owner');
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('CANNOT_REVOKE_OWNER');
    });

    it('VIEWER cannot revoke', async () => {
        mockEntityFound({ role: 'VIEWER', permissions: [] });
        const r = await request(app).delete('/api/entities/00000000-0000-0000-0000-000000000abc/members/some-user');
        expect(r.status).toBe(403);
    });
});
