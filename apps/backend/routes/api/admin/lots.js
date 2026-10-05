'use strict';

/**
 * ADMIN — การเรียกคืนล็อต (recall)
 *
 * Mounted under /api/admin (authenticateProvider + requireAdmin already ran).
 * Mirrors the certificate revoke door one file over: reason required, the act
 * recorded in the audit log, and the response says what changed.
 */

const express = require('express');
const logger = require('../../../shared/logger');
const { getRequestIp } = require('../../../utils/client-ip');
const {
    auditLogger, AuditCategory, AuditSeverity, ResourceType,
} = require('../../../middleware/audit-logger');
const { recallLot } = require('../../../services/lot-recall-service');
const { safeErrorMessage } = require('../../../shared/api-response');

const router = express.Router();
const RECALL_REASON_MAX_LENGTH = 500;

router.post('/:id/recall', async (req, res) => {
    const lotId = String(req.params.id || '').trim();
    const rawReason = req.body?.reason;
    const reason = typeof rawReason === 'string' ? rawReason.trim() : '';

    if (reason.length > RECALL_REASON_MAX_LENGTH) {
        return res.status(400).json({
            success: false,
            error: 'RECALL_REASON_TOO_LONG',
            message: `เหตุผลยาวเกิน ${RECALL_REASON_MAX_LENGTH} ตัวอักษร`,
        });
    }

    const actorId = String(req.user?.id || 'SYSTEM');
    try {
        const { lot, previousStatus } = await recallLot(lotId, { reason, actorId });

        // Best-effort audit, same convention as the certificate revoke door:
        // the recall is committed; a logging outage is reported, not a 500.
        try {
            await auditLogger.log({
                category: AuditCategory.ADMIN,
                action: 'ADMIN_LOT_RECALLED',
                severity: AuditSeverity.WARNING,
                actorId,
                actorRole: req.user?.role || 'UNKNOWN',
                actorType: 'ADMIN',
                resourceType: ResourceType.SYSTEM,
                resourceId: lot.id,
                organizationId: lot.organizationId || req.user?.organizationId || null,
                ipAddress: getRequestIp(req),
                userAgent: req.get('user-agent'),
                metadata: { lotNumber: lot.lotNumber, previousStatus, reason },
            });
        } catch (auditError) {
            logger.error('[admin/lots] recall committed but audit log failed:', auditError);
        }

        return res.json({
            success: true,
            data: { id: lot.id, lotNumber: lot.lotNumber, status: lot.status, previousStatus },
        });
    } catch (error) {
        const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
        if (status >= 500) { logger.error('[admin/lots] recall failed:', error); }
        return res.status(status).json({
            success: false,
            error: error.code || 'LOT_RECALL_FAILED',
            message: error.messageTh || safeErrorMessage(error, 'ไม่สามารถเรียกคืนล็อตได้'),
        });
    }
});

module.exports = router;
