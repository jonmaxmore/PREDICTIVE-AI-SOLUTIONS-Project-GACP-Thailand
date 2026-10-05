/**
 * H1 (backend) — the PUBLIC verify endpoint must surface signature + hash
 * verdicts so a tampered cert is genuinely tamper-evident.
 *
 * The endpoint already recomputes the documentHash (`integrity`) but never
 * checked the RSA signature. We additively expose:
 *   - hashValid            : integrity.status === 'VALID'
 *   - signatureValid       : signature.signed ? signature.valid === true : null
 *                            (NULL — not false — when unsigned, so legacy certs
 *                             are NOT falsely flagged tampered)
 *   - sealed               : signature.signed === true
 *   - publicKeyFingerprint : the verifying public-key fingerprint (64-hex) | null
 *
 * existing verified/valid/integrity semantics + HTTP status codes unchanged.
 *
 * certificate-service imports prisma-database (process.exit(1) without
 * DATABASE_URL) — mock the service module entirely. Producing a real RSA
 * signature in-test depends on a provisioned local key + passphrase (env-
 * dependent), so per the plan's fallback we mock verifyCertificateSignature /
 * verifyDocumentIntegrity to controlled values and assert public.js maps them
 * to the response fields correctly (esp. the null-not-false rule).
 */
'use strict';

const mockFindByCertificateNumber = jest.fn();
const mockVerifyDocumentIntegrity = jest.fn();
const mockVerifyCertificateSignature = jest.fn();

jest.mock('../../services/certificate-service', () => ({
    findByCertificateNumber: (...a) => mockFindByCertificateNumber(...a),
    verifyDocumentIntegrity: (...a) => mockVerifyDocumentIntegrity(...a),
    verifyCertificateSignature: (...a) => mockVerifyCertificateSignature(...a),
}));

// Pass-through rate limiter so the route logic runs unimpeded.
jest.mock('../../middleware/rate-limiter', () => ({
    createRateLimiter: () => (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const publicRouter = require('../../routes/api/auth/public');

function makeApp() {
    const app = express();
    app.use('/api/v1/public', publicRouter);
    return app;
}

const FINGERPRINT = 'a'.repeat(64); // 64-hex
const future = new Date(Date.now() + 365 * 24 * 3600 * 1000);
const baseCert = {
    certificateNumber: 'GACP-2026-0001',
    status: 'active',
    expiryDate: future,
    farmName: 'สวนทดสอบ',
    applicantName: 'สมชาย ใจดี',
    province: 'เชียงใหม่',
    cropType: 'กัญชา',
    issuedDate: new Date('2026-01-01'),
    standardName: 'GACP',
    documentHash: 'deadbeef',
    signature: 'sig',
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('public verify — signature + hash verdicts (H1)', () => {
    test('1) signed + valid cert → signatureValid=true, sealed=true, hashValid=true, fingerprint 64-hex', async () => {
        mockFindByCertificateNumber.mockResolvedValue({ ...baseCert });
        mockVerifyDocumentIntegrity.mockReturnValue({ status: 'VALID', documentHash: 'deadbeef' });
        mockVerifyCertificateSignature.mockResolvedValue({
            signed: true, valid: true, algorithm: 'RSA-SHA256', publicKeyFingerprint: FINGERPRINT,
        });

        const res = await request(makeApp()).get('/api/v1/public/verify/GACP-2026-0001');
        expect(res.status).toBe(200);
        expect(res.body.data.signatureValid).toBe(true);
        expect(res.body.data.sealed).toBe(true);
        expect(res.body.data.hashValid).toBe(true);
        expect(res.body.data.publicKeyFingerprint).toMatch(/^[0-9a-f]{64}$/);
    });

    test('2) tampered farmName (hash mismatch) → hashValid=false, integrity TAMPERED, signatureValid=false', async () => {
        mockFindByCertificateNumber.mockResolvedValue({ ...baseCert, farmName: 'TAMPERED FARM' });
        mockVerifyDocumentIntegrity.mockReturnValue({ status: 'TAMPERED', expected: 'deadbeef', actual: 'cafe' });
        // signature no longer verifies over the tampered (recomputed) content
        mockVerifyCertificateSignature.mockResolvedValue({
            signed: true, valid: false, algorithm: 'RSA-SHA256', publicKeyFingerprint: FINGERPRINT,
        });

        const res = await request(makeApp()).get('/api/v1/public/verify/GACP-2026-0001');
        expect(res.status).toBe(200);
        expect(res.body.data.hashValid).toBe(false);
        expect(res.body.data.integrity).toBe('TAMPERED');
        expect(res.body.data.signatureValid).toBe(false);
        expect(res.body.data.sealed).toBe(true);
    });

    test('3) recomputed-hash-matches but signature NOT re-signed → integrity VALID yet signatureValid=false', async () => {
        mockFindByCertificateNumber.mockResolvedValue({ ...baseCert });
        mockVerifyDocumentIntegrity.mockReturnValue({ status: 'VALID', documentHash: 'deadbeef' });
        mockVerifyCertificateSignature.mockResolvedValue({
            signed: true, valid: false, algorithm: 'RSA-SHA256', publicKeyFingerprint: FINGERPRINT,
        });

        const res = await request(makeApp()).get('/api/v1/public/verify/GACP-2026-0001');
        expect(res.status).toBe(200);
        expect(res.body.data.integrity).toBe('VALID');
        expect(res.body.data.hashValid).toBe(true);
        expect(res.body.data.signatureValid).toBe(false);
    });

    test('4) legacy unsigned cert → signatureValid=NULL (not false), sealed=false, integrity UNSIGNED', async () => {
        mockFindByCertificateNumber.mockResolvedValue({ ...baseCert, documentHash: null, signature: null });
        mockVerifyDocumentIntegrity.mockReturnValue({ status: 'UNSIGNED' });
        mockVerifyCertificateSignature.mockResolvedValue({ signed: false });

        const res = await request(makeApp()).get('/api/v1/public/verify/GACP-2026-0001');
        expect(res.status).toBe(200);
        expect(res.body.data.signatureValid).toBeNull();
        expect(res.body.data.sealed).toBe(false);
        expect(res.body.data.integrity).toBe('UNSIGNED');
        expect(res.body.data.publicKeyFingerprint).toBeNull();
    });
});
