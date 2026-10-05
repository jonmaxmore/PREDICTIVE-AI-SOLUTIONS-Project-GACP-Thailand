'use strict';

/**
 * @module services/onsite-audit-resolver
 *
 * Single source of the applicationId -> AuditChecklist.id resolution the
 * onsite evidence flow keys off. The cert gate (onsite-evidence-gate.js) and
 * the inspect /context route both call this so they can never diverge.
 *
 * Preference order for a PASS/cert-mint/inspect happening NOW:
 *   1. the IN_PROGRESS row (the audit currently being executed)
 *   2. otherwise the most-recently-created row of any status (CAR / re-audit)
 * Soft-deleted rows are never returned. organizationId is a defense-in-depth
 * filter applied ONLY when the caller supplies one (the gate passes none, so
 * the gate stays behavior-identical — spec §2).
 *
 * @param {object} prisma           prisma client OR tx handle
 * @param {string} applicationId
 * @param {object} [opts]
 * @param {string} [opts.organizationId]
 * @returns {Promise<string|null>}  AuditChecklist.id, or null
 */
async function resolveCurrentOnsiteAuditId(prisma, applicationId, { organizationId } = {}) {
    if (!prisma || typeof prisma.auditChecklist?.findFirst !== 'function') { return null; }
    if (!applicationId) { return null; }

    const baseWhere = { applicationId, isDeleted: false };
    if (organizationId) { baseWhere.organizationId = organizationId; }

    const inProgress = await prisma.auditChecklist.findFirst({
        where: { ...baseWhere, status: 'IN_PROGRESS' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    });
    if (inProgress) { return inProgress.id; }

    const latest = await prisma.auditChecklist.findFirst({
        where: baseWhere,
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    });
    return latest ? latest.id : null;
}

module.exports = { resolveCurrentOnsiteAuditId };
