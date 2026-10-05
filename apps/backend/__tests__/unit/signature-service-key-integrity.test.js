'use strict';

/**
 * Ruling 2 / defect 1 — SILENT KEY REGENERATION.
 *
 * Pre-fix `ensureLocalKeys()` (signature-service.js:345-358) did two unsafe things:
 *   (a) a MISSING key pair was silently replaced by a freshly generated one, in
 *       every environment. On a fresh container or a machine move that mints a
 *       NEW key, and every certificate signed with the OLD key stops verifying.
 *   (b) a key that is PRESENT but not decryptable with the configured
 *       passphrase was treated as "loaded fine". The failure only surfaced later,
 *       inside signWithLocalKey, as an OpenSSL bad-decrypt — which
 *       certificate-service swallowed into its hash-only fallback. That is the
 *       live defect: the demo database holds 3 certificates issued AFTER CERT-01
 *       shipped and not one of them carries a signature.
 *
 * Post-fix contract:
 *   - production (or any env with REQUIRE_SIGNING_KEY=true): a missing OR
 *     unusable key is a FATAL boot error. No key is generated, no signing runs.
 *   - development/test: a dev key may be generated, but only with a LOUD warning
 *     naming it as a throwaway.
 *   - SIGNING_KEY_FINGERPRINT set + loaded key's sha256 differs → refuse to boot
 *     in EVERY environment (a wrong key is worse than no key).
 *
 * No key material is ever printed by these tests — only fingerprints (sha256 of
 * a PUBLIC key), which are safe by construction.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mockLog = {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
};
jest.mock('../../shared/logger', () => ({
    ...mockLog,
    createLogger: () => mockLog,
}));

const PASS = 'r2-key-integrity-passphrase';

function freshKeyDir(label) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `r2-${label}-`));
}

/** Write a key pair encrypted under `passphrase` into `dir` (no material logged). */
function installKeyPair(dir, passphrase) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: {
            type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase,
        },
    });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'public.pem'), publicKey);
    fs.writeFileSync(path.join(dir, 'private.pem'), privateKey);
    return publicKey;
}

describe('Ruling 2 — signing key integrity at boot', () => {
    const ENV_KEYS = ['NODE_ENV', 'RSA_PRIVATE_KEY_PASSPHRASE', 'REQUIRE_SIGNING_KEY', 'SIGNING_KEY_FINGERPRINT'];
    let savedEnv;
    let SignatureService;
    let fingerprintPublicKey;

    beforeEach(() => {
        savedEnv = {};
        for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; }
        delete process.env.REQUIRE_SIGNING_KEY;
        delete process.env.SIGNING_KEY_FINGERPRINT;
        process.env.RSA_PRIVATE_KEY_PASSPHRASE = PASS;
        process.env.NODE_ENV = 'test';
        jest.resetModules();
        mockLog.info.mockClear();
        mockLog.warn.mockClear();
        mockLog.error.mockClear();
        // Re-require after resetModules so config/secrets re-reads NODE_ENV.
        ({ SignatureService, fingerprintPublicKey } = require('../../services/crypto/signature-service'));
    });

    afterEach(() => {
        for (const k of ENV_KEYS) {
            if (savedEnv[k] === undefined) { delete process.env[k]; } else { process.env[k] = savedEnv[k]; }
        }
    });

    describe('REQUIRE_SIGNING_KEY=true (the production contract, testable outside production)', () => {
        it('MISSING key pair → refuses to boot and mints NOTHING', async () => {
            process.env.REQUIRE_SIGNING_KEY = 'true';
            const keyDir = freshKeyDir('missing');

            const svc = new SignatureService({ keyDir, useKMS: false });
            await expect(svc.ensureInitialized()).rejects.toThrow(/certificate signing key/i);

            // The whole point: no new key was written to disk.
            expect(fs.existsSync(path.join(keyDir, 'private.pem'))).toBe(false);
            expect(fs.existsSync(path.join(keyDir, 'public.pem'))).toBe(false);
        });

        it('key PRESENT but not decryptable with the configured passphrase → refuses to boot (the live defect)', async () => {
            process.env.REQUIRE_SIGNING_KEY = 'true';
            const keyDir = freshKeyDir('baddecrypt');
            installKeyPair(keyDir, 'a-different-passphrase-entirely');
            const before = fs.readFileSync(path.join(keyDir, 'public.pem'), 'utf8');

            const svc = new SignatureService({ keyDir, useKMS: false });
            await expect(svc.ensureInitialized()).rejects.toThrow(/certificate signing key/i);

            // Fail-closed must NOT overwrite the operator's key material.
            expect(fs.readFileSync(path.join(keyDir, 'public.pem'), 'utf8')).toBe(before);
        });

        it('a usable key pair → boots and signs', async () => {
            process.env.REQUIRE_SIGNING_KEY = 'true';
            const keyDir = freshKeyDir('good');
            const publicPem = installKeyPair(keyDir, PASS);

            const svc = new SignatureService({ keyDir, useKMS: false });
            await expect(svc.ensureInitialized()).resolves.toBeUndefined();

            const hash = 'a'.repeat(64);
            const sig = await svc.signWithLocalKey(hash);
            const v = crypto.createVerify('RSA-SHA256');
            v.update(hash); v.end();
            expect(v.verify(publicPem, sig, 'hex')).toBe(true);
        });
    });

    describe('development / test (generation allowed, but never quietly)', () => {
        it('MISSING key pair → generates AND logs a loud dev-key warning', async () => {
            const keyDir = freshKeyDir('devmissing');
            const svc = new SignatureService({ keyDir, useKMS: false });
            await svc.ensureInitialized();

            expect(fs.existsSync(path.join(keyDir, 'private.pem'))).toBe(true);
            const warnings = mockLog.warn.mock.calls.map((c) => String(c[0])).join('\n');
            expect(warnings).toMatch(/DEV(ELOPMENT)?[ _-]?KEY/i);
            expect(warnings).toMatch(/REQUIRE_SIGNING_KEY/);
        });

        // REVERSED 2026-08-26, and the reversal is the point.
        //
        // This test used to assert that an unusable key pair was REGENERATED in dev, on
        // the reasoning that it "unblocks the hash-only-certificate defect in dev". The
        // reasoning was wrong, and a real certificate paid for it: GACP-TH-2569-CAE820,
        // minted 2026-08-25 12:51 with the key 47b98a69…, was answered
        // `untrusted_pinned_key` by the product's own verifier the next morning because a
        // restart at 06:08 had regenerated the box's key over the top of it. The old key
        // was gone, so the certificate can never be verified again.
        //
        // Regenerating over existing key material trades one defect for a worse one:
        // instead of a certificate with no signature, you get a certificate with a
        // signature that everybody trusts until the day it silently stops meaning
        // anything. Refusal is the honest answer, and dev is not exempt — dev is where
        // that certificate was issued. Generation stays free on a box with NO key
        // (signature-service-never-replaces-existing-key.test.js).
        it('UNUSABLE key pair → refuses rather than overwriting the key that signed old certificates', async () => {
            const keyDir = freshKeyDir('devbad');
            const installed = installKeyPair(keyDir, 'a-passphrase-nobody-remembers');

            const svc = new SignatureService({ keyDir, useKMS: false });

            await expect(svc.ensureInitialized()).rejects.toThrow(/could not be loaded and used/i);
            // and the operator's key material is still on disk, byte for byte
            expect(fs.readFileSync(path.join(keyDir, 'public.pem'), 'utf8')).toBe(installed);
        });
    });

    describe('SIGNING_KEY_FINGERPRINT guard (wrong key is worse than no key)', () => {
        it('matching fingerprint → boots', async () => {
            const keyDir = freshKeyDir('fpok');
            const publicPem = installKeyPair(keyDir, PASS);
            process.env.REQUIRE_SIGNING_KEY = 'true';
            process.env.SIGNING_KEY_FINGERPRINT = fingerprintPublicKey(publicPem);

            const svc = new SignatureService({ keyDir, useKMS: false });
            await expect(svc.ensureInitialized()).resolves.toBeUndefined();
        });

        it('mismatched fingerprint → refuses to boot even though the key loads fine', async () => {
            const keyDir = freshKeyDir('fpbad');
            installKeyPair(keyDir, PASS);
            process.env.REQUIRE_SIGNING_KEY = 'true';
            process.env.SIGNING_KEY_FINGERPRINT = 'f'.repeat(64);

            const svc = new SignatureService({ keyDir, useKMS: false });
            await expect(svc.ensureInitialized()).rejects.toThrow(/fingerprint/i);
        });

        it('mismatch is fatal in dev too — a generated dev key can never match a pinned fingerprint', async () => {
            const keyDir = freshKeyDir('fpdev');
            process.env.SIGNING_KEY_FINGERPRINT = 'e'.repeat(64);

            const svc = new SignatureService({ keyDir, useKMS: false });
            await expect(svc.ensureInitialized()).rejects.toThrow(/fingerprint/i);
        });

        it('fingerprintPublicKey is stable, hex, and tolerant of CRLF checkout', () => {
            const { publicKey } = crypto.generateKeyPairSync('rsa', {
                modulusLength: 2048,
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            });
            const fp = fingerprintPublicKey(publicKey);
            expect(fp).toMatch(/^[0-9a-f]{64}$/);
            expect(fingerprintPublicKey(publicKey)).toBe(fp);
            // A key file checked out (or mounted) with Windows line endings must
            // not read as a different key.
            expect(fingerprintPublicKey(publicKey.replace(/\n/g, '\r\n'))).toBe(fp);
        });
    });
});
