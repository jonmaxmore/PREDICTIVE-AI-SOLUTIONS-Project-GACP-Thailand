/**
 * A3-layer-2b (carpet-bomb-inversion audit 2026-07-06) — cleanup of the Batch-1 A3
 * read-side defense. The dedicated public batch/lot trace routes drop a cross-farm
 * cert when batch.cycle.farmId !== batch.farmId; the Batch-1 fix resolved cycle.farmId
 * with a per-request prisma.plantingCycle.findUnique because the public projection
 * from traceability-service OMITTED it.
 *
 * The cleaner form: expose `cycle.farmId` on the public projection so the route can
 * compare it in-memory WITHOUT a separate query. This suite asserts the projection
 * select now carries cycle.farmId for both findPublicBatchByAnyIdentifier and
 * findPublicLotByAnyIdentifier, and that a cross-farm row is droppable by the same
 * comparison the routes use.
 */
'use strict';

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

describe('A3-layer-2b — cycle.farmId on the public batch/lot projection', () => {
    afterEach(() => jest.clearAllMocks());

    test('findPublicBatchByAnyIdentifier selects cycle.farmId', async () => {
        const findFirst = jest.fn().mockResolvedValue(null);
        const svc = loadService({ harvestBatch: { findFirst }, lot: { findFirst: jest.fn() } });

        await svc.findPublicBatchByAnyIdentifier('B1');

        const args = findFirst.mock.calls[0][0];
        expect(args.include.cycle.select.farmId).toBe(true);
    });

    test('findPublicLotByAnyIdentifier selects batch.cycle.farmId', async () => {
        const findFirst = jest.fn().mockResolvedValue(null);
        const svc = loadService({ harvestBatch: { findFirst: jest.fn() }, lot: { findFirst } });

        await svc.findPublicLotByAnyIdentifier('L1');

        const args = findFirst.mock.calls[0][0];
        expect(args.include.batch.include.cycle.select.farmId).toBe(true);
    });

    test('a cross-farm batch cert is droppable in-memory (batch.cycle.farmId !== batch.farmId)', async () => {
        const row = {
            id: 'batch-1', farmId: 'farm-A',
            cycle: { id: 'cycle-1', farmId: 'farm-B', certificate: { certificateNumber: 'CERT-X', status: 'active' } },
        };
        const findFirst = jest.fn().mockResolvedValue(row);
        const svc = loadService({ harvestBatch: { findFirst }, lot: { findFirst: jest.fn() } });

        const batch = await svc.findPublicBatchByAnyIdentifier('B1');

        // The route's comparison can now run without a separate query.
        expect(String(batch.cycle.farmId) !== String(batch.farmId)).toBe(true);
    });

    test('a same-farm batch cert is retained by the comparison', async () => {
        const row = {
            id: 'batch-1', farmId: 'farm-A',
            cycle: { id: 'cycle-1', farmId: 'farm-A', certificate: { certificateNumber: 'CERT-X', status: 'active' } },
        };
        const findFirst = jest.fn().mockResolvedValue(row);
        const svc = loadService({ harvestBatch: { findFirst }, lot: { findFirst: jest.fn() } });

        const batch = await svc.findPublicBatchByAnyIdentifier('B1');
        expect(String(batch.cycle.farmId) !== String(batch.farmId)).toBe(false);
    });
});
