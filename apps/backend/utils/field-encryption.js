/**
 * Field-level AES-256-GCM Encryption Utilities (PDPA)
 *
 * System deep-dive Tier 5 — DBA F-01 + Security C-1 (2026-05-15):
 *
 * Provides authenticated symmetric encryption for column-level PII storage.
 * Used by `services/prisma-pdpa-extension.js` to transparently encrypt
 * Phase-1 columns (idCard, taxId, laserCode, communityRegistrationNo,
 * address, province, district, subdistrict, zipCode) on writes and decrypt
 * on reads. The Prisma extension wraps these outputs with its own
 * `enc:v1:` version prefix — this module does NOT add a prefix of its own.
 *
 * Output format:
 *   `<iv-hex>:<authTag-hex>:<ciphertext-hex>`
 *
 * Key management:
 *   - Reads `ENCRYPTION_KEY` via `config/secrets.js` `getSecret()`.
 *   - Secrets manager THROWS in production when missing — no silent fallback.
 *   - Test env (NODE_ENV=test) uses the catalog's test fallback
 *     ('test-only-encryption-key-32-bytes-exactly-here!') so unit tests run
 *     without ops setup. Dev env (NODE_ENV=development) requires the env
 *     var be set explicitly — there is intentionally NO dev fallback so
 *     developers don't accidentally write data encrypted with a key that
 *     doesn't match production.
 *
 * Key derivation:
 *   The configured secret string is hashed with SHA-256 to produce a
 *   32-byte AES-256 key. This matches `shared/encryption.js`'s key
 *   derivation, so values encrypted by either module can be cross-decrypted
 *   if needed (same secret + same algorithm).
 *
 * Security properties:
 *   - AES-256-GCM is IND-CCA2 (authenticated): tampered ciphertexts throw
 *     on decrypt instead of returning garbage.
 *   - 12-byte random IV per call (per NIST SP 800-38D recommendation).
 *   - `decrypt()` returns `null` on any cipher error rather than throwing,
 *     so the prisma extension can map failures to the safe
 *     '[PII_DECRYPT_FAILED]' marker without crashing the read path.
 *
 * Masking helpers:
 *   `maskThaiId`, `maskEmail`, `maskPhone` return display-safe redacted
 *   strings. Used by audit logs and admin UIs to avoid leaking full PII
 *   to non-privileged viewers.
 */

const crypto = require('crypto');
const { getSecret } = require('../config/secrets');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

// Lazy-load the key so module import never throws at require() time —
// the secret manager only validates when a real encrypt/decrypt is attempted.
// This keeps test bootstrap and scripts that import the module but never
// call its helpers (e.g. some lint/index scripts) from crashing.
let _cachedKey = null;
let _cachedSecret = null;

function getKey() {
    const secret = getSecret('ENCRYPTION_KEY');
    if (!secret) {
        // Secret manager already enforced 'required: always' — getting here
        // means the test fallback was disabled. Fail loudly.
        throw new Error(
            '[field-encryption] ENCRYPTION_KEY is required. Set it via env / secret manager.',
        );
    }
    // Re-derive only when the underlying secret value changes (test rotation,
    // hot-reloaded config). Comparing the raw string is safer than caching
    // forever — avoids cross-test state bleed when a test sets ENCRYPTION_KEY.
    if (_cachedKey && _cachedSecret === secret) {return _cachedKey;}
    _cachedSecret = secret;
    _cachedKey = crypto.createHash('sha256').update(String(secret)).digest();
    if (_cachedKey.length !== KEY_BYTES) {
        // SHA-256 always produces 32 bytes — this is a paranoia check.
        throw new Error('[field-encryption] derived key has wrong length');
    }
    return _cachedKey;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * @param {string} plaintext
 * @returns {string} `<iv-hex>:<authTag-hex>:<ciphertext-hex>`
 * @throws {Error} when ENCRYPTION_KEY is missing (production) or the
 *                 cipher operation fails. Callers SHOULD let this propagate
 *                 — silent fallback to plaintext would defeat the PDPA
 *                 guarantee.
 */
function encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined) {return plaintext;}
    if (typeof plaintext !== 'string') {
        throw new Error('[field-encryption] encrypt() requires a string input');
    }
    const key = getKey();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypt an AES-256-GCM ciphertext produced by `encrypt()`.
 *
 * @param {string} encryptedData `<iv-hex>:<authTag-hex>:<ciphertext-hex>`
 * @returns {string|null} plaintext, or `null` on any cipher error
 *                        (malformed input, wrong key, tampering).
 *
 * Failure semantics: the prisma-pdpa-extension treats `null` as a signal
 * to render the safe '[PII_DECRYPT_FAILED]' marker. Returning the raw
 * ciphertext (or rethrowing) would either leak format info or crash read
 * paths — `null` is the agreed contract.
 */
function decrypt(encryptedData) {
    if (encryptedData === null || encryptedData === undefined) {return encryptedData;}
    if (typeof encryptedData !== 'string' || encryptedData === '') {return null;}
    try {
        const parts = encryptedData.split(':');
        if (parts.length !== 3) {return null;}
        const [ivHex, authTagHex, ctHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const ciphertext = Buffer.from(ctHex, 'hex');
        if (iv.length !== IV_BYTES) {return null;}
        const key = getKey();
        // authTagLength pins the GCM tag to 128 bits so a truncated tag can't be
        // accepted (setAuthTag then rejects any shorter tag) — CWE-310 hardening.
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);
        return plaintext.toString('utf8');
    } catch (_err) {
        // Auth-tag mismatch / corrupted ciphertext / wrong key — fail safe.
        return null;
    }
}

/**
 * Deterministic HMAC-SHA-256 hash for lookup columns (e.g. healthIdHash).
 *
 * HMAC (not raw SHA-256) prevents rainbow-table attacks on small input
 * spaces like 13-digit Thai national IDs. The HMAC key is derived from
 * ENCRYPTION_KEY so rotating the master key invalidates lookup hashes —
 * an intentional trade-off that prevents stale-key lookups across rotations.
 *
 * NOTE: `services/user-lookup-service.js` deliberately uses RAW SHA-256
 * (NOT this function) because the DB column was populated with raw SHA-256
 * before the HMAC change. Do NOT swap that out without a migration of the
 * existing hash column values.
 *
 * @param {string} value
 * @returns {string|null} hex-encoded HMAC, or null for empty input.
 */
function hashData(value) {
    if (value === null || value === undefined) {return null;}
    if (typeof value !== 'string') {value = String(value);}
    if (value === '') {return null;}
    const key = getKey();
    return crypto.createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

/**
 * H-4 Phase 1 — shared lookup-HMAC helper for national-ID columns.
 *
 * Computes the keyed HMAC-SHA-256 that the `*Hmac` lookup columns
 * (healthIdHmac / providerIdHmac / idCardHmac / taxIdHmac /
 * communityRegistrationNoHmac) are populated with, so EVERY login/lookup site
 * agrees on a single function (see RFC docs/handoffs/H-4-national-id-hmac-migration-rfc.md).
 *
 * This is distinct from the legacy `*Hash` columns, which hold a RAW SHA-256
 * (no key) and are still the source of truth while AUTH_LOOKUP_USE_HMAC is off.
 *
 * Key source (overridable so the owner's dedicated-key decision stays open):
 *   - If `process.env.AUTH_LOOKUP_HMAC_KEY` is set, the HMAC is keyed off THAT
 *     secret (SHA-256-derived 32-byte key, same derivation as field-encryption)
 *     so ID-lookup rotation can be independent of ENCRYPTION_KEY / field
 *     encryption rotation.
 *   - Otherwise (default, unset) it falls back to `hashData()`, whose key
 *     derives from ENCRYPTION_KEY. This means NO new secret is required to run
 *     the staging drill — the default path is the existing keyed HMAC.
 *
 * Returns null for empty/falsy input (mirrors `hashData`), so a missing
 * identifier never resolves to a real row.
 *
 * @param {string} value plaintext identifier (already digit-normalized by caller)
 * @returns {string|null} hex-encoded HMAC, or null for empty input.
 */
function computeLookupHmac(value) {
    if (value === null || value === undefined) {return null;}
    if (typeof value !== 'string') {value = String(value);}
    if (value === '') {return null;}
    const dedicated = process.env.AUTH_LOOKUP_HMAC_KEY;
    if (dedicated && String(dedicated).length > 0) {
        const key = crypto.createHash('sha256').update(String(dedicated)).digest();
        return crypto.createHmac('sha256', key).update(value, 'utf8').digest('hex');
    }
    // Default: reuse the existing ENCRYPTION_KEY-derived keyed HMAC.
    return hashData(value);
}

/**
 * Constant-time verify a value against an HMAC produced by `hashData()`.
 * Avoids early-return timing leaks on short prefix mismatches.
 *
 * @param {string} value
 * @param {string} expectedHash hex digest
 * @returns {boolean}
 */
function verifyHash(value, expectedHash) {
    if (!value || !expectedHash) {return false;}
    const actual = hashData(value);
    if (actual === null) {return false;}
    try {
        const a = Buffer.from(actual, 'hex');
        const b = Buffer.from(expectedHash, 'hex');
        if (a.length !== b.length) {return false;}
        return crypto.timingSafeEqual(a, b);
    } catch (_err) {
        return false;
    }
}

/**
 * Mask a Thai national ID (13 digits) for display.
 * Keeps the first digit and last 4 — enough for users to recognize their
 * own record, not enough for someone over their shoulder to reuse.
 *
 *   1234567890123 → 1-XXXX-XXXX-X-0123
 *
 * Non-13-digit inputs are returned with everything except last 4 masked.
 */
function maskThaiId(idCard) {
    if (idCard === null || idCard === undefined) {return idCard;}
    const s = String(idCard).replace(/[^0-9]/g, '');
    if (s.length === 13) {
        return `${s[0]}-XXXX-XXXX-X-${s.slice(9, 13)}`;
    }
    if (s.length <= 4) {return 'X'.repeat(s.length);}
    return 'X'.repeat(s.length - 4) + s.slice(-4);
}

// A 13-digit national-ID run inside free text — bare (13 consecutive digits)
// OR formatted with separators between digits. The separator class covers
// space, dot, hyphen, slash, comma, en-dash (U+2013), em-dash (U+2014),
// NBSP (U+00A0) and thin-space (U+2009), and REPEATED separators are allowed
// (`*` between each digit pair), so "1-1000-00000-00-8", "1 1000 00000 00 8",
// "1/1000/00000/00/8", comma / en-dash / NBSP / thin-space and doubled-separator
// forms ALL match, in addition to the bare `\d{13}` form. Lookarounds `(?<!\d)`
// / `(?!\d)` keep a 20-digit invoice number from being partially mangled and
// boundary-guard the run to exactly 13 digits.
const THAI_ID_RUN_IN_TEXT = /(?<!\d)\d(?:[ .\-/,\u2013\u2014\u00A0\u2009]*\d){12}(?!\d)/g;

// UUID shield (2026-10-03). THAI_ID_RUN_IN_TEXT accepts hyphens between
// digits, so 13 digits spread over the groups of a UUID matched and ~1.1% of
// UUIDs in audit_logs.metadata lost their digits for good
// (c82d4715-4c75-4994-8945-880ab07c5ded → c82d4715-4c7-XXXX-XXXX-X-5880ab07c5ded).
// Each canonical UUID (8-4-4-4-12 hex, either case; found left to right, so one
// may start right after a glued digit run) is swapped for a sentinel with no
// digit and no hex letter — a hard boundary for every pattern — the unchanged
// masking runs, and the UUIDs are put back. A UUID never holds a contiguous
// 13-digit ID, so everything masked before is still masked; only matches that
// reached INTO a UUID are gone. Sentinel: U+F0000, the index written in
// U+F0010..U+F0019, U+F0001 (supplementary private use; never typed).
// Same shield in packages/error-reporting/src/scrub.js and the mobile log redactor.
const UUID_SHAPE = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g;
const UUID_SENTINEL = /\u{F0000}([\u{F0010}-\u{F0019}]+)\u{F0001}/gu;
const SENTINEL_CHAR = /[\u{F0000}-\u{F0019}]/u;

/**
 * Run `mask` on `text` with every UUID shielded, then restore the UUIDs.
 * A text that already carries sentinel characters is masked unshielded.
 * @param {string} text
 * @param {(t: string) => string} mask
 * @returns {string}
 */
function withUuidsShielded(text, mask) {
    if (SENTINEL_CHAR.test(text)) {return mask(text);}
    const uuids = [];
    const swapped = text.replace(UUID_SHAPE, (uuid) => {
        uuids.push(uuid);
        const index = String(uuids.length - 1).replace(/\d/g, (d) => String.fromCodePoint(0xF0010 + Number(d)));
        return `\u{F0000}${index}\u{F0001}`;
    });
    if (uuids.length === 0) {return mask(text);}
    return mask(swapped).replace(UUID_SENTINEL, (_m, index) => uuids[Number([...index].map((c) => c.codePointAt(0) - 0xF0010).join(''))]);
}

/**
 * Mask every national-ID-shaped 13-digit run inside FREE TEXT via `maskThaiId`,
 * preserving the surrounding text (unlike `maskThaiId`, which strips
 * non-digits and therefore mangles prose).
 *
 * Used at PII-ingress sources that persist operator-typed free text and at the
 * PUBLIC interoperability projections (audit-logger metadata, entity grant
 * `reason`, the /verify + partner revokedReason feeds) — national-ID-at-rest
 * rule: a 13-digit national ID must never land in the DB / be broadcast in
 * plaintext.
 *
 * ONE behaviour — a 13-digit run (bare OR separated) is masked UNCONDITIONALLY
 * (SHOULD-#3, batch-2 fast-follow): the Mod-11 checksum gate that once guarded
 * the SEPARATED branch is DROPPED, so the separated branch is now consistent
 * with the bare branch (which always redacted, incl. non-Mod-11-valid IDs).
 * Reasons:
 *   - CONSISTENCY / no-leak: gating the separated branch on Mod-11 let a
 *     formatted-but-Mod-11-INVALID id (`1-1017-00230-70-5`) broadcast in
 *     cleartext while the BARE form of the same value was redacted — an
 *     inconsistency on an UNAUTHENTICATED redaction feed.
 *   - FAIL-SAFE: over-masking a rare 13-digit formatted non-ID on a redaction
 *     path is acceptable; phones (10 digits) and dates (8 digits) are never
 *     13-runs, so there is no realistic over-mask.
 *
 * NOTE (documented residual): `\d` is ASCII-only, so Thai-numeral (๐๑๒…) IDs
 * are NOT matched. Supporting them would materially complicate the regex and
 * normalisation for a case operators effectively never type; the ASCII bare +
 * formatted forms are the realistic operator-typed input.
 *
 * UUIDs are shielded — see withUuidsShielded.
 *
 * Non-string / empty inputs pass through unchanged.
 *
 *   "แทนคุณสมชาย 1100000000008"     → "แทนคุณสมชาย 1-XXXX-XXXX-X-0008"
 *   "ยกเลิกเพราะ 1-1000-00000-00-8" → "ยกเลิกเพราะ 1-XXXX-XXXX-X-0008"
 *
 * @param {*} text
 * @returns {*}
 */
function maskThaiIdsInText(text) {
    if (typeof text !== 'string' || text === '') {return text;}
    return withUuidsShielded(text, (shielded) => shielded.replace(THAI_ID_RUN_IN_TEXT, (run) => {
        const digits = run.replace(/[^0-9]/g, '');
        // Regex guarantees exactly 13 digits; guard defensively anyway.
        if (digits.length !== 13) {return run;}
        // SHOULD-#3: mask a 13-digit run UNCONDITIONALLY — bare or separated,
        // Mod-11-valid or not — so the separated branch cannot leak an ID the
        // bare branch would redact.
        return maskThaiId(digits);
    }));
}

module.exports = {
    encrypt,
    decrypt,
    hashData,
    computeLookupHmac,
    verifyHash,
    maskThaiId,
    maskThaiIdsInText,
    // Internal helpers exposed for diagnostics / hot-rotation in tests:
    _getKey: getKey,
};
