/**
 * Admin Dashboard Service
 *
 * Aggregates application status counts, today's activity, SLA breach counts,
 * revenue summaries, auditor workload, and recent timeline for the admin
 * master dashboard. Extracted from routes/api/provider/handlers/admin-dashboard-handler.js
 * during the batch 10 Prisma-bypass cleanup.
 *
 * Every method is scoped by an optional `orgId` to keep tenant isolation at the
 * service boundary — if a route forgets to pass orgId the queries degrade to
 * the legacy unscoped form (same behavior as the handler previously had for
 * pre-tenant JWTs).
 */

const { prisma } = require('./prisma-database');
const { CANONICAL_ROLES } = require('../shared/canonical-rbac');

// Every users.role spelling for audit-side staff, in BOTH the legacy casing and the
// canonical one, so this query is correct on either side of migration
// 20260801000000_canonicalize_user_role. An uppercase-only filter would
// match nothing post-migration and fail silently, as an empty result.
const AUDIT_STAFF_ROLES = Object.freeze([CANONICAL_ROLES.FIELD_INSPECTOR, CANONICAL_ROLES.DOCUMENT_REVIEWER]);

function buildTenantWhere(orgId, extra = {}) {
    const orgFilter = orgId ? { organizationId: orgId } : {};
    return { isDeleted: false, ...orgFilter, ...extra };
}

/**
 * Aggregate application count by status for an org (or globally if orgId nil).
 * Used by admin-dashboard-handler.js master dashboard.
 */
async function getApplicationStatusCounts(orgId) {
    return prisma.application.groupBy({
        by: ['status'],
        _count: { id: true },
        where: buildTenantWhere(orgId),
    });
}

/**
 * Count applications created since `since` for an org.
 */
async function countApplicationsCreatedSince(orgId, since) {
    return prisma.application.count({
        where: buildTenantWhere(orgId, { createdAt: { gte: since } }),
    });
}

/**
 * Count pending revision deadlines that are past due for an org.
 * Non-fatal if the table doesn't exist — caller handles fallback.
 */
async function countPendingRevisionDeadlinesPastDue(orgId, now) {
    const orgFilter = orgId ? { organizationId: orgId } : {};
    return prisma.revisionDeadline.count({
        where: {
            ...orgFilter,
            status: 'PENDING',
            revisionDue: { lt: now },
        },
    });
}

/**
 * Sum completed-payment amount in [since, now] for an org.
 */
async function sumCompletedPaymentsSince(orgId, since) {
    // There is NO `Payment` model — prisma.payment was undefined → TypeError,
    // swallowed by the caller's bare catch → the admin dashboard reported
    // revenue 0 forever. Sum the paid Invoices (canonical revenue) instead,
    // org-scoped. Returns the caller's expected `{ _sum: { amount } }` shape.
    const orgFilter = orgId ? { organizationId: orgId } : {};
    const agg = await prisma.invoice.aggregate({
        _sum: { totalAmount: true },
        where: {
            ...orgFilter,
            isDeleted: false,
            status: { in: ['paid', 'PAID', 'PAID_PENDING_RECEIPT', 'RECEIPT_ISSUED'] },
            paidAt: { gte: since },
        },
    });
    // totalAmount is Decimal(15,2) → coerce to Number for the dashboard tile.
    return { _sum: { amount: agg._sum.totalAmount == null ? 0 : Number(agg._sum.totalAmount) } };
}

/**
 * Return PROVIDER auditor/reviewer-auditor users (id + name + role).
 * Used to assemble auditor workload widget.
 */
async function listAuditorUsers() {
    return prisma.user.findMany({
        where: {
            isDeleted: false,
            accountType: 'PROVIDER',
            role: { in: [...AUDIT_STAFF_ROLES] },
        },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
        },
    });
}

/**
 * Count active applications assigned to a given user (as reviewer OR auditor). Scoped by org.
 *
 * L7 fix: match the canonical `reviewerId` / `auditorId` COLUMNS first (assign-reviewer
 * handlers write reviewerId; the scheduler audit handler writes auditorId). The legacy
 * `formData.PROVIDERAssignment.*` JSON paths are retained as a fallback for pre-backfill
 * rows. Previously only the JSON paths were matched, so audit-phase assignments (column-
 * based) were undercounted → an overloaded auditor read as AVAILABLE on the admin dashboard.
 */
async function countAuditorActiveAssignments(orgId, userId) {
    return prisma.application.count({
        where: buildTenantWhere(orgId, {
            status: { in: ['ASSIGNED_FOR_REVIEW', 'AUDIT_CONFIRMED', 'CAR_REVIEWING'] },
            OR: [
                { reviewerId: userId },
                { auditorId: userId },
                { formData: { path: ['PROVIDERAssignment', 'reviewerId'], equals: userId } },
                { formData: { path: ['PROVIDERAssignment', 'auditorId'], equals: userId } },
            ],
        }),
    });
}

/**
 * Batched variant of countAuditorActiveAssignments — returns a Map<userId, count>
 * for all supplied userIds in a single round trip. The legacy call site loops
 * over auditors and awaits countAuditorActiveAssignments(orgId, userId) per
 * user (N round-trips for N auditors). This helper folds that into one
 * grouped-by query against the same active-status set.
 *
 * Performance: N+1 -> 1 query for N auditors. The handler caller still
 * iterates the auditor list in JS, but only one DB round trip is issued.
 *
 * Implementation note: Prisma cannot groupBy on a JSON path predicate, so we
 * fetch the slim row set (id + relevant formData paths) for active-status
 * applications scoped to the tenant, then bucket in JS. Returns a Map keyed
 * by userId for O(1) lookup at the call site.
 */
async function countAuditorActiveAssignmentsBulk(orgId, userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
        return new Map();
    }
    const idSet = new Set(userIds.map(String));
    // L7 fix: select the canonical reviewerId/auditorId COLUMNS alongside the legacy
    // formData JSON so column-based audit-phase assignments are counted too.
    const rows = await prisma.application.findMany({
        where: buildTenantWhere(orgId, {
            status: { in: ['ASSIGNED_FOR_REVIEW', 'AUDIT_CONFIRMED', 'CAR_REVIEWING'] },
        }),
        select: { id: true, formData: true, reviewerId: true, auditorId: true },
    });
    const counts = new Map(userIds.map((id) => [String(id), 0]));
    for (const row of rows) {
        // Union of every user assigned to this app (canonical columns + legacy
        // formData), deduped per row so one app counts once per distinct assignee.
        const assigned = new Set();
        if (row.reviewerId) { assigned.add(String(row.reviewerId)); }
        if (row.auditorId) { assigned.add(String(row.auditorId)); }
        const a = row?.formData?.PROVIDERAssignment;
        if (a?.reviewerId) { assigned.add(String(a.reviewerId)); }
        if (a?.auditorId) { assigned.add(String(a.auditorId)); }
        for (const uid of assigned) {
            if (idSet.has(uid)) {
                counts.set(uid, (counts.get(uid) || 0) + 1);
            }
        }
    }
    return counts;
}

/**
 * Recent application activity for the timeline strip on the admin dashboard.
 * Caps at `take` rows.
 */
async function listRecentApplications(orgId, take = 12) {
    return prisma.application.findMany({
        where: buildTenantWhere(orgId),
        orderBy: { updatedAt: 'desc' },
        take,
        select: {
            id: true,
            applicationNumber: true,
            status: true,
            updatedAt: true,
            updatedBy: true,
            applicant: { select: { firstName: true, lastName: true } },
        },
    });
}

module.exports = {
    getApplicationStatusCounts,
    countApplicationsCreatedSince,
    countPendingRevisionDeadlinesPastDue,
    sumCompletedPaymentsSince,
    listAuditorUsers,
    countAuditorActiveAssignments,
    countAuditorActiveAssignmentsBulk,
    listRecentApplications,
};
