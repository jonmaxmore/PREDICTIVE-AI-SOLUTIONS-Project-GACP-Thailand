/**
 * Post-Audit Task Service
 *
 * Owns reads + writes for the PostAuditTask model. Used by
 * routes/api/audit/post-audit.js (Phase 7). Extracted during the
 * Batch 11 Prisma-bypass cleanup so the route does not reach into
 * prisma.postAuditTask directly.
 *
 * Visibility note: post-audit tasks are evidence attached to an
 * application's regulatory file. The route already runs each lookup
 * through `withVisibility(...)` on the parent Application before
 * touching the task row — that helper produces the where predicate the
 * caller passes here. Keeping the actual Prisma call inside this
 * service guarantees the route never hands out a task row that
 * bypassed the parent visibility check.
 *
 * Regulatory framing:
 *   - Thai PDPA Act B.E. 2562/2019 s.32 — data subjects can request
 *     restriction of processing; the visibility predicate is the
 *     route-level enforcement point. The service stays a thin
 *     pass-through so the predicate is centralised at one boundary.
 *   - ISO 27799:2016 § 7.10 (audit log tamper-evidence) — the task
 *     "documents" JSON column is append-only by convention (the route
 *     concatenates new entries onto the existing array); this service
 *     does not expose a delete or replace helper.
 */

const { prisma } = require('./prisma-database');

/**
 * Tenant-scoped lookup by id. Caller is responsible for the parent
 * application visibility check after this returns the row.
 */
async function findTaskInTenant({ id, organizationId } = {}) {
    if (!id) {return null;}
    const where = organizationId ? { id, organizationId } : { id };
    return prisma.postAuditTask.findFirst({ where });
}

/**
 * List tasks for an application. Optional status filter for the UI
 * tabs. Projection is fixed here so the route cannot widen the
 * surface area inadvertently.
 */
async function listTasksForApplication({ applicationId, status } = {}) {
    if (!applicationId) {return [];}
    const where = { applicationId };
    if (status) {
        where.status = status;
    }
    return prisma.postAuditTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            description: true,
            status: true,
            dueDate: true,
            completedAt: true,
            documents: true,
            assignedTo: true,
            createdAt: true,
        },
    });
}

/**
 * Create a task row. Caller has already verified the parent
 * application is in tenant + visible to the actor.
 */
async function createTask(data) {
    return prisma.postAuditTask.create({
        data,
        select: {
            id: true,
            applicationId: true,
            description: true,
            status: true,
            dueDate: true,
            createdAt: true,
        },
    });
}

/**
 * Update task status / completion timestamp. Returns the projected
 * row the UI uses.
 */
async function updateTask({ id, data } = {}) {
    return prisma.postAuditTask.update({
        where: { id },
        data,
        select: {
            id: true,
            status: true,
            completedAt: true,
            updatedAt: true,
        },
    });
}

/**
 * Append documents + flip status to IN_PROGRESS for the upload path.
 * Caller has assembled the merged documents array (append-only).
 */
async function appendTaskDocuments({ id, documents, updatedBy } = {}) {
    return prisma.postAuditTask.update({
        where: { id },
        data: {
            documents,
            status: 'IN_PROGRESS',
            updatedBy,
        },
        select: {
            id: true,
            status: true,
            documents: true,
        },
    });
}

/**
 * Detail view — includes the parent application slice the UI shows.
 */
async function getTaskDetailWithApplication(id) {
    return prisma.postAuditTask.findFirst({
        where: { id },
        include: {
            application: {
                select: {
                    id: true,
                    applicationNumber: true,
                },
            },
        },
    });
}

module.exports = {
    findTaskInTenant,
    listTasksForApplication,
    createTask,
    updateTask,
    appendTaskDocuments,
    getTaskDetailWithApplication,
};
