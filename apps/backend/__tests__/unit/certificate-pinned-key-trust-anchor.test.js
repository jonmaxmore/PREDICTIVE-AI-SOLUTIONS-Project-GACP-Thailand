'use strict';

/**
 * Ruling 2, fix round — TRUST ANCHOR for the pinned public key.
 *
 * Security review of the first round found the crux: `signaturePublicKey` was
 * fed straight into verification with no anchor. It lives on the same row as
 * `signature` and `documentHash`, so anyone who can write a certificate row can
 * generate their own keypair, sign the stored documentHash with it, pin their
 * own PEM, and the public verifier would answer sealed:true / signatureValid:true
 * carrying the ATTACKER's fingerprint. The signature check passes because the
 * attacker holds the matching private key — cryptography is not the missing
 * piece, an answer to "is this key OURS?" is.
 *
 * So a pinned key is honoured ONLY when its fingerprint is in the trusted set:
 *   - the key this box currently holds for the certificate namespace,
 *   - the operator-pinned SIGNING_KEY_FINGERPRINT,
 *   - operator-declared retired keys (SIGNING_KEY_RETIRED_FINGERPRINTS).
 *
 * The retired list is what keeps rotation and machine-move survival working: a
 * key that signed real certificates stays trusted after it stops signing new
 * ones because the OPERATOR says so, not because the row says so.
 *
 * Real RSA throughout. The forgery case uses a genuinely valid signature.
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

const PASS = 'r2-trust-anchor-passphrase';
process.env.RSA_PRIVATE_KEY_PASSPHRASE = PASS;

let mockLiveService = null;
jest.mock('../../services/crypto/signature-service', () => {
    const actual = jest.requireActual('../../services/crypto/signature-service');
    return { ...actual, getSignatureService: () => mockLiveService };
});

const {
    SignatureService, fingerprintPublicKey,
} = jest.requireActual('../../services/crypto/signature-service');
const certificateService = require('../../services/certificate-service');

const DOCUMENT_HASH = crypto.createHash('sha256').update('a certificate body').digest('hex');
const NAMESPACE = 'rsa:gacp-certificate';

async function boxWithFreshKey(label) {
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), `r2-anchor-${label}-`));
    const svc = new SignatureService({ keyDir, useKMS: false });
    await svc.ensureInitialized();
    return { svc, publicPem: fs.readFileSync(path.join(keyDir, 'public.pem'), 'utf8') };
}

/** An attacker who can write a certificate row and holds their own keypair. */
function forgeRow(documentHash) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(documentHash);
    sign.end();
    return { publicKey, signature: sign.sign(privateKey, 'hex') };
}

const ENV_KEYS = ['SIGNING_KEY_FINGERPRINT', 'SIGNING_KEY_RETIRED_FINGERPRINTS'];

describe('Ruling 2 fix round — a pinned public key counts only when the operator vouches for it', () => {
    let saved;

    beforeEach(() => {
        saved = {};
        for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    });

    afterEach(() => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) { delete process.env[k]; } else { process.env[k] = saved[k]; }
        }
    });

    test('FORGERY: a row pinning an attacker key with a genuinely valid signature is NOT valid', async () => {
        const box = await boxWithFreshKey('forge');
        mockLiveService = box.svc;
        const forged = forgeRow(DOCUMENT_HASH);

        // Sanity: the forged signature really does verify against the forged
        // key. Without this, the assertion below would prove nothing.
        const v = crypto.createVerify('RSA-SHA256');
        v.update(DOCUMENT_HASH);
        v.end();
        expect(v.verify(forged.publicKey, forged.signature, 'hex')).toBe(true);

        const res = await certificateService.verifyCertificateSignature({
            documentHash: DOCUMENT_HASH,
            signature: forged.signature,
            signatureAlgorithm: 'RSA-SHA256',
            signatureKeyId: NAMESPACE,
            signaturePublicKey: forged.publicKey,
        });

        expect(res).toMatchObject({ signed: true, valid: false, reason: 'untrusted_pinned_key' });
        // Never attest an untrusted key's fingerprint as if it were the signer.
        expect(res.publicKeyFingerprint).toBeNull();
    });

    test('CURRENT key: a row pinning the key this box holds verifies', async () => {
        const box = await boxWithFreshKey('current');
        mockLiveService = box.svc;
        const signature = await box.svc.signWithLocalKey(DOCUMENT_HASH, NAMESPACE);

        const res = await certificateService.verifyCertificateSignature({
            documentHash: DOCUMENT_HASH,
            signature,
            signaturePublicKey: box.publicPem,
        });

        expect(res).toMatchObject({ signed: true, valid: true });
        expect(res.publicKeyFingerprint).toBe(fingerprintPublicKey(box.publicPem));
    });

    test('RETIRED but LISTED: after rotation the old key still verifies its own certificates', async () => {
        const oldBox = await boxWithFreshKey('retired-old');
        mockLiveService = oldBox.svc;
        const signature = await oldBox.svc.signWithLocalKey(DOCUMENT_HASH, NAMESPACE);

        // Rotation / machine move: the box now holds a different key.
        const newBox = await boxWithFreshKey('retired-new');
        mockLiveService = newBox.svc;
        expect(newBox.publicPem).not.toBe(oldBox.publicPem);

        process.env.SIGNING_KEY_RETIRED_FINGERPRINTS = fingerprintPublicKey(oldBox.publicPem);

        const res = await certificateService.verifyCertificateSignature({
            documentHash: DOCUMENT_HASH,
            signature,
            signaturePublicKey: oldBox.publicPem,
        });

        expect(res).toMatchObject({ signed: true, valid: true });
        expect(res.publicKeyFingerprint).toBe(fingerprintPublicKey(oldBox.publicPem));
    });

    test('the retired list tolerates spacing, blanks and mixed case', async () => {
        const oldBox = await boxWithFreshKey('list-old');
        mockLiveService = oldBox.svc;
        const signature = await oldBox.svc.signWithLocalKey(DOCUMENT_HASH, NAMESPACE);
        const newBox = await boxWithFreshKey('list-new');
        mockLiveService = newBox.svc;

        process.env.SIGNING_KEY_RETIRED_FINGERPRINTS = [
            'A'.repeat(64),
            ` ${fingerprintPublicKey(oldBox.publicPem).toUpperCase()} `,
            '',
        ].join(',');

        const res = await certificateService.verifyCertificateSignature({
            documentHash: DOCUMENT_HASH, signature, signaturePublicKey: oldBox.publicPem,
        });
        expect(res).toMatchObject({ signed: true, valid: true });
    });

    test('RETIRED and NOT listed: rotation without declaring the old key refuses rather than trusts', async () => {
        const oldBox = await boxWithFreshKey('undeclared-old');
        mockLiveService = oldBox.svc;
        const signature = await oldBox.svc.signWithLocalKey(DOCUMENT_HASH, NAMESPACE);
        const newBox = await boxWithFreshKey('undeclared-new');
        mockLiveService = newBox.svc;

        const res = await certificateService.verifyCertificateSignature({
            documentHash: DOCUMENT_HASH, signature, signaturePublicKey: oldBox.publicPem,
        });

        expect(res).toMatchObject({ signed: true, valid: false, reason: 'untrusted_pinned_key' });
    });

    test('SIGNING_KEY_FINGERPRINT alone anchors a row even when the key mount is unreadable', async () => {
        const oldBox = await boxWithFreshKey('pinned-old');
        mockLiveService = oldBox.svc;
        const signature = await oldBox.svc.signWithLocalKey(DOCUMENT_HASH, NAMESPACE);
        process.env.SIGNING_KEY_FINGERPRINT = fingerprintPublicKey(oldBox.publicPem);

        // A service that cannot produce its own public key at all.
        const broken = new SignatureService({
            keyDir: fs.mkdtempSync(path.join(os.tmpdir(), 'r2-anchor-broken-')), useKMS: false,
        });
        broken.getPublicKeyForNamespace = async () => { throw new Error('mount unavailable'); };
        mockLiveService = broken;

        const res = await certificateService.verifyCertificateSignature({
            documentHash: DOCUMENT_HASH, signature, signaturePublicKey: oldBox.publicPem,
        });
        expect(res).toMatchObject({ signed: true, valid: true });
    });

    test('LEGACY row (no pinned key) still falls back to the loaded key — unchanged behaviour', async () => {
        const box = await boxWithFreshKey('legacy');
        mockLiveService = box.svc;
        const signature = await box.svc.signWithLocalKey(DOCUMENT_HASH, NAMESPACE);

        const res = await certificateService.verifyCertificateSignature({
            documentHash: DOCUMENT_HASH, signature,
        });
        expect(res).toMatchObject({ signed: true, valid: true });
    });

    test('a trusted pinned key does NOT excuse a tampered documentHash', async () => {
        const box = await boxWithFreshKey('tamper');
        mockLiveService = box.svc;
        const signature = await box.svc.signWithLocalKey(DOCUMENT_HASH, NAMESPACE);

        const res = await certificateService.verifyCertificateSignature({
            documentHash: crypto.createHash('sha256').update('tampered').digest('hex'),
            signature,
            signaturePublicKey: box.publicPem,
        });
        expect(res).toMatchObject({ signed: true, valid: false });
        // Distinguishable from an untrusted key: this one IS ours, the body changed.
        expect(res.reason).toBeUndefined();
    });
});
