/**
 * SEC-AUDIT-012 + SEC-AUDIT-010 regression.
 *
 * SEC-AUDIT-012 — the gov-to-gov bulk/export interoperability endpoints
 * (trust registry/revocations, trace events, e-certificate, signed envelope)
 * must require a per-partner API key. Single-cert verification stays public.
 *
 * SEC-AUDIT-010 — the e-certificate export (a GET) must NOT write to the DB; it
 * previously overwrote Certificate.documentHash on every read, corrupting the
 * issuance-time integrity hash.
 *
 * See docs/handoffs/audit-2026-05-31/security/SEC-AUDIT.md.
 */
'use strict';

const express = require('express');
const request = require('supertest');

process.env.INTEROP_PARTNER_API_KEYS = JSON.stringify({ 'test-partner': 'valid-partner-key' });

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => {
        req.user = { id: 'provider-1', role: 'ADMIN', canonicalRole: 'ADMIN' };
        next();
    },
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
        plantingCycle: { findFirst: jest.fn() },
        harvestBatch: { findFirst: jest.fn() },
        lot: { findFirst: jest.fn() },
        // No `plantUnit` delegate: the interoperability resolver stopped resolving a
        // PLANT_UNIT entity on 2026-08-25 (R8 of design notes
        // 2026-08-20-planting-tnt-design.md retires per-plant tracking). A re-added
        // branch fails loudly here instead of reading a mocked null.
        traceQrSecurity: { findFirst: jest.fn() },
    },
}));

jest.mock('../../services/crypto/signature-service', () => ({
    getSignatureService: jest.fn(() => ({
        sign: jest.fn().mockResolvedValue('mock-signature'),
        verify: jest.fn().mockResolvedValue(true),
        getPublicKey: jest.fn().mockResolvedValue('mock-public-key'),
    })),
}));

jest.mock('../../shared/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const { prisma } = require('../../services/prisma-database');
const { requirePartnerApiKey } = require('../../middleware/partner-api-key');
requirePartnerApiKey._reload();
const interoperabilityRouter = require('../../routes/api/integration/interoperability');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/interoperability', interoperabilityRouter);
    return app;
}

let app;
beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
});

// ── Middleware unit behaviour ───────────────────────────────────────────────
describe('requirePartnerApiKey middleware (SEC-AUDIT-012)', () => {
    const fakeReq = (key) => ({
        get: (h) => (h.toLowerCase() === 'x-api-key' ? key : undefined),
        ip: '127.0.0.1',
        originalUrl: '/api/interoperability/v1/trust/registry',
    });
    const fakeRes = () => ({
        statusCode: 200, body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; },
    });

    test('missing key → 401 PARTNER_KEY_MISSING, next not called', () => {
        const res = fakeRes();
        const next = jest.fn();
        requirePartnerApiKey(fakeReq(undefined), res, next);
        expect(res.statusCode).toBe(401);
        expect(res.body.code).toBe('PARTNER_KEY_MISSING');
        expect(next).not.toHaveBeenCalled();
    });

    test('invalid key → 401 PARTNER_KEY_INVALID, next not called', () => {
        const res = fakeRes();
        const next = jest.fn();
        requirePartnerApiKey(fakeReq('wrong-key'), res, next);
        expect(res.statusCode).toBe(401);
        expect(res.body.code).toBe('PARTNER_KEY_INVALID');
        expect(next).not.toHaveBeenCalled();
    });

    test('valid key → next() called and req.partner set', () => {
        const req = fakeReq('valid-partner-key');
        const next = jest.fn();
        requirePartnerApiKey(req, fakeRes(), next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.partner).toEqual({ id: 'test-partner' });
    });
});

// ── Route enforcement ───────────────────────────────────────────────────────
describe('interoperability bulk endpoints require a partner key (SEC-AUDIT-012)', () => {
    test('GET /v1/trust/registry without key → 401', async () => {
        const res = await request(app).get('/api/interoperability/v1/trust/registry');
        expect(res.status).toBe(401);
        expect(prisma.certificate.findMany).not.toHaveBeenCalled();
    });

    test('GET /v1/trust/registry with wrong key → 401', async () => {
        const res = await request(app)
            .get('/api/interoperability/v1/trust/registry')
            .set('x-api-key', 'nope');
        expect(res.status).toBe(401);
        expect(prisma.certificate.findMany).not.toHaveBeenCalled();
    });

    test('GET /v1/trust/registry with valid key → 200', async () => {
        prisma.certificate.findMany.mockResolvedValue([]);
        const res = await request(app)
            .get('/api/interoperability/v1/trust/registry')
            .set('x-api-key', 'valid-partner-key');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(prisma.certificate.findMany).toHaveBeenCalledTimes(1);
    });

    test('single-cert verification stays PUBLIC (no key needed)', async () => {
        prisma.certificate.findFirst.mockResolvedValue(null);
        const res = await request(app).get('/api/interoperability/v1/verification?certificateNumber=CERT-X');
        expect(res.status).not.toBe(401);
    });
});

describe('e-certificate export does not persist on read (SEC-AUDIT-010)', () => {
    test('GET e-certificate with a valid key never calls certificate.update', async () => {
        prisma.certificate.findFirst.mockResolvedValue({
            id: 'cert-1', certificateNumber: 'CERT-2026-0001', status: 'ACTIVE',
            issuedDate: new Date('2026-01-01'), expiryDate: new Date('2027-01-01'),
            farmName: 'Farm', applicantName: 'Applicant', province: 'CM', district: 'Muang',
        });

        const res = await request(app)
            .get('/api/interoperability/v1/certificates/CERT-2026-0001/e-certificate')
            .set('x-api-key', 'valid-partner-key');

        expect(res.status).not.toBe(401);            // key accepted
        expect(prisma.certificate.update).not.toHaveBeenCalled(); // no write on read path
    });
});
