/**
 * IDOR ownership contract — T-014 / PR-02
 *
 * Locks in the 404-on-ownership-fail contract established in PRs #262/#263/#264.
 *
 * Twenty-two health-route endpoints across six controllers/route files now
 * return 404 (not 403) when the resolved row's owner !== req.user.id, so
 * "doesn't exist" and "not yours" produce identical responses and ids
 * cannot be enumerated by response-code differential.
 *
 * Future refactors that drop the ownership check, return 403 instead of
 * 404, or short-circuit before the check runs will fail this test.
 *
 * Each describe block covers one representative endpoint per controller —
 * the helper pattern is shared across siblings, so one regression catches
 * the whole class.
 */

jest.mock('../../shared/logger', () => {
    const noop = () => {};
    const stub = { info: noop, warn: noop, error: noop, debug: noop, log: noop, fatal: noop, trace: noop };
    return {
        ...stub,
        createLogger: jest.fn(() => stub),
    };
});

jest.mock('../../services/site-analysis-service');
jest.mock('../../services/training-record-service');
jest.mock('../../services/cultivation-log-service');
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findUnique: jest.fn() },
        farm: { findUnique: jest.fn(), findMany: jest.fn() },
        plantingCycle: { findUnique: jest.fn() },
    },
}));

const siteAnalysisService = require('../../services/site-analysis-service');
const trainingRecordService = require('../../services/training-record-service');
const cultivationLogService = require('../../services/cultivation-log-service');
const { prisma } = require('../../services/prisma-database');

const siteAnalysisController = require('../../controllers/site-analysis-controller');
const trainingRecordController = require('../../controllers/training-record-controller');
const cultivationLogController = require('../../controllers/cultivation-log-controller');

function buildRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('IDOR ownership contract — T-014 / PR-02', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('site-analysis-controller — resolveOwnedAnalysis', () => {
        test('GET /:id returns 404 when row owner differs from req.user.id', async () => {
            siteAnalysisService.getAnalysisById.mockResolvedValue({
                id: 'analysis-1',
                farm: { ownerId: 'other-tenant' },
            });
            const req = { params: { id: 'analysis-1' }, user: { id: 'me' } };
            const res = buildRes();

            await siteAnalysisController.getAnalysisById(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.status).not.toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, message: 'Site analysis not found' }),
            );
        });

        test('GET /:id returns the row when owner matches', async () => {
            const row = { id: 'analysis-1', farm: { ownerId: 'me' }, soilPH: 6.5 };
            siteAnalysisService.getAnalysisById.mockResolvedValue(row);
            const req = { params: { id: 'analysis-1' }, user: { id: 'me' } };
            const res = buildRes();

            await siteAnalysisController.getAnalysisById(req, res);

            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, data: row }),
            );
        });

        test('GET /:id returns 404 when row does not exist (same shape as cross-tenant)', async () => {
            siteAnalysisService.getAnalysisById.mockResolvedValue(null);
            const req = { params: { id: 'missing' }, user: { id: 'me' } };
            const res = buildRes();

            await siteAnalysisController.getAnalysisById(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, message: 'Site analysis not found' }),
            );
        });
    });

    describe('training-record-controller — resolveOwnedRecord', () => {
        test('DELETE /:id returns 404 on cross-tenant before deleting', async () => {
            trainingRecordService.getRecordById.mockResolvedValue({
                id: 'record-1',
                farm: { ownerId: 'other-tenant' },
            });
            const req = { params: { id: 'record-1' }, user: { id: 'me' } };
            const res = buildRes();

            await trainingRecordController.deleteRecord(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(trainingRecordService.deleteRecord).not.toHaveBeenCalled();
        });

        test('PUT /:id returns 404 on cross-tenant before updating', async () => {
            trainingRecordService.getRecordById.mockResolvedValue({
                id: 'record-1',
                farm: { ownerId: 'other-tenant' },
            });
            const req = {
                params: { id: 'record-1' },
                user: { id: 'me' },
                body: { trainingTopic: 'changed' },
            };
            const res = buildRes();

            await trainingRecordController.updateRecord(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(trainingRecordService.updateRecord).not.toHaveBeenCalled();
        });
    });

    describe('cultivation-log-controller — verifyCycleOwnership / verifyFarmOwnership', () => {
        // PR #264 normalized 7 cultivation-log sites from 403 → 404. Cover the
        // three distinct ownership-resolution paths:
        //   1. resource-by-id (log.cycle.farm.ownerId !== userId)   — getLogById
        //   2. cycle-scope (cycle exists but farm not owned)        — getLogsByCycle
        //   3. farm-scope (farm not owned by user)                  — getLogsByFarm

        test('GET /:id returns 404 when log.cycle.farm.ownerId !== req.user.id', async () => {
            cultivationLogService.getLogById.mockResolvedValue({
                id: 'log-1',
                cycle: { farm: { ownerId: 'other-tenant' } },
            });
            const req = { params: { id: 'log-1' }, user: { id: 'me' } };
            const res = buildRes();

            await cultivationLogController.getLogById(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.status).not.toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, message: 'Cultivation log not found' }),
            );
        });

        test('DELETE /:id returns 404 on cross-tenant before deleting', async () => {
            cultivationLogService.getLogById.mockResolvedValue({
                id: 'log-1',
                cycle: { farm: { ownerId: 'other-tenant' } },
            });
            const req = { params: { id: 'log-1' }, user: { id: 'me' } };
            const res = buildRes();

            await cultivationLogController.deleteLog(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(cultivationLogService.deleteLog).not.toHaveBeenCalled();
        });

        test('GET /cycle/:cycleId returns 404 when cycle.farmId not in user\'s farms', async () => {
            // verifyCycleOwnership reads plantingCycle then farm.findMany.
            // Cycle exists but its farmId isn't among the user's owned farms.
            prisma.plantingCycle.findUnique.mockResolvedValue({ farmId: 'other-tenant-farm' });
            prisma.farm.findMany.mockResolvedValue([{ id: 'my-farm-1' }]);

            const req = {
                params: { cycleId: 'cycle-x' },
                user: { id: 'me' },
                query: {},
            };
            const res = buildRes();

            await cultivationLogController.getLogsByCycle(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, message: 'Planting cycle not found' }),
            );
            expect(cultivationLogService.getLogsByCycle).not.toHaveBeenCalled();
        });

        test('GET /farm/:farmId returns 404 when farmId is not in user\'s farms', async () => {
            // verifyFarmOwnership reads farm.findMany only.
            prisma.farm.findMany.mockResolvedValue([{ id: 'my-farm-1' }]);

            const req = {
                params: { farmId: 'other-tenant-farm' },
                user: { id: 'me' },
                query: {},
            };
            const res = buildRes();

            await cultivationLogController.getLogsByFarm(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, message: 'Farm not found' }),
            );
            expect(cultivationLogService.getLogsByFarm).not.toHaveBeenCalled();
        });

        test('POST / returns 404 when cycleId not owned by caller', async () => {
            // createLog also goes through verifyCycleOwnership before
            // service.createLog. The 404 must fire before the write.
            prisma.plantingCycle.findUnique.mockResolvedValue({ farmId: 'other-tenant-farm' });
            prisma.farm.findMany.mockResolvedValue([{ id: 'my-farm-1' }]);

            const req = {
                body: { cycleId: 'cycle-x', logType: 'IRRIGATION' },
                user: { id: 'me' },
            };
            const res = buildRes();

            await cultivationLogController.createLog(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, message: 'Planting cycle not found' }),
            );
            expect(cultivationLogService.createLog).not.toHaveBeenCalled();
        });
    });
});
