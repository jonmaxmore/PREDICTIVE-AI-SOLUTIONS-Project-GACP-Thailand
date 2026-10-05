/**
 * Health dashboard farm/certificate counts must scope by the owner's User.id
 * (UUID), NOT by User.healthId.
 *
 * BUG (reproduced live on staging 2026-07-03): GET /api/dashboard returned
 * `farms: 0, certificates: 0` for an applicant who owns 7 farms. Root cause —
 * the counts filtered `owner: { healthId: actorHealthId }` / `user: { healthId
 * }`, but `actorHealthId` is the keyed-HMAC TOKEN (from resolveHealthIdentity)
 * while the `User.healthId` COLUMN is the enc:v1: AES ciphertext at rest
 * (STAGE B). token !== ciphertext → the relation filter never matches → 0.
 * Farm.ownerId / Certificate.userId are plain User.id UUIDs (never re-keyed),
 * so scope by those instead. This is the same plaintext/token-vs-column class
 * as the documents/preview 404s.
 *
 * R2 Task 12 (Review Focus 4): the counters count exactly what the lists list —
 * the membership-based farm fragment (as GET /farms/my) and the certificate
 * holder fragment (as GET /certificates/my). Neither touches a healthId.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

const mockFarmCount = jest.fn();
const mockCertCount = jest.fn();
const mockNotifCount = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        farm: { count: (...a) => mockFarmCount(...a) },
        certificate: { count: (...a) => mockCertCount(...a) },
        notification: { count: (...a) => mockNotifCount(...a) },
        application: { count: jest.fn().mockResolvedValue(0) },
        // The caller is an ACTIVE OWNER of ent-1 (holder-access reads memberships).
        entityMembership: { findMany: jest.fn().mockResolvedValue([{ entityId: 'ent-1', role: 'OWNER' }]) },
    },
}));

const mockResolveIdentity = jest.fn();
const mockGetHealthApps = jest.fn();
jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: (...a) => mockResolveIdentity(...a),
    getHealthApplications: (...a) => mockGetHealthApps(...a),
}));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateAny: (req, _res, next) => {
        // Post-detokenize shape: healthId = decrypted plaintext, canonicalId =
        // the token, id = the UUID.
        req.user = { id: 'user-uuid-1', healthId: '1186494077533', canonicalId: 'TOKEN-abc' };
        next();
    },
}));

const dashboardRouter = require('../../routes/api/system/dashboard');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/dashboard', dashboardRouter);
    return app;
}

describe('GET /dashboard — farm/cert counts scope by holder membership, not healthId', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // resolveHealthIdentity returns the TOKEN as healthId + the UUID as userId.
        mockResolveIdentity.mockResolvedValue({ userId: 'user-uuid-1', healthId: 'TOKEN-abc' });
        mockGetHealthApps.mockResolvedValue([]);
        mockFarmCount.mockResolvedValue(7);
        mockCertCount.mockResolvedValue(2);
        mockNotifCount.mockResolvedValue(0);
    });

    test('farm.count counts the /farms/my rows: the farm-access fragment (User.id + memberships), never owner.healthId', async () => {
        await request(buildApp()).get('/dashboard');
        expect(mockFarmCount).toHaveBeenCalledTimes(1);
        const where = JSON.parse(JSON.stringify(mockFarmCount.mock.calls[0][0].where));
        expect(where).toEqual({
            OR: [
                { ownerId: 'user-uuid-1', entityId: null },
                { ownerId: 'user-uuid-1', entityId: { in: ['ent-1'] } },
                { entityId: { in: ['ent-1'] } },
            ],
            isDeleted: false,
        });
        expect(JSON.stringify(where)).not.toContain('healthId');
    });

    test('certificate.count counts the /certificates/my rows: the holder fragment, never user.healthId', async () => {
        await request(buildApp()).get('/dashboard');
        expect(mockCertCount).toHaveBeenCalledTimes(1);
        const where = JSON.parse(JSON.stringify(mockCertCount.mock.calls[0][0].where));
        expect(where).toEqual({
            isDeleted: false,
            status: { in: ['active', 'ACTIVE'] },
            application: { entityId: { in: ['ent-1'] } },
        });
        expect(JSON.stringify(where)).not.toContain('healthId');
    });

    test('the counts reach the response (farms:7, certificates:2 — not 0)', async () => {
        const res = await request(buildApp()).get('/dashboard');
        expect(res.status).toBe(200);
        expect(res.body.data.farms).toBe(7);
        expect(res.body.data.certificates).toBe(2);
    });
});
