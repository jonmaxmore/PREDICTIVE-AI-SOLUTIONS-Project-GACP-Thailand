// Wave C PR C-1 — entities-route contract test.
// Covers GET /api/entities/mine and POST /api/entities/me/switch.

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const passHealthUser = (req, _res, next) => {
        req.user = {
            id: 'user-1',
            healthId: '1100000000008',
            canonicalRole: 'health',
            role: 'HEALTH_USER',
        };
        next();
    };
    return {
        authenticateHealth: passHealthUser,
        authenticateAny: passHealthUser,
    };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        entityMembership: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
        },
        entityContextSwitch: {
            create: jest.fn(),
        },
    },
}));

jest.mock('../../shared/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    // entity-effective-permissions-service destructures createLogger from
    // this module — the mock predated that and the whole suite died at
    // require time with "createLogger is not a function".
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const { prisma } = require('../../services/prisma-database');
const entitiesRouter = require('../../routes/api/entities/index');

const PERSONAL_HEALTH_ID = '1100000000008';
const PERSONAL_HASH = require('crypto').createHash('sha256').update(PERSONAL_HEALTH_ID).digest('hex');

function makeMembership({ id, type, role = 'OWNER', status = 'ACTIVE', displayName, isPersonalHash = false, juristicId = null, communityRegNo = null }) {
    return {
        id: `mem-${id}`,
        userId: 'user-1',
        entityId: id,
        role,
        status,
        permissions: [],
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        entity: {
            id,
            type,
            displayName,
            status: 'ACTIVE',
            organizationId: 'org-1',
            thaiCitizenIdHash: isPersonalHash ? PERSONAL_HASH : null,
            juristicId,
            communityRegNo,
            isDeleted: false,
        },
    };
}

describe('Wave C PR C-1 — /api/entities', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/entities', entitiesRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /mine', () => {
        it('returns the user\'s active memberships, flagging the personal INDIVIDUAL', async () => {
            prisma.entityMembership.findMany.mockResolvedValue([
                makeMembership({ id: 'ent-personal', type: 'INDIVIDUAL', displayName: 'สมชาย ทดสอบ', isPersonalHash: true }),
                makeMembership({ id: 'ent-juristic', type: 'JURISTIC', displayName: 'ABC Co.', juristicId: '0105561234560' }),
            ]);

            const response = await request(app).get('/api/entities/mine');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toHaveLength(2);
            expect(response.body.data[0]).toMatchObject({
                id: 'ent-personal',
                type: 'INDIVIDUAL',
                displayName: 'สมชาย ทดสอบ',
                role: 'OWNER',
                membershipStatus: 'ACTIVE',
                isPersonal: true,
            });
            expect(response.body.data[1]).toMatchObject({
                id: 'ent-juristic',
                type: 'JURISTIC',
                isPersonal: false,
            });
        });

        it('filters out PENDING by default; ?include=pending shows them', async () => {
            // First call (default): only ACTIVE
            prisma.entityMembership.findMany.mockResolvedValueOnce([
                makeMembership({ id: 'ent-1', type: 'INDIVIDUAL', displayName: 'X', isPersonalHash: true }),
            ]);
            const r1 = await request(app).get('/api/entities/mine');
            expect(r1.body.data).toHaveLength(1);
            expect(prisma.entityMembership.findMany).toHaveBeenLastCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }),
            );

            // Second call (with pending): ACTIVE + PENDING
            prisma.entityMembership.findMany.mockResolvedValueOnce([
                makeMembership({ id: 'ent-1', type: 'INDIVIDUAL', displayName: 'X', isPersonalHash: true }),
                makeMembership({ id: 'ent-2', type: 'JURISTIC', displayName: 'Pending', status: 'PENDING' }),
            ]);
            const r2 = await request(app).get('/api/entities/mine?include=pending');
            expect(r2.body.data).toHaveLength(2);
            expect(r2.body.data[1].membershipStatus).toBe('PENDING');
            expect(prisma.entityMembership.findMany).toHaveBeenLastCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ status: { in: ['ACTIVE', 'PENDING'] } }) }),
            );
        });

        it('drops soft-deleted entities even if a stale membership row points at them', async () => {
            prisma.entityMembership.findMany.mockResolvedValue([
                makeMembership({ id: 'ent-1', type: 'INDIVIDUAL', displayName: 'X', isPersonalHash: true }),
                {
                    ...makeMembership({ id: 'ent-2', type: 'JURISTIC', displayName: 'Deleted Co.' }),
                    entity: {
                        id: 'ent-2', type: 'JURISTIC', displayName: 'Deleted Co.',
                        status: 'DELETED', thaiCitizenIdHash: null, juristicId: '0105561234560',
                        communityRegNo: null, isDeleted: true, organizationId: 'org-1',
                    },
                },
            ]);

            const response = await request(app).get('/api/entities/mine');
            expect(response.body.data).toHaveLength(1);
            expect(response.body.data[0].id).toBe('ent-1');
        });
    });

    // R2 Task 12 (spec 2026-09-30 §5): there is no active workspace to switch to;
    // the door is gone and writes nothing.
    describe('POST /me/switch is removed', () => {
        it('answers 404 and records no context switch', async () => {
            const r = await request(app)
                .post('/api/entities/me/switch')
                .send({ fromEntityId: 'ent-personal', toEntityId: 'ent-juristic', source: 'HEADER' });
            expect(r.status).toBe(404);
            expect(prisma.entityContextSwitch.create).not.toHaveBeenCalled();
        });
    });
});
