'use strict';

/**
 * A signing key is never replaced by accident — in ANY environment.
 *
 * THE LIVE DEFECT (measured, 2026-08-25/26). Certificate GACP-TH-2569-CAE820 was minted
 * through the full pressed journey at 12:51 on 2026-08-25 and pinned the public key whose
 * fingerprint starts 47b98a69. A read-only census the next morning found the box holding
 * a DIFFERENT key, c09bcabf, written at 06:08 — and the product's own verifier answering
 * { signed: true, valid: false, reason: 'untrusted_pinned_key' } for that certificate.
 * Nobody rotated anything. A restart did it.
 *
 * The mechanism: ensureLocalKeys() treated "the key on disk cannot be used" as a
 * development convenience. It logged a WARN and called generateKeyPair(), which writes
 * private.pem and public.pem — overwriting whatever was there. Two things die in that one
 * step:
 *
 *   1. every certificate already signed with the old key becomes unverifiable, because
 *      the trusted set is built from the key the box holds NOW; and
 *   2. the old key material itself is gone, so the damage cannot be undone — the private
 *      key that made those signatures no longer exists anywhere.
 *
 * The service already refused this on a required runtime, with exactly the right reason
 * written in its own comment: "generating a replacement key here would silently
 * invalidate every certificate already signed with the previous key." That reason does
 * not depend on NODE_ENV. It depends on whether certificates exist — and by the time a
 * developer has walked a journey, they do. So the refusal applies everywhere.
 *
 * What stays allowed: generating a key when the box has NO key material at all. That is a
 * fresh machine, nothing has been signed with a key it does not have, and nothing can be
 * invalidated. Convenience is preserved exactly where it costs nothing.
 *
 * The escape hatch is deliberately manual — a human removes the files — rather than an
 * env flag. A flag that permits silent key replacement is the defect with a switch on it.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PASS = 'never-replaces-existing-key-passphrase';
process.env.RSA_PRIVATE_KEY_PASSPHRASE = PASS;

jest.mock('../../shared/logger', () => {
    const l = {
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    };
    return { ...l, createLogger: () => l };
});

const { SignatureService } = require('../../services/crypto/signature-service');

function tmpKeyDir(label) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `sig-keep-${label}-`));
}

/** Write a real RSA pair whose private half is locked with a passphrase nobody here has. */
function writeUndecryptablePair(keyDir) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: {
            type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'a-passphrase-nobody-has-any-more',
        },
    });
    fs.writeFileSync(path.join(keyDir, 'public.pem'), publicKey);
    fs.writeFileSync(path.join(keyDir, 'private.pem'), privateKey);
    return { publicKey, privateKey };
}

function read(keyDir, name) {
    return fs.readFileSync(path.join(keyDir, name), 'utf8');
}

describe('an existing signing key is never replaced, whatever NODE_ENV says', () => {
    it('refuses when private.pem is there but cannot be decrypted', async () => {
        const keyDir = tmpKeyDir('undecryptable');
        writeUndecryptablePair(keyDir);

        const svc = new SignatureService({ keyDir, useKMS: false });

        await expect(svc.ensureInitialized()).rejects.toThrow(/could not be loaded and used/i);
    });

    it('leaves the key material on disk EXACTLY as it found it', async () => {
        const keyDir = tmpKeyDir('untouched');
        const written = writeUndecryptablePair(keyDir);

        const svc = new SignatureService({ keyDir, useKMS: false });
        await svc.ensureInitialized().catch(() => {});

        // Byte-for-byte: the operator's key is recoverable once they find the passphrase.
        expect(read(keyDir, 'private.pem')).toBe(written.privateKey);
        expect(read(keyDir, 'public.pem')).toBe(written.publicKey);
    });

    it('says what to do, and names the directory it is talking about', async () => {
        const keyDir = tmpKeyDir('message');
        writeUndecryptablePair(keyDir);

        let thrown;
        try {
            await new SignatureService({ keyDir, useKMS: false }).ensureInitialized();
        } catch (err) { thrown = err; }

        expect(thrown).toBeDefined();
        expect(thrown.message).toContain(keyDir);
        expect(thrown.message).toMatch(/RSA_PRIVATE_KEY_PASSPHRASE/);
        // The refusal must explain the stake, not just the symptom.
        expect(thrown.message).toMatch(/invalidate|already signed/i);
    });

    it('refuses a half-provisioned box rather than completing it with a guess', async () => {
        // public.pem alone: whoever mounted it has a private half somewhere. Generating a
        // pair here would overwrite the public key that old certificates verify against.
        const keyDir = tmpKeyDir('half');
        const { publicKey } = writeUndecryptablePair(keyDir);
        fs.unlinkSync(path.join(keyDir, 'private.pem'));

        const svc = new SignatureService({ keyDir, useKMS: false });

        await expect(svc.ensureInitialized()).rejects.toThrow();
        expect(read(keyDir, 'public.pem')).toBe(publicKey);
        expect(fs.existsSync(path.join(keyDir, 'private.pem'))).toBe(false);
    });

    it('still generates freely when the box has NO key material — nothing can be invalidated', async () => {
        const keyDir = tmpKeyDir('empty');

        const svc = new SignatureService({ keyDir, useKMS: false });
        await svc.ensureInitialized();

        expect(fs.existsSync(path.join(keyDir, 'private.pem'))).toBe(true);
        expect(fs.existsSync(path.join(keyDir, 'public.pem'))).toBe(true);

        // And the generated key really works, so a fresh dev box is usable as before.
        const signed = await svc.signWithLocalKey('a'.repeat(64));
        expect(typeof signed).toBe('string');
        expect(signed.length).toBeGreaterThan(0);
    });

    it('a second start on a healthy box reuses the SAME key — restarts do not rotate', async () => {
        const keyDir = tmpKeyDir('restart');

        await new SignatureService({ keyDir, useKMS: false }).ensureInitialized();
        const firstPublic = read(keyDir, 'public.pem');

        await new SignatureService({ keyDir, useKMS: false }).ensureInitialized();

        expect(read(keyDir, 'public.pem')).toBe(firstPublic);
    });
});

/**
 * And the machine enforces it, so nobody has to remember.
 *
 * The rule above is only as good as the discipline behind it, and discipline is exactly
 * what failed here: two unit suites about area units and the evidence gate quietly ran the
 * REAL signature service against the repository's own apps/backend/keys directory. Neither
 * file mentions signing anywhere. Running `npx jest` was enough to rotate the certifying
 * authority's key — measured on 2026-08-26, keys/*.pem rewritten at 06:08, six minutes into
 * a test run, which is what destroyed the key GACP-TH-2569-CAE820 was signed with.
 *
 * A test has no business reading or writing the box's key. It gets a temp directory or it
 * mocks the service. Under NODE_ENV=test the default key directory is simply refused, and
 * the refusal names both ways out — which turns a silent, invisible act into a failure the
 * author sees on the first run.
 */
describe('a test run can never reach the box\'s own signing key', () => {
    // jest.setup.js points the whole run at a key directory outside the repository, so
    // these two cases have to remove that safety net to prove the guard underneath it
    // holds — the case of a run configured without the harness, or a test that overrides
    // the variable itself.
    let savedDir;
    beforeEach(() => { savedDir = process.env.SIGNING_KEY_DIR; delete process.env.SIGNING_KEY_DIR; });
    afterEach(() => { if (savedDir !== undefined) { process.env.SIGNING_KEY_DIR = savedDir; } });

    it('refuses the repository key directory under NODE_ENV=test', async () => {
        // No keyDir option: this is precisely what the offending suites did.
        const svc = new SignatureService({ useKMS: false });

        await expect(svc.ensureInitialized()).rejects.toThrow(/test/i);
    });

    it('tells the author both ways out', async () => {
        let thrown;
        try {
            await new SignatureService({ useKMS: false }).ensureInitialized();
        } catch (err) { thrown = err; }

        expect(thrown).toBeDefined();
        expect(thrown.message).toMatch(/keyDir/);
        expect(thrown.message).toMatch(/mock/i);
    });

    it('trips even when a test names the repository directory outright', async () => {
        const repoKeys = path.join(__dirname, '../../keys');

        await expect(
            new SignatureService({ keyDir: repoKeys, useKMS: false }).ensureInitialized(),
        ).rejects.toThrow(/must never read or write/i);
    });

    it('the harness directory is accepted — real signing still works in tests', async () => {
        process.env.SIGNING_KEY_DIR = tmpKeyDir('harness');

        const svc = new SignatureService({ useKMS: false });
        await expect(svc.ensureInitialized()).resolves.toBeUndefined();

        const signed = await svc.signWithLocalKey('c'.repeat(64));
        expect(typeof signed).toBe('string');
    });

    it('leaves an explicit temp directory alone — real-key tests still work', async () => {
        const keyDir = tmpKeyDir('explicit');

        await expect(
            new SignatureService({ keyDir, useKMS: false }).ensureInitialized(),
        ).resolves.toBeUndefined();
    });
});
