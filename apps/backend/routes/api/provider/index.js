const express = require('express');

const router = express.Router();

const createLazyRouter = (modulePath) => {
    let resolvedRouter = null;
    return (req, res, next) => {
        if (!resolvedRouter) {
            // Lazy-load provider modules to avoid unnecessary boot-time dependencies.
            resolvedRouter = require(modulePath);
        }
        return resolvedRouter(req, res, next);
    };
};

// Canonical provider namespaces (resource-oriented, kebab-case path policy)
router.use('/reviewer', createLazyRouter('./reviewer'));
router.use('/scheduler', createLazyRouter('./scheduler'));
router.use('/auditor', createLazyRouter('./auditor'));
// Legacy: redirect /head-auditor/* to /auditor/* (role merged)
router.use('/head-auditor', createLazyRouter('./auditor'));
// กทล.๑ ส่วน จนท. ข้อ ๑.๑ — per-slot document verdicts. Mounted BEFORE the
// generic /applications router so its specific paths match first.
router.use('/applications', createLazyRouter('./document-reviews'));
router.use('/applications', createLazyRouter('./applications'));
// ADR-016 Phase 1C/1D — work-queue admin surfaces (admin-only).
// Mounted BEFORE /admin so the more-specific paths match first.
router.use('/admin/user-groups', createLazyRouter('./admin-user-groups'));
router.use('/admin/work-config', createLazyRouter('./admin-work-config'));
router.use('/admin', createLazyRouter('./admin'));
router.use('/certificates', createLazyRouter('./certificates'));
// Waiver-reopen (owner ruling 2026-07-08): once-only, DTAM-side-approved
// reopen of EXPIRED applications reusing the settled payment.
router.use('/waiver-reopen', createLazyRouter('./waiver-reopen'));
// ADR-016 Phase 4 — work-queue KPI roll-up (admin + scheduler).
// Mounted BEFORE /analytics so the more-specific path matches first.
router.use('/analytics/work-kpis', createLazyRouter('./analytics-work-kpis'));
router.use('/analytics', createLazyRouter('./analytics'));
router.use('/planting-cycles', createLazyRouter('./planting'));
router.use('/reports', createLazyRouter('./reports'));
// ADR-016 Phase 1A — unified work queue (BPMN-aligned)
router.use('/work', createLazyRouter('./work'));
// Work-distribution ledger read API (Phase 1C) — who-assigned-whom queries
// (workload / fairness / timeline / reassignments). ADMIN + SCHEDULER only.
router.use('/ledger', createLazyRouter('./ledger'));

// Legacy provider route removed
router.get('/stats', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Legacy provider route is disabled',
    });
});

module.exports = router;
