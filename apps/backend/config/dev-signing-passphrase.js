'use strict';

/**
 * The passphrase a DEVELOPMENT box uses to protect its own signing key.
 *
 * WHY THIS FILE EXISTS
 *   A passphrase that protects something written to disk has exactly one hard requirement:
 *   the next process must be able to reproduce it. The previous dev fallback could not —
 *   it was `dev-rsa-passphrase-${process.pid}-${Date.now()}`, so every process invented a
 *   new one, every read of an existing keys/private.pem failed with `bad decrypt`, and the
 *   service's old behaviour was to treat that as permission to generate a replacement key.
 *   Every certificate signed by the previous process became unverifiable, on every boot,
 *   by construction rather than by accident.
 *
 * WHY NOT A CONSTANT IN THE REPOSITORY
 *   Because it would be a real passphrase with a published value. The comment on
 *   RSA_PRIVATE_KEY_PASSPHRASE in secrets.js is right that a static fallback is never
 *   acceptable: anyone who took a copy of an encrypted private key could open it.
 *
 * WHY NOT DERIVE IT FROM THE MACHINE
 *   A hostname, a username or an install path is stable but guessable, which is the same
 *   weakness wearing a disguise.
 *
 * SO: 32 random bytes, generated once, written next to the key they protect, and read back
 * on every later boot. Unique per box, stable across processes, never in git — the file
 * sits in apps/backend/keys/, which .gitignore already covers.
 *
 * THIS IS NOT A PRODUCTION PATH. secrets.js only calls a devFallback when NODE_ENV is
 * development or test; production requires the real secret and refuses to boot without it.
 * A developer who wants production-like behaviour sets RSA_PRIVATE_KEY_PASSPHRASE in .env
 * and this file is never consulted.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Beside the key it protects: one directory to mount, one directory to wipe. */
const KEY_DIR = path.join(__dirname, '..', 'keys');
const PASSPHRASE_FILE = path.join(KEY_DIR, '.dev-signing-passphrase');

/**
 * @returns {string} the box's stable development passphrase, creating it on first use.
 */
function readOrCreateDevPassphrase() {
    try {
        const existing = fs.readFileSync(PASSPHRASE_FILE, 'utf8').trim();
        if (existing.length >= 32) {
            return existing;
        }
        // A truncated or emptied file is worse than no file: it would silently become a
        // weak passphrase that still "works". Fall through and rewrite it.
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw new Error(
                `[dev-signing-passphrase] cannot read ${PASSPHRASE_FILE}: ${error.message}. `
                + 'Fix the permissions or delete the file; do not work around it, because an '
                + 'unreadable passphrase means the signing key cannot be opened either.',
            );
        }
    }

    const generated = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(KEY_DIR, { recursive: true });
    // 0600: the same posture the runbook asks for on a mounted key. Windows ignores the
    // mode, which is one more reason this path is development-only.
    fs.writeFileSync(PASSPHRASE_FILE, `${generated}\n`, { mode: 0o600 });
    return generated;
}

module.exports = { readOrCreateDevPassphrase, PASSPHRASE_FILE };
