/**
 * User Group Service
 *
 * Owns read/write access for the UserGroupMembership and RoleGroup tables
 * introduced by ADR-016 Phase 1C (canonical role groups). These tables drive
 * the secondary-membership system (e.g. an auditor who also reviews
 * documents), distinct from the legacy User.role column which still acts as
 * the primary role.
 *
 * Extracted from `routes/api/provider/admin-user-groups.js` during the batch 14
 * Prisma-bypass cleanup. Soft-delete on User is enforced at the service
 * boundary so a route bug cannot accidentally add a deleted user to a group.
 * The route layer is still responsible for the canonical role normalization
 * (the `normalizeRole(...)` translation table lives in shared/canonical-rbac).
 */

'use strict';

const { prisma } = require('./prisma-database');

let _auditModule;
function _getAuditLogger() {
    if (!_auditModule) {
        try { _auditModule = require('../middleware/audit-logger'); } catch (_) { _auditModule = null; }
    }
    return _auditModule;
}

async function _auditMembershipChange({ action, actorId, userId, groupId, organizationId }) {
    const mod = _getAuditLogger();
    if (!mod || !mod.auditLogger) { return; }
    try {
        await mod.auditLogger.log({
            category: 'USER_MANAGEMENT',
            action,
            severity: mod.AuditSeverity?.WARNING || 'WARNING',
            actorId: actorId || 'SYSTEM',
            actorType: 'USER',
            resourceType: 'USER',
            resourceId: userId,
            organizationId: organizationId || null,
            metadata: { userId, groupId, assignedBy: actorId },
        });
    } catch (_) { /* audit failure must never block the primary operation */ }
}

// Replaces prisma.userGroupMembership.findMany at admin-user-groups.js:47.
async function listMembershipsForUser(userId) {
    return prisma.userGroupMembership.findMany({
        where: { userId },
        include: {
            group: {
                select: { code: true, titleTH: true, titleEN: true, isActive: true },
            },
        },
        orderBy: { assignedAt: 'asc' },
    });
}

// Replaces prisma.user.findUnique at admin-user-groups.js:77.
async function findActiveUserForMembership(userId) {
    if (!userId) {return null;}
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, organizationId: true, isDeleted: true },
    });
    // Mirror the route-level "treat soft-deleted as missing" check at one
    // place so future callers cannot widen the predicate.
    if (!user || user.isDeleted) {return null;}
    return user;
}

// Replaces prisma.roleGroup.findUnique at admin-user-groups.js:85 + :132.
async function findRoleGroupByCode(groupCode, { activeOnly = false } = {}) {
    const group = await prisma.roleGroup.findUnique({
        where: { code: groupCode },
        select: { id: true, code: true, isActive: true },
    });
    if (!group) {return null;}
    if (activeOnly && !group.isActive) {return null;}
    return group;
}

// Replaces prisma.userGroupMembership.upsert at admin-user-groups.js:93.
async function upsertMembership({ userId, groupId, organizationId, assignedBy } = {}) {
    const result = await prisma.userGroupMembership.upsert({
        where: { userId_groupId: { userId, groupId } },
        update: { isActive: true, assignedBy },
        create: {
            userId,
            groupId,
            organizationId,
            assignedBy,
            isActive: true,
        },
    });
    // Role group membership changes are security-sensitive (ISO 27001 A.9.2.2).
    // Always audit-log regardless of whether the upsert created or updated.
    await _auditMembershipChange({
        action: 'USER_GROUP_MEMBERSHIP_GRANTED',
        actorId: assignedBy,
        userId,
        groupId,
        organizationId,
    });
    return result;
}

// Replaces prisma.userGroupMembership.deleteMany at admin-user-groups.js:139.
async function deleteMembership({ userId, groupId, removedBy, organizationId } = {}) {
    const result = await prisma.userGroupMembership.deleteMany({
        where: { userId, groupId },
    });
    await _auditMembershipChange({
        action: 'USER_GROUP_MEMBERSHIP_REVOKED',
        actorId: removedBy || null,
        userId,
        groupId,
        organizationId,
    });
    return result;
}

module.exports = {
    listMembershipsForUser,
    findActiveUserForMembership,
    findRoleGroupByCode,
    upsertMembership,
    deleteMembership,
};
