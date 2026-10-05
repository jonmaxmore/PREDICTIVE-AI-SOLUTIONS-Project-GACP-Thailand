/**
 * Assignment Ledger — QUERY service (Phase 1C, read-only).
 *
 * Read sibling of the write-only assignment-ledger-service.js. Surfaces the
 * AssignmentLedgerEntry table so schedulers/admins can answer:
 *   • how much work was HANDED to each person in a window (distribution fairness)
 *   • what one person was assigned
 *   • the full assignment history of one work item
 *   • the reassignment audit trail (who moved work off whom, why)
 *   • what one scheduler/admin handed out
 *
 * HONEST METRIC — read this before using the counts:
 *   `assignmentsGivenInWindow` / the fairness counts = COUNT of rows whose
 *   action ∈ {ASSIGN, REASSIGN} in the window, grouped by assignee. This is
 *   THROUGHPUT — "how much work was GIVEN to this person" — an EVENT-LOG count,
 *   NOT current open load. CLAIM/UNCLAIM/COMPLETE/CANCEL are lifecycle events
 *   and are EXCLUDED from these counts (summing all 6 actions would inflate a
 *   single assignment's lifecycle 3-4x and conflate "given to me" with "I
 *   grabbed it myself"). "How much OPEN work does X have right now" cannot be
 *   derived from the ledger alone (it needs live WorkActivity/Application state)
 *   and is intentionally NOT implemented here.
 *
 * TENANCY (critical): TENANT_READ_ORG_SCOPE is OFF on prod, so the tenant
 * Prisma extension does NOT auto-scope reads — and it never scopes groupBy at
 * all. Therefore EVERY query here takes organizationId as a REQUIRED arg and
 * puts it in the WHERE explicitly (findMany / count / groupBy / the
 * name-resolution user.findMany alike). Omitting it would leak cross-tenant rows.
 */

'use strict';

const { prisma } = require('./prisma-database');

// Actions that mean "someone GAVE work to a person" — the only ones counted in
// the fairness/workload throughput metric. The rest are lifecycle.
const ASSIGNMENT_ACTIONS = ['ASSIGN', 'REASSIGN'];

const VALID_ENTITY_TYPES = new Set(['APPLICATION', 'WORK_ACTIVITY', 'POST_AUDIT_TASK']);

const MAX_TAKE = 1000;

function clampTake(take, fallback) {
    const n = Number.isFinite(take) ? Math.floor(take) : fallback;
    return Math.min(Math.max(n, 1), MAX_TAKE);
}

function requireOrg(organizationId) {
    if (!organizationId) {
        // Defensive: the route fail-closes before calling, but never let a
        // future caller run an unscoped ledger query.
        throw new Error('assignment-ledger-query: organizationId is required (tenant scope)');
    }
}

const displayName = (u) => (u
    ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || u.id.slice(0, 8)
    : null);

/**
 * Resolve a set of user ids → { id: name } within the SAME org (PII display).
 * Org-scoped on purpose (must-fix tenant guard) — never an unscoped user read.
 */
async function resolveUserNames(organizationId, ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    if (unique.length === 0) {
        return new Map();
    }
    const users = await prisma.user.findMany({
        where: { id: { in: unique }, organizationId },
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
    });
    return new Map(users.map((u) => [u.id, u]));
}

const ROW_SELECT = {
    id: true,
    createdAt: true,
    entityType: true,
    entityId: true,
    action: true,
    assigneeUserId: true,
    assignedByUserId: true,
    role: true,
    previousAssigneeUserId: true,
    source: true,
    reason: true,
};

/**
 * Per-person: how much work was GIVEN to `userId` in the window (throughput),
 * plus their recent ledger events for context.
 */
async function getWorkloadByUser({ organizationId, userId, from, to, take = 100 } = {}) {
    requireOrg(organizationId);
    if (!userId) { throw new Error('assignment-ledger-query: userId is required'); }
    const windowWhere = { organizationId, assigneeUserId: userId, createdAt: { gte: from, lte: to } };

    const [assignmentsGivenInWindow, recentEvents] = await Promise.all([
        prisma.assignmentLedgerEntry.count({
            where: { ...windowWhere, action: { in: ASSIGNMENT_ACTIONS } },
        }),
        prisma.assignmentLedgerEntry.findMany({
            where: windowWhere,
            orderBy: { createdAt: 'desc' },
            take: clampTake(take, 100),
            select: ROW_SELECT,
        }),
    ]);

    return {
        metric: 'assignments_given',
        userId,
        assignmentsGivenInWindow,
        recentEvents,
    };
}

/**
 * Full chronological assignment history for ONE work item (all actions — this
 * is the who-touched-this audit trail, intentionally not action-filtered).
 */
async function getEntityTimeline({ organizationId, entityType, entityId } = {}) {
    requireOrg(organizationId);
    if (!VALID_ENTITY_TYPES.has(entityType)) {
        throw new Error(`assignment-ledger-query: invalid entityType ${entityType}`);
    }
    if (!entityId) { throw new Error('assignment-ledger-query: entityId is required'); }

    const events = await prisma.assignmentLedgerEntry.findMany({
        where: { organizationId, entityType, entityId },
        orderBy: { createdAt: 'asc' },
        select: ROW_SELECT,
    });

    const names = await resolveUserNames(
        organizationId,
        events.flatMap((e) => [e.assigneeUserId, e.assignedByUserId, e.previousAssigneeUserId]),
    );

    return {
        entityType,
        entityId,
        events: events.map((e) => ({
            ...e,
            assigneeName: displayName(names.get(e.assigneeUserId)),
            assignedByName: displayName(names.get(e.assignedByUserId)),
            previousAssigneeName: displayName(names.get(e.previousAssigneeUserId)),
        })),
    };
}

/**
 * Org-wide distribution: count of work GIVEN (ASSIGN+REASSIGN) per assignee in
 * the window. The fairness/round-robin lens. Throughput, NOT current load.
 */
async function getFairnessReport({ organizationId, from, to, role = null, take = MAX_TAKE } = {}) {
    requireOrg(organizationId);
    const grouped = await prisma.assignmentLedgerEntry.groupBy({
        by: ['assigneeUserId'],
        where: {
            organizationId,
            action: { in: ASSIGNMENT_ACTIONS },
            createdAt: { gte: from, lte: to },
            ...(role ? { role } : {}),
        },
        _count: { assigneeUserId: true },
        orderBy: { _count: { assigneeUserId: 'desc' } },
        take: clampTake(take, MAX_TAKE),
    });

    const names = await resolveUserNames(organizationId, grouped.map((g) => g.assigneeUserId));

    const rows = grouped.map((g) => {
        const u = names.get(g.assigneeUserId);
        return {
            assigneeUserId: g.assigneeUserId,
            assigneeName: displayName(u),
            role: u?.role || null,
            assignmentsGivenInWindow: g._count.assigneeUserId,
        };
    });

    const total = rows.reduce((s, r) => s + r.assignmentsGivenInWindow, 0);
    return {
        metric: 'assignments_given',
        roleFilter: role || null,
        people: rows.length,
        totalAssignments: total,
        rows,
    };
}

/**
 * Reassignment audit trail — REASSIGN events (who moved work off whom + why).
 */
async function getReassignments({ organizationId, from, to, take = 100 } = {}) {
    requireOrg(organizationId);
    const events = await prisma.assignmentLedgerEntry.findMany({
        where: { organizationId, action: 'REASSIGN', createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        take: clampTake(take, 100),
        select: ROW_SELECT,
    });

    const names = await resolveUserNames(
        organizationId,
        events.flatMap((e) => [e.assigneeUserId, e.assignedByUserId, e.previousAssigneeUserId]),
    );

    return {
        events: events.map((e) => ({
            ...e,
            assigneeName: displayName(names.get(e.assigneeUserId)),
            assignedByName: displayName(names.get(e.assignedByUserId)),
            previousAssigneeName: displayName(names.get(e.previousAssigneeUserId)),
        })),
    };
}

/**
 * What one scheduler/admin HANDED OUT (ASSIGN+REASSIGN by assignedByUserId).
 * SELF_CLAIM rows (assignedByUserId IS NULL) are naturally excluded.
 */
async function getAssignmentsByAssigner({ organizationId, assignedByUserId, from, to, take = 100 } = {}) {
    requireOrg(organizationId);
    if (!assignedByUserId) { throw new Error('assignment-ledger-query: assignedByUserId is required'); }

    const events = await prisma.assignmentLedgerEntry.findMany({
        where: {
            organizationId,
            assignedByUserId,
            action: { in: ASSIGNMENT_ACTIONS },
            createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: 'desc' },
        take: clampTake(take, 100),
        select: ROW_SELECT,
    });

    const names = await resolveUserNames(organizationId, events.map((e) => e.assigneeUserId));

    return {
        assignedByUserId,
        count: events.length,
        events: events.map((e) => ({ ...e, assigneeName: displayName(names.get(e.assigneeUserId)) })),
    };
}

module.exports = {
    getWorkloadByUser,
    getEntityTimeline,
    getFairnessReport,
    getReassignments,
    getAssignmentsByAssigner,
    ASSIGNMENT_ACTIONS,
    VALID_ENTITY_TYPES,
    MAX_TAKE,
};
