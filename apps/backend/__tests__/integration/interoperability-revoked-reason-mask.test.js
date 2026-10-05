/**
 * B2 (PDPA-LEAK cluster) part 2 — Certificate.revokedReason must NOT broadcast a
 * national ID on the interoperability projections.
 *
 * revokedReason is projected to every consumer on the UNAUTHENTICATED public
 * verify endpoint (buildTrustRecord) + the partner e-certificate envelope
 * (buildCertificateEnvelope) + the partner revocation feed. Because the cert is
 * loaded through the extended (decrypting) prisma client, the at-rest encrypt
 * (part 1) decrypts back to plaintext before it reaches the projection — so the
 * public API would STILL broadcast the plaintext ID. Fix: maskThaiIdsInText the
 * revokedReason at each projection so a 13-digit run is redacted (keeps the human
 * reason minus the ID).
 *
 * Harness mirrors interoperability-track.test.js (fully-mocked prisma → the mock
 * returns the post-decrypt plaintext the extended client would hand the route).
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => {
        req.user = { id: 'provider-1', role: 'REVIEWER', canonicalRole: 'REVIEWER' };
        next();
    },
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
        },
        traceQrSecurity: { findFirst: jest.fn() },
    },
}));

jest.mock('../../services/crypto/signature-service', () => ({
    getSignatureService: jest.fn(() => ({
        sign: jest.fn().mockResolvedValue('mock-signature'),
        getPublicKey: jest.fn().mockResolvedValue('mock-public-key'),
    })),
}));

jest.mock('../../shared/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

process.env.INTEROP_PARTNER_API_KEYS = JSON.stringify({ 'test-partner': 'test-partner-key' });

const { prisma } = require('../../services/prisma-database');
require('../../middleware/partner-api-key').requirePartnerApiKey._reload();
const interoperabilityRouter = require('../../routes/api/integration/interoperability');

// A revocation reason a reviewer typed a national ID into.
const REASON_WITH_ID = 'พบสวมสิทธิ์ เลขบัตร 1100000000008 ไม่ตรงกับผู้ยื่น';
const MASKED = '1-XXXX-XXXX-X-0008'; // maskThaiId('1100000000008')
const RUN_13 = /(?<!\d)\d{13}(?!\d)/;

describe('[B2] interoperability projections mask revokedReason national IDs', () => {
    let app;
    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/interoperability', interoperabilityRouter);
    });
    beforeEach(() => jest.clearAllMocks());

    it('UNAUTHENTICATED /verification returns no revokedReason at all (minimal public record)', async () => {
        prisma.certificate.findFirst.mockResolvedValue({
            id: 'c1', certificateNumber: 'CERT-2026-0002', status: 'REVOKED',
            revokedAt: new Date('2026-02-01T00:00:00.000Z'), revokedReason: REASON_WITH_ID,
            farmId: 'f1', farmName: 'Farm', province: 'Bangkok', district: 'X',
            updatedAt: new Date('2026-02-01T00:00:00.000Z'), application: null,
        });
        const res = await request(app).get('/api/interoperability/v1/verification?certificateNumber=CERT-2026-0002');
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain('1100000000008');
        expect(res.body.data.revokedReason).toBeUndefined();
    });

    it('partner e-certificate (buildCertificateEnvelope) masks the ID in revokedReason', async () => {
        prisma.certificate.findFirst.mockResolvedValue({
            id: 'c1', certificateNumber: 'CERT-2026-0002', status: 'REVOKED',
            revokedAt: new Date('2026-02-01T00:00:00.000Z'), revokedReason: REASON_WITH_ID,
            applicantName: 'A', farmName: 'Farm', cropType: 'cannabis', userId: 'u1',
            province: 'Bangkok', district: 'X', updatedAt: new Date(), application: null,
        });
        const res = await request(app)
            .get('/api/interoperability/v1/certificates/CERT-2026-0002/e-certificate')
            .set('x-api-key', 'test-partner-key');
        expect(res.status).toBe(200);
        const rr = res.body.data.envelope.certificate.revokedReason;
        expect(rr).not.toMatch(RUN_13);
        expect(rr).toContain(MASKED);
    });

    it('partner revocation feed masks the ID in revokedReason', async () => {
        prisma.certificate.findMany.mockResolvedValue([{
            certificateNumber: 'CERT-2026-0002', status: 'REVOKED',
            revokedAt: new Date('2026-02-01T00:00:00.000Z'), revokedReason: REASON_WITH_ID,
            revokedBy: 'provider-2', updatedAt: new Date(), farmName: 'Farm',
            province: 'Bangkok', district: 'X', isDeleted: false,
        }]);
        const res = await request(app)
            .get('/api/interoperability/v1/trust/revocations')
            .set('x-api-key', 'test-partner-key');
        expect(res.status).toBe(200);
        const rr = res.body.data[0].revokedReason;
        expect(rr).not.toMatch(RUN_13);
        expect(rr).toContain(MASKED);
    });

    it('a null revokedReason still projects the pre-existing fallbacks (no behaviour change)', async () => {
        prisma.certificate.findMany.mockResolvedValue([{
            certificateNumber: 'CERT-2026-0003', status: 'REVOKED',
            revokedAt: new Date('2026-02-01T00:00:00.000Z'), revokedReason: null,
            revokedBy: 'p', updatedAt: new Date(), farmName: 'F', province: 'B', district: 'X',
            isDeleted: false,
        }]);
        const res = await request(app)
            .get('/api/interoperability/v1/trust/revocations')
            .set('x-api-key', 'test-partner-key');
        expect(res.status).toBe(200);
        expect(res.body.data[0].revokedReason).toBe('NOT_SPECIFIED');
    });
});
