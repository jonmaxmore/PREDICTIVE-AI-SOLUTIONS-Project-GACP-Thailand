'use strict';

/**
 * R2 Task 8 (spec 2026-09-30-remove-workspace-mode §3.2, Review Focus 5):
 * GET /api/entities/mine rows carry `can: { edit, submit, createFarm }` so the
 * step-1 holder picker knows what the caller may do on each holder.
 *
 *   edit       = role !== 'VIEWER' && membershipStatus === 'ACTIVE'
 *   submit     = SUBMIT_APPLICATION in the effective set (role ∪ permissions[] ∪ GRANT − REVOKE)
 *   createFarm = FARM_CREATE in the effective set
 *
 * A PENDING invite (include=pending) grants nothing: every flag false.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const passHealthUser = (req, _res, next) => {
        req.user = { id: 'user-1', healthId: '1100000000008', canonicalRole: 'health', role: 'health' };
        next();
    };
    return { authenticateHealth: passHealthUser, authenticateAny: passHealthUser };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        entityMembership: { findMany: jest.fn(), findUnique: jest.fn() },
        entityMemberPermissionGrant: { findMany: jest.fn() },
        entityContextSwitch: { create: jest.fn() },
    },
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});

const { prisma } = require('../../services/prisma-database');
const entitiesRouter = require('../../routes/api/entities/index');

function row(entityId, role, status = 'ACTIVE') {
    return {
        id: `mem-${entityId}`, userId: 'user-1', entityId, role, status, permissions: [],
        createdAt: new Date('2026-09-30T00:00:00Z'),
        entity: {
            id: entityId, type: 'JURISTIC', displayName: `บริษัท ${entityId} จำกัด`, slug: null, status: 'ACTIVE',
            thaiCitizenIdHash: null, thaiCitizenIdHmac: null, juristicId: null, communityRegNo: null,
            isDeleted: false, organizationId: 'org-1',
        },
    };
}

const ROWS = [
    row('ent-owner', 'OWNER'),
    row('ent-manager', 'MANAGER'),
    row('ent-viewer', 'VIEWER'),
    row('ent-manager-granted', 'MANAGER'),
    row('ent-pending', 'OWNER', 'PENDING'),
];

describe('GET /api/entities/mine — per-row capability flags', () => {
    let app;
    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/entities', entitiesRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        prisma.entityMembership.findMany.mockImplementation(async ({ where }) => (
            where.status === 'ACTIVE' ? ROWS.filter((r) => r.status === 'ACTIVE') : ROWS
        ));
        prisma.entityMembership.findUnique.mockImplementation(async ({ where }) => {
            const key = where.userId_entityId || {};
            const found = ROWS.find((r) => r.userId === key.userId && r.entityId === key.entityId);
            return found ? { id: found.id, role: found.role, permissions: found.permissions, status: found.status } : null;
        });
        prisma.entityMemberPermissionGrant.findMany.mockImplementation(async ({ where }) => (
            where.membershipId === 'mem-ent-manager-granted'
                ? [{ permission: 'SUBMIT_APPLICATION', effect: 'GRANT' }]
                : []
        ));
    });

    const byId = (body) => Object.fromEntries(body.data.map((r) => [r.id, r]));

    test('OWNER {edit,submit,createFarm} = {true,true,true}', async () => {
        const res = await request(app).get('/api/entities/mine');
        expect(res.status).toBe(200);
        expect(byId(res.body)['ent-owner'].can).toEqual({ edit: true, submit: true, createFarm: true });
    });

    test('MANAGER = {true,false,false}', async () => {
        const res = await request(app).get('/api/entities/mine');
        expect(byId(res.body)['ent-manager'].can).toEqual({ edit: true, submit: false, createFarm: false });
    });

    test('VIEWER = {false,false,false}', async () => {
        const res = await request(app).get('/api/entities/mine');
        expect(byId(res.body)['ent-viewer'].can).toEqual({ edit: false, submit: false, createFarm: false });
    });

    test('MANAGER with a SUBMIT_APPLICATION GRANT → submit:true', async () => {
        const res = await request(app).get('/api/entities/mine');
        expect(byId(res.body)['ent-manager-granted'].can).toEqual({ edit: true, submit: true, createFarm: false });
    });

    test('PENDING (include=pending) → all false', async () => {
        const res = await request(app).get('/api/entities/mine?include=pending');
        expect(res.status).toBe(200);
        const rows = byId(res.body);
        expect(rows['ent-pending'].membershipStatus).toBe('PENDING');
        expect(rows['ent-pending'].can).toEqual({ edit: false, submit: false, createFarm: false });
        // ACTIVE rows keep their flags in the same response.
        expect(rows['ent-owner'].can).toEqual({ edit: true, submit: true, createFarm: true });
    });
});
