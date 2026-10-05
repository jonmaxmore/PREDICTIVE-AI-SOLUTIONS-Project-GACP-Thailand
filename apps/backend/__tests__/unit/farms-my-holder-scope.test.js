// R2 Task 15 fix round 1: GET /farms/my reads the caller's holder scope
// (the same R1 read predicate as /my/eligible-for-planting), not the owner pin.
const express = require('express');
const request = require('supertest');

const mockGetByOwner = jest.fn();
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => { req.user = { id: 'user-1', role: 'health' }; next(); },
}));
jest.mock('../../services/farm-service', () => ({
    getByOwner: (...a) => mockGetByOwner(...a),
    getEligibleForPlanting: jest.fn(),
}));
jest.mock('../../services/holder-access', () => ({
    ...jest.requireActual('../../services/holder-access'),
    holderScope: jest.fn(async () => ({ userId: 'user-1', readIds: ['ent-c'], editIds: [] })),
}));
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, logger: l, createLogger: () => l };
});

const router = require('../../routes/api/cultivation/farms');

describe('GET /api/farms/my carries the holder scope', () => {
    test('passes holderScope to the service and returns the holder id', async () => {
        mockGetByOwner.mockResolvedValue([{ id: 'f1', entityId: 'ent-c' }]);
        const app = express();
        app.use('/api/farms', router);
        const res = await request(app).get('/api/farms/my');
        expect(res.status).toBe(200);
        expect(mockGetByOwner).toHaveBeenCalledWith('user-1', {
            holderScope: expect.objectContaining({ readIds: ['ent-c'] }),
        });
        expect(res.body.data[0].entityId).toBe('ent-c');
    });
});
