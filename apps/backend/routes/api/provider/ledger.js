/**
 * Routes: /api/provider/ledger/*  (Work-Distribution Ledger read API — Phase 1C)
 *
 * Surfaces the AssignmentLedgerEntry table (who assigned which work to whom).
 * Manager-facing: ADMIN + SCHEDULER only (mirrors analytics-work-kpis.js — the
 * cross-cutting distribution view is an ops tool; other staff see their own
 * slice elsewhere).
 *
 * TENANCY (critical): TENANT_READ_ORG_SCOPE is OFF on prod, so reads are NOT
 * auto-scoped. Every handler runs behind a FAIL-CLOSED org guard that 403s when
 * req.user.organizationId is absent (the degraded-DB bindScopes-skipped path),
 * and the org id is passed explicitly into every query. Never 500, never an
 * unscoped fall-through.
 *
 *   GET /workload/:userId                 per-person throughput + recent events
 *   GET /timeline/:entityType/:entityId   full assignment history of one item
 *   GET /fairness                          org-wide distribution (groupBy assignee)
 *   GET /reassignments                     REASSIGN audit trail
 *   GET /by-assigner/:assignedByUserId     what one scheduler/admin handed out
 *
 * Window param: ?days=30 (default), bounded to [1, 365]. Optional ?role= on /fairness.
 */

'use strict';

const express = require('express');
const { authenticateProvider, logger } = require('./handlers/shared');
const { CANONICAL_ROLES, normalizeRole } = require('../../../shared/canonical-rbac');
const ledgerQuery = require('../../../services/assignment-ledger-query-service');

const router = express.Router();
router.use(authenticateProvider);

// Manager-only gate — ADMIN + SCHEDULER (mirror analytics-work-kpis.js:39-45).
// document_reviewer/auditor get 403: peer-workload is staff-performance data,
// not exposed laterally.
router.use((req, res, next) => {
    const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (role === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM || role === CANONICAL_ROLES.DISPATCHER) {
        return next();
    }
    return res.status(403).json({ success: false, error: 'Manager access required' });
});

// Fail-closed tenant guard — runs before every handler. ADMIN/SCHEDULER are
// tenant-scoped roles so org is always present in normal operation; a missing
// org means the degraded-DB path skipped bindScopes (auth-middleware) — fail
// closed rather than leak/empty. Stashes the scoped org for the handlers.
router.use((req, res, next) => {
    const orgId = req.user?.organizationId || null;
    if (!orgId) {
        return res.status(403).json({
            success: false,
            code: 'ORG_SCOPE_REQUIRED',
            error: 'Tenant context required',
        });
    }
    req.ledgerOrgId = orgId;
    return next();
});

// ── helpers ──────────────────────────────────────────────────────────────
function resolveWindow(req) {
    const parsed = parseInt(req.query.days, 10);
    const requested = Number.isFinite(parsed) ? parsed : 30;
    const days = Math.min(Math.max(requested, 1), 365);
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return { days, from, to };
}

// ── routes ───────────────────────────────────────────────────────────────

// Per-person throughput: how much work was GIVEN to :userId in the window.
router.get('/workload/:userId', async (req, res) => {
    try {
        const { from, to, days } = resolveWindow(req);
        const data = await ledgerQuery.getWorkloadByUser({
            organizationId: req.ledgerOrgId,
            userId: req.params.userId,
            from,
            to,
        });
        return res.json({ success: true, data: { ...data, window: { days, from, to } } });
    } catch (e) {
        logger.error('[ledger/workload]', e);
        return res.status(500).json({ success: false, error: 'Failed to load workload' });
    }
});

// Full assignment history (all actions) for one work item.
router.get('/timeline/:entityType/:entityId', async (req, res) => {
    const entityType = String(req.params.entityType || '').toUpperCase();
    if (!ledgerQuery.VALID_ENTITY_TYPES.has(entityType)) {
        return res.status(400).json({ success: false, error: 'Invalid entityType' });
    }
    try {
        const data = await ledgerQuery.getEntityTimeline({
            organizationId: req.ledgerOrgId,
            entityType,
            entityId: req.params.entityId,
        });
        return res.json({ success: true, data });
    } catch (e) {
        logger.error('[ledger/timeline]', e);
        return res.status(500).json({ success: false, error: 'Failed to load timeline' });
    }
});

// Org-wide distribution fairness (assignments GIVEN per assignee in window).
router.get('/fairness', async (req, res) => {
    try {
        const { from, to, days } = resolveWindow(req);
        const role = req.query.role ? normalizeRole(req.query.role) : null;
        const data = await ledgerQuery.getFairnessReport({
            organizationId: req.ledgerOrgId,
            from,
            to,
            role,
        });
        return res.json({ success: true, data: { ...data, window: { days, from, to } } });
    } catch (e) {
        logger.error('[ledger/fairness]', e);
        return res.status(500).json({ success: false, error: 'Failed to load fairness report' });
    }
});

// Reassignment audit trail (REASSIGN events in window).
router.get('/reassignments', async (req, res) => {
    try {
        const { from, to, days } = resolveWindow(req);
        const data = await ledgerQuery.getReassignments({
            organizationId: req.ledgerOrgId,
            from,
            to,
        });
        return res.json({ success: true, data: { ...data, window: { days, from, to } } });
    } catch (e) {
        logger.error('[ledger/reassignments]', e);
        return res.status(500).json({ success: false, error: 'Failed to load reassignments' });
    }
});

// What one scheduler/admin handed out (ASSIGN+REASSIGN by them) in window.
router.get('/by-assigner/:assignedByUserId', async (req, res) => {
    try {
        const { from, to, days } = resolveWindow(req);
        const data = await ledgerQuery.getAssignmentsByAssigner({
            organizationId: req.ledgerOrgId,
            assignedByUserId: req.params.assignedByUserId,
            from,
            to,
        });
        return res.json({ success: true, data: { ...data, window: { days, from, to } } });
    } catch (e) {
        logger.error('[ledger/by-assigner]', e);
        return res.status(500).json({ success: false, error: 'Failed to load assignments' });
    }
});

module.exports = router;
