// Farm-worker Wave A, Chunk 3 (2026-07-02) — route-level proof that a
// workspace co-member (ACTIVE EntityMembership on the farm's entity) passes
// where they previously 404'd/403'd, on one cultivation MUTATION
// (DELETE /plots/:id) and one READ (GET /harvest-batches/:id).
//
// The plots test runs the REAL farm-access helper against a mocked
// prisma.entityMembership, so it exercises the actual membership predicate,
// not a stub of it.

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        // Wave B chunk 4: farm.findUnique + the grants table feed the REAL
        // entity-effective-permissions engine behind the new per-permission
        // gates on plots (create/delete → CYCLE_CREATE).
        farm: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
        entityMembership: { findUnique: jest.fn(), findMany: jest.fn() },
        entityMemberPermissionGrant: { findMany: jest.fn() },
        // B6 (2026-09-05): the plot door now asks whether a live certificate limits what
        // may be planted here (services/certified-scope.js), and that guard fails CLOSED
        // when it cannot read — a scope lock that lapses whenever the database hiccups is
        // open exactly when things are going wrong. These fixtures are farms with no
        // certificate yet, which is what this suite is about, so the read answers null.
        certificate: { findMany: jest.fn(async () => []) },
    },
}));

jest.mock('../../shared/logger', () => {
    const noop = () => {};
    const fake = { debug: noop, info: noop, warn: noop, error: noop };
    return { ...fake, createLogger: () => fake, logger: fake };
});

jest.mock('../../shared', () => {
    const noop = () => {};
    return { logger: { debug: noop, info: noop, warn: noop, error: noop } };
});

// Auth: inject the WORKER (not the farm owner).
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { id: 'worker-1', role: 'health' };
        next();
    },
}));

jest.mock('../../services/planting-service', () => ({
    findPlotWithFarmOwner: jest.fn(),
    deletePlot: jest.fn().mockResolvedValue({}),
    createPlotForFarm: jest.fn().mockResolvedValue({ id: 'plot-new' }),
}));

jest.mock('../../services/harvest-service', () => ({
    getById: jest.fn(),
    list: jest.fn(),
}));

jest.mock('../../services/qrcode/qrcode-service', () => ({}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn() },
    AuditCategory: {},
    AuditSeverity: {},
    ResourceType: {},
}));

jest.mock('../../utils/field-encryption', () => ({
    maskThaiId: (v) => v,
}));

// farm-service is mocked for the harvest-batches route (id-set guard wiring);
// the plots route uses the REAL services/farm-access.js underneath.
jest.mock('../../services/farm-service', () => ({
    listOwnerFarmIds: jest.fn().mockResolvedValue([]),
    listAccessibleFarmIds: jest.fn(),
    findOwnedFarmForPlotOps: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { prisma } = require('../../services/prisma-database');
const plantingService = require('../../services/planting-service');
const harvestService = require('../../services/harvest-service');
const farmService = require('../../services/farm-service');

function makeApp(router, mountPath = '/') {
    const app = express();
    app.use(express.json());
    app.use(mountPath, router);
    return app;
}

describe('Wave A chunk 3 — DELETE /plots/:id (mutation) honours entity co-membership', () => {
    let app;
    beforeAll(() => {
        const router = require('../../routes/api/cultivation/plots');
        app = makeApp(router);
    });
    beforeEach(() => {
        jest.clearAllMocks();
        // Wave B: the real permission engine reads the grants table — no
        // grants by default so the role baseline governs.
        prisma.entityMemberPermissionGrant.findMany.mockResolvedValue([]);
    });

    it('ACTIVE co-member of the farm entity can delete (previously 404)', async () => {
        plantingService.findPlotWithFarmOwner.mockResolvedValue({
            id: 'plot-1',
            farm: { ownerId: 'owner-9', entityId: 'ent-1' },
        });
        // Wave B: the same lookup also feeds the permission engine — MANAGER
        // role default carries CYCLE_CREATE, so the delete still passes.
        prisma.entityMembership.findUnique.mockResolvedValue({
            id: 'mem-1', status: 'ACTIVE', role: 'MANAGER', permissions: [],
        });

        const res = await request(app).delete('/plots/plot-1');
        expect(res.status).toBe(200);
        expect(plantingService.deletePlot).toHaveBeenCalledWith('plot-1');
    });

    it('M2: un-granted ACTIVE VIEWER cannot delete — the CYCLE_CREATE gate denies with an explicit 403', async () => {
        plantingService.findPlotWithFarmOwner.mockResolvedValue({
            id: 'plot-1',
            farm: { ownerId: 'owner-9', entityId: 'ent-1' },
        });
        prisma.entityMembership.findUnique.mockResolvedValue({
            id: 'mem-1', status: 'ACTIVE', role: 'VIEWER', permissions: [],
        });

        const res = await request(app).delete('/plots/plot-1');
        // M2 — reachability is read-shaped so a GRANT-holding VIEWER can act;
        // the un-granted VIEWER is denied BY the engine (403, code named).
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(plantingService.deletePlot).not.toHaveBeenCalled();
    });

    it('PENDING member still 404s (no mutation)', async () => {
        plantingService.findPlotWithFarmOwner.mockResolvedValue({
            id: 'plot-1',
            farm: { ownerId: 'owner-9', entityId: 'ent-1' },
        });
        prisma.entityMembership.findUnique.mockResolvedValue({ status: 'PENDING' });

        const res = await request(app).delete('/plots/plot-1');
        expect(res.status).toBe(404);
        expect(plantingService.deletePlot).not.toHaveBeenCalled();
    });

    it('entityId=null plot farm stays owner-only → 404 for the worker', async () => {
        plantingService.findPlotWithFarmOwner.mockResolvedValue({
            id: 'plot-1',
            farm: { ownerId: 'owner-9', entityId: null },
        });

        const res = await request(app).delete('/plots/plot-1');
        expect(res.status).toBe(404);
        expect(prisma.entityMembership.findUnique).not.toHaveBeenCalled();
        expect(plantingService.deletePlot).not.toHaveBeenCalled();
    });

    it('owner still deletes (regression)', async () => {
        plantingService.findPlotWithFarmOwner.mockResolvedValue({
            id: 'plot-1',
            farm: { ownerId: 'worker-1', entityId: null },
        });

        const res = await request(app).delete('/plots/plot-1');
        expect(res.status).toBe(200);
    });

    it('M2: plot CREATE probes read-shaped — the CYCLE_CREATE gate is the mutation authority', async () => {
        farmService.findOwnedFarmForPlotOps.mockResolvedValue({
            id: 'farm-9',
            cultivationMethod: 'OUTDOOR',
        });
        // Wave B: the CYCLE_CREATE gate loads the farm row + the worker's
        // membership through the REAL engine (MANAGER default → allowed).
        prisma.farm.findUnique.mockResolvedValue({ ownerId: 'owner-9', entityId: 'ent-1' });
        prisma.entityMembership.findUnique.mockResolvedValue({
            id: 'mem-1', status: 'ACTIVE', role: 'MANAGER', permissions: [],
        });

        const res = await request(app)
            .post('/farms/farm-9/plots')
            .send({ name: 'แปลง 1', area: 2, solarSystem: 'OUTDOOR' });

        expect(res.status).toBe(201);
        // M2 — no VIEWER floor here: a VIEWER holding a CYCLE_CREATE GRANT
        // must reach the gate; an un-granted VIEWER is denied BY the gate.
        expect(farmService.findOwnedFarmForPlotOps).toHaveBeenCalledWith('farm-9', 'worker-1');
    });

    it('S2: plot LIST keeps the read-shaped probe (no forMutation)', async () => {
        farmService.findOwnedFarmForPlotOps.mockResolvedValue({
            id: 'farm-9',
            cultivationMethod: 'OUTDOOR',
        });
        const plantingSvc = require('../../services/planting-service');
        plantingSvc.listPlotsByFarm = jest.fn().mockResolvedValue([]);

        const res = await request(app).get('/farms/farm-9/plots');

        expect(res.status).toBe(200);
        expect(farmService.findOwnedFarmForPlotOps).toHaveBeenCalledWith('farm-9', 'worker-1');
    });
});

describe('Wave A chunk 3 — GET /harvest-batches/:id (read) uses the accessible-farm set', () => {
    let app;
    beforeAll(() => {
        const router = require('../../routes/api/cultivation/harvest-batches');
        app = makeApp(router);
    });
    beforeEach(() => jest.clearAllMocks());

    it('co-member sees a workspace batch (previously 403 via owner-only farm ids)', async () => {
        harvestService.getById.mockResolvedValue({ id: 'batch-1', farmId: 'farm-9' });
        farmService.listAccessibleFarmIds.mockResolvedValue(['farm-9']);
        // legacy owner-only set stays empty — proves the route switched guards
        farmService.listOwnerFarmIds.mockResolvedValue([]);

        const res = await request(app).get('/batch-1');
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe('batch-1');
        expect(farmService.listAccessibleFarmIds).toHaveBeenCalledWith('worker-1');
    });

    it('non-member is still denied', async () => {
        harvestService.getById.mockResolvedValue({ id: 'batch-1', farmId: 'farm-9' });
        farmService.listAccessibleFarmIds.mockResolvedValue([]);

        const res = await request(app).get('/batch-1');
        expect(res.status).toBe(403);
    });
});
