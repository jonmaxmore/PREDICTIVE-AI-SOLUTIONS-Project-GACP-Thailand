/**
 * Wave B adversarial-verify S9 (2026-07-03) — the four GACP
 * cultivation-record CRUDs gate their WRITES on RECORDS_MANAGE.
 *
 *   - seed-sources            (cycle-scoped)
 *   - fertilizer-records      (cycle-scoped)
 *   - water-sources           (plot-scoped)
 *   - controlled-environments (plot-scoped)
 *
 * Pre-fix these were co-member-writable with NO floor and NO per-permission
 * gate — any ACTIVE workspace member (VIEWER included) could create/edit/
 * delete GACP compliance records. Now create/update/delete run
 * assertFarmActionPermission('RECORDS_MANAGE') on the parent farm (resolved
 * from the probe row); READS stay plain co-member.
 *
 * REAL routes + REAL cultivation-record-service + REAL farm-access + REAL
 * permission engine over a mocked prisma (full vertical minus the DB).
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { id: 'worker-1', healthId: 'health-1' };
        return next();
    },
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        plantingCycle: { findFirst: jest.fn() },
        plot: { findFirst: jest.fn() },
        farm: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
        entityMembership: { findUnique: jest.fn(), findMany: jest.fn() },
        entityMemberPermissionGrant: { findMany: jest.fn() },
        seedSource: {
            findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(),
            update: jest.fn(), delete: jest.fn(),
        },
        waterSource: {
            findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(),
            update: jest.fn(), delete: jest.fn(),
        },
        fertilizerRecord: {
            findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(),
            update: jest.fn(), delete: jest.fn(),
        },
        controlledEnvironment: {
            findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(),
            update: jest.fn(), delete: jest.fn(),
        },
    },
}));

const { prisma } = require('../../services/prisma-database');

const seedSourcesRouter = require('../../routes/api/cultivation/seed-sources');
const waterSourcesRouter = require('../../routes/api/cultivation/water-sources');
const fertilizerRecordsRouter = require('../../routes/api/cultivation/fertilizer-records');
const controlledEnvironmentsRouter = require('../../routes/api/cultivation/controlled-environments');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/seed-sources', seedSourcesRouter);
    app.use('/api/water-sources', waterSourcesRouter);
    app.use('/api/fertilizer-records', fertilizerRecordsRouter);
    app.use('/api/controlled-environments', controlledEnvironmentsRouter);
    return app;
}

const FARM = { ownerId: 'employer-1', entityId: 'ent-1' };

/**
 * Worker is an ACTIVE co-member of ent-1 (role parametrised) on farm-1,
 * owned by someone else. `grants` = the worker's grant rows.
 */
function emulateWorker(role, grants = []) {
    prisma.entityMembership.findMany.mockResolvedValue([{ entityId: 'ent-1', role }]);
    prisma.entityMembership.findUnique.mockResolvedValue({
        id: 'mem-1', role, permissions: [], status: 'ACTIVE',
    });
    prisma.entityMemberPermissionGrant.findMany.mockResolvedValue(grants);
    prisma.farm.findUnique.mockResolvedValue(FARM);
    // Reachability probes resolve on the membership branch.
    prisma.plantingCycle.findFirst.mockResolvedValue({ id: 'cycle-1', farmId: 'farm-1' });
    prisma.plot.findFirst.mockResolvedValue({ id: 'plot-1', farmId: 'farm-1' });
    // Record probes now include the parent's farmId for the gate.
    prisma.seedSource.findFirst.mockResolvedValue({ id: 'ss-1', cycleId: 'cycle-1', cycle: { farmId: 'farm-1' } });
    prisma.waterSource.findFirst.mockResolvedValue({ id: 'ws-1', plotId: 'plot-1', plot: { farmId: 'farm-1' } });
    prisma.fertilizerRecord.findFirst.mockResolvedValue({ id: 'fr-1', cycleId: 'cycle-1', cycle: { farmId: 'farm-1' } });
    prisma.controlledEnvironment.findFirst.mockResolvedValue({ id: 'ce-1', plotId: 'plot-1', plot: { farmId: 'farm-1' } });
}

const RECORDS_MANAGE_GRANT = [{ permission: 'RECORDS_MANAGE', effect: 'GRANT' }];

let app;
beforeAll(() => { app = buildApp(); });

beforeEach(() => {
    jest.clearAllMocks();
    for (const model of ['seedSource', 'waterSource', 'fertilizerRecord', 'controlledEnvironment']) {
        prisma[model].create.mockResolvedValue({ id: `${model}-new` });
        prisma[model].update.mockResolvedValue({ id: `${model}-upd` });
        prisma[model].delete.mockResolvedValue({});
        prisma[model].findMany.mockResolvedValue([]);
    }
});

// [routerBase, createPath, createBody, model]
const SURFACES = [
    ['/api/seed-sources', '/api/seed-sources/cycle/cycle-1', { sourceType: 'PURCHASED' }, 'seedSource'],
    ['/api/water-sources', '/api/water-sources/plot/plot-1', { sourceType: 'WELL' }, 'waterSource'],
    ['/api/fertilizer-records', '/api/fertilizer-records/cycle/cycle-1', { brandName: 'B', registrationNo: 'REG-1', usageDate: '2026-01-01', amount: 1 }, 'fertilizerRecord'],
    ['/api/controlled-environments', '/api/controlled-environments/plot/plot-1', { structureType: 'GREENHOUSE' }, 'controlledEnvironment'],
];

describe.each(SURFACES)('S9 — %s writes gate on RECORDS_MANAGE', (base, createPath, createBody, model) => {
    it('un-granted VIEWER co-member: POST → 403 ENTITY_PERMISSION_DENIED, no create', async () => {
        emulateWorker('VIEWER', []);
        const res = await request(app).post(createPath).send(createBody);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(res.body.permission).toBe('RECORDS_MANAGE');
        expect(prisma[model].create).not.toHaveBeenCalled();
    });

    it('VIEWER with GRANT RECORDS_MANAGE: POST passes (create runs)', async () => {
        emulateWorker('VIEWER', RECORDS_MANAGE_GRANT);
        const res = await request(app).post(createPath).send(createBody);
        expect(res.status).toBe(200);
        expect(prisma[model].create).toHaveBeenCalled();
    });

    it('MANAGER with REVOKE RECORDS_MANAGE: PUT /:id → 403, no update', async () => {
        emulateWorker('MANAGER', [{ permission: 'RECORDS_MANAGE', effect: 'REVOKE' }]);
        const res = await request(app).put(`${base}/rec-1`).send({ description: 'x' });
        expect(res.status).toBe(403);
        expect(prisma[model].update).not.toHaveBeenCalled();
    });

    it('MANAGER (role default holds RECORDS_MANAGE): DELETE /:id passes', async () => {
        emulateWorker('MANAGER', []);
        const res = await request(app).delete(`${base}/rec-1`);
        expect(res.status).toBe(200);
        expect(prisma[model].delete).toHaveBeenCalled();
    });

    it('reads stay plain co-member (VIEWER lists without any grant)', async () => {
        emulateWorker('VIEWER', []);
        const listPath = createPath; // GET on the same collection path
        const res = await request(app).get(listPath);
        expect(res.status).toBe(200);
    });
});
