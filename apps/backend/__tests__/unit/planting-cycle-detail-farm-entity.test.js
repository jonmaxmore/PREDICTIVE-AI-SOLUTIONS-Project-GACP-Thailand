/**
 * The cycle detail response carries farm.entityId so the web can gate
 * buttons on the holder's role (VIEWER sees no write buttons).
 */
const { getPlantingCycleById } = require('../../services/planting/planting-cycle-detail-loader');

describe('planting cycle detail loader: farm.entityId', () => {
  it('asks the database for farm.entityId and returns it', async () => {
    const findUnique = jest.fn(async (args) => {
      const farmSelect = args.include.farm.select;
      const farm = { id: 'f1', farmName: 'ฟาร์ม' };
      if (farmSelect.entityId) farm.entityId = 'ent-1';
      return { id: 'c1', farm, plantSpecies: null, cyclePlots: [], batches: [], cultivationLogs: [], _count: {} };
    });
    const result = await getPlantingCycleById({
      prisma: { plantingCycle: { findUnique } },
      id: 'c1',
      decorateCycleSummary: () => ({}),
      roundSqm: (n) => n,
      plotAreaSqm: () => 0,
    });
    expect(findUnique.mock.calls[0][0].include.farm.select.entityId).toBe(true);
    expect(result.farm.entityId).toBe('ent-1');
  });
});
