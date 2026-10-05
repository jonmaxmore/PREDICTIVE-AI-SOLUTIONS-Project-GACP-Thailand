/**
 * Harvest must not depend on per-plant rows.
 *
 * Granularity ends at the plot and the cycle (planting spec R8): a plot of 100
 * plants carries one code, not 100. Until this test existed, createHarvestBatches
 * refused with "Plant units must be generated before harvest" whenever a cycle had
 * no PlantUnit rows — which meant every farmer opening a cycle was pushed back into
 * the per-plant direction the design retired, because the alternative was being
 * unable to harvest at all.
 *
 * The two quota guards that used to follow it (over-plan, unassigned) are now gone
 * as well, along with the plantUnitService dependency that served them: with
 * nothing creating per-plant rows there is no quota to reconcile. The operations
 * factory no longer accepts that dependency, which is why the fixtures below do
 * not inject one.
 */
const { createHarvestCapacityOperations } = require('../../services/planting-cycle/harvest-capacity-operations');

const CYCLE_ID = 'cycle-no-units';
const VALID_HARVEST_CYCLE_ID = CYCLE_ID;
const CYCLE_PLOT_ID = 'cycle-plot-1';

function buildCycle() {
  return {
    id: CYCLE_ID,
    isDeleted: false,
    status: 'GROWING',
    certificateId: 'cert-1',
    certificate: {
      id: 'cert-1',
      status: 'ACTIVE',
      // Comfortably in the future so the expiry branch is not what we are testing.
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
    plantSpecies: { code: 'TURMERIC', nameTH: 'ขมิ้นชัน', nameEN: 'Turmeric' },
    cyclePlots: [
      { id: CYCLE_PLOT_ID, plotId: 'plot-1', plot: { id: 'plot-1', name: 'แปลงหลังบ้าน', solarSystem: 'INDOOR' } },
    ],
    // The point of the test: no per-plant rows exist — and nothing selects a
    // count of them any more either, so the fixture carries no `_count`.
  };
}

function buildOps() {
  return createHarvestCapacityOperations({
    prisma: {
      plantingCycle: { findUnique: jest.fn().mockResolvedValue(buildCycle()) },
      $transaction: jest.fn(async (fn) => fn({})),
    },
    qrcodeService: { generateQrCode: jest.fn().mockResolvedValue('qr') },
    storedAreaToSqm: (v) => Number(v) || 0,
    normalizePackagingRows: () => [],
    buildBatchNumber: () => 'BATCH-TEST-0001',
    buildLotNumber: () => 'LOT-TEST-0001',
    toRoundedSqm: (v) => Number(v) || 0,
    isReservedCycleStatus: () => false,
    PLOT_HARVEST_META_PREFIX: 'PLOT_HARVEST_META:',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
}

describe('createHarvestBatches — per-plant rows are not a precondition', () => {
  it('does not refuse a harvest just because the cycle has no plant units', async () => {
    const ops = buildOps();

    const result = await ops.createHarvestBatches(
      CYCLE_ID,
      {
        harvestDate: '2026-08-23T00:00:00.000Z',
        plotHarvests: [{ cyclePlotId: CYCLE_PLOT_ID, freshWeight: 12.5 }],
      },
      { id: 'user-1', role: 'health' },
    );

    // The harvest may still fail further down for reasons this test does not set
    // up. What it must never be is a refusal for having no per-plant rows.
    expect(result?.body?.message).not.toBe('Plant units must be generated before harvest');
  });

  it('still refuses when the certificate is missing, so removing the unit gate did not open the cert gate', async () => {
    const ops = createHarvestCapacityOperations({
      prisma: {
        plantingCycle: {
          findUnique: jest.fn().mockResolvedValue({ ...buildCycle(), certificateId: null, certificate: null }),
        },
        $transaction: jest.fn(async (fn) => fn({})),
      },
      qrcodeService: { generateQrCode: jest.fn() },
      storedAreaToSqm: (v) => Number(v) || 0,
      normalizePackagingRows: () => [],
      buildBatchNumber: () => 'BATCH-TEST-0002',
      buildLotNumber: () => 'LOT-TEST-0002',
      toRoundedSqm: (v) => Number(v) || 0,
      isReservedCycleStatus: () => false,
      PLOT_HARVEST_META_PREFIX: 'PLOT_HARVEST_META:',
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });

    const result = await ops.createHarvestBatches(
      CYCLE_ID,
      {
        harvestDate: '2026-08-23T00:00:00.000Z',
        plotHarvests: [{ cyclePlotId: CYCLE_PLOT_ID, freshWeight: 12.5 }],
      },
      { id: 'user-1', role: 'health' },
    );

    expect(result.status).toBe(400);
    expect(result.body.message).toBe('Active certificate is required before harvest');
  });
});

/**
 * The other half of the same rule: the harvest not only ACCEPTS a cycle with no
 * per-plant rows, it completes on one — and the 201 it returns carries no
 * `linkedPlantUnits`.
 *
 * That field is the one the operator saw in the walk of 2026-08-25: a single
 * cycle-create press minted 500 PlantUnit rows and the harvest reported all 500
 * as linked into its evidence chain. The linking loop and the field are deleted,
 * not zeroed — `linkedPlantUnits: 0` would read as "we counted the plants this
 * harvest linked and there were none", which is a measurement of a thing that is
 * no longer measured. Absence reads as "not a thing any more" (spec R8).
 */
describe('createHarvestBatches — a cycle with zero plant units harvests to completion', () => {
  const HARVEST_PLOT_ID = 'cycle-plot-1';

  function buildCompletableOps(overrides = {}) {
    const tx = {
      harvestBatch: {
        create: jest.fn().mockResolvedValue({
          id: 'batch-1', batchNumber: 'BATCH-TEST-0001', qrCode: 'QR-BATCH-1',
          harvestDate: new Date('2026-08-23T00:00:00.000Z'), freshWeight: 12.5, notes: '',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'batch-1', batchNumber: 'BATCH-TEST-0001', qrCode: 'QR-BATCH-1',
          trackingUrl: 'http://localhost/trace/batch/batch-1',
          harvestDate: new Date('2026-08-23T00:00:00.000Z'), freshWeight: 12.5, notes: '',
        }),
      },
      lot: {
        create: jest.fn().mockResolvedValue({ id: 'lot-1', lotNumber: 'LOT-TEST-0001', qrCode: 'QR-LOT-1' }),
        update: jest.fn().mockResolvedValue({
          id: 'lot-1', lotNumber: 'LOT-TEST-0001', packageType: 'DRY_BAG',
          quantity: 5, unitWeight: 2, totalWeight: 10,
          qrCode: 'QR-LOT-1', trackingUrl: 'http://localhost/trace/lot/lot-1',
        }),
      },
      plantingCycle: { update: jest.fn().mockResolvedValue({}) },
    };

    const ops = createHarvestCapacityOperations({
      prisma: {
        plantingCycle: { findUnique: jest.fn().mockResolvedValue(buildCycle()) },
        $transaction: jest.fn(async (fn) => fn(tx)),
      },
      qrcodeService: {
        generateQrCode: jest.fn().mockResolvedValue('qr'),
        generateQRCodeId: jest.fn(() => 'QR-GENERATED'),
        generatePublicTraceUrl: jest.fn((path) => `http://localhost/trace/${path}`),
        registerTraceIntegrity: jest.fn().mockResolvedValue({}),
      },
      storedAreaToSqm: (v) => Number(v) || 0,
      normalizePackagingRows: (rows) => (Array.isArray(rows) ? rows : []),
      buildBatchNumber: async () => 'BATCH-TEST-0001',
      buildLotNumber: () => 'LOT-TEST-0001',
      toRoundedSqm: (v) => Number(v) || 0,
      isReservedCycleStatus: () => false,
      PLOT_HARVEST_META_PREFIX: 'PLOT_HARVEST_META:',
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      ...overrides,
    });

    return { ops, tx };
  }

  const VALID_HARVEST = {
    harvestDate: '2026-08-23T00:00:00.000Z',
    plotHarvests: [{
      cyclePlotId: HARVEST_PLOT_ID,
      freshWeightKg: 12.5,
      qualityGrade: 'A',
      packagingRows: [{ packageType: 'DRY_BAG', quantity: 5, unitWeight: 2, totalWeight: 10 }],
    }],
  };

  it('returns 201 and writes the batch + lot, with no plant rows anywhere in the cycle', async () => {
    const { ops, tx } = buildCompletableOps();

    const result = await ops.createHarvestBatches(VALID_HARVEST_CYCLE_ID, VALID_HARVEST, { id: 'user-1', userId: 'user-1', role: 'health' });

    expect(result.status).toBe(201);
    expect(result.body.success).toBe(true);
    expect(result.body.data.batchCount).toBe(1);
    expect(result.body.data.sourceLevel).toBe('PLOT');
    // Granularity ends at the plot: the batch's source names a plot and a cycle,
    // and there is no third, finer level below them.
    expect(result.body.data.batches[0].source).toEqual(expect.objectContaining({
      plotId: 'plot-1',
      cyclePlotId: HARVEST_PLOT_ID,
      cycleId: VALID_HARVEST_CYCLE_ID,
    }));
    expect(tx.harvestBatch.create).toHaveBeenCalledTimes(1);
    expect(tx.lot.create).toHaveBeenCalledTimes(1);
  });

  it('the 201 body carries NO linkedPlantUnits field — absent, not zero', async () => {
    const { ops } = buildCompletableOps();

    const result = await ops.createHarvestBatches(VALID_HARVEST_CYCLE_ID, VALID_HARVEST, { id: 'user-1', userId: 'user-1', role: 'health' });

    expect(result.status).toBe(201);
    expect(result.body.data).not.toHaveProperty('linkedPlantUnits');
    expect(result.body).not.toHaveProperty('linkedPlantUnits');
    // Pin the whole key set, so a re-added per-plant field cannot slip in under
    // some other name alongside the ones that belong here.
    // phiWarning เข้ามา 2026-09-07 (ระยะปลอดภัยหลังพ่นสาร — pre-harvest-interval.js)
    expect(Object.keys(result.body.data).sort()).toEqual(['batchCount', 'batches', 'cycleId', 'phiWarning', 'sourceLevel']);
    expect(JSON.stringify(result.body)).not.toMatch(/plantUnit/i);
  });
});
