/**
 * User Lookup Service — Secure Identifier Resolution
 *
 * System deep-dive Tier 6 — Backend + Security (2026-05-15):
 *
 * Canonical helper for finding a User by `healthId` (Thai national ID) or
 * `providerId` (DTAM staff ID) using the dedicated *Hash lookup columns
 * instead of filtering by the plaintext column.
 *
 * ## Why this exists
 *
 * Today many call sites query by plaintext:
 *
 *   prisma.user.findFirst({ where: { healthId: 'x', isDeleted: false } })
 *
 * That works in legacy mode but **breaks** the moment we encrypt the
 * `healthId`/`providerId` columns (PDPA Phase 2). Non-deterministic AES-GCM
 * means the same plaintext produces different ciphertext on each write, so
 * a WHERE on the encrypted column cannot match anything.
 *
 * The schema already has `healthIdHash` / `providerIdHash` / `idCardHash`
 * columns populated on user creation specifically for this purpose
 * (deterministic SHA-256 of the plaintext, suitable for indexing).
 * Production login flow already uses them:
 *
 *   - apps/backend/services/prisma-auth-service.js:265
 *     `{ healthIdHash: loginIdHash }`
 *
 * This helper centralizes the same pattern so feature code can adopt it
 * incrementally and Phase 2 encryption becomes a one-line config flip
 * (extend PHASE_1_PII_COLUMNS in prisma-pdpa-extension.js) instead of a
 * 7-file refactor.
 *
 * ## CRITICAL — hash format consistency (H-4 Phase 1)
 *
 * The lookup hash is gated by `AUTH_LOOKUP_USE_HMAC` (RFC
 * docs/handoffs/H-4-national-id-hmac-migration-rfc.md):
 *
 *   - flag OFF (DEFAULT): the legacy `*Hash` columns hold raw SHA-256 of the
 *     cleaned ID, written by `prisma-auth-service.js _generateHashes`. This file
 *     computes the SAME raw SHA-256 to stay compatible — byte-for-byte the
 *     historical behaviour.
 *   - flag ON: the lookup reads the keyed-HMAC `*Hmac` columns instead, computed
 *     by `utils/field-encryption.js computeLookupHmac` (the dual-write side is in
 *     `_generateHashes`; existing rows are populated by
 *     `scripts/backfill-national-id-hmac.js`).
 *
 * `computeIdentifierHash()` + the `*Hash`/`*Hmac` column selection below both
 * branch on the SAME `useHmacLookup()` switch, so reader and writer never drift.
 * The H-4 rollout (dual-column, additive, flag-flip rollback) is exactly the
 * coordinated rotation this note used to warn was required.
 *
 * ## Fallback strategy
 *
 * Some legacy users (registered before the *Hash columns existed) may
 * have `healthIdHash IS NULL` even though `healthId` is populated. For
 * those rows we transparently fall back to a plaintext WHERE so the
 * helper is a safe drop-in replacement — until the encryption flip, both
 * lookup strategies coexist.
 *
 * Phase 2 cutover plan (when ready to encrypt healthId/providerId):
 *   1. Run a backfill that re-computes `*Hash` for any NULL rows
 *   2. Once verified, remove the fallback branch from this file
 *   3. Add `healthId` / `providerId` to PHASE_1_PII_COLUMNS in
 *      prisma-pdpa-extension.js
 *   4. Run the PDPA backfill script to encrypt existing plaintext rows
 */

const crypto = require('crypto');
const { prisma } = require('./prisma-database');
const { computeLookupHmac } = require('../utils/field-encryption');

// H-4 Phase 1 (RFC docs/handoffs/H-4-national-id-hmac-migration-rfc.md):
// when `AUTH_LOOKUP_USE_HMAC === 'true'` the lookup switches from the legacy
// raw-SHA-256 `*Hash` columns to the keyed-HMAC `*Hmac` columns. With the flag
// OFF (default) this helper is byte-for-byte the current behaviour.
function useHmacLookup() {
    return process.env.AUTH_LOOKUP_USE_HMAC === 'true';
}

/**
 * Compute the canonical lookup hash for `healthId`/`providerId`/`idCard`.
 *
 * MUST stay in sync with the writer (`prisma-auth-service.js` `_generateHashes`)
 * via the shared `useHmacLookup()` switch:
 *   - flag OFF (default): raw SHA-256 of the cleaned ID → legacy `*Hash` columns.
 *   - flag ON: keyed HMAC (computeLookupHmac) → `*Hmac` columns.
 *
 * @param {string} plaintext
 * @returns {string|null} hex digest, or null if input is falsy
 */
function computeIdentifierHash(plaintext) {
    const trimmed = String(plaintext || '').trim();
    if (!trimmed) {return null;}
    if (useHmacLookup()) {
        return computeLookupHmac(trimmed);
    }
    return crypto.createHash('sha256').update(trimmed).digest('hex');
}

/**
 * Find a User by their Thai national ID (healthId), preferring the
 * deterministic `healthIdHash` column over a plaintext filter.
 *
 * @param {string} healthId  Thai national ID (13 digits)
 * @param {object} [options]
 * @param {object} [options.select]  Prisma select clause (defaults to { id: true })
 * @param {boolean} [options.includeDeleted=false]  Set true to bypass the isDeleted filter
 * @param {object} [options.client=prisma]  Prisma client to use (allows tx injection)
 * @returns {Promise<object|null>}  User row or null when not found / input empty
 */
async function findUserByHealthIdSecurely(healthId, options = {}) {
    const normalized = String(healthId || '').trim();
    if (!normalized) {return null;}

    const {
        select = { id: true },
        includeDeleted = false,
        client = prisma,
    } = options;

    const baseFilter = includeDeleted ? {} : { isDeleted: false };
    const hash = computeIdentifierHash(normalized);
    const healthIdCol = useHmacLookup() ? 'healthIdHmac' : 'healthIdHash';

    // 0️⃣ Token path (detokenize STAGE A, 2026-06-29): `Application.healthId`
    //    and the other FK columns are no longer a plaintext national ID — they
    //    hold the keyed-HMAC TOKEN which EQUALS `User.canonicalId`. Callers that
    //    resolve an applicant from `Application.healthId` (the provider workflow
    //    handlers) therefore pass a token; re-hashing it (step 1️⃣) misses
    //    (healthIdHmac = hash(plaintext), not hash(token)), and the plaintext
    //    fallback (step 2️⃣) misses too → the function returned null and every
    //    applicant workflow notification (pay-งวด2, REJECT, CAR, REVISION) was
    //    SILENTLY DROPPED (provider-E2E carpet 2026-07-09, HIGH). Match on
    //    canonicalId FIRST — the identity match used by the working writer path
    //    (application-status-writer.js). A real plaintext national ID passed in
    //    misses here (canonicalId is a token) and falls through unchanged, so
    //    this is additive and backward-compatible.
    const byCanonicalId = await client.user.findFirst({
        where: { ...baseFilter, canonicalId: normalized },
        select,
    });
    if (byCanonicalId) {return byCanonicalId;}

    // 1️⃣ Deterministic hash lookup — production's login flow uses this
    //    (prisma-auth-service.js) when resolving by a real plaintext national ID.
    if (hash) {
        const byHash = await client.user.findFirst({
            where: { ...baseFilter, [healthIdCol]: hash },
            select,
        });
        if (byHash) {return byHash;}
    }

    // 2️⃣ Fallback for legacy rows with NULL healthIdHash. Once the Phase 2
    //    backfill has populated *Hash for every row, this branch becomes
    //    dead code — but DO NOT remove it before verifying via:
    //      SELECT COUNT(*) FROM "User" WHERE "healthId" IS NOT NULL AND "healthIdHash" IS NULL;
    //    must be 0 in production first.
    const byPlaintext = await client.user.findFirst({
        where: { ...baseFilter, healthId: normalized },
        select,
    });
    return byPlaintext;
}

/**
 * Find a User by their DTAM staff ID (providerId), preferring the
 * deterministic `providerIdHash` column over a plaintext filter.
 * Symmetric with findUserByHealthIdSecurely; same comments apply.
 *
 * @param {string} providerId  DTAM staff ID
 * @param {object} [options]
 * @param {object} [options.select]
 * @param {boolean} [options.includeDeleted=false]
 * @param {object} [options.client=prisma]
 * @returns {Promise<object|null>}
 */
async function findUserByProviderIdSecurely(providerId, options = {}) {
    const normalized = String(providerId || '').trim();
    if (!normalized) {return null;}

    const {
        select = { id: true },
        includeDeleted = false,
        client = prisma,
    } = options;

    const baseFilter = includeDeleted ? {} : { isDeleted: false };
    const hash = computeIdentifierHash(normalized);
    const providerIdCol = useHmacLookup() ? 'providerIdHmac' : 'providerIdHash';

    if (hash) {
        const byHash = await client.user.findFirst({
            where: { ...baseFilter, [providerIdCol]: hash },
            select,
        });
        if (byHash) {return byHash;}
    }

    const byPlaintext = await client.user.findFirst({
        where: { ...baseFilter, providerId: normalized },
        select,
    });
    return byPlaintext;
}

/**
 * Convenience helper retained for legacy parity with
 * `routes/api/provider/handlers/shared.js` `resolveUserIdFromHealthId`.
 * Returns just the user's ID string (or null), so existing callers can
 * swap import paths without changing their downstream logic.
 *
 * @param {string} healthId
 * @returns {Promise<string|null>}
 */
async function resolveUserIdFromHealthIdSecurely(healthId) {
    const user = await findUserByHealthIdSecurely(healthId, { select: { id: true } });
    return user?.id || null;
}

module.exports = {
    computeIdentifierHash,
    findUserByHealthIdSecurely,
    findUserByProviderIdSecurely,
    resolveUserIdFromHealthIdSecurely,
};
