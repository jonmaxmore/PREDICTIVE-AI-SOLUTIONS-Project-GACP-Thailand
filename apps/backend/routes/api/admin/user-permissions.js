/**
 * Routes: /api/admin/user-permissions/*
 *
 * Per-user permission GRANT / REVOKE administration (ERP additive-override
 * model). A tenant ADMIN can layer a per-user grant on top of the role
 * baseline WITHOUT changing the user's role:
 *
 *   effective(user) = ROLE_PERMISSIONS[role] ∪ {GRANTs} − {REVOKEs}
 *
 * The engine (services/effective-permissions-service.js) owns the math; this
 * route only validates the input, tenant-scopes the target, persists the
 * grant row, and audits the change. Grants are read LIVE per request (NOT
 * baked into the JWT) so a change takes effect on the very NEXT request —
 * hence NO session-epoch bump here (unlike a role change).
 *
 *   GET    /:userId               — role, rolePermissions, grants, effective,
 *                                    and the full permission catalog (Thai labels)
 *   PUT    /:userId/:permission    — upsert a { effect, reason } grant row
 *   DELETE /:userId/:permission    — revert to inherit (delete the grant row)
 *
 * Auth: inherits authenticateProvider + requireAdmin from the parent admin
 * router (routes/api/admin/index.js). No second per-route gate is added — the
 * parent chain already restricts the whole surface to canonical ADMIN.
 *
 * Guards:
 *   - Self-guard: an admin editing their OWN permissions is privilege
 *     self-escalation / self-lockout → 403 SELF_PERMISSION_CHANGE_FORBIDDEN.
 *   - Tenant-scope: getActiveAdminUserGuard(userId, { organizationId }) 404s a
 *     cross-tenant target before any mutation. NOTE (adversarial-verify F5):
 *     this whole surface sits behind require-admin (admin/index.js), which
 *     admits ONLY the tenant ADMIN role — PLATFORM_ADMIN normalizes to
 *     'platform_admin' and is 403'd upstream, so the guardScope PLATFORM_ADMIN
 *     branch below is defensive parity only (dead today); cross-tenant grants
 *     are impossible by construction.
 */

'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../../../shared/logger');
const { getRequestIp } = require('../../../utils/client-ip');
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
} = require('../../../middleware/audit-logger');
const {
    PERMISSIONS,
    normalizeRole,
    CANONICAL_ROLES,
} = require('../../../shared/canonical-rbac');
const {
    PERMISSION_VALUES,
    isValidPermission,
    getEffectivePermissions,
} = require('../../../services/effective-permissions-service');
const { getActiveAdminUserGuard } = require('../../../services/provider-user-service');
const { prisma } = require('../../../services/prisma-database');

const VALID_EFFECTS = new Set(['GRANT', 'REVOKE']);
const MIN_REASON_LENGTH = 5;

/**
 * Thai labels for every canonical PERMISSIONS value. Keyed by the permission
 * STRING (e.g. 'report.export') so the map stays in lock-step with the engine's
 * PERMISSION_VALUES array. A permission without an explicit label falls back to
 * its raw key (so a newly-added permission never crashes the catalog build).
 */
const PERMISSION_LABELS = Object.freeze({
    [PERMISSIONS.APPLICATION_SUBMIT]: 'ยื่นใบสมัคร',
    [PERMISSIONS.APPLICATION_VIEW_SELF]: 'ดูใบสมัครของตนเอง',
    [PERMISSIONS.APPLICATION_VIEW_ALL]: 'ดูใบสมัครทั้งหมด',
    [PERMISSIONS.APPLICATION_DOC_REVIEW]: 'ตรวจเอกสารใบสมัคร',
    [PERMISSIONS.APPLICATION_SCHEDULE]: 'จัดตารางนัดหมาย/มอบหมายงาน',
    [PERMISSIONS.APPLICATION_AUDIT_RECORD]: 'บันทึกผลการตรวจประเมิน',
    [PERMISSIONS.APPLICATION_WORKFLOW_TRANSITION]: 'เปลี่ยนสถานะใบสมัคร (workflow)',
    [PERMISSIONS.USERS_MANAGE]: 'จัดการผู้ใช้งาน',
    [PERMISSIONS.MASTER_DATA_MANAGE]: 'จัดการข้อมูลหลัก (master data)',
    [PERMISSIONS.ACCOUNTING_DASHBOARD_READ]: 'ดูแดชบอร์ดบัญชี',
    [PERMISSIONS.INVOICE_VIEW_ALL]: 'ดูใบแจ้งหนี้ทั้งหมด',
    [PERMISSIONS.RECEIPT_ISSUE]: 'ออกใบเสร็จ/ใบกำกับภาษี',
    [PERMISSIONS.REPORT_EXPORT]: 'ส่งออกรายงาน',
    [PERMISSIONS.AUDIT_TIMELINE_READ]: 'ดูไทม์ไลน์การตรวจสอบ',
    [PERMISSIONS.AUDIT_SUBMIT]: 'ส่งผลการตรวจสอบ',
    [PERMISSIONS.APPLICATION_OVERRIDE]: 'แก้ไข/บังคับสถานะใบสมัคร (admin)',
    [PERMISSIONS.BANK_ACCOUNT_READ_ALL]: 'ดูบัญชีธนาคารทั้งหมด',
    [PERMISSIONS.BANK_ACCOUNT_MANAGE]: 'จัดการบัญชีธนาคาร',
    [PERMISSIONS.PAYMENT_SLIP_READ_ALL]: 'ดูสลิปการชำระเงินทั้งหมด',
    [PERMISSIONS.PAYMENT_SLIP_REVIEW]: 'ตรวจสลิป (ทั่วไป, legacy)',
    [PERMISSIONS.PAYMENT_SLIP_REVIEW_DTAM]: 'ตรวจสลิปฝั่งรัฐ (DTAM)',
    [PERMISSIONS.PAYMENT_SLIP_REVIEW_PLATFORM]: 'ตรวจสลิปฝั่งแพลตฟอร์ม',
    [PERMISSIONS.PAYMENT_SLIP_REVIEW_ANY]: 'ตรวจสลิปได้ทุกฝั่ง (break-glass)',
    [PERMISSIONS.PAYMENT_SLIP_READ_OWN]: 'ดูสลิปของตนเอง',
});

/**
 * The full permission catalog the FE renders as matrix rows.
 * @returns {Array<{ key: string, label: string }>}
 */
function buildCatalog() {
    return PERMISSION_VALUES.map((key) => ({
        key,
        label: PERMISSION_LABELS[key] || key,
    }));
}

/**
 * PLATFORM_ADMIN is the only cross-tenant role. Every other caller here is a
 * tenant ADMIN whose target lookup must be scoped to their own org (a
 * cross-tenant id then 404s before any mutation). Mirrors admin/users.js.
 */
function guardScope(req) {
    const canonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM) {
        return {};
    }
    return { organizationId: req.user?.organizationId };
}

/**
 * Compute the fresh GET payload for a target user. Reused by GET + the write
 * routes (which return it so the FE re-renders without a second round-trip).
 * The engine receives the (possibly-mocked) prisma so its grant read is one
 * DB hit and the additive-override math lives in one place.
 */
async function buildPayload(target) {
    const canonicalRole = normalizeRole(target.role) || CANONICAL_ROLES.HEALTH;
    const { rolePermissions, grants, effective } = await getEffectivePermissions({
        role: target.role,
        userId: target.id,
        prisma,
    });
    return {
        userId: target.id,
        role: canonicalRole,
        rolePermissions,
        grants,
        effective,
        catalog: buildCatalog(),
    };
}

async function writePermissionAudit(req, action, targetUserId, metadata) {
    try {
        await auditLogger.log({
            category: AuditCategory.ADMIN,
            action,
            severity: AuditSeverity.WARNING,
            actorId: req.user?.id || 'SYSTEM',
            actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
            actorType: 'ADMIN',
            resourceType: ResourceType.USER,
            resourceId: targetUserId,
            ipAddress: getRequestIp(req),
            userAgent: req.get('user-agent'),
            metadata,
        });
    } catch (_error) {
        // Best-effort audit only — mirrors admin/users.writeAdminUserAudit.
    }
}

// ── GET /:userId ─────────────────────────────────────────────────────────
router.get('/:userId', async (req, res) => {
    try {
        const target = await getActiveAdminUserGuard(req.params.userId, guardScope(req));
        if (!target) {
            return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'User not found' });
        }
        const payload = await buildPayload(target);
        return res.json({ success: true, data: payload });
    } catch (error) {
        logger.error('[admin/user-permissions] read failed:', error?.message);
        return res.status(500).json({ success: false, error: 'Failed to load user permissions' });
    }
});

// ── PUT /:userId/:permission ───────────────────────────────────────────────
router.put('/:userId/:permission', async (req, res) => {
    try {
        const { userId, permission } = req.params;
        const effect = String(req.body?.effect || '').trim().toUpperCase();
        const reason = String(req.body?.reason || '').trim();

        // Validate BEFORE the self/tenant guard so a malformed request never
        // even resolves the target (cheap-first + no info leak).
        if (!isValidPermission(permission)) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PERMISSION',
                error: `Unknown permission: ${permission}`,
            });
        }
        if (!VALID_EFFECTS.has(effect)) {
            return res.status(400).json({
                success: false,
                code: 'VALIDATION_ERROR',
                error: "effect must be 'GRANT' or 'REVOKE'",
            });
        }
        if (reason.length < MIN_REASON_LENGTH) {
            return res.status(400).json({
                success: false,
                code: 'VALIDATION_ERROR',
                error: `reason is required (minimum ${MIN_REASON_LENGTH} characters)`,
            });
        }

        // Self-guard: an admin cannot alter their OWN permission grid
        // (privilege self-escalation / self-lockout).
        if (userId === req.user?.id) {
            return res.status(403).json({
                success: false,
                code: 'SELF_PERMISSION_CHANGE_FORBIDDEN',
                error: 'An admin cannot change their own permissions',
            });
        }

        const target = await getActiveAdminUserGuard(userId, guardScope(req));
        if (!target) {
            return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'User not found' });
        }

        // Capture the prior grant for the audit "before" (inherit if none).
        let before = 'inherit';
        try {
            const prior = await prisma.userPermissionGrant.findUnique({
                where: { userId_permission: { userId, permission } },
            });
            if (prior) {
                before = prior.effect;
            }
        } catch (_e) {
            // Non-fatal: audit "before" degrades to inherit if the read fails.
        }

        await prisma.userPermissionGrant.upsert({
            where: { userId_permission: { userId, permission } },
            update: { effect, reason, grantedBy: req.user?.id || null },
            create: {
                userId,
                permission,
                effect,
                reason,
                grantedBy: req.user?.id || null,
                organizationId: target.organizationId,
            },
        });

        await writePermissionAudit(
            req,
            effect === 'GRANT' ? 'USER_PERMISSION_GRANTED' : 'USER_PERMISSION_REVOKED',
            userId,
            { permission, effect, reason, before, after: effect },
        );

        const payload = await buildPayload(target);
        return res.json({ success: true, data: payload });
    } catch (error) {
        logger.error('[admin/user-permissions] write failed:', error?.message);
        return res.status(500).json({ success: false, error: 'Failed to update user permission' });
    }
});

// ── DELETE /:userId/:permission ─────────────────────────────────────────────
router.delete('/:userId/:permission', async (req, res) => {
    try {
        const { userId, permission } = req.params;

        if (!isValidPermission(permission)) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PERMISSION',
                error: `Unknown permission: ${permission}`,
            });
        }

        // Self-guard mirrors PUT — an admin cannot reset their own grid.
        if (userId === req.user?.id) {
            return res.status(403).json({
                success: false,
                code: 'SELF_PERMISSION_CHANGE_FORBIDDEN',
                error: 'An admin cannot change their own permissions',
            });
        }

        const target = await getActiveAdminUserGuard(userId, guardScope(req));
        if (!target) {
            return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'User not found' });
        }

        try {
            await prisma.userPermissionGrant.delete({
                where: { userId_permission: { userId, permission } },
            });
        } catch (err) {
            // P2025 = row already absent. Reverting to inherit is idempotent:
            // "no grant" IS the target state, so treat as success.
            if (err && err.code !== 'P2025') {
                throw err;
            }
        }

        await writePermissionAudit(req, 'USER_PERMISSION_RESET', userId, {
            permission,
            effect: 'INHERIT',
            after: 'inherit',
        });

        const payload = await buildPayload(target);
        return res.json({ success: true, data: payload });
    } catch (error) {
        logger.error('[admin/user-permissions] reset failed:', error?.message);
        return res.status(500).json({ success: false, error: 'Failed to reset user permission' });
    }
});

module.exports = router;
