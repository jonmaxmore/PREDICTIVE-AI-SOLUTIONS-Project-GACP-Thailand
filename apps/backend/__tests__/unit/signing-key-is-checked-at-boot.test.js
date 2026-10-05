/**
 * A signing key that exists but cannot be used must be reported at BOOT — in development too.
 *
 * Found 2026-09-05 by walking the flow on a scratch database: this box's keys/private.pem
 * had been encrypted under a passphrase that no longer existed (the stable dev-passphrase
 * file was written AFTER the key), and nothing said so until an officer pressed
 * "ผ่านการตรวจ". At that moment certificate issuance threw 503 and the status writer rolled
 * the application back — so the operator saw a correct decision refused, while the real
 * fault had been lying on disk, unmentioned, since the previous boot.
 *
 * `validateSigningKeyAtBoot` already refuses production boot for exactly this, and
 * `inspectSigningKey` already proves the pair by signing a probe. The gap was one line:
 * where a key is not REQUIRED, the guard returned `{ok:true, skipped:true}` and said
 * nothing at all. It now inspects and reports there too.
 *
 * Three properties this pins, because each of them is a way the fix could go wrong:
 *   - it must NOT refuse a dev boot: a box that mints its key on first use is normal;
 *   - it must NOT complain about a key that simply is not there yet — that IS first use;
 *   - it must NOT touch, move or regenerate anything. What an unusable key already signed
 *     is an operator's question, not a boot's.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { validateSigningKeyAtBoot } = require('../../config/boot-secret-guard');

function tmpKeyDir(name) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `keyboot-${name}-`));
}

function writeKeyPair(dir, passphrase) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase },
    });
    fs.writeFileSync(path.join(dir, 'private.pem'), privateKey);
    fs.writeFileSync(path.join(dir, 'public.pem'), publicKey);
}

/** Collects what the guard wrote, and proves it never called exit. */
function runGuard(keyDir) {
    const written = [];
    const result = validateSigningKeyAtBoot({
        keyDir,
        stderr: { write: (s) => written.push(String(s)) },
        exit: (code) => { throw new Error(`exit(${code}) was called and must not have been`); },
    });
    return { result, said: written.join('') };
}

const ORIGINAL_PASSPHRASE = process.env.RSA_PRIVATE_KEY_PASSPHRASE;
const ORIGINAL_REQUIRE = process.env.REQUIRE_SIGNING_KEY;

beforeEach(() => {
    // Development: a key is not required here. That is the branch under test.
    delete process.env.REQUIRE_SIGNING_KEY;
    process.env.RSA_PRIVATE_KEY_PASSPHRASE = 'the-passphrase-this-box-holds';
});

afterEach(() => {
    if (ORIGINAL_PASSPHRASE === undefined) { delete process.env.RSA_PRIVATE_KEY_PASSPHRASE; }
    else { process.env.RSA_PRIVATE_KEY_PASSPHRASE = ORIGINAL_PASSPHRASE; }
    if (ORIGINAL_REQUIRE === undefined) { delete process.env.REQUIRE_SIGNING_KEY; }
    else { process.env.REQUIRE_SIGNING_KEY = ORIGINAL_REQUIRE; }
});

describe('a development boot with a key nobody can open', () => {
    test('says so, names the directory and the passphrase variable, and does not exit', () => {
        const dir = tmpKeyDir('orphan');
        writeKeyPair(dir, 'a-passphrase-that-was-lost');

        const { result, said } = runGuard(dir);

        expect(result.ok).toBe(true);          // boot continues
        expect(result.skipped).toBe(true);
        expect(said).toContain(dir);
        expect(said).toContain('RSA_PRIVATE_KEY_PASSPHRASE');
        expect(said).toMatch(/issuance will fail/i);
    });

    test('prints no key material — only the verdict and the cause', () => {
        const dir = tmpKeyDir('quiet');
        writeKeyPair(dir, 'lost');
        const { said } = runGuard(dir);
        expect(said).not.toContain('PRIVATE KEY');
        expect(said).not.toContain('the-passphrase-this-box-holds');
    });

    test('changes nothing on disk — the files are byte-identical afterwards', () => {
        const dir = tmpKeyDir('untouched');
        writeKeyPair(dir, 'lost');
        const before = ['private.pem', 'public.pem'].map((f) => fs.readFileSync(path.join(dir, f)));

        runGuard(dir);

        const after = ['private.pem', 'public.pem'].map((f) => fs.readFileSync(path.join(dir, f)));
        expect(after[0].equals(before[0])).toBe(true);
        expect(after[1].equals(before[1])).toBe(true);
        expect(fs.readdirSync(dir).sort()).toEqual(['private.pem', 'public.pem']);
    });
});

describe('the ordinary development states stay quiet', () => {
    test('no key yet is first use, not a fault', () => {
        const { result, said } = runGuard(tmpKeyDir('empty'));
        expect(result.ok).toBe(true);
        expect(said).toBe('');
    });

    test('a key the passphrase opens says nothing and reports its fingerprint back', () => {
        const dir = tmpKeyDir('good');
        writeKeyPair(dir, 'the-passphrase-this-box-holds');
        const { result, said } = runGuard(dir);
        expect(said).toBe('');
        expect(result.devVerdict.ok).toBe(true);
        expect(result.devVerdict.fingerprint).toMatch(/^[0-9a-f]{16,}$/);
    });
});
