const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const E2EController = require('../../../controllers/e2e-controller');
const logger = require('../../../shared/logger');

// Defense-in-depth: block even if somehow mounted in production.
// Primary gate is at the router-mount point (routes/api/index.js) which simply
// does not register the /e2e router when NODE_ENV === 'production'. This
// middleware is a second layer that returns 404 (not 403) so production never
// reveals the existence of these routes.
const ensureNonProduction = (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not Found' });
    }
    next();
};

// P1-e2e (audit 2026-06-10): these routes MUTATE data — bulk deleteMany (reset),
// cert-forge (pass-audit), force-transition — and were previously gated ONLY by
// NODE_ENV, leaving them open & unauthenticated on staging (NODE_ENV=staging is
// not 'production'). Require a shared secret with a constant-time compare that
// rejects when the secret is unset (fail-closed). Mirrors the cron-secret pattern
// (cron.js verifyCronSecret, #418). Callers send `x-e2e-secret`.
function verifyE2ESecret(req) {
    const configuredSecret = String(process.env.E2E_SECRET || '').trim();
    if (!configuredSecret) {
        // SECURITY: reject when E2E_SECRET is not configured (fail-closed).
        logger.error('[E2E] E2E_SECRET environment variable is not set. Rejecting request.');
        return false;
    }
    const provided = String(req.headers['x-e2e-secret'] || '').trim();
    if (!provided) { return false; }
    // timingSafeEqual needs equal-length buffers; gate on length first (length
    // is not itself secret), then constant-time compare to avoid byte-timing leaks.
    const a = Buffer.from(provided);
    const b = Buffer.from(configuredSecret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const requireE2ESecret = (req, res, next) => {
    if (!verifyE2ESecret(req)) {
        return res.status(401).json({ success: false, error: 'E2E_SECRET_INVALID' });
    }
    next();
};

router.use(ensureNonProduction);
router.use(requireE2ESecret);

router.post('/reset', E2EController.reset);
router.post('/application/:id/approve-documents', E2EController.approveDocuments);
router.post('/application/:id/pass-audit', E2EController.passAudit);

// Golden Scenario - Complete QC flow with QR code generation
router.post('/golden-scenario', E2EController.goldenScenario);
router.get('/lot/:lotId/qr', E2EController.getLotQRCode);

module.exports = router;
