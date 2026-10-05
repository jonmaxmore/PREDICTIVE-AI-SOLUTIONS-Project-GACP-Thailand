/**
 * Manual Journal Entry routes (B20-C, 2026-05-16).
 *
 *   POST /api/finance/manual-journal-entries           — create DRAFT
 *   GET  /api/finance/manual-journal-entries           — list drafts
 *   GET  /api/finance/manual-journal-entries/:id       — detail
 *   POST /api/finance/manual-journal-entries/:id/approve — DRAFT → APPROVED
 *   POST /api/finance/manual-journal-entries/:id/post     — APPROVED → POSTED (writes JE)
 *   POST /api/finance/manual-journal-entries/:id/reject   — → REJECTED
 *
 * Role gate:
 *   - Create:  ACCOUNT_PLATFORM | ADMIN
 *   - List:    ACCOUNT_PLATFORM | ADMIN | AUDITOR
 *   - Detail:  ACCOUNT_PLATFORM | ADMIN | AUDITOR
 *   - Approve: ADMIN only (cannot self-approve — service enforces)
 *   - Post:    ADMIN only (after APPROVED)
 *   - Reject:  ADMIN only
 *
 * Compliance:
 *   - TFRS for NPAEs ch.2 — segregation of duties enforced at the
 *     service layer (approver MUST NOT equal creator).
 *   - ป.รัษฎากร ม.86/4 — sequential draftNumber preserved across
 *     rejected drafts (gap is meaningful audit signal).
 *   - Thai e-Transactions Act §31 — every state transition is audit-
 *     logged with the action MANUAL_JE_* (see service.ACTIONS).
 */

'use strict';

const express = require('express');

const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { requireOrganization } = require('./finance-route-helpers');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../../../middleware/audit-logger');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { safeErrorMessage } = require('../../../shared/api-response');
const { getRequestIp } = require('../../../utils/client-ip');
const logger = require('../../../shared/logger');
const manualJournalEntryService = require('../../../services/manual-journal-entry-service');

const router = express.Router();

const CREATE_ROLES = new Set([
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]);

// ด่านอ่าน — การเงินสองบทบาทเห็นชุดเดียวกัน (operator 2026-09-11) · CREATE_ROLES ข้างบนไม่ขยาย
const READ_ROLES = new Set([
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]);
// ผู้ตรวจประเมินไม่อยู่ในชุดอ่านเรื่องเงิน (operator 2026-09-27 — งานตรวจถึงมือหลังจ่ายเงินแล้ว)

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

async function logEvent(req, action, severity, payload) {
    try {
        await auditLogger.log({
            category: AuditCategory.PAYMENT,
            action,
            severity,
            actorId: req.user?.id || 'ANONYMOUS',
            actorEmail: req.user?.email || null,
            actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
            actorType: req.user?.providerId ? 'PROVIDER' : 'USER',
            resourceType: ResourceType.PAYMENT,
            resourceId: payload?.draftId || payload?.draftNumber || 'unknown',
            ipAddress: getRequestIp(req),
            userAgent: req.get('user-agent'),
            metadata: payload || {},
        });
    } catch (err) {
        logger.warn('[manual-je] audit log failed (non-fatal):', err?.message);
    }
}

// ─── POST / — create draft ─────────────────────────────────────────────────
router.post(
    '/',
    authenticateProvider,
    requireRole(CREATE_ROLES, 'MANUAL_JE_CREATE_FORBIDDEN'),
    async (req, res) => {
        try {
            const { description, lines, postingDate, reason } = req.body || {};
            const organizationId = req.user?.organizationId || null;

            const draft = await manualJournalEntryService.createDraftManualEntry({
                description,
                lines,
                organizationId,
                actorId: req.user.id,
                postingDate,
                reason,
            });

            await logEvent(req, manualJournalEntryService.ACTIONS.DRAFT_CREATED, AuditSeverity.INFO, {
                draftId: draft.id,
                draftNumber: draft.draftNumber,
                totalDebit: String(draft.totalDebit),
                totalCredit: String(draft.totalCredit),
            });

            return res.status(201).json({ success: true, data: draft });
        } catch (error) {
            if (['VALIDATION_ERROR', 'UNBALANCED_ENTRY', 'UNKNOWN_ACCOUNT_CODE'].includes(error.code)) {
                return res.status(400).json({
                    success: false,
                    error: error.code,
                    message: error.message,
                });
            }
            logger.error('[manual-je] create draft failed:', error?.message);
            return res.status(500).json({ success: false, error: safeErrorMessage(error) });
        }
    },
);

// ─── GET / — list drafts ───────────────────────────────────────────────────
router.get(
    '/',
    authenticateProvider,
    requireRole(READ_ROLES, 'MANUAL_JE_READ_FORBIDDEN'),
    async (req, res) => {
        try {
            const { status, limit } = req.query || {};
            // Fail closed on a caller with no organization (L3, 2026-09-27).
            const organizationId = requireOrganization(req, res);
            if (!organizationId) { return undefined; }
            const drafts = await manualJournalEntryService.listDrafts({
                status: status || null,
                organizationId,
                limit: limit ? Number(limit) : 100,
            });
            return res.json({ success: true, data: drafts, count: drafts.length });
        } catch (error) {
            logger.error('[manual-je] list drafts failed:', error?.message);
            return res.status(500).json({ success: false, error: safeErrorMessage(error) });
        }
    },
);

// ─── GET /:id — draft detail ───────────────────────────────────────────────
router.get(
    '/:id',
    authenticateProvider,
    requireRole(READ_ROLES, 'MANUAL_JE_READ_FORBIDDEN'),
    async (req, res) => {
        try {
            const draft = await manualJournalEntryService.getDraftById(req.params.id);
            if (!draft) {
                return res.status(404).json({ success: false, error: 'NOT_FOUND' });
            }
            // Org-scope check — non-admin users see only their own tenant.
            const organizationId = req.user?.organizationId || null;
            if (req.user.canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM
                && draft.organizationId
                && draft.organizationId !== organizationId) {
                return res.status(403).json({ success: false, error: 'CROSS_TENANT_ACCESS_FORBIDDEN' });
            }
            return res.json({ success: true, data: draft });
        } catch (error) {
            logger.error('[manual-je] get draft failed:', error?.message);
            return res.status(500).json({ success: false, error: safeErrorMessage(error) });
        }
    },
);

// ─── POST /:id/approve — DRAFT → APPROVED (ADMIN, separation-of-duties) ────
router.post(
    '/:id/approve',
    authenticateProvider,
    requireRole(ADMIN_ONLY, 'MANUAL_JE_APPROVE_FORBIDDEN'),
    async (req, res) => {
        try {
            const updated = await manualJournalEntryService.approveManualEntry(req.params.id, {
                approverId: req.user.id,
            });
            await logEvent(req, manualJournalEntryService.ACTIONS.APPROVED, AuditSeverity.INFO, {
                draftId: updated.id,
                draftNumber: updated.draftNumber,
                approverId: req.user.id,
            });
            return res.json({ success: true, data: updated });
        } catch (error) {
            if (error.code === 'SELF_APPROVAL_FORBIDDEN') {
                return res.status(403).json({
                    success: false,
                    error: 'SELF_APPROVAL_FORBIDDEN',
                    message: error.message,
                });
            }
            if (error.code === 'NOT_FOUND') {
                return res.status(404).json({ success: false, error: 'NOT_FOUND' });
            }
            if (error.code === 'INVALID_STATE') {
                return res.status(409).json({ success: false, error: 'INVALID_STATE', message: error.message });
            }
            if (error.code === 'VALIDATION_ERROR') {
                return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: error.message });
            }
            logger.error('[manual-je] approve failed:', error?.message);
            return res.status(500).json({ success: false, error: safeErrorMessage(error) });
        }
    },
);

// ─── POST /:id/post — APPROVED → POSTED ────────────────────────────────────
router.post(
    '/:id/post',
    authenticateProvider,
    requireRole(ADMIN_ONLY, 'MANUAL_JE_POST_FORBIDDEN'),
    async (req, res) => {
        try {
            const result = await manualJournalEntryService.postManualEntry(req.params.id, {
                actorId: req.user.id,
            });
            await logEvent(req, manualJournalEntryService.ACTIONS.POSTED, AuditSeverity.INFO, {
                draftId: result.draft.id,
                draftNumber: result.draft.draftNumber,
                journalEntryId: result.entry.id,
            });
            return res.json({ success: true, data: result });
        } catch (error) {
            if (error.code === 'NOT_FOUND') {
                return res.status(404).json({ success: false, error: 'NOT_FOUND' });
            }
            if (error.code === 'INVALID_STATE') {
                return res.status(409).json({ success: false, error: 'INVALID_STATE', message: error.message });
            }
            if (['VALIDATION_ERROR', 'UNBALANCED_ENTRY', 'UNKNOWN_ACCOUNT_CODE'].includes(error.code)) {
                return res.status(400).json({
                    success: false,
                    error: error.code,
                    message: error.message,
                });
            }
            // Bug 7.4 — period-close guard. PERIOD_CLOSED = the target period is
            // sealed (409, client must re-open or shift the date). PERIOD_CHECK_
            // UNAVAILABLE = the guard failed CLOSED because the period-close DB
            // was unreachable (503, transient — safe to retry).
            if (error.code === 'PERIOD_CLOSED') {
                return res.status(409).json({ success: false, error: error.code, message: error.message });
            }
            if (error.code === 'PERIOD_CHECK_UNAVAILABLE') {
                return res.status(503).json({ success: false, error: error.code, message: error.message });
            }
            logger.error('[manual-je] post failed:', error?.message);
            return res.status(500).json({ success: false, error: safeErrorMessage(error) });
        }
    },
);

// ─── POST /:id/reject — record rejection ───────────────────────────────────
router.post(
    '/:id/reject',
    authenticateProvider,
    requireRole(ADMIN_ONLY, 'MANUAL_JE_REJECT_FORBIDDEN'),
    async (req, res) => {
        try {
            const { reason } = req.body || {};
            const updated = await manualJournalEntryService.rejectManualEntry(req.params.id, {
                reason,
                rejectorId: req.user.id,
            });
            await logEvent(req, manualJournalEntryService.ACTIONS.REJECTED, AuditSeverity.INFO, {
                draftId: updated.id,
                draftNumber: updated.draftNumber,
                reason,
            });
            return res.json({ success: true, data: updated });
        } catch (error) {
            if (error.code === 'NOT_FOUND') {
                return res.status(404).json({ success: false, error: 'NOT_FOUND' });
            }
            if (error.code === 'INVALID_STATE') {
                return res.status(409).json({ success: false, error: 'INVALID_STATE', message: error.message });
            }
            if (error.code === 'VALIDATION_ERROR') {
                return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: error.message });
            }
            logger.error('[manual-je] reject failed:', error?.message);
            return res.status(500).json({ success: false, error: safeErrorMessage(error) });
        }
    },
);

module.exports = router;
