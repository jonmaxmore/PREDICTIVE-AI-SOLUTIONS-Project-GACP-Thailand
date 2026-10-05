/**
 * Thai National ID validator — Mod-11 checksum + format checks.
 *
 * Sprint 6 healthId-audit Phase C-H9 centralised this so the auth Zod
 * schemas (`shared/schemas/auth-schemas.js`) and any other caller can
 * share a single source of truth.
 *
 * Historic note: an equivalent helper already exists in
 * `services/applicant-validation.js` as `isThaiIdMod11Valid` (boolean).
 * This file wraps it with the `{ valid, errors }` contract the auth
 * layer uses so callers don't have to translate booleans to issues.
 */

'use strict';

// F-G4-10 — the arithmetic used to be copied here. It now lives once, in
// @gacp/validation/thai-id-checksum, which the browser wizard calls too. This
// file is only the `{valid, errors}` adapter the auth Zod layer expects.
const { isThaiIdChecksumValid } = require('@gacp/validation/thai-id-checksum');

const THAI_ID_REGEX = /^\d{13}$/;

/**
 * Pure Mod-11 checksum verifier for a 13-digit Thai national ID.
 * @param {string} value 13-digit numeric string (no dashes)
 * @returns {boolean}
 */
function isThaiIdMod11Valid(value) {
    if (!THAI_ID_REGEX.test(value)) {
        return false;
    }
    return isThaiIdChecksumValid(value);
}

/**
 * Rich validator used by Zod refines. Returns the result shape used
 * across the auth layer: { valid: boolean, errors: Array<{message}> }.
 *
 * Accepts a string with or without dashes — dashes are stripped before
 * the Mod-11 check so callers don't have to normalise twice.
 *
 * @param {string} input
 * @returns {{ valid: boolean, errors: Array<{ message: string }> }}
 */
function validateThaiId(input) {
    const errors = [];
    const cleaned = String(input || '').replace(/-/g, '').trim();
    if (!cleaned) {
        errors.push({ message: 'Thai national ID is required' });
        return { valid: false, errors };
    }
    if (!THAI_ID_REGEX.test(cleaned)) {
        errors.push({ message: 'Thai national ID must be exactly 13 digits' });
        return { valid: false, errors };
    }
    if (!isThaiIdMod11Valid(cleaned)) {
        errors.push({ message: 'Thai national ID failed Mod-11 checksum' });
        return { valid: false, errors };
    }
    return { valid: true, errors: [] };
}

module.exports = {
    isThaiIdMod11Valid,
    validateThaiId,
};
