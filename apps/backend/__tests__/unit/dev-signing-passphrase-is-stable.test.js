'use strict';

/**
 * A passphrase that protects a file on disk must be reproducible by the next process.
 *
 * THE INCIDENT THIS PINS. Until 2026-08-26 the development fallback for
 * RSA_PRIVATE_KEY_PASSPHRASE was:
 *
 *     devFallback: () => `dev-rsa-passphrase-${process.pid}-${Date.now()}`
 *
 * The comment above it explained that the pid and the clock were there so the value "cannot
 * collide with a real key". That reasoning is about collisions and it is correct about
 * collisions. It is silent about the property that actually mattered: this passphrase
 * encrypts apps/backend/keys/private.pem, a file that outlives the process that wrote it.
 *
 * So every process invented a passphrase no other process could reproduce. Process A
 * generated the key; process B read the same bytes and got `error:1C800064 bad decrypt` —
 * not sometimes, EVERY time, because the value was different by construction. The old
 * ensureLocalKeys then treated an unreadable key as permission to generate a replacement,
 * which retroactively invalidated every certificate the previous process had signed.
 *
 * That is the mechanism behind the three signature-NULL certificates found on 2026-08-22
 * and behind GACP-TH-2569-CAE820 losing its signing key on 2026-08-26. Everything else that
 * day — a test run rotating the key, issuance pinning a key nobody trusted — sat downstream
 * of this one expression.
 *
 * Two properties are pinned here, and the first one is the one that was missing:
 *   1. two processes reading the fallback get the SAME value;
 *   2. the value is not a constant in the repository, because a published passphrase opens
 *      any encrypted private key someone copies.
 */

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');
const { PASSPHRASE_FILE } = require('../../config/dev-signing-passphrase');

/** Read the fallback in a genuinely separate process, and return only a digest of it. */
function passphraseDigestFromFreshProcess() {
    const script = "const{readOrCreateDevPassphrase}=require('./config/dev-signing-passphrase');"
        + "process.stdout.write(require('crypto').createHash('sha256')"
        + '.update(readOrCreateDevPassphrase()).digest("hex"));';
    return execFileSync(process.execPath, ['-e', script], {
        cwd: BACKEND,
        env: { ...process.env, NODE_ENV: 'development' },
        encoding: 'utf8',
    }).trim();
}

describe('the development signing passphrase survives a restart', () => {
    it('two separate processes derive the same passphrase', () => {
        // Separate processes, so the pid differs and the clock has moved — the exact two
        // ingredients the old implementation mixed in.
        const first = passphraseDigestFromFreshProcess();
        const second = passphraseDigestFromFreshProcess();

        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect(second).toBe(first);
    });

    it('a key encrypted by one process opens in another', () => {
        // The property the digests above stand in for, exercised with real RSA rather than
        // asserted. If this passes, a restart can read the key the previous boot wrote.
        const { readOrCreateDevPassphrase } = require('../../config/dev-signing-passphrase');
        const passphrase = readOrCreateDevPassphrase();

        const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: {
                type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase,
            },
        });

        // A second read stands in for the next boot.
        const asReadLater = readOrCreateDevPassphrase();
        const signature = crypto.sign(null, Buffer.from('a certificate body'), {
            key: privateKey, passphrase: asReadLater,
        });

        expect(crypto.verify(null, Buffer.from('a certificate body'), publicKey, signature)).toBe(true);
    });

    it('is long enough to be worth encrypting with', () => {
        const { readOrCreateDevPassphrase } = require('../../config/dev-signing-passphrase');

        // secrets.js declares minLength 16 for this secret; the generator gives 64 hex
        // characters. A file truncated below that is regenerated rather than trusted.
        expect(readOrCreateDevPassphrase().length).toBeGreaterThanOrEqual(32);
    });
});

describe('the passphrase is not published with the code', () => {
    it('is not a literal in the secrets catalogue', () => {
        const source = fs.readFileSync(path.join(BACKEND, 'config', 'secrets.js'), 'utf8');
        const entry = source.slice(source.indexOf('RSA_PRIVATE_KEY_PASSPHRASE:'));

        // Whatever the fallback becomes, it must not be a quoted value sitting in git.
        expect(entry.slice(0, entry.indexOf('},'))).not.toMatch(/devFallback:\s*\(\)\s*=>\s*['"`]/);
    });

    it('never mixes the pid or the clock back in', () => {
        const source = fs.readFileSync(
            path.join(BACKEND, 'config', 'dev-signing-passphrase.js'), 'utf8',
        );
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

        expect(code).not.toMatch(/process\.pid/);
        expect(code).not.toMatch(/Date\.now\(\)/);
    });

    it('lives where git will not take it', () => {
        // The file sits in apps/backend/keys/, and .gitignore names it explicitly.
        expect(PASSPHRASE_FILE.replace(/\\/g, '/')).toMatch(/apps\/backend\/keys\/\.dev-signing-passphrase$/);

        const ignore = fs.readFileSync(path.join(BACKEND, '..', '..', '.gitignore'), 'utf8');
        expect(ignore).toMatch(/^\.dev-signing-passphrase$/m);
    });
});
