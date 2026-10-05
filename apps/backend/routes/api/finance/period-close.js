/**
 * Period Close routes (Iter 24, 2026-05-16).
 *
 *   POST /api/finance/period-close             — close a period
 *   POST /api/finance/period-close/:id/reopen  — reopen a closed period
 *   GET  /api/finance/period-close             — list close records
 *   GET  /api/finance/period-close/check       — query if a period is closed
 *
 * Role gate:
 *   - Close:  ACCOUNT_PLATFORM | ADMIN
 *   - Reopen: ADMIN only (separation-of-duties — service rejects when
 *             the reopener equals the original closer)
 *   - List:   ACCOUNT_PLATFORM | ACCOUNT_DTAM | ACCOUNT | AUDITOR | ADMIN
 *   - Check:  same as List
 *
 * Compliance:
 *   - TFRS for NPAEs ch.5 — monthly period close supports the year-end
 *     close mandated by the standard.
 *   - TFRS for NPAEs ch.2 — internal controls + segregation of duties.
 *   - Thai e-Transactions Act §31 — every close + reopen audit-logged.
 *
 * @module routes/api/finance/period-close
 */

'use strict';

const express = require('express');

const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { requireOrganization } = require('./finance-route-helpers');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { safeErrorMessage } = require('../../../shared/api-response');
const logger = require('../../../shared/logger');
const periodCloseService = require('../../../services/period-close-service');

const router = express.Router();

const CLOSE_ROLES = new Set([
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]);

// อ่าน — การเงินสองบทบาท + ผู้ดูแลระบบกรม · ผู้ตรวจประเมินไม่อยู่ในชุดอ่านเรื่องเงิน (operator 2026-09-27 — งานตรวจถึงมือหลังจ่ายเงินแล้ว)
const READ_ROLES = new Set([
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]);

const ADMIN_ONLY = new Set([CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]);

function requireRole(allowed, errorCode = 'FORBIDDEN') {
    return (req, res, next) => {
        const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
        if (!role || !allowed.has(role)) {
            return res.status(403).json({
                success: false,
                error: 'Forbidden',
                code: errorCode,
            });
        }
        req.user.canonicalRole = role;
        return next();
    };
}

// ─── POST / — close a period ───────────────────────────────────────────────
router.post(
    '/',
    authenticateProvider,
    requireRole(CLOSE_ROLES, 'PERIOD_CLOSE_FORBIDDEN'),
    async (req, res) => {
        try {
            const { year, month, notes } = req.body || {};
            const organizationId = req.user?.organizationId || null;
            if (!organizationId) {
                return res.status(400).json({
                    success: false,
                    error: 'VALIDATION_ERROR',
                    message: 'Caller must be bound to an organization',
                });
            }
            const result = await periodCloseService.closePeriod({
                year: Number(year),
                month: Number(month),
                organizationId,
                actorId: req.user.id,
                notes,
            });
            return res.status(201).json({ success: true, data: result });
        } catch (error) {
            if (error.code === 'VALIDATION_ERROR'
                || error.code === 'FUTURE_PERIOD') {
                return res.status(400).json({
                    success: false,
                    error: error.code,
                    message: error.message,
                });
            }
            if (error.code === 'PENDING_INVOICES_IN_PERIOD') {
                return res.status(409).json({
                    success: false,
                    error: 'PENDING_INVOICES_IN_PERIOD',
                    message: error.message,
                    openInvoices: error.openInvoices || 0,
                    warnings: error.warnings || [],
                });
            }
            if (error.code === 'ALREADY_CLOSED') {
                return res.status(409).json({
                    success: false,
                    error: 'ALREADY_CLOSED',
                    message: error.message,
                    periodCloseId: error.periodCloseId,
                });
            }
            logger.error('[period-close] close failed:', error?.message);
            return res.status(500).json({ success: false, error: safeErrorMessage(error) });
        }
    },
);

// ─── POST /:id/reopen — ADMIN only, separation-of-duties enforced ──────────
router.post(
    '/:id/reopen',
    authenticateProvider,
    requireRole(ADMIN_ONLY, 'PERIOD_REOPEN_FORBIDDEN'),
    async (req, res) => {
        try {
            const { reason } = req.body || {};
            const updated = await periodCloseService.reopenPeriod(req.params.id, {
                reason,
                actorId: req.user.id,
            });
            return res.json({ success: true, data: updated });
        } catch (error) {
            if (error.code === 'NOT_FOUND') {
                return res.status(404).json({ success: false, error: 'NOT_FOUND' });
            }
            if (error.code === 'INVALID_STATE') {
                return res.status(409).json({
                    success: false,
                    error: 'INVALID_STATE',
                    message: error.message,
                });
            }
            if (error.code === 'SELF_REOPEN_FORBIDDEN') {
                return res.status(403).json({
                    success: false,
                    error: 'SELF_REOPEN_FORBIDDEN',
                    message: error.message,
                });
            }
            if (error.code === 'VALIDATION_ERROR') {
                return res.status(400).json({
                    success: false,
                    error: 'VALIDATION_ERROR',
                    message: error.message,
                });
            }
            logger.error('[period-close] reopen failed:', error?.message);
            return res.status(500).json({ success: false, error: safeErrorMessage(error) });
        }
    },
);

// ─── GET / — list close records (fromYear/toYear range) ────────────────────
router.get(
    '/',
    authenticateProvider,
    requireRole(READ_ROLES, 'PERIOD_READ_FORBIDDEN'),
    async (req, res) => {
        try {
            const { fromYear, toYear } = req.query || {};
            // Fail closed on a caller with no organization (L3, 2026-09-27).
            const organizationId = requireOrganization(req, res);
            if (!organizationId) { return undefined; }
            const records = await periodCloseService.getPeriodCloseStatus({
                organizationId,
                fromYear: fromYear ? Number(fromYear) : undefined,
                toYear: toYear ? Number(toYear) : undefined,
            });
            return res.json({ success: true, data: records, count: records.length });
        } catch (error) {
            logger.error('[period-close] list failed:', error?.message);
            return res.status(500).json({ success: false, error: safeErrorMessage(error) });
        }
    },
);

// ─── GET /check — query whether (year, month) is closed ────────────────────
router.get(
    '/check',
    authenticateProvider,
    requireRole(READ_ROLES, 'PERIOD_READ_FORBIDDEN'),
    async (req, res) => {
        try {
            const { year, month } = req.query || {};
            // Fail closed on a caller with no organization (L3, 2026-09-27).
            const organizationId = requireOrganization(req, res);
            if (!organizationId) { return undefined; }
            const y = Number(year);
            const m = Number(month);
            if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
                return res.status(400).json({
                    success: false,
                    error: 'VALIDATION_ERROR',
                    message: 'year + month (1..12) are required',
                });
            }
            const closed = await periodCloseService.isPeriodClosed({
                year: y,
                month: m,
                organizationId,
            });
            return res.json({ success: true, data: { year: y, month: m, closed } });
        } catch (error) {
            // Bug 7.4 (adversarial-verify finding 6): isPeriodClosed now FAILS
            // CLOSED — it throws PERIOD_CHECK_UNAVAILABLE on a period-close DB
            // error instead of quietly reporting the period OPEN. Surface that as
            // 503 (transient, retryable) rather than a generic 500, matching the
            // error-codes catalog + the posting routes.
            if (error?.code === 'PERIOD_CHECK_UNAVAILABLE') {
                return res.status(503).json({ success: false, error: error.code, message: error.message });
            }
            logger.error('[period-close] check failed:', error?.message);
            return res.status(500).json({ success: false, error: safeErrorMessage(error) });
        }
    },
);

module.exports = router;
