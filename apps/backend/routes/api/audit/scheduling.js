/**
 * Audit Scheduling Routes — Iter 25 (2026-05-16).
 *
 * Thin HTTP layer over audit-scheduling-service. Authentication is enforced
 * by authenticateProvider for scheduler/admin routes and authenticateUser
 * for the applicant-side reschedule request route; authorization (role +
 * tenant + ownership) lives inside the service so the contract is identical
 * for any caller (CLI, cron, future routes).
 *
 * Endpoints:
 *   GET  /api/audit/scheduling/queue
 *        — list AUDIT_FEE_PAID applications waiting for scheduling.
 *          SCHEDULER + ADMIN.
 *   POST /api/audit/scheduling/assign
 *        — assign auditor + date; transitions AUDIT_FEE_PAID → AUDIT_CONFIRMED.
 *          SCHEDULER + ADMIN.
 *   POST /api/audit/scheduling/:applicationId/reschedule
 *        — applicant requests reschedule (HEALTH owner only).
 *   POST /api/audit/scheduling/:rescheduleId/approve
 *        — scheduler approves a pending reschedule. SCHEDULER + ADMIN.
 *   GET  /api/audit/scheduling/auditor-availability/:auditorId
 *        — busy slots + per-day cap. SCHEDULER + ADMIN.
 *
 * Workflow cited: AUDIT_FEE_PAID → AUDIT_CONFIRMED per workflow-transition-service.
 *
 * Storage of reschedule requests is on `Application.formData.rescheduleRequests[]`
 * — see audit-scheduling-service for the JSON shape. No Prisma migration is
 * required for Iter 25.
 */

'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../../../shared/logger');
const { authenticateProvider, authenticateHealth } = require('../../../middleware/auth-middleware');
const auditSchedulingService = require('../../../services/audit-scheduling-service');
const { CANONICAL_ROLES, normalizeRole } = require('../../../shared/canonical-rbac');

function sendServiceError(res, err) {
    const status = err?.statusCode || 500;
    const code = err?.code || 'INTERNAL_ERROR';
    if (status >= 500) {
        logger.error(`[audit-scheduling] ${code}: ${err?.message}`, err);
    }
    const body = {
        success: false,
        error: code,
        message: err?.message || 'Audit-scheduling request failed',
    };
    if (err?.data) {body.data = err.data;}
    return res.status(status).json(body);
}

// ── GET /queue ──────────────────────────────────────────────────────────────
router.get('/queue', authenticateProvider, async (req, res) => {
    try {
        const status = req.query?.status ? String(req.query.status) : undefined;
        // UAT gap: a caller-supplied ?organizationId must NOT override the
        // actor's own org (would be a cross-tenant read once a 2nd org exists;
        // #508 hardened only the write/assign path). Only PLATFORM_ADMIN (the
        // cross-tenant role) may target another org; everyone else is pinned to
        // their own org.
        const isPlatformAdmin = normalizeRole(req.user?.canonicalRole || req.user?.role) === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM;
        const organizationId = (isPlatformAdmin && req.query?.organizationId)
            ? String(req.query.organizationId)
            : (req.user?.organizationId || undefined);
        // assertSchedulerRole lives inside the service — gate the queue by
        // calling it preemptively to short-circuit non-scheduler reads.
        auditSchedulingService._internals.assertSchedulerRole(req.user);
        const queue = await auditSchedulingService.getSchedulingQueue({ organizationId, status });
        // queue is now { items, summary } (H1 contract fix) — not a bare array.
        return res.json({
            success: true,
            data: queue,
            meta: {
                total: Array.isArray(queue?.items) ? queue.items.length : 0,
                organizationId,
                status: status || 'AUDIT_FEE_PAID',
            },
        });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// ── POST /assign ────────────────────────────────────────────────────────────
router.post('/assign', authenticateProvider, async (req, res) => {
    try {
        const body = req.body || {};
        const result = await auditSchedulingService.assignAuditor({
            applicationId: body.applicationId,
            auditorId: body.auditorId,
            scheduledDate: body.scheduledDate,
            scheduledTime: body.scheduledTime,
            location: body.location,
            notes: body.notes,
            inspectionMode: body.inspectionMode,
            estimatedDuration: body.estimatedDuration,
            actorId: req.user?.id,
            actor: req.user,
        });
        return res.status(201).json({ success: true, data: result });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// ── POST /:applicationId/reschedule — applicant-initiated ───────────────────
router.post('/:applicationId/reschedule', authenticateHealth, async (req, res) => {
    try {
        const body = req.body || {};
        const result = await auditSchedulingService.requestReschedule({
            applicationId: req.params.applicationId,
            requestedDate: body.requestedDate,
            reason: body.reason,
            actorId: req.user?.id,
            actor: req.user,
        });
        return res.status(201).json({ success: true, data: result });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// ── POST /:rescheduleId/approve — scheduler-side approval ───────────────────
router.post('/:rescheduleId/approve', authenticateProvider, async (req, res) => {
    try {
        const body = req.body || {};
        const result = await auditSchedulingService.approveReschedule(
            req.params.rescheduleId,
            {
                newDate: body.newDate,
                newAuditor: body.newAuditor,
                actorId: req.user?.id,
                actor: req.user,
            },
        );
        return res.json({ success: true, data: result });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// ── GET /auditor-availability/:auditorId ────────────────────────────────────
router.get('/auditor-availability/:auditorId', authenticateProvider, async (req, res) => {
    try {
        auditSchedulingService._internals.assertSchedulerRole(req.user);
        const from = req.query?.from;
        const to = req.query?.to;
        const result = await auditSchedulingService.getAuditorAvailability({
            auditorId: req.params.auditorId,
            dateRange: { from, to },
        });
        return res.json({ success: true, data: result });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

module.exports = router;
