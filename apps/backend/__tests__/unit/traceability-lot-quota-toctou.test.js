/**
 * Bug 5.3 — Lot weight-quota TOCTOU (read-then-create without a lock).
 *
 * createLotWithQuotaCheck read the batch + its lots, computed the remaining
 * quota, then created — with no lock between read and write. Two concurrent
 * lot creates both observe the same used-weight and both pass, over-issuing
 * past the batch weight cap (a GACP certification breach).
 *
 * Fix: wrap the quota read + lot create in a $transaction and take a
 * SELECT … FOR UPDATE row lock on the batch inside it (pgbouncer-safe — a
 * single interactive tx with an explicit row lock serialises concurrent
 * writers on the same batch). The remaining-quota is recomputed INSIDE the
 * locked scope.
 *
 * These tests are structural: they assert the create happens inside a
 * $transaction, that a FOR UPDATE lock is taken on the batch row, and that an
 * over-quota lot throws inside the locked scope (never reaching lot.create).
 */

'use strict';

function makeMock({ batch, lots }) {
    const calls = { forUpdateLock: 0, lotCreate: 0, txRan: 0 };
    const order = [];

    // The service now computes used-weight via a TOP-LEVEL tx.lot.aggregate that
    // EXCLUDES soft-deleted lots (where isDeleted:false), and derives the auto
    // lotNumber from a raw COUNT(*) query — NOT a nested include reduce and NOT
    // tx.lot.count. Reflect that in the mock: aggregate sums only non-deleted
    // lots; $queryRaw serves BOTH the FOR UPDATE batch lock (returns [{id}]) and
    // the lot COUNT (returns [{c}]) — distinguished by the SQL text.
    // 2026-08-23: used-weight is now the sum of TWO aggregates — active lots, plus
    // soft-deleted lots that were already PRINTED. A printed label exists on a bag
    // whatever happened to its row, so returning its weight to the quota let the
    // same harvest be packaged twice. An unprinted tombstone still returns its
    // weight, which is what the exclusion below is for and why it stays.
    const sumOf = (predicate) =>
        (lots || []).filter(predicate).reduce((acc, l) => acc + Number(l.totalWeight || 0), 0);
    const usedWeight = sumOf((l) => !l.isDeleted);
    const printedTombstoneWeight = sumOf((l) => l.isDeleted && l.printedAt);

    const tx = {
        $queryRaw: jest.fn(async (strings) => {
            const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
            if (/for\s+update/i.test(sql)) {
                calls.forUpdateLock += 1;
                order.push('LOCK');
                return [{ id: batch.id }];
            }
            if (/count\(\*\)/i.test(sql)) {
                // The lot-number suffix COUNT spans ALL rows (soft-deleted too).
                return [{ c: (lots || []).length }];
            }
            return [];
        }),
        $executeRaw: jest.fn(async () => 1),
        harvestBatch: {
            // No `include` now — the batch is read on its own.
            findUnique: jest.fn(async () => ({ ...batch })),
        },
        lot: {
            aggregate: jest.fn(async ({ where }) => {
                // Two slices, and the mock refuses to serve anything else — an
                // aggregate that forgot its soft-delete filter would sum every
                // tombstone and false-reject legitimate lots, which is the failure
                // this test exists to prevent.
                expect(where).toMatchObject({ batchId: batch.id });
                if (where.isDeleted === false) {
                    return { _sum: { totalWeight: usedWeight } };
                }
                if (where.isDeleted === true && where.printedAt) {
                    return { _sum: { totalWeight: printedTombstoneWeight } };
                }
                throw new Error(
                    `unexpected lot.aggregate filter: ${JSON.stringify(where)} — used-weight must be `
                    + 'active lots plus PRINTED tombstones, nothing wider',
                );
            }),
            create: jest.fn(async ({ data }) => {
                calls.lotCreate += 1;
                order.push('CREATE');
                return { id: 'lot-new', ...data };
            }),
        },
    };

    const prisma = {
        harvestBatch: { findUnique: jest.fn(async () => ({ ...batch })) },
        lot: { create: jest.fn(async ({ data }) => ({ id: 'lot-new', ...data })) },
        $transaction: jest.fn(async (cb) => {
            calls.txRan += 1;
            if (typeof cb === 'function') { return cb(tx); }
            return Promise.all(cb);
        }),
    };

    return { prisma, tx, calls, order };
}

function loadService(prisma) {
    jest.resetModules();
    jest.doMock('../../services/prisma-database', () => ({ prisma }));
    jest.doMock('../../services/user-lookup-service', () => ({ findUserByHealthIdSecurely: jest.fn() }));
    jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn().mockResolvedValue(null) },
        AuditCategory: {}, AuditSeverity: {}, ResourceType: {},
    }));
    return require('../../services/traceability-service');
}

const BATCH = { id: 'batch-1', batchNumber: 'BATCH-2026-000001', dryWeight: 100, freshWeight: 120 };

describe('Bug 5.3 — lot weight-quota TOCTOU', () => {
    afterEach(() => jest.clearAllMocks());

    it('creates the lot inside a $transaction with a FOR UPDATE lock on the batch', async () => {
        const { prisma, calls, order } = makeMock({
            batch: BATCH,
            lots: [{ totalWeight: 40 }],
        });
        const svc = loadService(prisma);

        const lot = await svc.createLotWithQuotaCheck('batch-1', { totalWeight: 30 });

        expect(lot).toMatchObject({ id: 'lot-new', batchId: 'batch-1', totalWeight: 30 });
        expect(calls.txRan).toBe(1);           // ran inside a $transaction
        expect(calls.forUpdateLock).toBe(1);   // took a FOR UPDATE row lock
        expect(calls.lotCreate).toBe(1);
        // Lock BEFORE create.
        expect(order.indexOf('LOCK')).toBeLessThan(order.indexOf('CREATE'));
    });

    it('throws LOT_WEIGHT_QUOTA_EXCEEDED inside the locked scope and never creates', async () => {
        const { prisma, calls } = makeMock({
            batch: BATCH,
            lots: [{ totalWeight: 90 }], // 90 used of 100
        });
        const svc = loadService(prisma);

        await expect(
            svc.createLotWithQuotaCheck('batch-1', { totalWeight: 30 }), // 90 + 30 = 120 > 100
        ).rejects.toMatchObject({ code: 'LOT_WEIGHT_QUOTA_EXCEEDED' });

        expect(calls.txRan).toBe(1);
        expect(calls.forUpdateLock).toBe(1);
        expect(calls.lotCreate).toBe(0); // rejected before create
    });

    it('EXCLUDES soft-deleted lots from used-weight (aggregate where isDeleted:false)', async () => {
        // 90kg is tombstoned (isDeleted) + 5kg live = 5kg used of 100. A new 30kg
        // lot must PASS. If the tombstoned 90kg were summed, 90+5+30=125 > 100 and
        // the lot would be false-rejected (fail-CLOSED). The aggregate excludes it.
        const { prisma, tx, calls } = makeMock({
            batch: BATCH,
            lots: [{ totalWeight: 90, isDeleted: true }, { totalWeight: 5 }],
        });
        const svc = loadService(prisma);

        const lot = await svc.createLotWithQuotaCheck('batch-1', { totalWeight: 30 });

        expect(lot).toMatchObject({ id: 'lot-new', totalWeight: 30 });
        expect(calls.lotCreate).toBe(1);
        // The aggregate was called with the soft-delete filter pinned.
        expect(tx.lot.aggregate).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ isDeleted: false }) }),
        );
    });

    it('still 404s for a missing batch', async () => {
        const { prisma } = makeMock({ batch: BATCH, lots: [] });
        // Override the locked read to return null (batch vanished / bad id).
        prisma.$transaction = jest.fn(async (cb) => cb({
            $queryRaw: jest.fn(async () => []),
            $executeRaw: jest.fn(async () => 1),
            harvestBatch: { findUnique: jest.fn(async () => null) },
            lot: { create: jest.fn() },
        }));
        const svc = loadService(prisma);
        await expect(
            svc.createLotWithQuotaCheck('batch-missing', { totalWeight: 5 }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects a missing batchId (VALIDATION_ERROR)', async () => {
        const { prisma } = makeMock({ batch: BATCH, lots: [] });
        const svc = loadService(prisma);
        await expect(
            svc.createLotWithQuotaCheck('', { totalWeight: 5 }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

/**
 * Bug #22 (carpet-bomb-inversion audit 2026-07-06) — the oversell guard must
 * FAIL CLOSED when the batch weight limit resolves to 0/null. Previously the
 * check was wrapped in `if (limitWeight > 0)`, so a batch whose dryWeight AND
 * freshWeight are 0/null (an owner can PUT {freshWeight:0,dryWeight:0}) skipped
 * the quota entirely → unlimited packaged lots could mint off a weightless batch.
 */
describe('Bug #22 — non-positive weight limit fails CLOSED', () => {
    afterEach(() => jest.clearAllMocks());

    it('rejects lot creation when BOTH dryWeight and freshWeight are 0', async () => {
        const { prisma, calls } = makeMock({
            batch: { id: 'batch-1', batchNumber: 'BATCH-2026-000001', dryWeight: 0, freshWeight: 0 },
            lots: [],
        });
        const svc = loadService(prisma);

        await expect(
            svc.createLotWithQuotaCheck('batch-1', { totalWeight: 5 }),
        ).rejects.toMatchObject({ code: 'LOT_WEIGHT_QUOTA_EXCEEDED', limit: 0, remaining: 0 });

        // Locked (existence check ran) but never created a lot.
        expect(calls.forUpdateLock).toBe(1);
        expect(calls.lotCreate).toBe(0);
    });

    it('rejects lot creation when both weights are null/undefined', async () => {
        const { prisma, calls } = makeMock({
            batch: { id: 'batch-1', batchNumber: 'BATCH-2026-000001', dryWeight: null, freshWeight: null },
            lots: [],
        });
        const svc = loadService(prisma);

        await expect(
            svc.createLotWithQuotaCheck('batch-1', { totalWeight: 999 }),
        ).rejects.toMatchObject({ code: 'LOT_WEIGHT_QUOTA_EXCEEDED', requested: 999 });

        expect(calls.lotCreate).toBe(0);
    });

    it('still allows allocation within a positive freshWeight-only limit (dryWeight null)', async () => {
        const { prisma, calls } = makeMock({
            batch: { id: 'batch-1', batchNumber: 'BATCH-2026-000001', dryWeight: null, freshWeight: 50 },
            lots: [{ totalWeight: 10 }],
        });
        const svc = loadService(prisma);

        const lot = await svc.createLotWithQuotaCheck('batch-1', { totalWeight: 30 }); // 10 + 30 = 40 ≤ 50
        expect(lot).toMatchObject({ id: 'lot-new', totalWeight: 30 });
        expect(calls.lotCreate).toBe(1);
    });

    it('rejects over-allocation against a positive limit (regression guard)', async () => {
        const { prisma, calls } = makeMock({
            batch: { id: 'batch-1', batchNumber: 'BATCH-2026-000001', dryWeight: null, freshWeight: 50 },
            lots: [{ totalWeight: 40 }],
        });
        const svc = loadService(prisma);

        await expect(
            svc.createLotWithQuotaCheck('batch-1', { totalWeight: 30 }), // 40 + 30 = 70 > 50
        ).rejects.toMatchObject({ code: 'LOT_WEIGHT_QUOTA_EXCEEDED' });
        expect(calls.lotCreate).toBe(0);
    });
});
