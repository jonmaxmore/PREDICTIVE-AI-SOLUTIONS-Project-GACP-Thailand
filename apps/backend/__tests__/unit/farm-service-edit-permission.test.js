/**
 * Farm-worker Wave B, Chunk 4 — farm-service.updateFarm gates on EDIT_FARM.
 *
 * The Wave-A VIEWER floor (getById { forMutation: true }) stays underneath as
 * defense-in-depth; the per-permission assert layers ON TOP: the legacy owner
 * passes inside assertFarmActionPermission (rule a), a workspace co-member
 * must hold effective EDIT_FARM, and the denial propagates so the route can
 * map it to 403.
 */

'use strict';

const mockFarmFindFirst = jest.fn();
const mockFarmUpdate = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        farm: {
            findFirst: (...a) => mockFarmFindFirst(...a),
            update: (...a) => mockFarmUpdate(...a),
            findMany: jest.fn().mockResolvedValue([]),
        },
    },
}));

jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/farm-access', () => ({
    farmAccessWhere: jest.fn().mockResolvedValue({ ownerId: 'caller-1' }),
    listAccessibleFarmIds: jest.fn().mockResolvedValue([]),
    resolveFarmOwnerAccess: jest.fn(),
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockAssertFarmActionPermission = jest.fn();
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertFarmActionPermission: (...a) => mockAssertFarmActionPermission(...a),
}));

const farmService = require('../../services/farm-service');

beforeEach(() => {
    jest.clearAllMocks();
    mockAssertFarmActionPermission.mockResolvedValue({ allowed: true });
});

describe('updateFarm — EDIT_FARM permission gate', () => {
    const EXISTING = { id: 'farm-1', ownerId: 'employer-1', entityId: 'ent-1' };

    it('asserts EDIT_FARM with the loaded farm row before writing', async () => {
        mockFarmFindFirst.mockResolvedValue(EXISTING);
        mockFarmUpdate.mockResolvedValue({ id: 'farm-1', farmName: 'ใหม่' });

        const out = await farmService.updateFarm('farm-1', 'worker-1', { farmName: 'ใหม่' });

        expect(out).toEqual({ id: 'farm-1', farmName: 'ใหม่' });
        expect(mockAssertFarmActionPermission).toHaveBeenCalledWith(expect.objectContaining({
            farm: EXISTING,
            userId: 'worker-1',
            permission: 'EDIT_FARM',
        }));
        // gate runs BEFORE the write
        const gateOrder = mockAssertFarmActionPermission.mock.invocationCallOrder[0];
        const writeOrder = mockFarmUpdate.mock.invocationCallOrder[0];
        expect(gateOrder).toBeLessThan(writeOrder);
    });

    it('denial propagates (route maps to 403) and blocks the write', async () => {
        mockFarmFindFirst.mockResolvedValue(EXISTING);
        const err = new Error('denied');
        err.code = 'ENTITY_PERMISSION_DENIED';
        err.statusCode = 403;
        err.permission = 'EDIT_FARM';
        mockAssertFarmActionPermission.mockRejectedValue(err);

        await expect(farmService.updateFarm('farm-1', 'worker-1', { farmName: 'x' }))
            .rejects.toMatchObject({ code: 'ENTITY_PERMISSION_DENIED', permission: 'EDIT_FARM' });
        expect(mockFarmUpdate).not.toHaveBeenCalled();
    });

    it('no farm found (Wave-A floor / no access) → null, no gate call', async () => {
        mockFarmFindFirst.mockResolvedValue(null);
        const out = await farmService.updateFarm('farm-1', 'worker-1', { farmName: 'x' });
        expect(out).toBeNull();
        expect(mockAssertFarmActionPermission).not.toHaveBeenCalled();
    });
});
