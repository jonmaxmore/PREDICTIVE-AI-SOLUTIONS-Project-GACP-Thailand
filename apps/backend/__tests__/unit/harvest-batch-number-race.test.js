/**
 * Bug 5.4 — Harvest-batch number count()+1 collides on @unique batchNumber.
 *
 * buildBatchNumber() did `count(*) + 1` then created — two parallel callers
 * both observed the same count, emitted the same BATCH-YYYY-NNNN, and one hit
 * the batchNumber unique constraint → P2002 → generic 500. Soft-deleted rows
 * also let numbers be reused.
 *
 * Fix (mirrors the planting-cycle sequence pattern): allocate the number from
 * the `harvest_batch_number_seq` PostgreSQL sequence (already created by
 * 20260425100000_add_numbering_sequences), and make the create resilient — a
 * bounded retry loop that regenerates the number on P2002, and maps an
 * exhausted P2002 to a 409 (not a 500).
 */

'use strict';

function makeP2002(target = ['batchNumber']) {
    const e = new Error('Unique constraint failed on batchNumber');
    e.code = 'P2002';
    e.meta = { target };
    return e;
}

function loadService(prisma) {
    jest.resetModules();
    jest.doMock('../../services/prisma-database', () => ({ prisma }));
    return require('../../services/harvest-service');
}

describe('Bug 5.4 — harvest-batch number race', () => {
    afterEach(() => jest.clearAllMocks());

    it('allocates the number from harvest_batch_number_seq (not count()+1)', async () => {
        let seq = 0;
        const prisma = {
            $queryRaw: jest.fn(async () => { seq += 1; return [{ seq }]; }),
            harvestBatch: {
                count: jest.fn(async () => { throw new Error('count() must NOT be used for numbering'); }),
                create: jest.fn(async ({ data }) => ({ id: 'b1', ...data })),
            },
        };
        const svc = loadService(prisma);
        const batch = await svc.createHarvestBatchWithGeneratedNumber({ farmId: 'f1' });
        expect(prisma.$queryRaw).toHaveBeenCalled();
        expect(batch.batchNumber).toMatch(/^BATCH-\d{4}-\d{6}$/);
    });

    it('retries on a single P2002 and succeeds with a fresh number', async () => {
        let seq = 0;
        let createCalls = 0;
        const prisma = {
            $queryRaw: jest.fn(async () => { seq += 1; return [{ seq }]; }),
            harvestBatch: {
                create: jest.fn(async ({ data }) => {
                    createCalls += 1;
                    if (createCalls === 1) { throw makeP2002(); }
                    return { id: 'b2', ...data };
                }),
            },
        };
        const svc = loadService(prisma);
        const batch = await svc.createHarvestBatchWithGeneratedNumber({ farmId: 'f1' });
        expect(createCalls).toBe(2);
        expect(seq).toBeGreaterThanOrEqual(2); // a fresh number was allocated on retry
        expect(batch.id).toBe('b2');
    });

    it('maps an unresolved P2002 to a 409 (not a 500)', async () => {
        let seq = 0;
        const prisma = {
            $queryRaw: jest.fn(async () => { seq += 1; return [{ seq }]; }),
            harvestBatch: {
                create: jest.fn(async () => { throw makeP2002(); }), // always collides
            },
        };
        const svc = loadService(prisma);
        await expect(
            svc.createHarvestBatchWithGeneratedNumber({ farmId: 'f1' }),
        ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('re-raises a non-P2002 error unchanged', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => [{ seq: 1 }]),
            harvestBatch: {
                create: jest.fn(async () => { throw Object.assign(new Error('boom'), { code: 'P2003' }); }),
            },
        };
        const svc = loadService(prisma);
        await expect(
            svc.createHarvestBatchWithGeneratedNumber({ farmId: 'f1' }),
        ).rejects.toMatchObject({ code: 'P2003' });
    });
});
