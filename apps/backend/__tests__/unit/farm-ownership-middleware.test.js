/**
 * Unit tests for farm-ownership middleware
 * Verifies M-011: Cross-tenant ownership enforcement
 */

const { requireFarmOwnership } = require('../../middleware/farm-ownership');

// Mock dependencies
// Task 6: the code under test now passes a holder scope beside its pre-R1 where
// (spec 2026-09-30 §3.1). The scope's own reads are not this suite's subject; the
// real-Postgres walk (health-door-walk-real-postgres.test.js) proves them.
jest.mock('../../services/holder-access', () => ({
    holderScope: async (req) => ({ userId: String(req?.user?.id || ''), readIds: [], editIds: [] }),
    holderReadWhere: () => ({}),
}));
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        farm: {
            findUnique: jest.fn(),
        },
    },
}));
jest.mock('../../shared/logger', () => {
    const l = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() };
    // Wave B: farm-ownership now pulls farm-access + the entity permission
    // engine, both of which use createLogger.
    return { ...l, createLogger: jest.fn(() => l) };
});

// Wave B chunk 4 — the middleware consults these for NON-owner callers only;
// this legacy suite covers the owner/400/401/404/non-member paths, so both
// are stubbed DENY-shaped matching the REAL contracts (co-member behaviour
// has its own suite: farm-ownership-records-permission.test.js):
//   - resolveFarmAccess DENIES by RESOLVING false
//   - assertFarmActionPermission DENIES by THROWING ENTITY_PERMISSION_DENIED
// S12 (adversarial-verify): the old bare `jest.fn()` stub RESOLVED undefined
// — i.e. it silently ALLOWED — the false-green mock-vs-reality class. Any
// test that reached the permission branch would have passed the gate no
// matter what; the stub must deny the way the real engine denies.
jest.mock('../../services/farm-access', () => ({
    resolveFarmAccess: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertFarmActionPermission: jest.fn().mockImplementation(async () => {
        const err = new Error('Workspace member lacks permission');
        err.code = 'ENTITY_PERMISSION_DENIED';
        err.statusCode = 403;
        err.httpStatus = 403;
        throw err;
    }),
}));

const { prisma } = require('../../services/prisma-database');

describe('requireFarmOwnership middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            user: { id: 'user-1' },
            params: {},
            body: {},
            query: {},
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    test('blocks when farmId is missing and not optional (400)', async () => {
        const middleware = requireFarmOwnership();
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(next).not.toHaveBeenCalled();
    });

    test('passes when farmId is missing and optional', async () => {
        const middleware = requireFarmOwnership({ optional: true });
        await middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('blocks when user is not authenticated (401)', async () => {
        req.user = null;
        req.params.farmId = 'farm-1';
        const middleware = requireFarmOwnership();
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('blocks when farm does not exist (404)', async () => {
        req.params.farmId = 'nonexistent';
        prisma.farm.findUnique.mockResolvedValue(null);
        const middleware = requireFarmOwnership();
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('blocks cross-tenant access (403)', async () => {
        req.params.farmId = 'farm-1';
        prisma.farm.findUnique.mockResolvedValue({ id: 'farm-1', ownerId: 'other-user' });
        const middleware = requireFarmOwnership();
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('allows farm owner access', async () => {
        req.params.farmId = 'farm-1';
        prisma.farm.findUnique.mockResolvedValue({ id: 'farm-1', ownerId: 'user-1' });
        const middleware = requireFarmOwnership();
        await middleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.farm).toEqual({ id: 'farm-1', ownerId: 'user-1' });
    });

    test('reads farmId from body when not in params', async () => {
        req.body.farmId = 'farm-1';
        prisma.farm.findUnique.mockResolvedValue({ id: 'farm-1', ownerId: 'user-1' });
        const middleware = requireFarmOwnership();
        await middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('reads farmId from query when not in params or body', async () => {
        req.query.farmId = 'farm-1';
        prisma.farm.findUnique.mockResolvedValue({ id: 'farm-1', ownerId: 'user-1' });
        const middleware = requireFarmOwnership();
        await middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('S12 guard: the permission branch DENIES with the deny-shaped engine stub (never a silent pass)', async () => {
        // Proves the stub matches the real contract (throw, not resolve-undefined):
        // a non-owner hitting a permission-gated site must 403, not next().
        req.params.farmId = 'farm-1';
        prisma.farm.findUnique.mockResolvedValue({ id: 'farm-1', ownerId: 'other-user', entityId: 'ent-1' });
        const middleware = requireFarmOwnership({ permission: 'RECORDS_MANAGE' });
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
});
