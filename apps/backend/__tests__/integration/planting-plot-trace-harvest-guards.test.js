const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
  const pass = (req, _res, next) => {
    req.user = { id: 'health-user-1' };
    req.healthIdentity = { healthId: '1100100100011' };
    next();
  };
  const noop = (_req, _res, next) => next();
  return {
    authenticateHealth: pass,
    authenticate: pass,
    authenticateProvider: noop,
    authenticateDTAM: noop,
    optionalAuth: noop,
    requireVerification: noop,
    authorizeRoles: () => noop,
    authorize: () => noop,
    requireRole: () => noop,
    checkPermission: () => noop,
    rateLimitSensitive: () => noop,
  };
});

// Break circular dep: trace.js → trace-service → server.js → routes/api → trace.js
jest.mock('../../services/trace-service', () => ({
  FDA_REFERRAL: { name: 'FDA', phone: '1556' },
  SAFETY_DISCLAIMER: {},
  TRACE_BASE_URL: 'http://localhost',
  TRACE_NOT_FOUND_MESSAGE: 'Not found',
  PLOT_HARVEST_META_PREFIX: 'PLOT_HARVEST_META:',
  formatCultivationType: jest.fn((t) => t || ''),
  formatThaiDate: jest.fn((d) => d ? String(d) : null),
  generateQRCodeString: jest.fn(() => 'QR-TEST'),
  parseJsonMetaFromNotes: jest.fn(() => null),
  normalizeSourceFromPayload: jest.fn(() => ({ farm: {}, cycle: {}, plot: {} })),
  buildIntegrityPayload: jest.fn(() => ({ available: false })),
  logPublicTraceAccess: jest.fn().mockResolvedValue(undefined),
  resolveTraceByPlotCycleQr: jest.fn().mockResolvedValue({
    status: 200,
    body: {
      success: true,
      type: 'PLOT_CYCLE',
      data: {
        source: {
          plot: { plotId: 'plot-1', plotName: 'Plot A', cyclePlotId: 'cp-1' },
          cycle: { cycleId: 'cycle-1', cycleName: 'Cycle 1' },
          cultivationMethod: 'OUTDOOR',
        },
        farm: { name: 'Farm Alpha', alias: 'Fa***', district: 'Mueang', province: 'Chiang Mai' },
        // No `plantUnits` block and no `links.healthPlantingUnitsUrl`: R8 of
        // design note 2026-08-20-planting-tnt-design retired
        // per-plant tracking on 2026-08-25, so the plot-cycle trace body carries
        // neither a per-plant roll-up nor a deep link into the deleted per-plant
        // registry tab.
        verification: { valid: true, scannedAt: new Date().toISOString() },
      },
    },
  }),
  resolveTraceByGenericQr: jest.fn().mockResolvedValue({ status: 200, body: { success: true } }),
}));

jest.mock('../../services/planting-service', () => ({
  listByOwner: jest.fn(),
  listByFarm: jest.fn(),
  createCycle: jest.fn(),
  getById: jest.fn(),
  updateCycle: jest.fn(),
}));

// There is deliberately no jest.mock for '../../services/plant-unit-service':
// that module was deleted on 2026-08-25 with per-plant tracking (spec R8).
// jest.mock on a path with no file throws at load time, and mocking it back into
// existence would hide a re-added require behind a stub.

jest.mock('../../middleware/audit-logger', () => ({
  auditLogger: {
    log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  },
  AuditCategory: {
    APPLICATION: 'APPLICATION',
  },
  AuditSeverity: {
    INFO: 'INFO',
  },
  ResourceType: {
    SYSTEM: 'SYSTEM',
  },
}));

jest.mock('../../services/qrcode/qrcode-service', () => ({
  generateQRCodeId: jest.fn(),
  generatePublicTraceUrl: jest.fn(),
  registerTraceIntegrity: jest.fn().mockResolvedValue({}),
  recordTraceScan: jest.fn().mockResolvedValue({
    available: true,
    valid: true,
    signatureValid: true,
    hashValid: true,
    chainValid: true,
    signatureAlgorithm: 'RSA-SHA256',
  }),
}));

jest.mock('../../services/prisma-database', () => ({
  prisma: {
    plantingCycle: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    plantingCyclePlot: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    farm: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      // Wave B — the per-permission gate (assertFarmActionPermission) loads
      // { ownerId, entityId } by id; without this the engine fail-closes to
      // 403 before the 400 validators under test are ever reached.
      findUnique: jest.fn(),
    },
    entityMembership: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    certificate: {
      findMany: jest.fn(),
    },
    plot: {
      findMany: jest.fn(),
    },
    traceQrSecurity: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    cultivationLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    harvestBatch: {
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    lot: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    // No `plantUnit` delegate. The harvest door may not read PlantUnit rows any
    // more (spec R8); leaving the delegate off means a re-added read fails loudly
    // here instead of quietly collecting a mocked zero.
    $transaction: jest.fn(),
  },
}));

const { prisma } = require('../../services/prisma-database');
const qrcodeService = require('../../services/qrcode/qrcode-service');
const plantingService = require('../../services/planting-service');
const plantingCyclesRouter = require('../../routes/api/cultivation/planting-cycles');
const traceRouter = require('../../routes/api/trace/trace');

describe('Planting plot QR + trace + harvest validations', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/planting-cycles', plantingCyclesRouter);
    app.use('/api/trace', traceRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.harvestBatch.findMany.mockResolvedValue([]);
    prisma.plantingCycle.findMany.mockResolvedValue([]);
    prisma.farm.findFirst.mockResolvedValue({
      id: 'farm-1',
      ownerId: 'health-user-1',
      isDeleted: false,
    });
    prisma.farm.findMany.mockResolvedValue([]);
    // Solo legacy farm (entityId=null) → the caller passes the permission
    // gate via the byte-identical LEGACY_OWNER fast-path (no membership read).
    prisma.farm.findUnique.mockResolvedValue({
      id: 'farm-1',
      ownerId: 'health-user-1',
      entityId: null,
    });
    prisma.entityMembership.findUnique.mockResolvedValue(null);
    prisma.entityMembership.findMany.mockResolvedValue([]);
    prisma.certificate.findMany.mockResolvedValue([]);
    prisma.plot.findMany.mockResolvedValue([]);
    prisma.plantingCyclePlot.findFirst.mockResolvedValue(null);

    prisma.plantingCycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      farmId: 'farm-1',
    });
    prisma.plantingCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      cycleName: 'Cycle 1',
      status: 'PLANTED',
      estimatedPlantCount: 100,
    });

    qrcodeService.generatePublicTraceUrl.mockImplementation((path) => `http://localhost/trace/${path}`);
    plantingService.listByOwner.mockResolvedValue([
      {
        id: 'cycle-1',
        cycleName: 'Cycle 1',
        status: 'PLANTED',
      },
    ]);
    plantingService.createCycle.mockResolvedValue({
      id: 'cycle-1',
      status: 'PLANTED',
      plannedPlantCount: 120,
      cyclePlots: [],
    });
  });

  it('returns public plot-cycle trace data without owner PII', async () => {
    prisma.traceQrSecurity.findFirst.mockResolvedValue({
      entityId: 'cp-1',
      payload: {
        source: {
          plot: { plotId: 'plot-1', plotName: 'Plot A', cyclePlotId: 'cp-1' },
          cycle: { cycleId: 'cycle-1', cycleName: 'Cycle 1' },
          cultivationMethod: 'OUTDOOR',
        },
      },
      publicUrl: 'http://localhost/trace/plot-cycle/QR-PLOT-1',
    });

    prisma.plantingCyclePlot.findUnique.mockResolvedValue({
      id: 'cp-1',
      cycleId: 'cycle-1',
      plotId: 'plot-1',
      allocatedAreaSqm: 120,
      plannedPlantCount: 65,
      plot: {
        id: 'plot-1',
        name: 'Plot A',
        solarSystem: 'OUTDOOR',
      },
      cycle: {
        id: 'cycle-1',
        cycleName: 'Cycle 1',
        status: 'PLANTED',
        startDate: new Date('2026-01-10T00:00:00.000Z'),
        expectedHarvestDate: new Date('2026-03-10T00:00:00.000Z'),
        cultivationType: 'OUTDOOR',
        farm: {
          id: 'farm-1',
          farmName: 'Farm Alpha',
          district: 'Mueang',
          province: 'Chiang Mai',
        },
        plantSpecies: {
          code: 'CNB',
          nameTH: 'Cannabis',
          nameEN: 'Cannabis',
        },
      },
    });

    const response = await request(app).get('/api/trace/plot-cycle/QR-PLOT-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.type).toBe('PLOT_CYCLE');
    expect(response.body.data.source.plot).toEqual(expect.objectContaining({
      plotId: 'plot-1',
      plotName: 'Plot A',
      cyclePlotId: 'cp-1',
    }));
    expect(response.body.data.source.cycle).toEqual(expect.objectContaining({
      cycleId: 'cycle-1',
      cycleName: 'Cycle 1',
    }));
    expect(response.body.data.farm.alias).toBe('Fa***');
    expect(response.body.data.farm.name).toBe('Farm Alpha');
    // Per-plant tracking is retired (spec R8): the public plot-cycle body no
    // longer publishes a per-plant roll-up, and `links` no longer deep-links into
    // the deleted per-plant registry tab.
    expect(response.body.data).not.toHaveProperty('plantUnits');
    expect(response.body.data.links || {}).not.toHaveProperty('healthPlantingUnitsUrl');
    expect(response.body.data.farm).not.toHaveProperty('ownerId');
    expect(response.body.data.farm).not.toHaveProperty('ownerName');
  });

  it('blocks harvest-batches for multi-plot cycle when not all plot weights are provided', async () => {
    prisma.plantingCycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      farmId: 'farm-1',
    });

    prisma.plantingCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      farmId: 'farm-1',
      status: 'PLANTED',
      cycleName: 'Cycle 1',
      cultivationType: 'OUTDOOR',
      certificateId: 'cert-1',
      certificate: {
        id: 'cert-1',
        status: 'active',
        expiryDate: new Date('2028-01-01T00:00:00.000Z'),
      },
      // No `_count.plantUnits`: the harvest door stopped selecting it on
      // 2026-08-25 (spec R8). The guard under test is about plot COVERAGE — every
      // cycle plot must carry a weight — which is a plot-level rule and was never
      // about plants.
      cyclePlots: [
        {
          id: 'cp-1',
          plot: { id: 'plot-1', name: 'Plot A', solarSystem: 'OUTDOOR' },
        },
        {
          id: 'cp-2',
          plot: { id: 'plot-2', name: 'Plot B', solarSystem: 'GREENHOUSE' },
        },
      ],
    });

    const response = await request(app)
      .post('/api/planting-cycles/cycle-1/harvest-batches')
      .send({
        harvestDate: '2026-02-14T10:00:00.000Z',
        plotHarvests: [
          {
            cyclePlotId: 'cp-1',
            freshWeightKg: 60,
            qualityGrade: 'A',
            packagingRows: [
              { packageType: 'DRY_BAG', quantity: 10, unitWeight: 2, totalWeight: 20 },
            ],
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(String(response.body.message || response.body.error || '').toLowerCase())
      .toContain('include all cycle plots');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // DELETED 2026-08-25 — 'blocks harvest-batches when cycle has unassigned plant
  // units' and 'blocks harvest-batches when cycle has over-plan units'. Both
  // drove plantUnitService.getQuotaInfo, and both defended a harvest refusal
  // ("linked to plots" / "exceed planned quota") that counted PlantUnit rows
  // against the declared plan. Spec R8 retired per-plant tracking on 2026-08-25:
  // with nothing minting those rows there is no quota to be over and nothing to
  // be unassigned, so the guards were deleted from the service. Keeping their
  // tests would have forced the next person to resurrect the guards to get green.
  // What survives of the harvest door is covered by
  // __tests__/unit/harvest-does-not-require-plant-units.test.js (the cycle with
  // zero units harvests, and the certificate gate still bites).
});

