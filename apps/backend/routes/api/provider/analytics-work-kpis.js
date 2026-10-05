/**
 * Routes: /api/provider/analytics/work-kpis
 *
 * Manager-facing rollup over the work_activities table (ADR-016 Phase 4).
 *
 * Visible to ADMIN + SCHEDULER (the staff roles in NAV_ROLE_RULES.coordinator).
 * Other staff roles can see their group's slice via /provider/work/queue;
 * this endpoint is for the cross-cutting manager view.
 *
 * One query returns:
 *   summary       open/overdue counts now + done-in-window + avg hours
 *   byWorkType    one row per workType with count + done + breached
 *   byGroup       one row per candidateGroup with count + done + breached
 *   topPerformers top 10 users by completed count in the window
 *   stateCounts   distribution across TODO/CLAIMED/IN_PROGRESS/DONE/CANCELLED
 *
 * Window param: ?days=30 (default), bounded to [1, 365].
 */

'use strict';

const express = require('express');
const {
    authenticateProvider,
} = require('./handlers/shared');
const { CANONICAL_ROLES, normalizeRole } = require('../../../shared/canonical-rbac');
const { respondError } = require('../../../shared/api-response');
// Batch 14 (2026-05-16): KPI rolls-ups go through
// work-activity-analytics-service so this read-only manager dashboard cannot
// drift from the canonical work-activity write-side state machine in
// work-activity-service.js.
const workActivityAnalyticsService = require('../../../services/work-activity-analytics-service');

const router = express.Router();
router.use(authenticateProvider);

// Manager-only — admin + scheduler. Other roles see their slice via
// /provider/work/queue; the cross-cutting roll-up is for ops.
router.use((req, res, next) => {
    const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (role === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM || role === CANONICAL_ROLES.DISPATCHER) {
        return next();
    }
    return res.status(403).json({ success: false, error: 'Manager access required' });
});

router.get('/', async (req, res) => {
    try {
        // Bug fix — `parseInt('0', 10) || 30` previously swallowed 0
        // (falsy) and returned 30 instead of clamping to the [1, 365]
        // floor. Use Number.isFinite + explicit fallback so days=0
        // becomes 1 (the documented floor), not 30.
        const parsed = parseInt(req.query.days, 10);
        const requested = Number.isFinite(parsed) ? parsed : 30;
        const days = Math.min(Math.max(requested, 1), 365);
        const now = new Date();
        const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        // groupBy is NOT auto-scoped by the tenant extension — pass the caller's org
        // so stateCounts/topPerformers don't leak across tenants (ADMIN/SCHEDULER are
        // tenant-scoped; PLATFORM_ADMIN with no org gets the cross-tenant roll-up).
        const orgId = req.user?.organizationId || null;

        const [openCount, overdueCount, windowRows, stateRows, perfRows] = await Promise.all([
            workActivityAnalyticsService.countOpenActivities(),
            workActivityAnalyticsService.countOverdueOpenActivities(now),
            workActivityAnalyticsService.listActivitiesInWindow(since),
            workActivityAnalyticsService.groupByState(orgId),
            workActivityAnalyticsService.groupByTopPerformers(since, { take: 10, orgId }),
        ]);

        // Resolve top-performer userIds to names. Single round-trip.
        const performerIds = perfRows.map((r) => r.completedBy).filter(Boolean);
        const performerUsers = await workActivityAnalyticsService.findUsersForPerformerNames(performerIds);
        const userById = new Map(performerUsers.map((u) => [u.id, u]));

        // Aggregate the windowRows in JS so we get count + done + breached
        // + avgCompletionHours per (workType / candidateGroup) without
        // multiple DB round-trips.
        function emptyBucket() {
            return { total: 0, done: 0, breached: 0, completionHoursSum: 0, completionHoursCount: 0 };
        }
        const byWorkType = new Map();
        const byGroup = new Map();
        let windowDone = 0;
        let windowDoneHoursSum = 0;
        let windowDoneCount = 0;

        for (const row of windowRows) {
            const wt = byWorkType.get(row.workType) || emptyBucket();
            wt.total += 1;
            const gp = byGroup.get(row.candidateGroup) || emptyBucket();
            gp.total += 1;

            if (row.state === 'DONE' && row.completedAt) {
                wt.done += 1;
                gp.done += 1;
                if (row.completedAt >= since) {
                    windowDone += 1;
                    const hours = (row.completedAt.getTime() - row.createdAt.getTime()) / (60 * 60 * 1000);
                    if (Number.isFinite(hours) && hours >= 0) {
                        wt.completionHoursSum += hours;
                        wt.completionHoursCount += 1;
                        gp.completionHoursSum += hours;
                        gp.completionHoursCount += 1;
                        windowDoneHoursSum += hours;
                        windowDoneCount += 1;
                    }
                }
            }
            // breached* tracks the dedup column, not the live "is overdue"
            // signal — we want "ever breached SLA in the window".
            if (row.breachedAt && row.breachedAt >= since) {
                wt.breached += 1;
                gp.breached += 1;
            }

            byWorkType.set(row.workType, wt);
            byGroup.set(row.candidateGroup, gp);
        }

        function shapeBucket(key, bucket) {
            return {
                key,
                total: bucket.total,
                done: bucket.done,
                breached: bucket.breached,
                avgCompletionHours: bucket.completionHoursCount > 0
                    ? Math.round((bucket.completionHoursSum / bucket.completionHoursCount) * 10) / 10
                    : null,
                breachRate: bucket.total > 0
                    ? Math.round((bucket.breached / bucket.total) * 1000) / 10
                    : 0,
            };
        }

        const byWorkTypeArr = Array.from(byWorkType.entries())
            .map(([k, v]) => shapeBucket(k, v))
            .sort((a, b) => b.total - a.total);
        const byGroupArr = Array.from(byGroup.entries())
            .map(([k, v]) => shapeBucket(k, v))
            .sort((a, b) => b.total - a.total);

        const topPerformers = perfRows
            .filter((r) => r.completedBy)
            .map((r) => {
                const u = userById.get(r.completedBy);
                const name = u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() : null;
                return {
                    userId: r.completedBy,
                    name: name || u?.email || r.completedBy.slice(0, 8),
                    role: u?.role || null,
                    completed: r._count.completedBy,
                };
            });

        const stateCounts = Object.fromEntries(
            stateRows.map((r) => [r.state, r._count.state]),
        );

        return res.json({
            success: true,
            data: {
                window: { days, since: since.toISOString(), now: now.toISOString() },
                summary: {
                    openCount,
                    overdueCount,
                    windowDone,
                    avgCompletionHours: windowDoneCount > 0
                        ? Math.round((windowDoneHoursSum / windowDoneCount) * 10) / 10
                        : null,
                },
                byWorkType: byWorkTypeArr,
                byGroup: byGroupArr,
                topPerformers,
                stateCounts,
            },
        });
    } catch (e) {
        return respondError(res, req, e, { label: '[analytics/work-kpis]', message: 'Failed to load work KPIs' });
    }
});

module.exports = router;
