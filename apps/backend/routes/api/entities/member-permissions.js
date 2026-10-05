/**
 * Routes: /api/entities/:id/members/:memberUserId/permissions*
 *
 * Farm-worker Wave B chunk 5 — OWNER-only per-member farm-operation
 * permission administration. Mirrors the Wave-2 provider admin surface
 * (routes/api/admin/user-permissions.js) on the entity dimension:
 *
 *   GET    /                → role, rolePermissions, legacyPermissions,
 *                             grants, effective + farm-operation catalog
 *   PUT    /                → body { permission, effect, reason? } — upsert
 *   DELETE /:permission     → revert to inherit (idempotent)
 *
 * Guards (owner decisions, binding plan 2026-07-02):
 *   - requester must hold the entity's OWNER membership — NOT ADMIN
 *     (stricter than the Wave-2 pattern, per owner decision)
 *   - self-guard on writes: the OWNER cannot edit their own grants →
 *     403 SELF_PERMISSION_CHANGE_FORBIDDEN (code reused from Wave 2)
 *   - target must be an ACTIVE member of the entity → 404 otherwise
 *   - only the FARM-OPERATION taxonomy is grantable (workspace-management
 *     codes such as INVITE_MEMBER stay role-bound in v1) → 400 INVALID_PERMISSION
 *   - tenant scope: requester + target resolve on the SAME entity; the
 *     grant row mirrors the membership's organizationId (ADR-014)
 *
 * Writes are transactional with their EntityMembershipEvent audit row
 * (ENTITY_PERMISSION_GRANTED / _REVOKED / _RESET — same convention as
 * addMember/revokeMember) and return the fresh GET payload so the FE
 * matrix re-renders without a second round-trip.
 */

'use strict';

const express = require('express');
// mergeParams: the parent mounts this at /:id/members/:memberUserId/permissions.
const router = express.Router({ mergeParams: true });

const { authenticateAny } = require('../../../middleware/auth-middleware');
const { safeErrorMessage } = require('../../../shared/api-response');
const { getRequestIp } = require('../../../utils/client-ip');
const entityService = require('../../../services/entity-service');
const {
    isGrantableFarmOperation,
    getEffectiveEntityPermissions,
} = require('../../../services/entity-effective-permissions-service');
const { prisma } = require('../../../services/prisma-database');
const logger = require('../../../shared/logger');

const VALID_EFFECTS = new Set(['GRANT', 'REVOKE']);

// S10 — reason bounds. Reason stays OPTIONAL here (unlike the Wave-2
// provider surface, where it is mandatory), but WHEN PROVIDED it must be a
// real justification: trimmed length >= 5 (the sibling admin surface's
// MIN_REASON_LENGTH) and <= 500 (storage/abuse cap).
const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 500;

/**
 * Thai labels for the grantable farm-operation codes — the FE matrix rows.
 * A code without a label falls back to its raw key so a newly-added
 * permission never crashes the catalog build (Wave-2 convention).
 */
const PERMISSION_LABELS = Object.freeze({
    FARM_CREATE: 'สร้างฟาร์ม',
    EDIT_FARM: 'แก้ไขข้อมูลฟาร์ม',
    CYCLE_CREATE: 'สร้างรอบปลูก/จัดการแปลง',
    UNIT_MANAGE: 'ลงแปลงปลูก/จัดการต้นปลูก',
    ACTIVITY_IRRIGATION: 'บันทึกการรดน้ำ',
    ACTIVITY_FERTILIZER: 'บันทึกการใส่ปุ๋ย',
    ACTIVITY_PEST_CONTROL: 'บันทึกการกำจัดศัตรูพืช',
    ACTIVITY_WEED_CONTROL: 'บันทึกการกำจัดวัชพืช',
    ACTIVITY_INSPECTION: 'บันทึกการตรวจแปลง',
    ACTIVITY_INCIDENT: 'บันทึกเหตุการณ์ผิดปกติ',
    ACTIVITY_OTHER: 'บันทึกกิจกรรมอื่น ๆ',
    HARVEST_RECORD: 'บันทึกการเก็บเกี่ยว',
    QR_GENERATE: 'สร้าง QR แปลงปลูก',
    RECORDS_MANAGE: 'จัดการบันทึกฟาร์ม (วิเคราะห์พื้นที่/อบรม)',
    REPORT_SUBMIT: 'ส่งรายงาน',
});

function buildCatalog() {
    return entityService.FARM_OPERATION_CAPABILITIES.map((key) => ({
        key,
        label: PERMISSION_LABELS[key] || key,
    }));
}

function getUserAgent(req) {
    const ua = req.headers['user-agent'];
    return ua ? String(ua) : null;
}

/**
 * Shared guard chain. Resolves and validates:
 *   requester is a member (404) + is OWNER (403) + target is an ACTIVE
 *   member (404). Returns { entityId, memberUserId, target } or null after
 *   having written the response.
 */
async function resolveGuards(req, res, { selfGuard }) {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return null;
    }

    const entityId = String(req.params.id || '').trim();
    const memberUserId = String(req.params.memberUserId || '').trim();

    // Self-guard first for writes — the OWNER editing their own grid is
    // self-escalation / self-lockout regardless of anything else.
    if (selfGuard && memberUserId === userId) {
        res.status(403).json({
            success: false,
            code: 'SELF_PERMISSION_CHANGE_FORBIDDEN',
            error: 'An owner cannot change their own permissions',
        });
        return null;
    }

    // Requester must be a member (404, never 403 — no entity probing) …
    const found = await entityService.getEntityForMember({ entityId, userId });
    if (!found) {
        res.status(404).json({ success: false, error: 'Not Found' });
        return null;
    }
    // … and specifically the OWNER (owner decision: NOT ADMIN).
    if (found.membership.role !== 'OWNER') {
        res.status(403).json({
            success: false,
            code: 'FORBIDDEN',
            error: 'Only the entity OWNER can manage member permissions',
        });
        return null;
    }

    // Target must be an ACTIVE member of THIS entity.
    const target = await prisma.entityMembership.findUnique({
        where: { userId_entityId: { userId: memberUserId, entityId } },
    });
    if (!target || target.status !== 'ACTIVE') {
        res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Member not found' });
        return null;
    }

    return { entityId, memberUserId, target };
}

/**
 * The GET payload — also returned by both writes (fresh state).
 */
async function buildPayload(entityId, memberUserId, target) {
    const {
        rolePermissions, legacyPermissions, grants, effective,
    } = await getEffectiveEntityPermissions({
        membershipId: target.id,
        role: target.role,
        basePermissions: target.permissions || [],
        prisma,
    });
    return {
        entityId,
        userId: memberUserId,
        membershipId: target.id,
        role: target.role,
        rolePermissions,
        legacyPermissions,
        grants,
        effective,
        catalog: buildCatalog(),
    };
}

// ── GET / ──────────────────────────────────────────────────────────────────
router.get('/', authenticateAny, async (req, res) => {
    try {
        const ctx = await resolveGuards(req, res, { selfGuard: false });
        if (!ctx) {return undefined;}
        const payload = await buildPayload(ctx.entityId, ctx.memberUserId, ctx.target);
        return res.json({ success: true, data: payload });
    } catch (error) {
        logger.error('[Entities MemberPermissions] read failed:', error?.message);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// ── PUT / ──────────────────────────────────────────────────────────────────
router.put('/', authenticateAny, async (req, res) => {
    try {
        const permission = String(req.body?.permission || '').trim();
        const effect = String(req.body?.effect || '').trim().toUpperCase();
        const reason = String(req.body?.reason || '').trim() || null;

        // Validate BEFORE the guards resolve anything (cheap-first, no info
        // leak — Wave-2 convention). Only the farm-operation taxonomy is
        // grantable; workspace-management codes stay role-bound in v1.
        if (!isGrantableFarmOperation(permission)) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PERMISSION',
                error: `Permission is not a grantable farm-operation code: ${permission || '(empty)'}`,
            });
        }
        if (!VALID_EFFECTS.has(effect)) {
            return res.status(400).json({
                success: false,
                code: 'VALIDATION_ERROR',
                error: "effect must be 'GRANT' or 'REVOKE'",
            });
        }
        // S10 — bound the optional reason (>= 5 trimmed chars when provided,
        // capped at 500) BEFORE the guards resolve anything.
        if (reason !== null && (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH)) {
            return res.status(400).json({
                success: false,
                code: 'VALIDATION_ERROR',
                error: `reason, when provided, must be ${MIN_REASON_LENGTH}-${MAX_REASON_LENGTH} characters`,
            });
        }

        const ctx = await resolveGuards(req, res, { selfGuard: true });
        if (!ctx) {return undefined;}

        await entityService.setMemberPermissionGrant({
            entityId: ctx.entityId,
            targetUserId: ctx.memberUserId,
            permission,
            effect,
            reason,
            actorUserId: req.user.id,
            ipAddress: getRequestIp(req),
            userAgent: getUserAgent(req),
        });

        // Re-read the target so the payload reflects the write.
        const fresh = await prisma.entityMembership.findUnique({
            where: { userId_entityId: { userId: ctx.memberUserId, entityId: ctx.entityId } },
        });
        const payload = await buildPayload(ctx.entityId, ctx.memberUserId, fresh || ctx.target);
        return res.json({ success: true, data: payload });
    } catch (error) {
        if (error?.code === 'TARGET_NOT_MEMBER') {
            return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Member not found' });
        }
        logger.error('[Entities MemberPermissions] write failed:', error?.message);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// ── DELETE /:permission ─────────────────────────────────────────────────────
router.delete('/:permission', authenticateAny, async (req, res) => {
    try {
        const permission = String(req.params.permission || '').trim();
        if (!isGrantableFarmOperation(permission)) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PERMISSION',
                error: `Permission is not a grantable farm-operation code: ${permission || '(empty)'}`,
            });
        }

        const ctx = await resolveGuards(req, res, { selfGuard: true });
        if (!ctx) {return undefined;}

        await entityService.resetMemberPermissionGrant({
            entityId: ctx.entityId,
            targetUserId: ctx.memberUserId,
            permission,
            actorUserId: req.user.id,
            ipAddress: getRequestIp(req),
            userAgent: getUserAgent(req),
        });

        const fresh = await prisma.entityMembership.findUnique({
            where: { userId_entityId: { userId: ctx.memberUserId, entityId: ctx.entityId } },
        });
        const payload = await buildPayload(ctx.entityId, ctx.memberUserId, fresh || ctx.target);
        return res.json({ success: true, data: payload });
    } catch (error) {
        if (error?.code === 'TARGET_NOT_MEMBER') {
            return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Member not found' });
        }
        logger.error('[Entities MemberPermissions] reset failed:', error?.message);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

module.exports = router;
