/**
 * Password Management Helpers
 *
 * Extracted from prisma-auth-service.js to reduce file size.
 * Handles: changePassword
 *
 * ไม่มีการรีเซ็ตรหัสผ่านไม่ว่ารูปแบบใด
 * - มติ operator 2026-09-16: ไม่มีระบบลืมรหัสผ่าน ไม่ว่าทางอีเมลหรือ SMS (requestPasswordReset ถูกถอด)
 * - มติ operator 2026-09-17 "เราไม่มีการกู้บัญชี": resetPasswordWithToken ซึ่งใช้ token ที่เจ้าหน้าที่
 *   ออกให้ ถูกถอดพร้อม route ทั้งสองปลาย การเปลี่ยนรหัสผ่านต้องรู้รหัสเดิมเสมอ
 *
 * @module services/auth/password-management
 */

const bcrypt = require('bcryptjs');
const { prisma } = require('../prisma-database');
const { sessionEpochStamp } = require('../../utils/session-epoch');
const { createLogger } = require('../../shared/logger');
const { validatePasswordStrength } = require('../../utils/password-policy');

const logger = createLogger('auth-password');
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

// Wrong CURRENT passwords count per account on the SAME columns the two login
// doors use (loginAttempts / isLocked / lockedUntil), with the same threshold:
// 5 failures lock the account for 15 minutes (prisma-auth-service.js login,
// provider-user-service.js PROVIDER_MAX_LOGIN_ATTEMPTS / PROVIDER_LOCKOUT_MINUTES).
// Security re-review 2026-09-26 (round 2, LOW): the change-password limiter is
// per IP, so a stolen session could keep guessing from new addresses. One
// counter, not two: guessing here locks sign-in too, the way guessing at the
// login door does.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function lockedError(lockedUntil) {
    const minutes = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60000));
    const err = new Error(`Account locked. Try again in ${minutes} minutes.`);
    err.code = 'ACCOUNT_LOCKED';
    err.lockedUntil = lockedUntil;
    return err;
}

/**
 * Change password for an authenticated user.
 * @param {string} userId
 * @param {string} oldPassword
 * @param {string} newPassword
 * @returns {Promise<boolean>}
 */
async function changePassword(userId, oldPassword, newPassword) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        logger.info('[Password] User not found');
        throw new Error('Invalid credentials');
    }
    if (user.healthId && user.providerId) {
        throw new Error('Identity conflict: account has both healthId and providerId');
    }
    const now = Date.now();
    const lockActive = Boolean(user.isLocked && user.lockedUntil && now < new Date(user.lockedUntil).getTime());
    if (lockActive) {
        // Refused before the compare: while locked, even the right password changes nothing.
        throw lockedError(user.lockedUntil);
    }
    const lockExpired = Boolean(user.isLocked && user.lockedUntil && !lockActive);
    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
        const failedAttempts = (lockExpired ? 0 : (user.loginAttempts || 0)) + 1;
        const locks = failedAttempts >= MAX_FAILED_ATTEMPTS;
        const lockedUntil = locks ? new Date(now + LOCKOUT_MINUTES * 60 * 1000) : null;
        await prisma.user.update({
            where: { id: userId },
            data: {
                loginAttempts: failedAttempts,
                isLocked: locks,
                lockedUntil,
            },
        });
        const err = locks ? lockedError(lockedUntil) : new Error('รหัสผ่านเดิมไม่ถูกต้อง');
        err.failedAttempts = failedAttempts;
        throw err;
    }
    // Strong-password backstop (owner directive 2026-06-11) — mirrors the
    // route-level changePasswordSchema → passwordField for any direct caller.
    const { valid, errors } = validatePasswordStrength(newPassword);
    if (!valid) {
        throw new Error(errors[0] || 'รหัสผ่านไม่ผ่านเกณฑ์ความปลอดภัย');
    }
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await prisma.user.update({
        where: { id: userId },
        // BE-AUTH-03-03 (session epoch): stamp the revocation instant on the SAME
        // update that rotates the hash. Any refresh/access token whose `iat`
        // predates this is rejected at /refresh + auth-middleware — so a stolen
        // token can't outlive the password even if its JTI was never blocklisted.
        // This is the durable backstop for the best-effort revokeAllUserTokens
        // below (which only clears the per-user allowlist key).
        // The right current password clears the failure count, as a login does.
        data: {
            password: hashedPassword,
            sessionsRevokedAt: sessionEpochStamp(),
            loginAttempts: 0,
            isLocked: false,
            lockedUntil: null,
        },
    });
    // BE-AUTH-03-02: revoke all existing sessions/refresh-tokens after a password
    // change so a stolen token can't outlive the password. Best-effort (the
    // service itself fails OPEN); never block the password change on revoke.
    // A half-finished move of the 2FA to a new device dies with the old password.
    await require('./mfa-reenrol-store').clear(userId, 'password-change');
    try {
        await require('../token-revocation-service').revokeAllUserTokens(userId);
    } catch (revokeErr) {
        logger.error(`[Password] session revoke after change failed for ${userId}: ${revokeErr?.message}`);
    }
    return true;
}

module.exports = { changePassword };
