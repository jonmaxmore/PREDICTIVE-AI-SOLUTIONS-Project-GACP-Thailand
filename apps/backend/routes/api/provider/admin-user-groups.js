/**
 * Routes: /api/provider/admin/user-groups/*
 *
 * Admin-only management of UserGroupMembership rows (ADR-016 Phase 1C).
 *
 *   GET    /:userId         — list a user's group memberships
 *   POST   /:userId         — add a user to a group  body: { groupCode }
 *   DELETE /:userId/:groupCode — remove a user from a group
 *
 * The migration backfills one row per user from their existing User.role,
 * so most users already have their primary group. These endpoints exist
 * to add SECONDARY memberships — the typical case being an auditor who
 * also reviews documents (i.e. add 'document_reviewer' on top of their
 * primary 'auditor' membership).
 *
 * Removing a user's only membership is allowed but discouraged — they
 * would fall back to User.role-driven access. Removing the membership
 * that matches User.role effectively does nothing (the legacy fallback
 * still grants access until User.role changes too).
 */

'use strict';

const express = require('express');
const {
    authenticateProvider,
} = require('./handlers/shared');
const { CANONICAL_ROLES, normalizeRole } = require('../../../shared/canonical-rbac');
const { respondError } = require('../../../shared/api-response');
const userGroups = require('../../../shared/user-groups');
// Batch 14 (2026-05-16): user-group membership and role-group lookups go
// through user-group-service.js so this route does not reach into the Prisma
// client directly. The route stays in charge of validation (groupCode
// normalization, admin-only middleware); the service owns the persistence.
const userGroupService = require('../../../services/user-group-service');

const router = express.Router();
router.use(authenticateProvider);

function requireAdmin(req, res, next) {
    const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        return res.status(403).json({ success: false, error: 'Admin only' });
    }
    return next();
}
router.use(requireAdmin);

router.get('/:userId', async (req, res) => {
    try {
        const memberships = await userGroupService.listMembershipsForUser(req.params.userId);
        return res.json({
            success: true,
            data: memberships.map((m) => ({
                userId: m.userId,
                groupCode: m.group.code,
                titleTH: m.group.titleTH,
                titleEN: m.group.titleEN,
                isActive: m.isActive && m.group.isActive,
                assignedAt: m.assignedAt,
                assignedBy: m.assignedBy,
            })),
        });
    } catch (e) {
        return respondError(res, req, e, { label: '[admin/user-groups] list', message: 'Failed to list user groups' });
    }
});

router.post('/:userId', async (req, res) => {
    try {
        const groupCode = normalizeRole(String(req.body?.groupCode || '').trim());
        if (!groupCode) {
            return res.status(400).json({ success: false, error: 'groupCode required' });
        }

        const user = await userGroupService.findActiveUserForMembership(req.params.userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const group = await userGroupService.findRoleGroupByCode(groupCode, { activeOnly: true });
        if (!group) {
            return res.status(404).json({ success: false, error: `Group ${groupCode} not found` });
        }

        const created = await userGroupService.upsertMembership({
            userId: user.id,
            groupId: group.id,
            organizationId: user.organizationId,
            assignedBy: req.user.id,
        });

        // Bust the in-memory cache so subsequent reads see the new
        // group-id mapping if a brand-new group was just activated.
        userGroups.clearCache();

        return res.json({
            success: true,
            data: {
                userId: created.userId,
                groupCode: group.code,
                isActive: created.isActive,
            },
        });
    } catch (e) {
        return respondError(res, req, e, { label: '[admin/user-groups] add', message: 'Failed to add user to group' });
    }
});

router.delete('/:userId/:groupCode', async (req, res) => {
    try {
        const groupCode = normalizeRole(req.params.groupCode);
        if (!groupCode) {
            return res.status(400).json({ success: false, error: 'Invalid groupCode' });
        }
        const group = await userGroupService.findRoleGroupByCode(groupCode);
        if (!group) {
            return res.status(404).json({ success: false, error: 'Group not found' });
        }
        await userGroupService.deleteMembership({
            userId: req.params.userId,
            groupId: group.id,
        });
        return res.json({ success: true });
    } catch (e) {
        return respondError(res, req, e, { label: '[admin/user-groups] delete', message: 'Failed to remove user from group' });
    }
});

module.exports = router;
