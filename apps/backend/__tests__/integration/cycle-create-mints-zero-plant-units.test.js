/**
 * Creating a planting cycle mints ZERO per-plant rows.
 *
 * The walk that prompted this removal (operator, 2026-08-25) pressed "create
 * cycle" once and got 500 PlantUnit rows, which the harvest then linked into its
 * evidence chain. R8 of design note 2026-08-20-planting-tnt-design
 * retires per-plant tracking permanently: resolution stops at the planting cycle
 * / plot and the Lot. "จำนวนต้น" survives only as `plannedPlantCount`, a declared
 * number on the cycle and on each cycle-plot — never as tracked units.
 *
 * This runs the REAL route + the REAL planting-service against a mocked prisma,
 * so the assertion is about what the create path actually issues to the database,
 * not about what a stub was told to return.
 *
 * The write-side PlantUnit delegates below are ARMED (not omitted) on purpose:
 * an omitted delegate would make a re-added generator throw a TypeError, which
 * reads like an unrelated crash. Armed, a re-added generator succeeds against the
 * mock and this suite names exactly what came back — per-plant rows.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
  const pass = (req, _res, next) => { req.user = { id: 'health-user-1' }; next(); };
  const noop = (_req, _res, next) => next();
  return {
    authenticateHealth: pass, authenticate: pass,
    authenticateProvider: noop, authenticateDTAM: noop, optionalAuth: noop,
    requireVerification: noop, authorizeRoles: () => noop, authorize: () => noop,
    requireRole: () => noop, checkPermission: () => noop, rateLimitSensitive: () => noop,
  };
});

jest.mock('../../middleware/audit-logger', () => ({
  auditLogger: { log: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  AuditCategory: { APPLICATION: 'APPLICATION' },
  AuditSeverity: { INFO: 'INFO' },
  ResourceType: { SYSTEM: 'SYSTEM' },
}));

jest.mock('../../shared/logger', () => {
  const fake = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { ...fake, createLogger: () => fake };
});

const mockPlantUnitCreate = jest.fn();
const mockPlantUnitCreateMany = jest.fn();
const mockPlantUnitUpsert = jest.fn();

jest.mock('../../services/prisma-database', () => ({
  prisma: {
    farm: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    entityMembership: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    plot: { findMany: jest.fn() },
    certificate: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    plantingCycle: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    plantingCyclePlot: { createMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    traceQrSecurity: { findMany: jest.fn().mockResolvedValue([]) },
    plantUnit: {
      create: (...a) => mockPlantUnitCreate(...a),
      createMany: (...a) => mockPlantUnitCreateMany(...a),
      upsert: (...a) => mockPlantUnitUpsert(...a),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../services/qrcode/qrcode-service', () => ({
  generateQRCodeId: jest.fn(() => 'QR-PLOT-1'),
  generatePublicTraceUrl: jest.fn((path) => `http://localhost/trace/${path}`),
  registerTraceIntegrity: jest.fn().mockResolvedValue({}),
}));

const { prisma } = require('../../services/prisma-database');
const plantingCyclesRouter = require('../../routes/api/cultivation/planting-cycles');

const CREATE_BODY = {
  farmId: 'farm-1',
  plantSpeciesId: 'species-1',
  cycleName: 'รอบปลูกทดสอบ',
  startDate: '2026-02-15T00:00:00.000Z',
  expectedHarvestDate: '2026-06-15T00:00:00.000Z',
  plotAssignments: [
    { plotId: 'plot-1', allocatedAreaSqm: 800, plannedPlantCount: 500 },
  ],
};

describe('POST /api/planting-cycles — one press, zero per-plant rows', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/planting-cycles', plantingCyclesRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Solo legacy farm (entityId=null) → the caller passes the CYCLE_CREATE gate
    // through the owner fast-path, so the permission engine is not what this
    // test is measuring.
    const FARM = { id: 'farm-1', ownerId: 'health-user-1', entityId: null, isDeleted: false };
    prisma.farm.findFirst.mockResolvedValue(FARM);
    prisma.farm.findUnique.mockResolvedValue(FARM);
    prisma.plot.findMany.mockResolvedValue([
      { id: 'plot-1', name: 'แปลงหลังบ้าน', area: 1, areaUnit: 'rai', solarSystem: 'OUTDOOR' },
    ]);
    prisma.certificate.findFirst.mockResolvedValue({ id: 'cert-1' });
    prisma.plantingCycle.create.mockResolvedValue({ id: 'cycle-new-1', status: 'PLANTED' });
    prisma.plantingCyclePlot.createMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(async (fn) => fn({
      plantingCycle: prisma.plantingCycle,
      plantingCyclePlot: prisma.plantingCyclePlot,
      plantUnit: prisma.plantUnit,
    }));

    // The plot-QR automation reads the created cycle back with its plots.
    prisma.plantingCycle.findFirst.mockResolvedValue({
      id: 'cycle-new-1',
      cycleName: 'รอบปลูกทดสอบ',
      status: 'PLANTED',
      cultivationType: 'OUTDOOR',
      farm: { id: 'farm-1', farmName: 'ฟาร์มทดสอบ', district: 'เมือง', province: 'เชียงใหม่' },
      plantSpecies: { code: 'TURMERIC', nameTH: 'ขมิ้นชัน', nameEN: 'Turmeric' },
      cyclePlots: [{
        id: 'cp-1',
        allocatedAreaSqm: 800,
        plannedPlantCount: 500,
        plot: { id: 'plot-1', name: 'แปลงหลังบ้าน', solarSystem: 'OUTDOOR' },
      }],
    });
  });

  it('creates the cycle and issues no PlantUnit write of any kind', async () => {
    const response = await request(app).post('/api/planting-cycles').send(CREATE_BODY);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe('cycle-new-1');

    // The press that produced 500 rows would land on one of these three.
    expect(mockPlantUnitCreateMany).not.toHaveBeenCalled();
    expect(mockPlantUnitCreate).not.toHaveBeenCalled();
    expect(mockPlantUnitUpsert).not.toHaveBeenCalled();
  });

  it('keeps จำนวนต้น as a declared number on the cycle (plannedPlantCount survives)', async () => {
    const response = await request(app).post('/api/planting-cycles').send(CREATE_BODY);

    expect(response.status).toBe(201);
    // 500 plants planned, 0 plants tracked — that pairing IS the retirement.
    expect(response.body.data.plannedPlantCount).toBe(500);
    expect(mockPlantUnitCreateMany).not.toHaveBeenCalled();
  });

  it('reports only the plot QR in `automation` — no plantUnits key, not even a zero', async () => {
    const response = await request(app).post('/api/planting-cycles').send(CREATE_BODY);

    expect(response.status).toBe(201);
    // Absence, not zero: `plantUnits: { generatedCount: 0 }` would read as
    // "we counted the plants we minted and there were none", which invites
    // someone to make the number non-zero again. There is no such measurement.
    expect(response.body.data.automation).not.toHaveProperty('plantUnits');
    expect(Object.keys(response.body.data.automation)).toEqual(['plotQr']);
  });

  it('ignores a caller that still sends the retired autoGenerateUnits flag', async () => {
    // Old clients and old scripts still exist. The flag must be inert — not an
    // error, and certainly not a switch that brings the 500 rows back.
    const response = await request(app)
      .post('/api/planting-cycles')
      .send({ ...CREATE_BODY, autoGenerateUnits: true });

    expect(response.status).toBe(201);
    expect(mockPlantUnitCreateMany).not.toHaveBeenCalled();
    expect(mockPlantUnitCreate).not.toHaveBeenCalled();
    expect(response.body.data.automation).not.toHaveProperty('plantUnits');
    expect(response.body.data).not.toHaveProperty('autoGenerateUnits');
  });
});
