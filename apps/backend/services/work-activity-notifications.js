/**
 * @module services/work-activity-notifications
 *
 * Notification dispatch for work-activity SLA events (ADR-016 Phase 1B).
 *
 * Three triggers:
 *   - notifyAssigned: when an activity is claimed (HIGH priority — actionable)
 *   - notifyWarning:  when warningAt has passed (NORMAL priority — heads-up)
 *   - notifyBreach:   when dueAt has passed (URGENT priority — escalation)
 *
 * All recipients are computed at dispatch time from candidateGroup +
 * organizationId (so a tenant only ever sees its own queue).  The breach
 * alert also CCs admins of the tenant for management visibility.
 *
 * Best-effort: failures here log warn and never throw.  The cron should
 * keep iterating other rows when one notification fails.
 */

'use strict';

const { prisma } = require('./prisma-database');
const notificationService = require('./notification-service');
const { CANONICAL_ROLES } = require('../shared/canonical-rbac');
const userGroups = require('../shared/user-groups');
const logger = require('../shared/logger');

// Display labels — keep aligned with the frontend WORK_TYPE_LABEL map.
const WORK_TYPE_LABELS = Object.freeze({
    SLIP_REVIEW: 'ตรวจสลิป',
    SCHEDULING: 'จัดคิว/มอบหมาย',
    DOC_REVIEW: 'ตรวจเอกสาร',
    FIELD_AUDIT: 'ตรวจประเมินภาคสนาม',
    CAR_REVIEW: 'ตรวจ CAR',
    FINAL_APPROVAL: 'อนุมัติออกใบรับรอง',
    // RECEIPT_ISSUE removed — receipt issuance is automatic (auto-issue +
    // auto-sign on slip approval), never a spawned human work-activity, so the
    // label was an unreachable orphan. workTypeLabel() falls back to the raw
    // workType for unknown keys, so removal is safe.
});

function workTypeLabel(workType) {
    return WORK_TYPE_LABELS[workType] || workType;
}

async function loadApplicationNumber(applicationId) {
    if (!applicationId) {return null;}
    const app = await prisma.application.findUnique({
        where: { id: applicationId },
        select: { applicationNumber: true },
    });
    return app?.applicationNumber || null;
}

// Resolve recipient userIds for a candidate group inside a tenant.
//
// Phase 1C: routes through user-groups.listGroupMemberUserIds which
// looks at both UserGroupMembership rows AND the legacy User.role
// column. So a user who's a member of multiple groups gets paged for
// every relevant group, and users without memberships still get paged
// via the legacy fallback.
async function listGroupRecipientUserIds(organizationId, candidateGroup) {
    return userGroups.listGroupMemberUserIds(prisma, organizationId, candidateGroup);
}

async function listAdminRecipientUserIds(organizationId) {
    return userGroups.listGroupMemberUserIds(prisma, organizationId, CANONICAL_ROLES.SYSTEM_ADMIN_DTAM);
}

function detailUrl(activityId) {
    return `/provider/work/${encodeURIComponent(activityId)}`;
}

/**
 * Send a notification to one user. Wraps notification-service.sendNotification
 * with a try/catch so a single failure doesn't abort the dispatch loop.
 */
async function safeSend(userId, type, data, overrides) {
    try {
        await notificationService.sendNotification(userId, type, data, overrides);
        return true;
    } catch (e) {
        logger.warn(`[work-activity-notif] send to ${userId} failed (non-fatal): ${e?.message || e}`);
        return false;
    }
}

/**
 * Notify the assignee that they've been given a work item. Called from
 * work-activity-service.claim.
 */
async function notifyAssigned(activity) {
    if (!activity?.assignedUserId) {return 0;}
    try {
        const applicationNumber = await loadApplicationNumber(activity.applicationId);
        const dueInHours = activity.dueAt
            ? Math.max(0, Math.round((new Date(activity.dueAt).getTime() - Date.now()) / (60 * 60 * 1000)))
            : null;
        const data = {
            applicationNumber: applicationNumber || activity.applicationId.slice(0, 8),
            workType: activity.workType,
            workTypeLabel: workTypeLabel(activity.workType),
            dueInHours,
        };
        const ok = await safeSend(activity.assignedUserId, 'WORK_ACTIVITY_ASSIGNED', data, {
            priority: 'HIGH',
            actionUrl: detailUrl(activity.id),
        });
        return ok ? 1 : 0;
    } catch (e) {
        logger.error('[work-activity-notif] notifyAssigned failed (non-fatal):', e?.message);
        return 0;
    }
}

/**
 * Warning alert — fired when warningAt has passed. Goes to the assignee
 * (if any) or to the candidate group queue (so someone picks it up).
 */
async function notifyWarning(activity) {
    try {
        const applicationNumber = await loadApplicationNumber(activity.applicationId);
        const hoursUntilDue = activity.dueAt
            ? Math.max(0, Math.round((new Date(activity.dueAt).getTime() - Date.now()) / (60 * 60 * 1000)))
            : 0;
        const data = {
            applicationNumber: applicationNumber || activity.applicationId.slice(0, 8),
            workType: activity.workType,
            workTypeLabel: workTypeLabel(activity.workType),
            hoursUntilDue,
        };

        const recipientIds = activity.assignedUserId
            ? [activity.assignedUserId]
            : await listGroupRecipientUserIds(activity.organizationId, activity.candidateGroup);

        if (recipientIds.length === 0) {
            logger.warn(
                `[work-activity-notif] no recipients for warning on ${activity.id} ` +
                    `(group=${activity.candidateGroup} org=${activity.organizationId})`,
            );
            return 0;
        }

        const results = await Promise.all(
            recipientIds.map((userId) =>
                safeSend(userId, 'WORK_ACTIVITY_WARNING', data, {
                    priority: 'NORMAL',
                    actionUrl: detailUrl(activity.id),
                }),
            ),
        );
        return results.filter(Boolean).length;
    } catch (e) {
        logger.error('[work-activity-notif] notifyWarning failed (non-fatal):', e?.message);
        return 0;
    }
}

/**
 * Breach alert — fired when dueAt has passed. Goes to the assignee + the
 * candidate group queue + admins (escalation).  At-most-once per row
 * (cron checks breachedAt before re-firing).
 */
async function notifyBreach(activity) {
    try {
        const applicationNumber = await loadApplicationNumber(activity.applicationId);
        const hoursOverdue = activity.dueAt
            ? Math.max(0, Math.round((Date.now() - new Date(activity.dueAt).getTime()) / (60 * 60 * 1000)))
            : 0;
        const data = {
            applicationNumber: applicationNumber || activity.applicationId.slice(0, 8),
            workType: activity.workType,
            workTypeLabel: workTypeLabel(activity.workType),
            hoursOverdue,
        };

        const groupIds = await listGroupRecipientUserIds(
            activity.organizationId,
            activity.candidateGroup,
        );
        const adminIds = await listAdminRecipientUserIds(activity.organizationId);
        // Dedupe — admin in the candidate group shouldn't get two pings.
        const recipientIds = Array.from(
            new Set(
                [activity.assignedUserId, ...groupIds, ...adminIds].filter(Boolean),
            ),
        );

        if (recipientIds.length === 0) {
            logger.warn(`[work-activity-notif] no recipients for breach on ${activity.id}`);
            return 0;
        }

        const results = await Promise.all(
            recipientIds.map((userId) =>
                safeSend(userId, 'WORK_ACTIVITY_BREACH', data, {
                    priority: 'URGENT',
                    actionUrl: detailUrl(activity.id),
                }),
            ),
        );
        return results.filter(Boolean).length;
    } catch (e) {
        logger.error('[work-activity-notif] notifyBreach failed (non-fatal):', e?.message);
        return 0;
    }
}

module.exports = {
    notifyAssigned,
    notifyWarning,
    notifyBreach,
    workTypeLabel,
};
