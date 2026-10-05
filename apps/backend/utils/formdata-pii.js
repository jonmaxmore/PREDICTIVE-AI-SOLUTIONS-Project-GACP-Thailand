/**
 * formData JSON National-ID Leaf Encryption (PDPA)
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md — the LAST live
 * national-ID-in-dump location after STAGE A / A.2 / B (which encrypted /
 * tokenized the structured scalar columns — User / Entity / Certificate — and
 * are LIVE on prod).
 *
 * ## Why this module exists
 *
 * `Application.formData` is a Prisma `Json` column holding the wizard's
 * free-form, deeply-nested data (per-step blobs under `formData.steps["N"]`
 * plus a `formData.applicantData` sub-object). A staging dump-grep found the
 * Thai 13-digit national ID stored IN PLAINTEXT inside formData under the keys
 * `id_card` and `tax_id` (24 apps had a 13-digit value). The column-level PDPA
 * extension (services/prisma-pdpa-extension.js) encrypts SCALAR columns
 * by-column and does NOT traverse JSON, so those JSON leaves stay plaintext.
 *
 * This module supplies the DEEP-walk leaf encrypt/decrypt the application
 * `create/update/upsert` extension hook calls so the stored JSON has its
 * national-ID leaves wrapped in `enc:v1:` ciphertext — at which point the B1
 * generic `decryptResultTree` walker already auto-decrypts them on EVERY
 * Prisma read (a parsed Json column is just a nested plain object/array in the
 * result tree, and B1 descends into plain objects/arrays and decrypts any
 * self-identifying `enc:v1:` string leaf). So encrypting on write gives us
 * decrypt-on-read for free — no new read code.
 *
 * ## PII key set — be PRECISE (over-encryption breaks fields, under-encryption leaks)
 *
 * Verified against the backend Zod step schemas
 * (validation/application-schemas.js), the wizard
 * (apps/web-app/.../_steps/steps/general-step.tsx `v.healthId(...)` markers),
 * and the staging formData shape. The national-ID-CLASS keys are:
 *
 *   snake_case (master-steps wizard, `formData.steps["N"]`):
 *     - id_card   — step 4 INDIVIDUAL "เลขบัตรประชาชน" (min 13). DUMP-CONFIRMED.
 *     - tax_id    — step 1 "เลขเสียภาษี/เลขบัตรประชาชน" (national-ID-class). DUMP-CONFIRMED.
 *
 *   camelCase (`formData.applicantData`, the canonical wizard store):
 *     - idCard          — INDIVIDUAL national ID (v.healthId).
 *     - taxId           — JURISTIC 13-digit tax/registration ID (v.healthId).
 *     - presidentIdCard — COMMUNITY president national ID (v.healthId).
 *     - directorIdCard  — JURISTIC director national ID (v.healthId).
 *     - communityRegNumber — COMMUNITY-ENTERPRISE registration (identity-section
 *                         registration; unambiguous key, no collision).
 *
 *   STAFF-ID keys (workflow handlers stamp `req.user.providerId` — itself a Thai
 *   13-digit national ID — into formData JSON: workflowHistory / revisionRequest /
 *   carRequest / reviewer fields). A definitive staging dump-grep of ALL
 *   `applications.formData` found the remaining plaintext national IDs were EXACTLY
 *   under these keys (counts at the time of the grep): reviewedBy (153), by (18),
 *   decidedBy (4), reviewerProviderId (2). The `by` key was confirmed to be ALWAYS
 *   a 13-digit value (0 non-13-digit), i.e. these are PURE national-ID keys with no
 *   over-encryption risk. Stamped by workflow-transitions-handler.js + the
 *   reviewer/auditor decision paths.
 *     - reviewedBy
 *     - by
 *     - decidedBy
 *     - reviewerProviderId
 *
 * ## VALUE-BASED Mod-11 safety-net (key-agnostic)
 *
 * In ADDITION to the key allowlist above, encryptFormDataPii encrypts a leaf
 * whose VALUE is a STRING that is a valid 13-digit Thai national ID (passes the
 * SHARED Mod-11 validator `utils/thai-id-validator.js` `isThaiIdMod11Valid`) —
 * REGARDLESS of its key. This catches any future workflow handler that stamps a
 * providerId national ID under a key we have not enumerated. STRICT GUARDS keep
 * it from over-encrypting:
 *   (a) STRING values only — never numbers/booleans. formData timestamps are
 *       stored as NUMBERS (unquoted), so a numeric ms-timestamp is NEVER touched.
 *   (b) exactly 13 digits AND passes Mod-11 — a random/timestamp-shaped 13-digit
 *       string that FAILS Mod-11 is left alone.
 *   (c) idempotent — an already-`enc:v1:`-prefixed leaf is skipped by the prefix
 *       guard (it is also not 13 digits, so Mod-11 would skip it anyway).
 *   (d) decryptFormDataPii stays purely PREFIX-based (unchanged) — it decrypts any
 *       `enc:v1:` leaf regardless of key, so the Mod-11-encrypted leaves round-trip.
 *
 * A Mod-11-PASSING 13-digit string that is NOT actually a national ID (rare —
 * ~1-in-10 random 13-digit strings pass Mod-11) gets encrypted HARMLESSLY: it
 * round-trips losslessly via the B1 decrypt walker / decryptFormDataPii, and the
 * ONLY raw (extension-bypassing) formData read in the codebase is
 * metrics-service.js reading `formData->>'plantId'` (a plant-variety NAME, never a
 * 13-digit value), which the net never touches.
 *
 * ## Deliberately NOT in the set
 *
 *   - registrationNumber — AMBIGUOUS / COLLISION. Under `applicantData` it is
 *     the juristic-person registration number, BUT the SAME key also appears in
 *     `productionData.productionInputs[].registrationNumber` as a FERTILIZER /
 *     input-product registration code (non-PII). A flat key-name walker cannot
 *     tell them apart, and the juristic person's actual healthId-validated
 *     13-digit identifier is already captured by `taxId` (which IS the Thai
 *     juristic 13-digit ID). Encrypting `registrationNumber` would silently
 *     break every fertilizer registration display → EXCLUDED (over-encryption
 *     rule). The juristic ID leak is closed via `taxId`.
 *   - phone / phoneNumber (10-digit, not 13 — consistent with the deferred-PII
 *     decision), names, addresses, emails — NOT national-ID-class.
 *   - laserCode / laser_code — never written to formData by the wizard (it is a
 *     User scalar column already handled by the B3 column encryption); no
 *     formData write site exists for it.
 *
 * ## Idempotency + flag-gating
 *
 * `encryptValue`/`decryptValue` (re-exported from field-encryption via the PDPA
 * extension) are idempotent: encryptValue is a no-op on an already-`enc:v1:`-
 * prefixed string and on null/empty/non-string; decryptValue is a no-op on any
 * non-prefixed (legacy plaintext) value. So re-walking is safe. The CALLER
 * (the application extension hook) is gated by ENABLE_PDPA_FIELD_ENCRYPTION —
 * this module performs no gating itself (pure data transform), which keeps it
 * trivially unit-testable.
 *
 * ## Walk semantics (mirrors B1 decryptResultTree)
 *
 *   - Descends ONLY into plain objects (proto === Object.prototype|null) and
 *     arrays — never into Date / Buffer / class instances (formData is JSON so
 *     in practice only plain objects/arrays/scalars, but we stay defensive).
 *   - Cycle / shared-ref guarded via a WeakSet; depth-bounded.
 *   - Returns a NEW object/array (does NOT mutate the caller's input) so the
 *     write hook can encrypt without clobbering an object another reader holds.
 *   - Only string VALUES of keys in the PII set are transformed; everything
 *     else passes through unchanged (structure preserved exactly).
 */

'use strict';

const { encrypt, decrypt } = require('./field-encryption');
// SHARED Mod-11 national-ID validator — the SAME source of truth the auth Zod
// schemas use (shared/schemas/auth-schemas.js → validateThaiId). REUSED here for
// the value-based safety-net; not reinvented. `isThaiIdMod11Valid` enforces
// `^\d{13}$` (exactly 13 digits) AND the Mod-11 checksum, returning a boolean.
const { isThaiIdMod11Valid } = require('./thai-id-validator');

// `enc:v1:` version prefix — MUST stay byte-for-byte identical to
// services/prisma-pdpa-extension.js `VERSION_PREFIX` so the B1 generic
// `decryptResultTree` walker (which keys off this exact prefix) auto-decrypts
// the leaves we encrypt here on read. (Re-defined locally rather than imported
// from the extension to avoid a require cycle: the extension's `application`
// hook requires THIS module.)
const VERSION_PREFIX = 'enc:v1:';

/**
 * Wrap a plaintext leaf as `enc:v1:<ciphertext>`. Idempotent: no-op on a value
 * already carrying the prefix, and on null/undefined/empty/non-string. Mirrors
 * `prisma-pdpa-extension.js` `encryptValue` exactly.
 */
function encryptValue(plain) {
    if (plain === null || plain === undefined) { return plain; }
    if (typeof plain !== 'string') { return plain; }
    if (plain === '') { return plain; }
    if (plain.startsWith(VERSION_PREFIX)) { return plain; } // already encrypted
    return VERSION_PREFIX + encrypt(plain);
}

/**
 * Inverse of `encryptValue`. No-op (pass-through) on any non-`enc:v1:`-prefixed
 * value (legacy plaintext) and on null/non-string. On a cipher failure returns
 * the safe '[PII_DECRYPT_FAILED]' marker — same fail-safe contract as the
 * extension's `decryptValue` (never leaks raw ciphertext, never throws).
 */
function decryptValue(stored) {
    if (stored === null || stored === undefined) { return stored; }
    if (typeof stored !== 'string') { return stored; }
    if (!stored.startsWith(VERSION_PREFIX)) { return stored; } // legacy plaintext
    try {
        const plain = decrypt(stored.slice(VERSION_PREFIX.length));
        // field-encryption.decrypt returns null on any cipher error.
        return plain === null ? '[PII_DECRYPT_FAILED]' : plain;
    } catch (_err) {
        return '[PII_DECRYPT_FAILED]';
    }
}

// National-ID-class formData keys to encrypt. Snake_case = master-steps wizard
// leaves (`formData.steps["N"]`); camelCase = `formData.applicantData` leaves.
// See the module header for the precise audit + the deliberate exclusions.
const FORMDATA_PII_KEYS = Object.freeze([
    // snake_case (master-steps) — dump-confirmed
    'id_card',
    'tax_id',
    // camelCase (applicantData) — wizard v.healthId-validated national IDs
    'idCard',
    'taxId',
    'presidentIdCard',
    'directorIdCard',
    'communityRegNumber',
    // STAFF-ID keys (workflow handlers stamp req.user.providerId = a 13-digit
    // national ID into workflowHistory / revisionRequest / carRequest / reviewer
    // fields). Definitive staging dump-grep of ALL applications.formData found
    // the remaining plaintext IDs EXACTLY under these keys (`by` confirmed always
    // 13-digit → pure national-ID keys, no over-encryption risk).
    'reviewedBy',
    'by',
    'decidedBy',
    'reviewerProviderId',
]);

const FORMDATA_PII_KEY_SET = new Set(FORMDATA_PII_KEYS);

// Bound pathological nesting (formData is shallow in practice; this only guards
// against a runaway / adversarial structure, never a real wizard payload).
const MAX_WALK_DEPTH = 100;

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') { return false; }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * VALUE-BASED national-ID detector for the key-agnostic safety-net. Returns true
 * ONLY for a plaintext STRING value that is a valid 13-digit Thai national ID:
 *   - STRING only (numbers/booleans → false; numeric ms-timestamps never match).
 *   - NOT already `enc:v1:`-prefixed (idempotent — ciphertext is left alone; it is
 *     also not 13 plain digits, so the Mod-11 check would reject it anyway, but
 *     the prefix guard makes the intent explicit and short-circuits).
 *   - exactly 13 digits AND passes the SHARED Mod-11 validator. A random or
 *     timestamp-shaped 13-digit string that FAILS Mod-11 is rejected (left alone).
 *
 * @param {*} val
 * @returns {boolean}
 */
function isPlaintextNationalId(val) {
    if (typeof val !== 'string') { return false; }
    if (val.startsWith(VERSION_PREFIX)) { return false; } // already encrypted
    return isThaiIdMod11Valid(val);
}

// VALUE-match predicate for the ENCRYPT path: a STRING value that is a valid
// 13-digit Mod-11 national ID under ANY key (key-agnostic safety-net).
function encryptValueMatch(val) {
    return isPlaintextNationalId(val);
}

// VALUE-match predicate for the DECRYPT path: ANY `enc:v1:`-prefixed STRING under
// ANY key. This makes decryptFormDataPii truly PREFIX-based (key-agnostic) — the
// SAME contract as B1's generic decryptResultTree walker — so a leaf the encrypt
// value-net wrapped under an arbitrary key (e.g. witnessId) still round-trips.
function decryptValueMatch(val) {
    return typeof val === 'string' && val.startsWith(VERSION_PREFIX);
}

/**
 * Internal deep-walk. Applies `transformLeaf` to the string VALUE of any leaf
 * that is EITHER (1) keyed by a name in FORMDATA_PII_KEY_SET, OR (2) matched by
 * the `valueMatch` predicate REGARDLESS of its key. Recurses through plain
 * objects + arrays. Returns a NEW structure (never mutates the input).
 * Everything else passes through unchanged.
 *
 * @param {*} node
 * @param {(s: string) => string} transformLeaf — encryptValue or decryptValue
 * @param {WeakSet} seen
 * @param {number} depth
 * @param {(s: string) => boolean} valueMatch — key-agnostic value predicate
 *   (encrypt: Mod-11 national ID; decrypt: `enc:v1:` prefix). Only ever invoked
 *   on a STRING value, so numbers/booleans (e.g. numeric ms-timestamps) are
 *   structurally excluded from value-based transformation.
 * @returns {*}
 */
function walk(node, transformLeaf, seen, depth, valueMatch) {
    if (node === null || typeof node !== 'object') {
        // Scalars reach here only via a non-PII key path (the PII-keyed string
        // is transformed by the parent before recursing), so return as-is.
        return node;
    }
    if (depth >= MAX_WALK_DEPTH) { return node; }
    if (seen.has(node)) { return node; }

    if (Array.isArray(node)) {
        seen.add(node);
        // Array elements are never "keyed" — a PII key only exists on an object.
        // So we recurse into each element but never treat an array index as a
        // PII key (this is what keeps productionInputs[] elements walked but
        // their non-PII `registrationNumber` untouched — that key is NOT in the
        // set anyway, and even if a PII key appeared inside an element object it
        // would be handled by the object branch below).
        return node.map((el) => walk(el, transformLeaf, seen, depth + 1, valueMatch));
    }

    if (!isPlainObject(node)) {
        // Date / Buffer / class instance — leaf, return by reference untouched.
        return node;
    }

    seen.add(node);
    const out = {};
    for (const key of Object.keys(node)) {
        const val = node[key];
        // (1) key-allowlist leaf, OR (2) value-match leaf under ANY key. Both are
        // STRING-gated: numbers/booleans (numeric ms-timestamps) never match.
        if (typeof val === 'string'
            && (FORMDATA_PII_KEY_SET.has(key) || valueMatch(val))) {
            out[key] = transformLeaf(val);
        } else if (val !== null && typeof val === 'object') {
            out[key] = walk(val, transformLeaf, seen, depth + 1, valueMatch);
        } else {
            out[key] = val;
        }
    }
    return out;
}

/**
 * Deep-walk `formData` and ENCRYPT the value of every national-ID-class leaf via
 * `encryptValue`. A leaf qualifies when its key is in FORMDATA_PII_KEYS OR its
 * STRING value is a valid 13-digit Mod-11 Thai national ID under ANY key (the
 * key-agnostic value safety-net). Idempotent (encryptValue is a no-op on
 * already-`enc:v1:`-prefixed + null/empty/non-string; the value-net likewise
 * skips ciphertext + non-strings). Returns a NEW object; non-PII fields are
 * preserved exactly. Pass-through for non-object inputs (null/undefined/scalar)
 * so a missing formData is a safe no-op.
 *
 * @param {*} formData
 * @returns {*}
 */
function encryptFormDataPii(formData) {
    if (formData === null || typeof formData !== 'object') { return formData; }
    return walk(formData, encryptValue, new WeakSet(), 0, encryptValueMatch);
}

/**
 * Inverse of `encryptFormDataPii` — deep-walk and DECRYPT every `enc:v1:`-prefixed
 * leaf via `decryptValue`, key-agnostically (PREFIX-based, the SAME contract as
 * B1's generic decryptResultTree walker) so a leaf the encrypt value-net wrapped
 * under an arbitrary key still round-trips. Idempotent (decryptValue is a no-op
 * on any non-`enc:v1:`-prefixed / legacy-plaintext value). Exported for any
 * non-B1 read path (a $queryRaw / JSON-path read that bypasses the generic
 * decryptResultTree walker). The standard Prisma read path does NOT need this —
 * B1's decryptResultTree already auto-decrypts formData leaves — but it is
 * exported so a raw-read caller can decrypt at the boundary.
 *
 * @param {*} formData
 * @returns {*}
 */
function decryptFormDataPii(formData) {
    if (formData === null || typeof formData !== 'object') { return formData; }
    // PREFIX-based, key-agnostic: decrypt any `enc:v1:` leaf regardless of key.
    return walk(formData, decryptValue, new WeakSet(), 0, decryptValueMatch);
}

/**
 * True when `formData` still contains at least one PLAINTEXT national-ID leaf —
 * EITHER (1) a non-empty plaintext string under a key in FORMDATA_PII_KEY_SET,
 * OR (2) a plaintext string value that is a valid 13-digit Mod-11 national ID
 * under ANY key (mirrors the encrypt value-net so the backfill's "0 plaintext
 * remaining" assertion is HONEST — it would otherwise miss a Mod-11 leaf the
 * encrypt path encrypts). A leaf already `enc:v1:`-prefixed is NOT plaintext.
 * Used by the backfill to (a) skip rows that need no write and (b) assert "0
 * plaintext remaining". Pure; deep-walks; does not allocate a transformed copy.
 *
 * @param {*} formData
 * @param {string} versionPrefix
 * @returns {boolean}
 */
function hasPlaintextPii(formData, versionPrefix) {
    const seen = new WeakSet();
    const stack = [{ node: formData, depth: 0 }];
    while (stack.length > 0) {
        const { node, depth } = stack.pop();
        if (node === null || typeof node !== 'object') { continue; }
        if (depth >= MAX_WALK_DEPTH) { continue; }
        if (seen.has(node)) { continue; }
        seen.add(node);
        if (Array.isArray(node)) {
            for (const el of node) {
                if (el !== null && typeof el === 'object') {
                    stack.push({ node: el, depth: depth + 1 });
                }
            }
            continue;
        }
        if (!isPlainObject(node)) { continue; }
        for (const key of Object.keys(node)) {
            const val = node[key];
            if (typeof val === 'string'
                && val.length > 0
                && !val.startsWith(versionPrefix)
                && (FORMDATA_PII_KEY_SET.has(key) || isThaiIdMod11Valid(val))) {
                return true;
            }
            if (val !== null && typeof val === 'object') {
                stack.push({ node: val, depth: depth + 1 });
            }
        }
    }
    return false;
}

module.exports = {
    VERSION_PREFIX,
    FORMDATA_PII_KEYS,
    FORMDATA_PII_KEY_SET,
    encryptValue,
    decryptValue,
    encryptFormDataPii,
    decryptFormDataPii,
    hasPlaintextPii,
};
