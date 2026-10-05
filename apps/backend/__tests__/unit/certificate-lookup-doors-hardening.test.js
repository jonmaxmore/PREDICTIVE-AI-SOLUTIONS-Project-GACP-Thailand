/**
 * Round 3 (reviewer HIGH): sequential numbers (TH-GACP 1/2569, 2/2569 ...) make
 * walking the register practical. Every public lookup-by-number door must carry
 * the shared per-IP limiter and answer with only what /api/v1/public/verify
 * answers. Dead duplicate doors (no caller) are removed.
 * Real limiter (not mocked); prisma is a fake. No Postgres.
 */
'use strict';

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log), stream: { write: jest.fn() } };
});

const mockCert = {
    id: 'c1', uuid: 'u1', certificateNumber: 'TH-GACP 7/2569', status: 'ACTIVE', isDeleted: false,
    expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000), issuedDate: new Date('2026-01-01'),
    farmId: 'farm-secret-id', farmName: 'สวนทดสอบ', applicantName: 'สมชาย ใจดี', province: 'เชียงใหม่',
    district: 'เมือง', cropType: 'กัญชา', standardName: 'GACP', revokedReason: null,
    verificationCount: 9, lastVerifiedAt: new Date(), updatedAt: new Date(), documentHash: null, signature: null,
};
const mockFindFirst = jest.fn();
const mockFindMany = jest.fn(async () => []);
const mockFindUnique = jest.fn(async () => mockCert);
jest.mock('../../services/prisma-database', () => ({
    prisma: { certificate: {
        findFirst: (a) => mockFindFirst(a), findUnique: (a) => mockFindUnique(a), findMany: (a) => mockFindMany(a),
        count: jest.fn(async () => 0),
    } },
}));
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => { req.user = { id: 'p', role: 'REVIEWER' }; next(); },
}));
jest.mock('../../services/crypto/signature-service', () => ({
    getSignatureService: jest.fn(() => ({ sign: jest.fn().mockResolvedValue('sig'), getPublicKey: jest.fn().mockResolvedValue('k') })),
}));
process.env.INTEROP_PARTNER_API_KEYS = JSON.stringify({ 'test-partner': 'test-partner-key' });

const express = require('express');
const request = require('supertest');

function appWith(mountPath, router) {
    const app = express();
    app.set('trust proxy', true);
    app.use(mountPath, router);
    return app;
}
const interop = () => appWith('/api/interoperability', require('../../routes/api/integration/interoperability'));

beforeEach(() => { jest.clearAllMocks(); mockFindFirst.mockResolvedValue(mockCert); });

describe('dead duplicate public doors are removed', () => {
    test.each([
        ['/api/certificates/verify/TH-GACP-7-2569', () => appWith('/api/certificates', require('../../routes/api/certificates/certificates'))],
        ['/api/interoperability/v1/certificates/TH-GACP-7-2569/verify', interop],
        ['/api/interoperability/v1/verification/certificate/TH-GACP-7-2569', interop],
    ])('%s -> 404', async (url, mk) => {
        const res = await request(mk()).get(url);
        expect(res.status).toBe(404);
    });
});

describe('/v1/verification?certificateNumber= (kept: trust-verifier-portal calls it)', () => {
    const url = '/api/interoperability/v1/verification?certificateNumber=TH-GACP-7-2569';

    test('31st request in a minute -> 429', async () => {
        const app = interop();
        let last;
        for (let i = 0; i < 31; i++) { last = await request(app).get(url).set('X-Forwarded-For', '203.0.113.50'); }
        expect(last.status).toBe(429);
    });

    test('active certificate answers only the public-verify facts', async () => {
        const res = await request(interop()).get(url).set('X-Forwarded-For', '203.0.113.51');
        expect(res.status).toBe(200);
        const s = JSON.stringify(res.body);
        for (const leak of ['farm-secret-id', 'verificationCount', 'lastVerifiedAt', 'revokedReason', 'เหตุผลภายใน', 'signedEnvelope', 'updatedAt']) {
            expect(s).not.toContain(leak);
        }
        expect(res.body.data.certificateNumber).toBe('TH-GACP 7/2569');
        expect(res.body.data.farm.province).toBe('เชียงใหม่');
    });

    test('not-active certificate hides farm facts like the public door does', async () => {
        mockFindFirst.mockResolvedValue({ ...mockCert, status: 'REVOKED', revokedAt: new Date(), revokedReason: 'เหตุผลภายใน' });
        const res = await request(interop()).get(url).set('X-Forwarded-For', '203.0.113.52');
        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain('สวนทดสอบ');
        expect(JSON.stringify(res.body)).not.toContain('เมือง');
        expect(JSON.stringify(res.body)).not.toContain('เหตุผลภายใน');
    });
});

describe('the limiter is one shared definition', () => {
    test('public.js and interoperability.js use middleware/public-verify-limiter', () => {
        const fs = require('fs');
        const path = require('path');
        for (const f of ['routes/api/auth/public.js', 'routes/api/integration/interoperability.js']) {
            const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
            expect(src).toContain("middleware/public-verify-limiter");
        }
    });
});

describe('partner doors normalise / slug', () => {
    test('trust registry search by slug searches the stored number', async () => {
        await request(interop()).get('/api/interoperability/v1/trust/registry?search=TH-GACP-7-2569').set('x-api-key', 'test-partner-key');
        const where = mockFindMany.mock.calls[0][0].where;
        expect(where.OR[0].certificateNumber.contains).toBe('TH-GACP 7/2569');
    });
    test('trust record link uses the slug, never the raw number', () => {
        const { buildTrustRecord } = require('../../routes/api/interoperability/interoperability-core');
        const rec = buildTrustRecord(mockCert);
        expect(JSON.stringify(rec.links)).not.toMatch(/ |%20|%2F/);
        const env = require('../../routes/api/interoperability/interoperability-core');
        expect(typeof env.buildTrustRecord).toBe('function');
    });
});
