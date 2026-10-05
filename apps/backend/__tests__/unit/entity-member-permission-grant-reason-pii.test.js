/**
 * Wave B adversarial-verify M5 + S10 (2026-07-03) — grant `reason` is a
 * plaintext PII ingress.
 *
 * M5 — PUT /entities/:id/members/:userId/permissions body `reason` was
 * persisted VERBATIM to BOTH sinks: entity_member_permission_grants.reason
 * (String) and entity_membership_events.metadata (Json). Neither model has a
 * PDPA extension hook, so a reason like "แทนคุณสมชาย 1186494077533" put a raw
 * 13-digit national ID back into the DB — a regression against the
 * national-ID-at-rest DONE_NO_LEAKS verdict. Fix AT SOURCE:
 * entity-service.setMemberPermissionGrant masks embedded 13-digit runs via
 * maskThaiIdsInText (maskThaiId per run) BEFORE persisting to either sink —
 * covering every caller.
 *
 * Hook decision (adjudicator asked for evidence): ALL
 * entityMembershipEvent.metadata writers live in entity-service.js (7 sites:
 * addMember / revokeMember / set+resetMemberPermissionGrant / accept+decline
 * Invitation / transferOwnership — repo-wide grep). Every other metadata
 * value is a role/permission enum or a User.id UUID; `reason` here is the
 * ONLY free-text ingress and it is masked at source → the Json extension
 * hook is NOT added (documented in entity-service).
 *
 * S10 — bound the reason: when provided, trimmed length must be >= 5 (the
 * sibling admin surface's MIN_REASON_LENGTH) and <= 500, else 400.
 *
 * REAL entity-service + REAL route over a mocked prisma.
 */

'use strict';

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
    const mockPrisma = {
        entity: { findFirst: jest.fn(), findUnique: jest.fn() },
        entityMembership: {
            findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn(),
        },
        entityMemberPermissionGrant: {
            findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(),
            delete: jest.fn(), deleteMany: jest.fn(),
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
const entityService = require('../../services/entity-service');
const entitiesRouter = require('../../routes/api/entities');

const ENTITY_ID = 'ent-1';
const WORKER_ID = 'user-worker';
// Passes the SHARED Mod-11 validator (utils/thai-id-validator) — a REAL
// national-ID-shaped value, not a random string.
const MOD11_ID = '1186494077533';

const WORKER_MEMBERSHIP = {
    id: 'mem-worker', userId: WORKER_ID, entityId: ENTITY_ID,
    role: 'VIEWER', permissions: [], status: 'ACTIVE', organizationId: 'org-1',
};

function primeRequesterIsOwner() {
    prisma.entity.findFirst.mockResolvedValue({
        id: ENTITY_ID, type: 'JURISTIC', displayName: 'ABC', status: 'ACTIVE',
        organizationId: 'org-1', isDeleted: false,
        members: [{ role: 'OWNER', permissions: [], status: 'ACTIVE' }],
    });
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
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.entityMembershipEvent.create.mockResolvedValue({ id: 'evt-mock' });
    prisma.entityMemberPermissionGrant.findMany.mockResolvedValue([]);
    prisma.entityMemberPermissionGrant.findUnique.mockResolvedValue(null);
    prisma.entityMemberPermissionGrant.upsert.mockResolvedValue({});
    prisma.entityMembership.findUnique.mockResolvedValue(WORKER_MEMBERSHIP);
    primeRequesterIsOwner();
});

describe('M5 — a national ID inside `reason` never reaches either sink in plaintext', () => {
    it('route PUT: grant row AND event metadata receive the MASKED reason', async () => {
        const res = await request(app).put(PERM_PATH).send({
            permission: 'HARVEST_RECORD',
            effect: 'GRANT',
            reason: `มอบสิทธิ์แทนคุณสมชาย ${MOD11_ID} ชั่วคราว`,
        });
        expect(res.status).toBe(200);

        const upsertArgs = prisma.entityMemberPermissionGrant.upsert.mock.calls[0][0];
        expect(JSON.stringify(upsertArgs)).not.toContain(MOD11_ID);
        expect(upsertArgs.create.reason).toContain('มอบสิทธิ์แทนคุณสมชาย');
        expect(upsertArgs.create.reason).toContain('1-XXXX-XXXX-X-7533');
        expect(upsertArgs.update.reason).toContain('1-XXXX-XXXX-X-7533');

        const eventArgs = prisma.entityMembershipEvent.create.mock.calls[0][0];
        expect(JSON.stringify(eventArgs)).not.toContain(MOD11_ID);
        expect(eventArgs.data.metadata.reason).toContain('1-XXXX-XXXX-X-7533');
    });

    it('service-level (source): setMemberPermissionGrant masks a whole-string ID reason for ANY caller', async () => {
        await entityService.setMemberPermissionGrant({
            entityId: ENTITY_ID,
            targetUserId: WORKER_ID,
            permission: 'HARVEST_RECORD',
            effect: 'REVOKE',
            reason: MOD11_ID,
            actorUserId: 'user-owner',
        });

        const upsertArgs = prisma.entityMemberPermissionGrant.upsert.mock.calls[0][0];
        expect(JSON.stringify(upsertArgs)).not.toContain(MOD11_ID);
        expect(upsertArgs.create.reason).toBe('1-XXXX-XXXX-X-7533');

        const eventArgs = prisma.entityMembershipEvent.create.mock.calls[0][0];
        expect(JSON.stringify(eventArgs)).not.toContain(MOD11_ID);
    });

    it('a 13-digit run inside a longer digit run is NOT mangled (not an ID)', async () => {
        const reason = 'อ้างอิงใบแจ้งหนี้เลขที่ 12345678901234567890';
        await entityService.setMemberPermissionGrant({
            entityId: ENTITY_ID,
            targetUserId: WORKER_ID,
            permission: 'HARVEST_RECORD',
            effect: 'GRANT',
            reason,
            actorUserId: 'user-owner',
        });
        const upsertArgs = prisma.entityMemberPermissionGrant.upsert.mock.calls[0][0];
        expect(upsertArgs.create.reason).toBe(reason);
    });
});

describe('S10 — reason bounds (when provided): trimmed >= 5 and <= 500', () => {
    it.each([
        ['too short', 'abc'],
        ['too long', 'x'.repeat(501)],
    ])('PUT with a %s reason → 400 VALIDATION_ERROR, nothing persisted', async (_label, reason) => {
        const res = await request(app).put(PERM_PATH).send({
            permission: 'HARVEST_RECORD', effect: 'GRANT', reason,
        });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(prisma.entityMemberPermissionGrant.upsert).not.toHaveBeenCalled();
        expect(prisma.entityMembershipEvent.create).not.toHaveBeenCalled();
    });

    it('PUT without a reason stays valid (reason is optional)', async () => {
        const res = await request(app).put(PERM_PATH).send({
            permission: 'HARVEST_RECORD', effect: 'GRANT',
        });
        expect(res.status).toBe(200);
        expect(prisma.entityMemberPermissionGrant.upsert).toHaveBeenCalled();
    });

    it('PUT with a 5-char and a 500-char reason both pass', async () => {
        let res = await request(app).put(PERM_PATH).send({
            permission: 'HARVEST_RECORD', effect: 'GRANT', reason: 'abcde',
        });
        expect(res.status).toBe(200);
        res = await request(app).put(PERM_PATH).send({
            permission: 'HARVEST_RECORD', effect: 'GRANT', reason: 'y'.repeat(500),
        });
        expect(res.status).toBe(200);
    });
});
