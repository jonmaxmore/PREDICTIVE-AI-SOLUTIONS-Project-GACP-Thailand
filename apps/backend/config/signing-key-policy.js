/**
 * Certificate signing-key policy (Ruling 2, 2026-08-22).
 *
 * ONE place that answers two questions for the signing stack:
 *   1. "Is a loadable, usable signing key MANDATORY in this runtime?"
 *   2. "Which key are we supposed to be holding?" (expected public-key fingerprint)
 *
 * Why this lives in `config/` and not in the service
 * -------------------------------------------------
 * `services/crypto/signature-service.js` must not read `process.env` directly:
 * every such read is counted by the env-direct ratchet (scripts/probes/ratchet.sh),
 * and more importantly the repo's rule is that runtime configuration resolves
 * through `config/secrets.js` so there is a single catalogued lookup path with
 * alias support and a documented `required` policy.
 *
 * Ruling 2 in one line
 * --------------------
 * "production ต้องปฏิเสธการบูตถ้าโหลดกุญแจไม่ได้ (เลิกพฤติกรรมสร้างกุญแจใหม่เงียบ ๆ)" —
 * production must REFUSE TO BOOT when the key cannot be loaded; the silent
 * regeneration behaviour is retired. A regenerated key invalidates every
 * certificate already signed with the previous one, which is a worse outcome
 * than a loud outage.
 *
 * @module config/signing-key-policy
 */

'use strict';

const { tryGetSecret } = require('./secrets');

const TRUTHY = new Set(['true', '1', 'yes', 'on']);

/**
 * True when the runtime is production. Read live (not captured at module load)
 * so a test that flips NODE_ENV sees the change without a module reset.
 *
 * @returns {boolean}
 */
function isProductionRuntime() {
    return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

/**
 * True when a missing/unusable signing key must be a FATAL boot error rather
 * than something the service quietly papers over by minting a new key.
 *
 * Always true in production. Elsewhere it is opt-in via REQUIRE_SIGNING_KEY so
 * staging, CI and a developer reproducing a production incident can exercise
 * the exact production contract without pretending to be production.
 *
 * @returns {boolean}
 */
function isSigningKeyRequired() {
    if (isProductionRuntime()) { return true; }
    return TRUTHY.has(String(tryGetSecret('REQUIRE_SIGNING_KEY') || '').trim().toLowerCase());
}

/**
 * The sha256 hex fingerprint the loaded signing PUBLIC key is expected to have,
 * or null when the operator has not pinned one.
 *
 * Pinning is what turns "we booted with a key" into "we booted with THE key":
 * without it, a wrong-but-loadable key (restored from the wrong backup, a stale
 * image layer, another environment's mount) signs happily and produces
 * certificates that fail verification everywhere else.
 *
 * @returns {string|null} lowercase hex, or null
 */
function getExpectedSigningKeyFingerprint() {
    const raw = tryGetSecret('SIGNING_KEY_FINGERPRINT');
    if (!raw) { return null; }
    const trimmed = String(raw).trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Fingerprints of PREVIOUS signing keys that must stay trusted.
 *
 * This is the half of the trust anchor that makes rotation and machine moves
 * survivable. A certificate row pins the public key that verifies it, but a
 * pinned key is only worth something if we can answer "is this key OURS?" —
 * otherwise anyone who can write the row pins a key they hold the private half
 * of and mints their own verdict. The currently-loaded key answers that for
 * certificates signed today; this list answers it for certificates signed by
 * keys we have since retired.
 *
 * Operator-declared on purpose. Retiring a key is a deliberate act and this list
 * is the record of it — nothing here is derived from data a request can reach.
 *
 * @returns {string[]} lowercase hex fingerprints, possibly empty
 */
function getRetiredSigningKeyFingerprints() {
    const raw = tryGetSecret('SIGNING_KEY_RETIRED_FINGERPRINTS');
    if (!raw) { return []; }
    return String(raw)
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0);
}

module.exports = {
    isProductionRuntime,
    isSigningKeyRequired,
    getExpectedSigningKeyFingerprint,
    getRetiredSigningKeyFingerprints,
};
