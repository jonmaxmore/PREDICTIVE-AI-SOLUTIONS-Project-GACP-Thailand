/**
 * Encryption Utilities
 *
 * Default cipher: AES-256-GCM (authenticated, IND-CCA2). Output format:
 *   `gcm:<iv-hex>:<authTag-hex>:<ciphertext-hex>`
 *
 * Backward-compatibility: existing ciphertexts written by the previous
 * AES-256-CBC implementation in the format `<iv-hex>:<ciphertext-hex>`
 * are still decryptable by `decrypt()`. New writes always use GCM.
 *
 * Uses SHA-256 for deterministic hashing (lookup keys).
 */

const crypto = require('crypto');
const logger = require('./logger');

const GCM_PREFIX = 'gcm:';
const GCM_ALGORITHM = 'aes-256-gcm';
const CBC_ALGORITHM = 'aes-256-cbc';
const GCM_IV_BYTES = 12;
const CBC_IV_BYTES = 16;

// ENCRYPTION_KEY must be 32 bytes (256 bits) of entropy. Set via secret manager.
const SECRET = process.env.ENCRYPTION_KEY;
if (!SECRET) {
  throw new Error(
    '[encryption] ENCRYPTION_KEY environment variable is required. ' +
    'Set it in your .env file or secret manager.',
  );
}
// Derive a 32-byte key from the configured secret.
const KEY = crypto.createHash('sha256').update(String(SECRET)).digest();

/**
 * Encrypt text using AES-256-GCM.
 * @param {string} text - Plaintext.
 * @returns {string} `gcm:<iv-hex>:<authTag-hex>:<ciphertext-hex>` or original
 *                   value if `text` is falsy.
 */
function encrypt(text) {
    if (!text) {return text;}
    try {
        const iv = crypto.randomBytes(GCM_IV_BYTES);
        const cipher = crypto.createCipheriv(GCM_ALGORITHM, KEY, iv);
        const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return `${GCM_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
    } catch (error) {
        logger.error('Encryption error:', error);
        throw error;
    }
}

function decryptGcm(payload) {
    const parts = payload.split(':');
    if (parts.length !== 3) {
        const err = new Error('Malformed AES-GCM ciphertext');
        err.code = 'CRYPTO_BAD_FORMAT';
        throw err;
    }
    const [ivHex, tagHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(ctHex, 'hex');
    if (iv.length !== GCM_IV_BYTES) {
        const err = new Error('Invalid AES-GCM IV length');
        err.code = 'CRYPTO_BAD_IV';
        throw err;
    }
    // authTagLength pins the GCM tag to 128 bits so a truncated tag can't be
    // accepted (setAuthTag then rejects any shorter tag) — CWE-310 hardening.
    const decipher = crypto.createDecipheriv(GCM_ALGORITHM, KEY, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function decryptCbcLegacy(text) {
    const parts = text.split(':');
    if (parts.length !== 2) {
        const err = new Error('Malformed AES-CBC ciphertext');
        err.code = 'CRYPTO_BAD_FORMAT';
        throw err;
    }
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    if (iv.length !== CBC_IV_BYTES) {
        const err = new Error('Invalid AES-CBC IV length');
        err.code = 'CRYPTO_BAD_IV';
        throw err;
    }
    const decipher = crypto.createDecipheriv(CBC_ALGORITHM, KEY, iv);
    return Buffer.concat([decipher.update(encryptedText), decipher.final()]).toString('utf8');
}

/**
 * Decrypt text. Supports new AES-GCM and legacy AES-CBC ciphertexts.
 * Throws on tampering / wrong key / corrupted ciphertext — callers MUST
 * handle the error rather than silently using the input.
 * @param {string} text - Ciphertext.
 * @returns {string} Plaintext.
 */
function decrypt(text) {
    if (!text) {return text;}
    if (typeof text !== 'string') {
        const err = new Error('Ciphertext must be a string');
        err.code = 'CRYPTO_BAD_TYPE';
        throw err;
    }
    try {
        if (text.startsWith(GCM_PREFIX)) {
            return decryptGcm(text.slice(GCM_PREFIX.length));
        }
        // Legacy CBC ciphertext (`iv:ct`) — kept for backward compatibility
        // with values written before AES-GCM rollout. Re-encrypt opportunistically
        // at the call site if you want to migrate them on read.
        return decryptCbcLegacy(text);
    } catch (error) {
        logger.error('Decryption error:', error);
        if (!error.code) { error.code = 'CRYPTO_DECRYPT_FAILED'; }
        throw error;
    }
}

/**
 * Hash text (deterministic, non-reversible)
 * Used for duplicate detection where we need to compare without decryption
 * @param {string} text - Text to hash
 * @returns {string} SHA-256 hash of the text
 */
function hash(text) {
    if (!text) {return null;}
    return crypto.createHash('sha256').update(String(text)).digest('hex');
}

module.exports = {
    encrypt,
    decrypt,
    hash,
};


