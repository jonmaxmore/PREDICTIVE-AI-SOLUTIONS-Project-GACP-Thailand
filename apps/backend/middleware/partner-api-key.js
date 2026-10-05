/**
 * Per-partner API-key authentication for gov-to-gov interoperability endpoints
 * (SEC-AUDIT-012).
 *
 * The `/api/interoperability/v1/*` bulk-export and full-envelope endpoints
 * disclose certificate data + PII (farm/applicant names, up to 1000 rows per
 * call). They are machine-to-machine surfaces for partner agencies (e.g. MOPH,
 * FDA), not public transparency endpoints, so each partner must present a
 * registered API key.
 *
 * Configuration — `INTEROP_PARTNER_API_KEYS` env var, a JSON object mapping a
 * partner id to its secret key:
 *
 *     INTEROP_PARTNER_API_KEYS='{"moph":"<random-secret>","fda":"<random-secret>"}'
 *
 * Fail-closed: if no keys are configured, every request to a protected endpoint
 * is rejected. Keys are compared with a timing-safe equal. Rotate by editing the
 * env value (a process restart, or `requirePartnerApiKey._reload()` in tests).
 *
 * NOTE: keys are read from env in plaintext to match the existing M2M
 * convention (LAB_API_KEY). Storing only salted hashes is a future hardening.
 */
const crypto = require('crypto');
const logger = require('../shared/logger');
const { getRequestIp } = require('../utils/client-ip');

function loadPartnerKeys() {
    const raw = process.env.INTEROP_PARTNER_API_KEYS;
    if (!raw) { return {}; }
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            // Keep only non-empty string keys.
            return Object.fromEntries(
                Object.entries(parsed).filter(([id, key]) => id && typeof key === 'string' && key.length > 0),
            );
        }
        logger.warn('[partner-api-key] INTEROP_PARTNER_API_KEYS must be a JSON object of {partnerId: key}; ignoring');
        return {};
    } catch (err) {
        logger.warn('[partner-api-key] failed to parse INTEROP_PARTNER_API_KEYS:', err.message);
        return {};
    }
}

let partnerKeys = loadPartnerKeys();

function timingSafeEqual(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ab.length !== bb.length) { return false; }
    return crypto.timingSafeEqual(ab, bb);
}

function requirePartnerApiKey(req, res, next) {
    const presented = req.get('x-api-key') || '';
    if (!presented) {
        return res.status(401).json({ success: false, error: 'Partner API key required', code: 'PARTNER_KEY_MISSING' });
    }

    const partnerId = Object.keys(partnerKeys).find((id) => timingSafeEqual(presented, partnerKeys[id]));
    if (!partnerId) {
        logger.warn('[partner-api-key] rejected interoperability request', {
            ip: getRequestIp(req),
            path: req.originalUrl,
        });
        return res.status(401).json({ success: false, error: 'Invalid partner API key', code: 'PARTNER_KEY_INVALID' });
    }

    req.partner = { id: partnerId };
    return next();
}

// Test/ops seam: re-read the env after it changes.
requirePartnerApiKey._reload = () => { partnerKeys = loadPartnerKeys(); };

module.exports = { requirePartnerApiKey };
