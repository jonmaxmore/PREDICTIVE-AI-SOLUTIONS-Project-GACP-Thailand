/**
 * Bug 5.5 — Lot-number suffix inlined + count-race.
 *
 * routes/api/trace/lots.js inlined `String.fromCharCode(65 + lotCount)`, which
 * produces a valid A–Z suffix only for the first 26 lots — the 27th lot yields
 * '[' (charCode 91) and then keeps walking into non-letter ASCII. The lot count
 * was also read outside any lock, so two concurrent creates could compute the
 * same suffix → P2002 on the @unique lotNumber → generic 500.
 *
 * Fix:
 *   (a) use the shared guarded `traceability-service.buildLotNumber(batchNumber,
 *       index)` helper (A..Z for 0..25, then -27, -28 … past 26) instead of the
 *       inlined charCode.
 *   (b) allocate the lot number + create ONCE INSIDE the locked
 *       createLotWithQuotaCheck tx. The FOR UPDATE batch lock already serialises
 *       concurrent writers on the same batch, so there is no collision to retry.
 *       Prisma 5.22 has no per-statement savepoint, so a P2002 aborts the whole
 *       tx — a retry INSIDE the tx cannot self-heal (the next tx.* call would
 *       throw 500). Therefore a P2002 on the single create surfaces as a 409
 *       LOT_NUMBER_CONFLICT immediately, with NO retry (adversarial-verify MF).
 *
 * Adversarial-verify contract this suite pins:
 *   - the auto lotNumber derives from the raw COUNT(*) via buildLotNumber;
 *   - an explicit caller lotNumber is honoured;
 *   - a P2002 on the create → 409 LOT_NUMBER_CONFLICT IMMEDIATELY (no retry);
 *   - because the retry no longer runs in the tx, there is NO 2nd tx.* mutation
 *     after a create P2002 → tx.lot.create is called EXACTLY once on that path.
 */

'use strict';

function makeP2002(target = ['lotNumber']) {
    const e = new Error('Unique constraint failed on lotNumber');
    e.code = 'P2002';
    e.meta = { target };
    return e;
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

describe('Bug 5.5 — buildLotNumber suffix past 26', () => {
    it('the 27th lot (index 26) yields a valid non-collapsing suffix (not "[")', () => {
        const svc = loadService({});
        const first = svc.buildLotNumber('BATCH-2026-000001', 0);
        const twentySixth = svc.buildLotNumber('BATCH-2026-000001', 25);
        const twentySeventh = svc.buildLotNumber('BATCH-2026-000001', 26);

        expect(first).toBe('LOT-2026-000001-A');
        expect(twentySixth).toBe('LOT-2026-000001-Z');
        // The inlined charCode produced '[' here — the helper must NOT.
        expect(twentySeventh).not.toMatch(/\[/);
        expect(twentySeventh).toMatch(/^LOT-2026-000001-\d{2}$/);
        // Distinct from every A..Z suffix (no collision with the first 26).
        expect(twentySeventh).not.toBe(twentySixth);
    });

    it('does not throw on a null batchNumber (guarded)', () => {
        const svc = loadService({});
        expect(() => svc.buildLotNumber(null, 0)).not.toThrow();
    });
});

describe('Bug 5.5 — createLotWithQuotaCheck single lot-number allocation', () => {
    afterEach(() => jest.clearAllMocks());

    // The service now allocates the lotNumber ONCE under the FOR UPDATE lock:
    //   - the auto suffix comes from a raw `SELECT COUNT(*) … AS c` ($queryRaw),
    //     NOT tx.lot.count;
    //   - used-weight comes from a top-level tx.lot.aggregate (isDeleted:false);
    //   - there is NO retry loop — a P2002 on the single create → 409 immediately.
    function mockWith({ batch, existingLotCount, createBehaviour }) {
        let lockCount = 0;
        let created = 0;
        const tx = {
            $queryRaw: jest.fn(async (strings) => {
                const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
                if (/for\s+update/i.test(sql)) { lockCount += 1; return [{ id: batch.id }]; }
                if (/count\(\*\)/i.test(sql)) { return [{ c: existingLotCount }]; }
                return [];
            }),
            harvestBatch: {
                // No `include` — the batch is read on its own now.
                findUnique: jest.fn(async () => ({ ...batch })),
            },
            lot: {
                aggregate: jest.fn(async () => ({
                    // existingLotCount lots of 1kg each; batch cap is generous (1000).
                    _sum: { totalWeight: existingLotCount },
                })),
                create: jest.fn(async ({ data }) => {
                    created += 1;
                    return createBehaviour(created, data);
                }),
            },
        };
        const prisma = {
            $transaction: jest.fn(async (cb) => (typeof cb === 'function' ? cb(tx) : Promise.all(cb))),
        };
        return { prisma, tx, getLockCount: () => lockCount };
    }

    const BATCH = { id: 'batch-1', batchNumber: 'BATCH-2026-000001', dryWeight: 1000 };

    it('derives the lotNumber via buildLotNumber from the raw COUNT when not supplied', async () => {
        const { prisma, tx } = mockWith({
            batch: BATCH,
            existingLotCount: 26, // next index = 26 → the past-26 path
            createBehaviour: (_n, data) => ({ id: 'lot-1', ...data }),
        });
        const svc = loadService(prisma);
        const lot = await svc.createLotWithQuotaCheck('batch-1', { totalWeight: 1 });
        // 27th lot → guarded numeric suffix, not '['.
        expect(lot.lotNumber).toMatch(/^LOT-2026-000001-\d{2}$/);
        // Allocated once — no count model call, the suffix came from $queryRaw COUNT.
        expect(tx.lot.create).toHaveBeenCalledTimes(1);
        expect(tx.lot.count).toBeUndefined();
    });

    it('a P2002 on the single create → 409 LOT_NUMBER_CONFLICT IMMEDIATELY (no retry)', async () => {
        const { prisma, tx } = mockWith({
            batch: BATCH,
            existingLotCount: 2,
            createBehaviour: () => { throw makeP2002(); },
        });
        const svc = loadService(prisma);
        await expect(
            svc.createLotWithQuotaCheck('batch-1', { totalWeight: 1 }),
        ).rejects.toMatchObject({ code: 'LOT_NUMBER_CONFLICT', statusCode: 409 });
        // Mechanism assertion (adversarial-verify): the retry no longer runs inside
        // the tx, so there is NO second create after a P2002 — exactly one call.
        expect(tx.lot.create).toHaveBeenCalledTimes(1);
    });

    it('honours a caller-supplied lotNumber (backward compat)', async () => {
        const { prisma, tx } = mockWith({
            batch: BATCH,
            existingLotCount: 0,
            createBehaviour: (_n, data) => ({ id: 'lot-x', ...data }),
        });
        const svc = loadService(prisma);
        const lot = await svc.createLotWithQuotaCheck('batch-1', { totalWeight: 1, lotNumber: 'LOT-EXPLICIT-A' });
        expect(lot.lotNumber).toBe('LOT-EXPLICIT-A');
        expect(tx.lot.create).toHaveBeenCalledTimes(1);
        // Explicit number ⇒ no COUNT query fired for the suffix.
        const countCalls = tx.$queryRaw.mock.calls.filter(
            ([s]) => /count\(\*\)/i.test(Array.isArray(s) ? s.join('?') : String(s)),
        );
        expect(countCalls).toHaveLength(0);
    });

    it('an explicit caller lotNumber that collides ALSO surfaces as a 409 (single create, no retry)', async () => {
        const { prisma, tx } = mockWith({
            batch: BATCH,
            existingLotCount: 0,
            createBehaviour: () => { throw makeP2002(); },
        });
        const svc = loadService(prisma);
        await expect(
            svc.createLotWithQuotaCheck('batch-1', { totalWeight: 1, lotNumber: 'LOT-EXPLICIT-A' }),
        ).rejects.toMatchObject({ code: 'LOT_NUMBER_CONFLICT', statusCode: 409 });
        expect(tx.lot.create).toHaveBeenCalledTimes(1); // no retry for a fixed number
    });
});
