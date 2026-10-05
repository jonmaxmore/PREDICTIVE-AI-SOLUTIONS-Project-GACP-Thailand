/**
 * Helpers for admin-only user lifecycle actions (Wave B Phase 55 / G6).
 *
 * Pure functions extracted from the route handlers so unit tests can
 * exercise them without dragging in Prisma or the audit logger.
 *
 * The force-password-reset builders (hashResetToken, generateResetToken,
 * buildForceResetPayload) were removed 2026-09-17 with the route that used
 * them — operator: "เราไม่มีการกู้บัญชี" (there is no account recovery).
 * buildDisableTwoFactorPayload went 2026-09-26 with POST /:id/disable-2fa
 * (operator: "ถอดทั้งสองประตู" — no one clears another account's 2FA).
 */

const { CANONICAL_ROLES, normalizeRole } = require('../../../../shared/canonical-rbac');

/**
 * Build the Prisma update payload for "unlock account": clears the
 * lock flag, reset attempt counter, and lock-until timestamp. Mirrors
 * the auto-unlock that happens in prisma-auth-service on next login.
 */
function buildUnlockPayload(actorId) {
    return {
        isLocked: false,
        lockedUntil: null,
        loginAttempts: 0,
        updatedBy: actorId || null,
        updatedAt: new Date(),
    };
}

/**
 * Decide whether the caller is allowed to perform admin user actions.
 * Mirrors the role check in PATCH/PUT/DELETE /:id elsewhere in this
 * file: only admin/super_admin roles.
 */
/**
 * ผู้เรียกเป็นผู้ดูแลระบบหรือไม่ (ปลดล็อกบัญชี)
 *
 * เดิมเทียบกับคำ `'admin'` / `'super_admin'` ตรง ๆ · หลังเปลี่ยนคำศัพท์ 2026-09-10
 * การเทียบแบบนั้นเป็นเท็จเสมอ ⇒ ผู้ดูแลปลดล็อกบัญชีใครไม่ได้เลย (403 ทุกครั้ง)
 * โดยไม่มี error ให้เห็นว่าเป็นเพราะคำ ไม่ใช่เพราะสิทธิ์
 */
function isAdminCaller(role) {
    const normalized = normalizeRole(role);
    return normalized === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM
        || normalized === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM;
}

module.exports = {
    buildUnlockPayload,
    isAdminCaller,
};
