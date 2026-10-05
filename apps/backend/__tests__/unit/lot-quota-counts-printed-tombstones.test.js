/**
 * A printed label does not stop existing because its row was deleted.
 *
 * The quota deliberately excludes soft-deleted lots, and that is right for lots
 * that never left the system: counting tombstones would falsely reject legitimate
 * lots. But it draws the line in the wrong place for one case. Once a lot's QR
 * label has been PRINTED, a physical code exists in the world — on a bag, in
 * somebody's hand. Soft-deleting that row returns its weight to the quota and lets
 * the same harvest be packaged again, while the first set of labels is still out
 * there certifying the same produce.
 *
 * So the used-weight sum counts active lots plus soft-deleted lots that were
 * printed. A lot deleted BEFORE printing still returns its weight, because nothing
 * physical was ever issued.
 *
 * printedAt is the right discriminator: schema/trace.prisma:47 sets it when the QR
 * label is first printed, and markLotAsPrinted only ever sets it once
 * (where: { id, printedAt: null }).
 */

'use strict';

function makeMock({ batch, lots }) {
  const calls = { aggregateCalls: [] };

  const sumWhere = (predicate) =>
    (lots || []).filter(predicate).reduce((acc, l) => acc + Number(l.totalWeight || 0), 0);

  const tx = {
    $queryRaw: jest.fn(async (strings) => {
      const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (/for\s+update/i.test(sql)) return [{ id: batch.id }];
      if (/count\(\*\)/i.test(sql)) return [{ c: (lots || []).length }];
      return [];
    }),
    $executeRaw: jest.fn(async () => 1),
    harvestBatch: { findUnique: jest.fn(async () => ({ ...batch })) },
    lot: {
      aggregate: jest.fn(async ({ where }) => {
        calls.aggregateCalls.push(where);
        // Serve whichever slice the service asks for, honestly.
        if (where.isDeleted === false) {
          return { _sum: { totalWeight: sumWhere((l) => !l.isDeleted) } };
        }
        if (where.isDeleted === true && where.printedAt) {
          return { _sum: { totalWeight: sumWhere((l) => l.isDeleted && l.printedAt) } };
        }
        return { _sum: { totalWeight: 0 } };
      }),
      create: jest.fn(async ({ data }) => ({ id: 'new-lot', ...data })),
      count: jest.fn(async () => (lots || []).length),
    },
  };

  const prisma = { $transaction: jest.fn(async (fn) => fn(tx)) };
  return { prisma, tx, calls };
}

function loadService(prismaMock) {
  jest.resetModules();
  jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
  return require('../../services/traceability-service');
}

const BATCH = { id: 'batch-1', dryWeight: 50, freshWeight: 100 };

describe('createLotWithQuotaCheck — a printed label keeps consuming quota after deletion', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('refuses a lot whose weight is only available because a PRINTED lot was deleted', async () => {
    // 50kg harvest. 45kg was already packaged and the labels were printed. That
    // lot was then soft-deleted, which used to hand the 45kg back.
    const { prisma } = makeMock({
      batch: BATCH,
      lots: [{ id: 'lot-printed-then-deleted', totalWeight: 45, isDeleted: true, printedAt: new Date() }],
    });
    const svc = loadService(prisma);

    await expect(
      svc.createLotWithQuotaCheck(BATCH.id, { totalWeight: 40, packageType: 'BAG_1KG', quantity: 40, unitWeight: 1 })
    ).rejects.toMatchObject({ code: 'LOT_WEIGHT_QUOTA_EXCEEDED' });
  });

  it('still returns the weight of a lot deleted BEFORE printing, because nothing was issued', async () => {
    const { prisma } = makeMock({
      batch: BATCH,
      lots: [{ id: 'lot-deleted-unprinted', totalWeight: 45, isDeleted: true, printedAt: null }],
    });
    const svc = loadService(prisma);

    const lot = await svc.createLotWithQuotaCheck(BATCH.id, {
      totalWeight: 40, packageType: 'BAG_1KG', quantity: 40, unitWeight: 1,
    });
    expect(lot).toBeTruthy();
  });

  it('still counts active lots, so the original guard is intact', async () => {
    const { prisma } = makeMock({
      batch: BATCH,
      lots: [{ id: 'lot-active', totalWeight: 45, isDeleted: false, printedAt: null }],
    });
    const svc = loadService(prisma);

    await expect(
      svc.createLotWithQuotaCheck(BATCH.id, { totalWeight: 40, packageType: 'BAG_1KG', quantity: 40, unitWeight: 1 })
    ).rejects.toMatchObject({ code: 'LOT_WEIGHT_QUOTA_EXCEEDED' });
  });
});
