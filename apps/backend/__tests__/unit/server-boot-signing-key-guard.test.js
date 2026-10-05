'use strict';

/**
 * Ruling 2 — boot guard for the certificate signing key
 * (`config/boot-secret-guard.validateSigningKeyAtBoot`, wired at server.js:35).
 *
 * Contract:
 *   - a runtime that REQUIRES a signing key (production, or REQUIRE_SIGNING_KEY=true)
 *     and cannot load/use it → exit(1) with Thai + English stderr diagnostics,
 *     and NO key is generated;
 *   - the key present, usable and matching SIGNING_KEY_FINGERPRINT → no exit;
 *   - a runtime that does not require one → silent no-op, so local development
 *     keeps working;
 *   - `ALLOW_PENDING_SECRETS` does NOT bypass it: that hatch is for pending
 *     finance values, not for a signing key that would mint unverifiable
 *     certificates.
 *
 * `exit` and `stderr` are injected — the real `process.exit` never runs here.
 * No key material is asserted on or printed; only sha256 fingerprints of PUBLIC
 * keys appear, which are safe by construction.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const guardPath = path.join('..', '..', 'config', 'boot-secret-guard');

function loadGuard() {
    jest.resetModules();
    return require(guardPath);
}

function makeStderr() {
    const buf = [];
    return { write: (c) => { buf.push(String(c)); return true; }, toString: () => buf.join('') };
}

const PASS = 'boot-guard-signing-passphrase';

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

function fp(pem) {
    return crypto.createHash('sha256').update(String(pem).replace(/\r\n/g, '\n')).digest('hex');
}

describe('Ruling 2 — validateSigningKeyAtBoot', () => {
    const ENV_KEYS = ['NODE_ENV', 'RSA_PRIVATE_KEY_PASSPHRASE', 'REQUIRE_SIGNING_KEY', 'SIGNING_KEY_FINGERPRINT', 'ALLOW_PENDING_SECRETS'];
    let saved;
    let keyDir;

    beforeEach(() => {
        saved = {};
        for (const k of ENV_KEYS) { saved[k] = process.env[k]; }
        delete process.env.REQUIRE_SIGNING_KEY;
        delete process.env.SIGNING_KEY_FINGERPRINT;
        delete process.env.ALLOW_PENDING_SECRETS;
        process.env.NODE_ENV = 'test';
        process.env.RSA_PRIVATE_KEY_PASSPHRASE = PASS;
        keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-boot-'));
    });

    afterEach(() => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) { delete process.env[k]; } else { process.env[k] = saved[k]; }
        }
    });

    it('key not required → silent no-op (local development is not disturbed)', () => {
        const exit = jest.fn();
        const stderr = makeStderr();
        const res = loadGuard().validateSigningKeyAtBoot({ exit, stderr, keyDir });
        expect(res).toMatchObject({ ok: true, skipped: true });
        expect(exit).not.toHaveBeenCalled();
        expect(stderr.toString()).toBe('');
    });

    it('key required + directory empty → exit(1), Thai + English diagnostics, nothing generated', () => {
        process.env.REQUIRE_SIGNING_KEY = 'true';
        const exit = jest.fn();
        const stderr = makeStderr();

        loadGuard().validateSigningKeyAtBoot({ exit, stderr, keyDir });

        expect(exit).toHaveBeenCalledWith(1);
        const out = stderr.toString();
        expect(out).toContain('OPERATOR_INTERVENTION_REQUIRED');
        expect(out).toContain('ต้องดำเนินการโดยผู้ดูแลระบบ');
        expect(out).toContain('KEY_UNREADABLE');
        expect(fs.readdirSync(keyDir)).toEqual([]);
    });

    it('key required + present but wrong passphrase → exit(1) and the operator key is left untouched', () => {
        process.env.REQUIRE_SIGNING_KEY = 'true';
        installKeyPair(keyDir, 'some-other-passphrase');
        const before = fs.readFileSync(path.join(keyDir, 'private.pem'), 'utf8').length;
        const exit = jest.fn();
        const stderr = makeStderr();

        loadGuard().validateSigningKeyAtBoot({ exit, stderr, keyDir });

        expect(exit).toHaveBeenCalledWith(1);
        expect(stderr.toString()).toContain('KEY_UNUSABLE');
        expect(fs.readFileSync(path.join(keyDir, 'private.pem'), 'utf8').length).toBe(before);
    });

    it('key required + mismatched public.pem → KEY_PAIR_MISMATCH, exit(1)', () => {
        process.env.REQUIRE_SIGNING_KEY = 'true';
        installKeyPair(keyDir, PASS);
        // Swap in an unrelated public key: the private key still decrypts, but
        // it can no longer be the one that verifies these signatures.
        const stranger = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        }).publicKey;
        fs.writeFileSync(path.join(keyDir, 'public.pem'), stranger);
        const exit = jest.fn();
        const stderr = makeStderr();

        loadGuard().validateSigningKeyAtBoot({ exit, stderr, keyDir });

        expect(exit).toHaveBeenCalledWith(1);
        expect(stderr.toString()).toContain('KEY_PAIR_MISMATCH');
    });

    it('key required + usable + fingerprint matches → boots, and reports the fingerprint', () => {
        process.env.REQUIRE_SIGNING_KEY = 'true';
        const publicPem = installKeyPair(keyDir, PASS);
        process.env.SIGNING_KEY_FINGERPRINT = fp(publicPem);
        const exit = jest.fn();
        const stderr = makeStderr();

        const res = loadGuard().validateSigningKeyAtBoot({ exit, stderr, keyDir });

        expect(exit).not.toHaveBeenCalled();
        expect(res).toMatchObject({ ok: true, skipped: false, fingerprint: fp(publicPem) });
    });

    it('key required + usable but WRONG key (fingerprint mismatch) → exit(1)', () => {
        process.env.REQUIRE_SIGNING_KEY = 'true';
        installKeyPair(keyDir, PASS);
        process.env.SIGNING_KEY_FINGERPRINT = 'a'.repeat(64);
        const exit = jest.fn();
        const stderr = makeStderr();

        loadGuard().validateSigningKeyAtBoot({ exit, stderr, keyDir });

        expect(exit).toHaveBeenCalledWith(1);
        expect(stderr.toString()).toContain('FINGERPRINT_MISMATCH');
    });

    it('ALLOW_PENDING_SECRETS does NOT bypass the signing-key guard', () => {
        process.env.REQUIRE_SIGNING_KEY = 'true';
        process.env.ALLOW_PENDING_SECRETS = 'true';
        const exit = jest.fn();
        const stderr = makeStderr();

        loadGuard().validateSigningKeyAtBoot({ exit, stderr, keyDir });

        expect(exit).toHaveBeenCalledWith(1);
    });

    it('server.js wires the guard at boot', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
        expect(src).toContain('validateSigningKeyAtBoot');
    });
});
