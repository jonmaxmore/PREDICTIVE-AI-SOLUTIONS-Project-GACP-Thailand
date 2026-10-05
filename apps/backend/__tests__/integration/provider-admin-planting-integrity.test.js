const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth-middleware', () => ({
  authenticateProvider: (req, _res, next) => {
    req.user = {
      id: 'provider-1',
      role: 'admin',
      canonicalRole: 'admin',
      providerId: '1234567890123',
    };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../../shared/canonical-rbac', () => ({
  PERMISSIONS: {
    APPLICATION_VIEW_ALL: 'application.view.all',
  },
  ROLE_GROUPS: {
    ALL_PROVIDER: ['admin', 'document_reviewer', 'auditor', 'scheduler', 'account'],
    ADMIN_ONLY: ['admin'],
    REVIEWERS: ['admin', 'document_reviewer', 'auditor'],
    AUDIT_STAFF: ['admin', 'document_reviewer', 'auditor', 'scheduler'],
    FINANCE: ['admin', 'account'],
    SCHEDULERS: ['admin', 'scheduler'],
    FULL_STAFF: ['admin', 'document_reviewer', 'auditor', 'scheduler', 'account'],
  },
  CANONICAL_ROLES: {
    ADMIN: 'admin', SCHEDULER: 'scheduler', DOCUMENT_REVIEWER: 'document_reviewer',
    AUDITOR: 'auditor', HEAD_AUDITOR: 'auditor', ACCOUNT: 'account', HEALTH: 'health',
  },
  hasPermission: jest.fn(() => true),
  normalizeRole: jest.fn((role) => role),
  isProviderRole: jest.fn(() => true),
  canonicalToLegacyRole: jest.fn((role) => role?.toUpperCase()),
}));

jest.mock('../../services/prisma-database', () => ({
  prisma: {
    plantingCycle: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    plantUnit: {
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    harvestBatch: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    lot: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    traceQrSecurity: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    cultivationLog: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  },
}));

jest.mock('../../shared/logger', () => {
  const mockLog = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
  mockLog.createLogger = jest.fn(() => ({ ...mockLog }));
  mockLog.stream = { write: jest.fn() };
  return mockLog;
});

// Prevent open handles from Redis connection and rate-limiter setInterval
jest.mock('../../config/redis', () => null);
jest.mock('../../services/cache-service', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  getOrSet: jest.fn((_key, fn) => fn()),
}));
jest.mock('../../middleware/rate-limiter', () => {
  const pass = (_req, _res, next) => next();
  return { rateLimiter: pass, strictRateLimiter: pass, createRateLimiter: () => pass };
});

const { prisma } = require('../../services/prisma-database');
const providerPlantingRouter = require('../../routes/api/provider/planting');
const adminPlantingRouter = require('../../routes/api/admin/planting');

const cycleRecord = {
  id: 'cycle-1',
  cycleName: 'Legacy Cycle',
  status: 'HARVESTED',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  expectedHarvestDate: new Date('2026-02-01T00:00:00.000Z'),
  isDeleted: false,
  farm: {
    id: 'farm-1',
    farmName: 'Certified Farm',
    ownerId: 'health-user-1',
    district: 'Muang',
    province: 'Bangkok',
  },
  cyclePlots: [
    {
      id: 'cp-1',
      allocatedAreaSqm: 8000,
      plannedPlantCount: 8000,
      plot: {
        id: 'plot-1',
        name: 'Plot A',
        solarSystem: 'OUTDOOR',
      },
    },
  ],
  _count: {
    plantUnits: 20000,
    cultivationLogs: 0,
    batches: 1,
  },
};

/**
 * The officer and admin cycle surfaces publish NO per-plant integrity summary.
 *
 * They used to. `integrity` reported totalPlantUnits / activeUnits /
 * removedUnits / overPlanCount / unassignedCount / traceabilityReady — an audit
 * of PlantUnit rows against the declared plan — and `counts.plantUnits` sat
 * beside it. R8 of design note 2026-08-20-planting-tnt-design
 * retires per-plant tracking, so on 2026-08-25 both were removed rather than
 * zeroed: a `traceabilityReady: true` computed from no rows is a green tick
 * that means nothing, and an officer would act on it.
 *
 * The fixture below deliberately keeps `_count.plantUnits: 20000` and arms the
 * prisma.plantUnit mocks. If a handler starts reading either again, these tests
 * fail instead of passing on an empty fixture.
 */
describe('Provider/Admin planting cycles — no per-plant integrity summary', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/provider/planting-cycles', providerPlantingRouter);
    app.use('/api/admin/planting-cycles', adminPlantingRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.plantingCycle.findMany.mockResolvedValue([cycleRecord]);
    prisma.plantingCycle.count.mockResolvedValue(1);
    prisma.plantingCycle.findUnique.mockResolvedValue(cycleRecord);

    // Armed, not empty: a re-added groupBy/count would get a real answer back,
    // so the "never queried" assertions below are the thing that catches it.
    prisma.plantUnit.groupBy.mockResolvedValue([{ cycleId: 'cycle-1', _count: { _all: 20000 } }]);
    prisma.plantUnit.count.mockResolvedValue(20000);
  });

  it('provider list and detail carry no integrity object and no plantUnits count', async () => {
    const listRes = await request(app).get('/api/provider/planting-cycles');
    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data[0]).not.toHaveProperty('integrity');
    expect(listRes.body.data[0].counts).not.toHaveProperty('plantUnits');
    // What the officer still gets: the activity/batch/lot rollup.
    expect(listRes.body.data[0].counts).toEqual(
      expect.objectContaining({ activities: 0, batches: 1, lots: 0 }),
    );
    // And the declared plant count, on the plot assignment where it belongs.
    expect(listRes.body.data[0].plotCount).toBe(1);

    const detailRes = await request(app).get('/api/provider/planting-cycles/cycle-1');
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.success).toBe(true);
    expect(detailRes.body.data).not.toHaveProperty('integrity');
    expect(detailRes.body.data._count).not.toHaveProperty('plantUnits');
    expect(detailRes.body.data.cyclePlots[0].plannedPlantCount).toBe(8000);
  });

  it('admin list and detail carry no integrity object and no plantUnits count', async () => {
    const listRes = await request(app).get('/api/admin/planting-cycles');
    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data[0]).not.toHaveProperty('integrity');
    expect(listRes.body.data[0].counts).not.toHaveProperty('plantUnits');

    const detailRes = await request(app).get('/api/admin/planting-cycles/cycle-1');
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.success).toBe(true);
    expect(detailRes.body.data).not.toHaveProperty('integrity');
    expect(detailRes.body.data._count).not.toHaveProperty('plantUnits');
    expect(detailRes.body.data.cyclePlots[0].plannedPlantCount).toBe(8000);
  });

  it('neither surface queries the per-plant table at all', async () => {
    await request(app).get('/api/provider/planting-cycles');
    await request(app).get('/api/provider/planting-cycles/cycle-1');
    await request(app).get('/api/admin/planting-cycles');
    await request(app).get('/api/admin/planting-cycles/cycle-1');

    expect(prisma.plantUnit.groupBy).not.toHaveBeenCalled();
    expect(prisma.plantUnit.count).not.toHaveBeenCalled();
  });
});
