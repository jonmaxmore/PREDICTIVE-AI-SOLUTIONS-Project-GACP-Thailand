// Work Activity SLA monitor (ADR-016 Phase 1B).
//
// Runs hourly. For every open activity (TODO/CLAIMED/IN_PROGRESS):
//
//   - if warningAt has passed AND warnedAt is NULL → send WORK_ACTIVITY_WARNING
//     to assignee (or candidate group queue) + stamp warnedAt
//   - if dueAt has passed AND breachedAt is NULL → send WORK_ACTIVITY_BREACH
//     to assignee + group + admins + stamp breachedAt
//
// The dedup is by stamping the alert columns at dispatch time. Once
// stamped, no further alerts fire for that row regardless of how long it
// stays open. The activity continues to surface as overdue in the UI
// (via the dueAt < now badge), so the visibility doesn't disappear —
// only the notification noise stops.

'use strict';

const { prisma } = require('../services/prisma-database');
const { withoutTenantScope, runWithTenantContext } = require('../services/tenant-context');
const notifications = require('../services/work-activity-notifications');
const logger = require('../shared/logger');

const OPEN_STATES = ['TODO', 'CLAIMED', 'IN_PROGRESS'];

async function checkOverdueActivities(asOf = new Date()) {
    // Cross-tenant scan; per-row notify re-enters the right tenant via
    // runWithTenantContext.
    const candidates = await withoutTenantScope(() =>
        prisma.workActivity.findMany({
            where: {
                state: { in: OPEN_STATES },
                OR: [
                    { warningAt: { lte: asOf }, warnedAt: null },
                    { dueAt: { lte: asOf }, breachedAt: null },
                ],
            },
            select: {
                id: true,
                applicationId: true,
                organizationId: true,
                workType: true,
                candidateGroup: true,
                state: true,
                assignedUserId: true,
                dueAt: true,
                warningAt: true,
                warnedAt: true,
                breachedAt: true,
            },
        }),
    );

    if (candidates.length === 0) {
        logger.info('[work-activity-sla] no overdue or warning rows');
        return { checked: 0, warned: 0, breached: 0 };
    }

    let warned = 0;
    let breached = 0;

    for (const activity of candidates) {
        if (!activity.organizationId) {
            logger.error(`[work-activity-sla] activity ${activity.id} missing organizationId; skipping`);
            continue;
        }

        const dueHit = activity.dueAt && activity.dueAt <= asOf && activity.breachedAt === null;
        const warnHit = activity.warningAt && activity.warningAt <= asOf && activity.warnedAt === null;

        // Breach takes precedence — if it's already past dueAt, sending
        // a warning is silly (the warning would say "near due" when it's
        // already overdue). Skip the warning, send only the breach.
        if (dueHit) {
            try {
                await runWithTenantContext({ organizationId: activity.organizationId }, async () => {
                    await notifications.notifyBreach(activity);
                    await prisma.workActivity.update({
                        where: { id: activity.id },
                        data: {
                            breachedAt: asOf,
                            // If we never sent a warning before the breach,
                            // mark it suppressed so the next cron pass doesn't
                            // double-alert.
                            warnedAt: activity.warnedAt || asOf,
                        },
                    });
                });
                breached++;
            } catch (e) {
                logger.error(`[work-activity-sla] breach for ${activity.id} failed:`, e?.message);
            }
        } else if (warnHit) {
            try {
                await runWithTenantContext({ organizationId: activity.organizationId }, async () => {
                    await notifications.notifyWarning(activity);
                    await prisma.workActivity.update({
                        where: { id: activity.id },
                        data: { warnedAt: asOf },
                    });
                });
                warned++;
            } catch (e) {
                logger.error(`[work-activity-sla] warning for ${activity.id} failed:`, e?.message);
            }
        }
    }

    logger.info(
        `[work-activity-sla] checked=${candidates.length} warned=${warned} breached=${breached}`,
    );
    return { checked: candidates.length, warned, breached };
}

module.exports = {
    checkOverdueActivities,
};
