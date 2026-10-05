/**
 * Work Activity Analytics Service
 *
 * Read-only roll-up over the work_activities table for the manager-facing
 * KPI dashboard (ADR-016 Phase 4). Distinct from work-activity-service.js
 * which owns the write paths (createForStage / claim / markDone / cancel) —
 * mixing the two would force the analytics queries to know about the
 * write-side state machine.
 *
 * Extracted from `routes/api/provider/analytics-work-kpis.js` during the
 * batch 14 Prisma-bypass cleanup. Each method header cites the call site it
 * replaces so the canonical KPI surface stays discoverable.
 */

'use strict';

const { prisma } = require('./prisma-database');

const OPEN_STATES = Object.freeze(['TODO', 'CLAIMED', 'IN_PROGRESS']);

// Replaces prisma.workActivity.count at analytics-work-kpis.js:58.
async function countOpenActivities() {
    return prisma.workActivity.count({
        where: { state: { in: [...OPEN_STATES] } },
    });
}

// Replaces prisma.workActivity.count at analytics-work-kpis.js:59.
async function countOverdueOpenActivities(now) {
    return prisma.workActivity.count({
        where: {
            state: { in: [...OPEN_STATES] },
            dueAt: { lt: now },
        },
    });
}

/**
 * Replaces prisma.workActivity.findMany (window slice) at analytics-work-kpis.js:65.
 * Returns the projection the JS aggregation needs to compute byWorkType,
 * byGroup, and the avg-completion-hours statistics in a single round-trip.
 */
async function listActivitiesInWindow(since) {
    return prisma.workActivity.findMany({
        where: {
            OR: [
                { createdAt: { gte: since } },
                { completedAt: { gte: since } },
            ],
        },
        select: {
            state: true,
            workType: true,
            candidateGroup: true,
            completedBy: true,
            completedAt: true,
            createdAt: true,
            breachedAt: true,
            dueAt: true,
        },
    });
}

// Replaces prisma.workActivity.groupBy at analytics-work-kpis.js:85.
async function groupByState(orgId = null) {
    // groupBy is NOT hooked by the tenant extension (it scopes findMany/findFirst/
    // count only, under TENANT_READ_ORG_SCOPE — never groupBy), so scope per-call-site
    // or this leaks cross-org state counts. null = cross-tenant (PLATFORM_ADMIN).
    return prisma.workActivity.groupBy({
        by: ['state'],
        where: { ...(orgId ? { organizationId: orgId } : {}) },
        _count: { state: true },
    });
}

// Replaces prisma.workActivity.groupBy at analytics-work-kpis.js:90.
async function groupByTopPerformers(since, { take = 10, orgId = null } = {}) {
    return prisma.workActivity.groupBy({
        by: ['completedBy'],
        where: {
            state: 'DONE',
            completedAt: { gte: since },
            completedBy: { not: null },
            ...(orgId ? { organizationId: orgId } : {}),
        },
        _count: { completedBy: true },
        orderBy: { _count: { completedBy: 'desc' } },
        take,
    });
}

/**
 * Replaces prisma.user.findMany at analytics-work-kpis.js:106.
 * Resolves top-performer userIds to names. Projection kept narrow so the
 * route layer cannot widen accidentally — firstName/lastName/email/role
 * are the only display columns the KPI widget renders.
 */
async function findUsersForPerformerNames(userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) {return [];}
    return prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
        },
    });
}

module.exports = {
    OPEN_STATES,
    countOpenActivities,
    countOverdueOpenActivities,
    listActivitiesInWindow,
    groupByState,
    groupByTopPerformers,
    findUsersForPerformerNames,
};
