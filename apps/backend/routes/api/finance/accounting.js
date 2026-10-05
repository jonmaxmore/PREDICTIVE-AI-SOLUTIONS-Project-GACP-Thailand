/**
 * Accounting Dashboard Routes
 *
 * Batch 11 (Finance cluster) — all direct `prisma.invoice.*` and
 * `prisma.quote.*` aggregate queries now go through
 * `services/accounting-service.js`. The service centralises the
 * `isDeleted: false` filter so route bugs cannot silently inflate
 * revenue numbers by counting soft-deleted rows.
 *
 * Tax-Invoice canonical totals (Tier 8/9 — anti-regression):
 *   The revenue figure here is _sum.totalAmount over PAID invoices —
 *   `totalAmount` already includes VAT for PLATFORM invoices, which is
 *   the correct value for revenue/bank-reconciliation reporting. The
 *   per-row VAT-split (needed for FlowAccount export) lives on
 *   invoice-service.listAll(), not here.
 */
const express = require('express');
const router = express.Router();
const accountingService = require('../../../services/accounting-service');
const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { requireOrganization } = require('./finance-route-helpers');
const { normalizeRole, PERMISSIONS } = require('../../../shared/canonical-rbac');
const { getEffectivePermissions } = require('../../../services/effective-permissions-service');
const logger = require('../../../shared/logger');

// Wave 2 — FIRST live consumer of the per-permission grant engine. The gate
// now decides on the EFFECTIVE permission set (role baseline ∪ GRANT − REVOKE),
// read live per request, so an admin's grant/revoke on the permission matrix
// bites on the target's very next request. For the ~all users with NO grants,
// effective === the role baseline, i.e. byte-identical to the previous
// hasPermission(role, …) check — no behaviour change. The service fails SAFE
// (grant-read outage → role-only), and the result is cached on
// req._effectivePermissions (shared with middleware requireEffectivePermission)
// so multiple gates in one request do a single read.
const requireCanonicalPermission = (permission) => async (req, res, next) => {
    const canonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (!canonicalRole) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: `Permission required: ${permission}`,
        });
    }
    req.user.canonicalRole = canonicalRole;
    try {
        if (!req._effectivePermissions || req._effectivePermissions.userId !== req.user?.id) {
            const result = await getEffectivePermissions({ role: canonicalRole, userId: req.user?.id });
            req._effectivePermissions = { userId: req.user?.id, ...result };
        }
        if (!req._effectivePermissions.effectiveSet.has(permission)) {
            return res.status(403).json({
                success: false,
                error: 'Forbidden',
                message: `Permission required: ${permission}`,
            });
        }
        return next();
    } catch (err) {
        logger.error('[Accounting] permission gate failed:', err?.message);
        return res.status(403).json({ success: false, error: 'Forbidden', message: `Permission required: ${permission}` });
    }
};

// Get Accounting Summary (root path)
router.get('/', authenticateProvider, requireCanonicalPermission(PERMISSIONS.ACCOUNTING_DASHBOARD_READ), async (req, res) => {
    try {
        // Org-scope the aggregates to the caller; a caller with no organization is
        // refused (L3, 2026-09-27). No role-based side narrowing — both finance
        // roles see the same totals (operator 2026-09-11).
        const organizationId = requireOrganization(req, res); // L3 — fail closed
        if (!organizationId) { return undefined; }
        const data = await accountingService.getRootSummary(organizationId);
        return res.json({ success: true, data });
    } catch (error) {
        logger.error('[Accounting] root error:', error);
        return res.status(500).json({ success: false, message: 'Failed to get accounting data' });
    }
});

// Get Dashboard Stats
router.get('/dashboard', authenticateProvider, requireCanonicalPermission(PERMISSIONS.ACCOUNTING_DASHBOARD_READ), async (req, res) => {
    try {
        const organizationId = requireOrganization(req, res); // L3 — fail closed
        if (!organizationId) { return undefined; }
        const data = await accountingService.getDashboardStats(organizationId);
        res.json({ success: true, data });
    } catch (error) {
        logger.error('[Accounting] getDashboardStats error:', error);
        res.status(500).json({ success: false, message: 'Failed to get dashboard stats' });
    }
});


module.exports = router;
