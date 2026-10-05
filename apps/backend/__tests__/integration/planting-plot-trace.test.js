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
        // registry tab. A fixture that still fed them would let this suite pass
        // against a shape the service can no longer produce.
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
  // Batch 15 (2026-05-16): planting-service now hosts the cycle / cycle-plot /
  // cultivation-log / harvest-batch reads + writes the unit-plot + activity-
  // harvest route helpers used to issue inline against prisma.
  findCycleForGenerate: jest.fn(),
  findCyclePlotInCycle: jest.fn(),
  listPlotCycleQrRecordsForCycle: jest.fn().mockResolvedValue([]),
  findOwnedApplicationDocuments: jest.fn().mockResolvedValue([]),
  // `findPlantUnitInCycle` is absent on purpose: planting-service deleted it on
  // 2026-08-25 (per-plant resolution, retired by spec R8). Mocking a member the
  // real module no longer exports would let a re-added caller pass on a fiction.
  createCultivationLog: jest.fn(),
  listCultivationLogs: jest.fn().mockResolvedValue([[], 0]),
  findCycleForLegacyHarvest: jest.fn(),
  countHarvestBatchesGlobal: jest.fn().mockResolvedValue(0),
  commitLegacyHarvest: jest.fn(),
  createPlotForFarm: jest.fn(),
  listPlotsByFarm: jest.fn(),
  findPlotWithFarmOwner: jest.fn(),
  deletePlot: jest.fn(),
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
      // 403 before the behaviour under test is ever reached.
      findUnique: jest.fn(),
    },
    entityMembership: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    certificate: {
      findMany: jest.fn(),
      // 2026-09-06: การออกป้าย QR ถามใบรับรองของรอบนั้นก่อน (QR_REQUIRES_ACTIVE_CERTIFICATE)
      // suite นี้จำลองรอบที่ "มีใบรับรองอยู่แล้ว" ซึ่งเป็นเงื่อนไขที่ทำให้รอบนั้นมีอยู่ได้ตั้งแต่แรก
      findUnique: jest.fn(),
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
    // No `plantUnit` delegate. Nothing behind these routes may read PlantUnit
    // rows any more (spec R8); leaving the delegate off means a re-added read
    // fails loudly here instead of quietly collecting a mocked zero.
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
    // รอบปลูกในชุดทดสอบนี้เป็นรอบที่มีใบรับรองอยู่แล้ว — เป็นเงื่อนไขที่ทำให้รอบนั้นถูกสร้างได้
    // ตั้งแต่แรก และเป็นเงื่อนไขเดียวกับที่การออกป้าย QR ถามตั้งแต่ 2026-09-06
    prisma.certificate.findUnique.mockResolvedValue({
      status: 'active', expiryDate: null, isDeleted: false, farmId: 'farm-1',
    });
    prisma.plot.findMany.mockResolvedValue([]);
    prisma.plantingCyclePlot.findFirst.mockResolvedValue(null);

    prisma.plantingCycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      farmId: 'farm-1',
      certificateId: 'cert-1',
    });
    prisma.plantingCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      cycleName: 'Cycle 1',
      status: 'PLANTED',
      estimatedPlantCount: 100,
      farmId: 'farm-1',
      certificateId: 'cert-1',
    });

    // Batch 15 (2026-05-16): generate-units / bulk-confirm helpers now
    // go through plantingService.findCycleForGenerate. Route per-test
    // mocks back through the prisma mock so existing assertions stay
    // intact.
    plantingService.findCycleForGenerate.mockImplementation(async (cycleId) => {
      return prisma.plantingCycle.findUnique({ where: { id: cycleId } });
    });
    plantingService.findCyclePlotInCycle.mockImplementation(async ({ cyclePlotId, cycleId, plotId }) => {
      const where = { cycleId };
      if (cyclePlotId) { where.id = cyclePlotId; }
      if (plotId) { where.plotId = plotId; }
      return prisma.plantingCyclePlot.findFirst({ where, select: { id: true } });
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

  it('generates plot-cycle QR records for each assigned plot', async () => {
    prisma.plantingCycle.findFirst
      .mockResolvedValueOnce({ id: 'cycle-1', farmId: 'farm-1' }) // ownership check
      .mockResolvedValueOnce({
        id: 'cycle-1',
        cycleName: 'Cycle 1',
        status: 'PLANTED',
        cultivationType: 'OUTDOOR',
        // การออกป้ายถามใบรับรองของรอบนี้ (QR_REQUIRES_ACTIVE_CERTIFICATE, 2026-09-06)
        farmId: 'farm-1',
        certificateId: 'cert-1',
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
        cyclePlots: [
          {
            id: 'cp-1',
            allocatedAreaSqm: 120,
            plannedPlantCount: 65,
            plot: {
              id: 'plot-1',
              name: 'Plot A',
              solarSystem: 'OUTDOOR',
            },
          },
          {
            id: 'cp-2',
            allocatedAreaSqm: 140,
            plannedPlantCount: 75,
            plot: {
              id: 'plot-2',
              name: 'Plot B',
              solarSystem: 'GREENHOUSE',
            },
          },
        ],
      });

    prisma.traceQrSecurity.findMany.mockResolvedValue([]);
    qrcodeService.generateQRCodeId
      .mockReturnValueOnce('QR-PLOT-1')
      .mockReturnValueOnce('QR-PLOT-2');

    const response = await request(app).post('/api/planting-cycles/cycle-1/plot-qrs/generate').send({});

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(2);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      cyclePlotId: 'cp-1',
      plotId: 'plot-1',
      qrCode: 'QR-PLOT-1',
      trackingUrl: 'http://localhost/trace/plot-cycle/QR-PLOT-1',
    }));
    expect(response.body.data[1]).toEqual(expect.objectContaining({
      cyclePlotId: 'cp-2',
      plotId: 'plot-2',
      qrCode: 'QR-PLOT-2',
      trackingUrl: 'http://localhost/trace/plot-cycle/QR-PLOT-2',
    }));
    expect(qrcodeService.registerTraceIntegrity).toHaveBeenCalledTimes(2);
  });

  it('returns automation summary when creating a cycle', async () => {
    plantingService.createCycle.mockResolvedValueOnce({
      id: 'cycle-created-1',
      status: 'PLANTED',
      plannedPlantCount: 120,
      cyclePlots: [],
    });
    prisma.plantingCycle.findFirst
      .mockResolvedValueOnce({
        id: 'cycle-created-1',
        cycleName: 'Cycle Created',
        status: 'PLANTED',
        cultivationType: 'OUTDOOR',
        farmId: 'farm-1',
        certificateId: 'cert-1',
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
        cyclePlots: [
          {
            id: 'cp-created-1',
            allocatedAreaSqm: 100,
            plannedPlantCount: 120,
            plot: {
              id: 'plot-created-1',
              name: 'Plot A',
              solarSystem: 'OUTDOOR',
            },
          },
        ],
      });
    prisma.traceQrSecurity.findMany.mockResolvedValueOnce([]);
    qrcodeService.generateQRCodeId.mockReturnValueOnce('QR-CREATED-1');

    const response = await request(app).post('/api/planting-cycles').send({
      farmId: 'farm-1',
      plantSpeciesId: 'species-1',
      cycleName: 'Cycle Created',
      startDate: '2026-02-15T00:00:00.000Z',
      expectedHarvestDate: '2026-04-15T00:00:00.000Z',
      plotAssignments: [
        {
          plotId: 'plot-created-1',
          allocatedAreaSqm: 100,
          plannedPlantCount: 120,
        },
      ],
      // No `autoGenerateUnits` flag: the route stopped honouring it on
      // 2026-08-25 (spec R8). plannedPlantCount above is the surviving shape of
      // "จำนวนต้น" — a declared number on the cycle plot, not a request to mint
      // one tracked row per plant.
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.automation.plotQr).toEqual(expect.objectContaining({
      status: 'generated',
      generatedCount: 1,
    }));
    // The field is ABSENT, not zero. A `plantUnits: { generatedCount: 0 }` would
    // read as "we counted the plants we made and there were none"; per-plant
    // generation is simply not something the platform does any more (spec R8).
    expect(response.body.data.automation).not.toHaveProperty('plantUnits');
    expect(Object.keys(response.body.data.automation)).toEqual(['plotQr']);
  });

  it('returns planting capacity summary for active certified farms', async () => {
    prisma.farm.findMany.mockResolvedValueOnce([
      { id: 'farm-1', farmName: 'Farm Alpha' },
      { id: 'farm-2', farmName: 'Farm Beta' },
    ]);
    prisma.certificate.findMany.mockResolvedValueOnce([
      { farmId: 'farm-1' },
      { farmId: 'farm-2' },
    ]);
    prisma.plot.findMany.mockResolvedValueOnce([
      { farmId: 'farm-1', area: 2, areaUnit: 'rai' }, // 3200 sqm
      { farmId: 'farm-2', area: 1, areaUnit: 'rai' }, // 1600 sqm
    ]);
    prisma.plantingCycle.findMany.mockResolvedValueOnce([
      {
        id: 'cycle-1',
        farmId: 'farm-1',
        status: 'PLANTED',
        cyclePlots: [{ allocatedAreaSqm: 1200 }],
      },
      {
        id: 'cycle-2',
        farmId: 'farm-2',
        status: 'COMPLETED',
        cyclePlots: [{ allocatedAreaSqm: 500 }],
      },
    ]);

    const response = await request(app).get('/api/planting-cycles/capacity/summary');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(expect.objectContaining({
      scope: 'ALL',
      allowedAreaSqm: 4800,
      reservedAreaSqm: 1200,
      remainingAreaSqm: 3600,
      overReservedAreaSqm: 0,
    }));
    expect(Array.isArray(response.body.data.farmBreakdown)).toBe(true);
    expect(response.body.data.farmBreakdown).toHaveLength(2);
  });

  // DELETED 2026-08-25 — 'confirms planting units in bulk for selected plot
  // scope'. It drove POST /:id/plant-units/confirm, a route retired with
  // per-plant tracking (spec R8). Keeping it would have been a tripwire: the
  // next person finishing the removal would have had to resurrect the route to
  // get the suite green.
});

