/**
 * The mass-balance ceiling must stop moving once packages exist.
 *
 * The quota control itself is sound: issuing a lot takes a row lock, sums the lots
 * already issued, and refuses with LOT_WEIGHT_QUOTA_EXCEEDED when the next one would
 * exceed the harvest. What defeated it was the ceiling, not the check —
 * PUT /api/harvest-batches/:id let freshWeight, dryWeight and harvestDate be edited
 * at any time, with no record of who changed them. Raise the declared harvest, and
 * the quota politely allows more bags.
 *
 * That is the laundering route the whole traceability chain rests on: a farmer with
 * one certified plot buys uncertified produce, edits the harvest weight upward, and
 * issues package codes for all of it.
 *
 * So: before any lot exists, the weights are a working number and stay editable. The
 * moment a lot is issued, the weights and the harvest date are claims that a printed
 * code has already been sold against, and they freeze. A correction after that point
 * is a decision for an officer, not a silent PUT.
 */
jest.mock('../../services/prisma-database', () => {
  const prisma = {
    harvestBatch: { update: jest.fn(), findUnique: jest.fn() },
    lot: { count: jest.fn() },
    // updateBatch locks the batch row inside a transaction before counting lots
    $queryRaw: jest.fn(async () => [{ id: 'batch-with-lots' }]),
  };
  prisma.$transaction = jest.fn((fn) => fn(prisma));
  return { prisma };
});

const { prisma } = require('../../services/prisma-database');
const harvestService = require('../../services/harvest-service');

const BATCH_ID = 'batch-with-lots';

describe('updateBatch — quantities freeze once a lot has been issued', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.harvestBatch.update.mockResolvedValue({ id: BATCH_ID });
  });

  it('refuses to change dryWeight when a lot already exists', async () => {
    prisma.lot.count.mockResolvedValue(1);

    await expect(
      harvestService.updateBatch(BATCH_ID, { dryWeight: 500 }),
    ).rejects.toThrow(/frozen|lot|package/i);

    expect(prisma.harvestBatch.update).not.toHaveBeenCalled();
  });

  it('refuses to change freshWeight or harvestDate when a lot already exists', async () => {
    prisma.lot.count.mockResolvedValue(2);

    await expect(harvestService.updateBatch(BATCH_ID, { freshWeight: 900 })).rejects.toThrow();
    await expect(
      harvestService.updateBatch(BATCH_ID, { harvestDate: '2029-01-01T00:00:00.000Z' }),
    ).rejects.toThrow();

    expect(prisma.harvestBatch.update).not.toHaveBeenCalled();
  });

  it('still allows the weights to be corrected while no lot exists', async () => {
    prisma.lot.count.mockResolvedValue(0);

    await harvestService.updateBatch(BATCH_ID, { dryWeight: 48.5 });

    expect(prisma.harvestBatch.update).toHaveBeenCalledTimes(1);
    const call = prisma.harvestBatch.update.mock.calls[0][0];
    expect(call.data.dryWeight).toBe(48.5);
  });

  it('still allows non-quantity edits after a lot exists, so the guard is narrow', async () => {
    prisma.lot.count.mockResolvedValue(1);

    await harvestService.updateBatch(BATCH_ID, { notes: 'ตากต่ออีกสองวัน' });

    expect(prisma.harvestBatch.update).toHaveBeenCalledTimes(1);
    const call = prisma.harvestBatch.update.mock.calls[0][0];
    expect(call.data.notes).toBe('ตากต่ออีกสองวัน');
  });
});
