/**
 * Payment utilities — the surviving helpers of the retired
 * `payment-webhook-service.js` (Wave 0 purge, docs/payment-refactor/
 * legacy-payment-audit.md).
 *
 * The platform shifted from payment-gateway auto-verify to slip-upload
 * manual verification on 2026-04-29. The gateway-era machinery around these
 * helpers (HMAC signature verification, webhook handlers, webhook audit
 * writer) had no mounted route and was removed; these three are the parts
 * the LIVE phase-payment path still uses.
 *
 * `buildWorkflowEvent` here is the POSITIONAL variant used by the payment
 * flow's workflowHistory entries. It is not the same contract as
 * `shared/workflow-event-builder` (object-argument variant) — both formats
 * exist in stored history rows, so neither can absorb the other without a
 * data migration.
 */
const crypto = require('crypto');

function generateSecureIdFragment(length = 9) {
    return crypto
        .randomBytes(Math.ceil(length / 2))
        .toString('hex')
        .slice(0, length)
        .toUpperCase();
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function buildWorkflowEvent(action, fromStatus, toStatus, metadata = {}) {
    return {
        timestamp: new Date().toISOString(),
        action,
        fromStatus: fromStatus || null,
        toStatus: toStatus || null,
        ...metadata,
    };
}

module.exports = {
    generateSecureIdFragment,
    asArray,
    buildWorkflowEvent,
};
