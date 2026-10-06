'use strict';

/**
 * Staging view-pack 2026-10-06, defect D1. The web names each row's holder
 * ("ยื่นในนาม …") and filters by holder from `entityId` on the rows of
 * GET /api/applications/my (applications and payments pages). The query read the
 * column; the row mapper never sent it, so no row named its holder and every holder
 * chip emptied the list. The same mapper serves GET /api/applications.
 *
 * Route-level: the real router, service and mapper run; only Prisma's findMany,
 * auth and the holder scope are stubbed. The rows come back with every scalar, as a
 * Prisma `include` returns them. The real-Postgres twin is in
 * __tests__/integration/holder-scope-real-postgres.test.js (case 1).
 */

const mockActor = { user: { id: 'user-a', healthId: 'health-a', role: 'health', canonicalRole: 'health' } };
jest.mock('../../middleware/auth-middleware', () => {
    const attach = (req, _res, next) => { req.user = { ...mockActor.user }; return next(); };
    return { authenticateProvider: attach, authenticateHealth: attach, authenticateAny: attach };
});
jest.mock('../../services/holder-access', () => ({
    ...jest.requireActual('../../services/holder-access'),
    holderScope: async () => ({ userId: 'user-a', readIds: ['entity-personal', 'entity-company'], editIds: [] }),
}));

const express = require('express');
const request = require('supertest');
const { prisma } = require('../../services/prisma-database');

const rows = [
    { id: 'app-1', applicationNumber: 'APP-1', status: 'DRAFT', entityId: 'entity-company', applicantId: 'user-a', formData: {}, createdAt: new Date('2026-10-01'), certificates: [] },
    { id: 'app-2', applicationNumber: 'APP-2', status: 'SUBMITTED', entityId: 'entity-personal', applicantId: 'user-a', formData: {}, createdAt: new Date('2026-10-02'), certificates: [] },
];

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', require('../../routes/api/applications/application-listing-handlers'));
    return app;
}

describe('applicant list rows carry their holder (D1)', () => {
    let findMany;
    beforeEach(() => { findMany = jest.spyOn(prisma.application, 'findMany').mockResolvedValue(rows); });
    afterEach(() => jest.restoreAllMocks());

    test.each(['/api/applications/my', '/api/applications'])('GET %s: each row has the entityId of its filing', async (url) => {
        const res = await request(buildApp()).get(url);
        expect(res.status).toBe(200);
        expect(res.body.data.map((r) => [r.id, r.entityId])).toEqual([['app-1', 'entity-company'], ['app-2', 'entity-personal']]);
    });

    test('the list query does not narrow the columns past entityId', async () => {
        await request(buildApp()).get('/api/applications/my');
        const args = findMany.mock.calls[0][0];
        expect(args.select === undefined || args.select.entityId === true).toBe(true);
    });
});

describe('the detail payload carries its holder (D2: the wizard resumes the holder from it)', () => {
    test('buildApplicationDetailPayload sends the row entityId', () => {
        const { buildApplicationDetailPayload } = require('../../routes/api/helpers/application-payload-builders');
        expect(buildApplicationDetailPayload({ ...rows[0], formData: { plantId: 'cannabis' } }).entityId).toBe('entity-company');
    });
});
