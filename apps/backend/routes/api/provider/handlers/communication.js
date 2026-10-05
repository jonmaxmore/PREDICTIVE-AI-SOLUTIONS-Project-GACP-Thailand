const {
    authenticateProvider,
    requireRole,
    logger,
    adminRoles,
} = require('./shared');
const {
    createBulkNotifications,
    listRecentAdminBroadcasts,
} = require('../../../../services/notification-service');
const providerUserService = require('../../../../services/provider-user-service');
// provider-UAT-round2 2026-07-09 (LOW): an admin broadcast fans a message out to
// up to 500 users but left only queryable (mutable/deletable) notification rows —
// no immutable AuditLog. Record who broadcast what to which target segment.
const { auditLogger, AuditCategory, AuditSeverity } = require('../../../../middleware/audit-logger');
const { getRequestIp } = require('../../../../utils/client-ip');

/**
 * Admin Broadcast — Send notification to multiple users
 * Supports targeting by role, status, or all applicants.
 */
const adminBroadcast = [
    authenticateProvider,
    requireRole(adminRoles),
    async (req, res) => {
        try {
            const { subject, message, targetType, targetValue } = req.body || {};

            if (!subject || String(subject).trim().length < 3) {
                return res.status(400).json({ success: false, error: 'Subject required (min 3 chars)' });
            }
            if (!message || String(message).trim().length < 5) {
                return res.status(400).json({ success: false, error: 'Message required (min 5 chars)' });
            }

            // Determine target users. `isDeleted: false` is enforced by
            // provider-user-service.listUserIdsForBroadcast, so only the
            // role/userType filter has to be assembled here.
            const where = {};
            if (targetType === 'role' && targetValue) {
                where.canonicalRole = targetValue;
            } else if (targetType === 'userType' && targetValue) {
                where.userType = targetValue;
            }
            // else: all users

            const users = await providerUserService.listUserIdsForBroadcast({ where, take: 500 });

            if (users.length === 0) {
                return res.json({
                    success: true,
                    message: 'No matching users found',
                    data: { recipientCount: 0 },
                });
            }

            // Route through createBulkNotifications so each recipient's
            // organizationId is resolved (cross-tenant admin fanout) and
            // user notification-channel preferences are honored.
            const userIds = users.map((u) => u.id);
            const result = await createBulkNotifications({
                userIds,
                type: 'ADMIN_BROADCAST',
                title: String(subject).trim(),
                message: String(message).trim(),
                data: {
                    broadcastBy: req.user.id,
                    broadcastAt: new Date().toISOString(),
                    targetType: targetType || 'all',
                    targetValue: targetValue || null,
                },
            });
            const created = result?.count ?? 0;

            // Immutable audit — the broadcast body itself is NOT logged (it can carry
            // free text); only who/when/target-segment/recipient-count, which is the
            // forensic surface a support-abuse investigation needs.
            try {
                await auditLogger.log({
                    category: AuditCategory.ADMIN,
                    action: 'ADMIN_BROADCAST_SENT',
                    severity: AuditSeverity.WARNING,
                    actorId: req.user.id,
                    actorRole: req.user.canonicalRole || req.user.role || 'ADMIN',
                    actorType: 'ADMIN',
                    resourceType: 'NOTIFICATION',
                    // A broadcast has no single target row — use a stable synthetic id
                    // (resourceId is a required, non-null column; mirrors 'SECURITY').
                    resourceId: 'BROADCAST',
                    ipAddress: getRequestIp(req),
                    userAgent: req.get('user-agent'),
                    metadata: {
                        targetType: targetType || 'all',
                        targetValue: targetValue || null,
                        recipientCount: created,
                        totalTargeted: users.length,
                    },
                });
            } catch (_e) { /* best-effort audit — never block the broadcast */ }

            logger.info({
                action: 'ADMIN_BROADCAST',
                subject,
                targetType,
                targetValue,
                recipientCount: created,
                actorId: req.user.id,
            }, '[admin] broadcast sent');

            return res.json({
                success: true,
                message: `Broadcast sent to ${created} users`,
                data: {
                    recipientCount: created,
                    totalTargeted: users.length,
                },
            });
        } catch (error) {
            logger.error('[admin] broadcast failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to send broadcast',
            });
        }
    },
];

/**
 * Admin Communication Log — Fetch recent broadcasts
 */
const adminCommunicationLog = [
    authenticateProvider,
    requireRole(adminRoles),
    async (_req, res) => {
        try {
            const recentBroadcasts = await listRecentAdminBroadcasts({ take: 20 });

            return res.json({
                success: true,
                data: recentBroadcasts.map((n) => ({
                    id: n.id,
                    subject: n.title,
                    message: n.message,
                    sentAt: n.createdAt?.toISOString() || null,
                    targetType: n.metadata?.targetType || 'all',
                    targetValue: n.metadata?.targetValue || null,
                    broadcastBy: n.metadata?.broadcastBy || null,
                })),
            });
        } catch (error) {
            logger.error('[admin] communication log failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch communication log',
            });
        }
    },
];

module.exports = {
    adminBroadcast,
    adminCommunicationLog,
};
