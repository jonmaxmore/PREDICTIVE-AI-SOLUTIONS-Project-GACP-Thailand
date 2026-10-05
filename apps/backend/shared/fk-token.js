'use strict';

/**
 * Detokenize STAGE 0 — FK-token flag + token resolver (single source of truth).
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md
 *
 * THE CORE DESIGN RULE
 * --------------------
 * `User.canonicalId` is the FK join key denormalized into Application.healthId,
 * Invoice.healthId, and application_bundles.healthId. TODAY it holds the national
 * ID. The detokenize plan re-keys it to a non-PII token so a Postgres dump no
 * longer exposes the national ID as a join key.
 *
 * WRITE chokepoints are FLAG-GATED behind `APP_FK_USE_TOKEN === 'true'`, read
 * live via process.env (mirrors the existing useHmacLookup() switch in
 * prisma-auth-service.js so a config flip needs no redeploy):
 *
 *   - flag OFF (default): canonicalId is written = the national ID
 *     (identity.actualIdentifier) — BYTE-FOR-BYTE today's behaviour.
 *   - flag ON: canonicalId is written = the token
 *     (isProvider ? providerIdHmac : healthIdHmac) ?? user.id.
 *
 * The token is the SAME keyed HMAC that H-4 Phase 1 already computes into the
 * `*Hmac` lookup columns (computeLookupHmac) — NO new crypto, NO new key. We
 * recompute it here from the plaintext rather than depending on whether
 * AUTH_LOOKUP_USE_HMAC happened to populate the `*Hmac` payload field, so the
 * FK-token decision is decoupled from the lookup-column decision. (In the
 * STAGE-A rollout both flags are ON together, but this module stays correct
 * regardless.)
 *
 * READ side: the auth-middleware read chokepoint sets req.user.canonicalId from
 * the DB `*Hmac` columns when the flag is ON; see middleware/auth-middleware.js
 * fetchIdentityFromDb. That value is sourced from the DB ONLY (never the JWT
 * fallback) so it always equals the column the FK points at.
 */

const { computeLookupHmac } = require('../utils/field-encryption');

/**
 * Live flag read (not cached): is the FK re-key (canonicalId := token) active?
 */
function useFkToken() {
    return process.env.APP_FK_USE_TOKEN === 'true';
}

/**
 * Resolve the value to write into `canonicalId` on user create.
 *
 * @param {object} args
 * @param {string} args.actualIdentifier  the national ID (cleaned, 13 digits)
 * @param {boolean} [args.isProvider]      provider account (documents intent at
 *                                         the call site; the HMAC is keyed on the
 *                                         identifier value, so this is advisory).
 * @param {string} [args.userId]           User.id fallback when no plaintext ID
 * @param {string} [args.precomputedHmac]  the already-computed *Hmac for this
 *                                         identifier (from the same payload), if
 *                                         the caller has it — reused verbatim.
 * @returns {string} the canonicalId to write.
 *
 * Flag OFF → returns the national ID unchanged (today's behaviour, byte-for-byte).
 * Flag ON  → returns the keyed-HMAC token, falling back to userId when the
 *            plaintext identifier is missing (matches the COALESCE(... , id) in
 *            the STAGE-A re-key SQL).
 */
// eslint-disable-next-line no-unused-vars -- isProvider documents caller intent
function resolveCanonicalIdForWrite({ actualIdentifier, isProvider, userId, precomputedHmac } = {}) {
    if (!useFkToken()) {
        // Flag OFF: identity is the canonicalId — unchanged from today.
        return actualIdentifier;
    }
    // Flag ON: the token. Prefer an already-computed *Hmac from the payload;
    // otherwise recompute it from the plaintext (same value, no new crypto).
    const token = precomputedHmac
        || (actualIdentifier ? computeLookupHmac(actualIdentifier) : null);
    // COALESCE(... , id): a user with no national ID (should not happen for
    // applicants/providers, but defensive) falls back to the stable User.id.
    return token || userId || actualIdentifier;
}

module.exports = {
    useFkToken,
    resolveCanonicalIdForWrite,
};
