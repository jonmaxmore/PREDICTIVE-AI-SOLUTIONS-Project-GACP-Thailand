'use strict';

/**
 * Ruling 2 / defect 3 — PUBLIC KEY ON ROW (expand-before-contract).
 *
 * Pre-fix `certificates` carried signature / signatureAlgorithm / signatureKeyId
 * (prisma/schema/certification.prisma:105-107) but NOT the key that verifies
 * them, and verifyCertificateSignature (certificate-service.js:1081) called
 * `verifyWithLocalKey(hash, signature)` with no third argument — so every old
 * certificate was verified against whatever key happens to be on the box
 * TODAY. Rotate the key, rebuild the container, or move machines and every
 * previously-issued certificate reads as forged.
 *
 * Post-fix contract: the row's `signaturePublicKey` PEM wins; the loaded key is
 * only a fallback for legacy rows that have none.
 *
 * This test uses REAL RSA keys (no signature mocking) so the proof is
 * cryptographic rather than a stubbed boolean.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../shared/logger', () => {
    const l = {
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    };
    return { ...l, createLogger: () => l };
});

const PASS = 'r2-pinned-key-passphrase';
process.env.RSA_PRIVATE_KEY_PASSPHRASE = PASS;

// The service instance the certificate-service will reach for. Swapping what
// this returns is how the test simulates "the box now holds a different key".
let mockLiveService = null;
jest.mock('../../services/crypto/signature-service', () => {
    const actual = jest.requireActual('../../services/crypto/signature-service');
    return { ...actual, getSignatureService: () => mockLiveService };
});

const { SignatureService } = jest.requireActual('../../services/crypto/signature-service');
const certificateService = require('../../services/certificate-service');

const DOCUMENT_HASH = crypto.createHash('sha256').update('a certificate body').digest('hex');

async function newServiceWithFreshKey(label) {
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), `r2-pin-${label}-`));
    const svc = new SignatureService({ keyDir, useKMS: false });
    await svc.ensureInitialized();
    return { svc, publicPem: fs.readFileSync(path.join(keyDir, 'public.pem'), 'utf8') };
}

describe('Ruling 2 — old certificates verify from the public key pinned on their row', () => {
    let originalPublicPem;
    let signature;
    let savedRetired;

    beforeAll(async () => {
        // 1. The key that signed the certificate, on the old machine.
        const original = await newServiceWithFreshKey('original');
        mockLiveService = original.svc;
        originalPublicPem = original.publicPem;
        signature = await original.svc.signWithLocalKey(DOCUMENT_HASH, 'rsa:gacp-certificate');
        expect(signature).toEqual(expect.any(String));

        // 2. Machine move / container rebuild / rotation: a DIFFERENT key is now
        //    the one loaded on the box.
        const replacement = await newServiceWithFreshKey('replacement');
        mockLiveService = replacement.svc;
        expect(replacement.publicPem).not.toBe(originalPublicPem);

        // 3. FIX ROUND — the pinned key needs a trust anchor, so a rotation is
        //    only non-destructive when the operator DECLARES the retired key.
        //    (Moving the same mount to a new box needs no declaration: the key
        //    is still the current key. Rotation is the case that does.) The
        //    security proof that an undeclared key is refused lives in
        //    certificate-pinned-key-trust-anchor.test.js.
        savedRetired = process.env.SIGNING_KEY_RETIRED_FINGERPRINTS;
        process.env.SIGNING_KEY_RETIRED_FINGERPRINTS = jest
            .requireActual('../../services/crypto/signature-service')
            .fingerprintPublicKey(originalPublicPem);
    });

    afterAll(() => {
        if (savedRetired === undefined) {
            delete process.env.SIGNING_KEY_RETIRED_FINGERPRINTS;
        } else {
            process.env.SIGNING_KEY_RETIRED_FINGERPRINTS = savedRetired;
        }
    });

    test('the Prisma schema declares the additive signaturePublicKey column', () => {
        const schema = fs.readFileSync(
            path.join(__dirname, '../../prisma/schema/certification.prisma'), 'utf8',
        );
        expect(schema).toMatch(/signaturePublicKey\s+String\?/);
    });

    test('GREEN: a row carrying a DECLARED signaturePublicKey still verifies after the on-box key changed', async () => {
        const res = await certificateService.verifyCertificateSignature({
            documentHash: DOCUMENT_HASH,
            signature,
            signatureAlgorithm: 'RSA-SHA256',
            signatureKeyId: 'rsa:gacp-certificate',
            signaturePublicKey: originalPublicPem,
        });
        expect(res).toMatchObject({ signed: true, valid: true, algorithm: 'RSA-SHA256' });
    });

    test('RED-without-the-column: the SAME row minus signaturePublicKey now reads as invalid', async () => {
        const res = await certificateService.verifyCertificateSignature({
            documentHash: DOCUMENT_HASH,
            signature,
            signatureAlgorithm: 'RSA-SHA256',
            signatureKeyId: 'rsa:gacp-certificate',
            // signaturePublicKey deliberately absent — this is every row issued
            // before the expand migration.
        });
        expect(res).toMatchObject({ signed: true, valid: false });
    });

    test('the reported fingerprint is of the key that actually verified, not of the on-box key', async () => {
        const { fingerprintPublicKey } = jest.requireActual('../../services/crypto/signature-service');
        const res = await certificateService.verifyCertificateSignature({
            documentHash: DOCUMENT_HASH,
            signature,
            signaturePublicKey: originalPublicPem,
        });
        expect(res.publicKeyFingerprint).toBe(fingerprintPublicKey(originalPublicPem));
        expect(res.publicKeyFingerprint)
            .not.toBe(fingerprintPublicKey(await mockLiveService.getPublicKey()));
    });

    test('a tampered documentHash still fails even with the pinned key (the column is not a bypass)', async () => {
        const res = await certificateService.verifyCertificateSignature({
            documentHash: crypto.createHash('sha256').update('tampered body').digest('hex'),
            signature,
            signaturePublicKey: originalPublicPem,
        });
        expect(res).toMatchObject({ signed: true, valid: false });
    });
});
