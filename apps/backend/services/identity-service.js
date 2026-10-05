/**
 * Identity Service
 *
 * Owns the per-user identity reads/writes that the MFA + consent routes
 * issued directly against `prisma.user.*`. Built for Batch 15 of the
 * prisma-bypass cleanup (2026-05-16) to replace direct prisma access in:
 *
 *   - routes/api/identity/mfa.js
 *
 * Service-boundary invariants:
 *   - Soft-delete on User is enforced (`isDeleted: false`) on every read.
 *     A deleted user must not be able to enable MFA, verify TOTP, or
 *     mark a backup code as used — those paths sit between the JWT verify
 *     gate and the auth-token issue, so the check has to live here.
 *   - Column projection is intentionally narrow per-method. Anything that
 *     does not need `twoFactorSecret` or `twoFactorBackupCodes` (e.g. the
 *     status check) MUST NOT select them — these are sensitive and a
 *     route bug that returns the result wholesale would leak the TOTP
 *     secret to the client.
 *   - There is no path here that returns `password`, `healthId`, or
 *     `providerId` in plain form. Identity resolution (e.g. for JWT
 *     issuance) goes through `user-lookup-service`, which masks those
 *     columns by default — see PDPA Sprint 6.
 */

const { prisma } = require('./prisma-database');
const { canAccountHoldSession } = require('../shared/account-status');

// Sensitive fields that may only appear in the verify-login payload.
// Kept as a single source of truth so multiple methods can't drift on
// which columns they return.
const MFA_VERIFY_USER_SELECT = Object.freeze({
    id: true,
    uuid: true,
    email: true,
    healthId: true,
    providerId: true,
    firstName: true,
    lastName: true,
    role: true,
    authType: true,
    ministryVerified: true,
    twoFactorSecret: true,
    twoFactorEnabled: true,
    twoFactorBackupCodes: true,
    // 2FA method discriminator. TOTP is the only factor since 2026-09-15; the
    // /mfa/verify handler reads this only to refuse a row still on a retired method.
    twoFactorMethod: true,
    // ADR-014 tenant claim. Without this, the MFA-completed session token
    // carried organizationId:null (claim-poorer than a normal login → an extra
    // tenant-context DB lookup on every request). User has organizationId
    // (auth.prisma model User), so select it to mint a parity session token.
    organizationId: true,
    // SECU-03: read by findUserForMfaVerify's status gate (staff vs applicant
    // rule follows `role` above) and by the route's session-epoch check on the
    // challenge. The route never echoes either.
    status: true,
    sessionsRevokedAt: true,
});

class IdentityService {
    /**
     * Replaces routes/api/identity/mfa.js:27 prisma.user.findUnique
     * Read-only MFA status check used by the security settings page —
     * returns only the `twoFactorEnabled` boolean. The TOTP secret is
     * intentionally NOT included.
     */
    async getMfaStatus(userId) {
        return prisma.user.findFirst({
            where: { id: userId, isDeleted: false },
            // The email column is not read: it only served the email-2FA enrol
            // page, retired 2026-09-15 (no email in the system).
            select: { twoFactorEnabled: true },
        });
    }

    /**
     * Replaces routes/api/identity/mfa.js:55 prisma.user.update
     * Stores a pending TOTP secret during /setup. `twoFactorEnabled` is
     * explicitly set to false so an interrupted setup cannot leave a row
     * in a half-enabled state.
     */
    async storePendingTotpSecret(userId, secret) {
        return prisma.user.update({
            where: { id: userId },
            data: {
                twoFactorSecret: secret,
                twoFactorEnabled: false,
            },
        });
    }

    /**
     * Replaces routes/api/identity/mfa.js:106 prisma.user.findUnique
     * Fetches the pending TOTP secret during /verify-setup. Returns ONLY
     * `twoFactorSecret` — the caller validates it with the verifier
     * service and does not need any other column.
     */
    async findPendingTotpSecret(userId) {
        return prisma.user.findFirst({
            where: { id: userId, isDeleted: false },
            select: { twoFactorSecret: true },
        });
    }

    /**
     * Replaces routes/api/identity/mfa.js:149 prisma.user.update
     * Activate MFA after successful /verify-setup and persist the hashed
     * backup codes. The Json column accepts a native array — DO NOT
     * JSON.stringify here (Tier 2 HIGH-1 anti-regression, see route
     * comment).
     */
    async enableMfaWithBackupCodes(userId, hashedBackupCodes) {
        return prisma.user.update({
            where: { id: userId },
            data: {
                twoFactorEnabled: true,
                twoFactorMethod: 'TOTP', // explicit — the only method there is (operator 2026-09-15)
                twoFactorBackupCodes: hashedBackupCodes,
            },
        });
    }

    /**
     * Re-enrol an ENABLED second factor (2026-09-26): swap in the new TOTP secret
     * and its fresh backup codes in ONE write, after /verify-setup confirmed a code
     * from the new secret. Until this runs the old secret stays the live factor.
     * `sessionsRevokedAt` (round 5) rides on the same write so the other sessions
     * are signed out exactly when the factor changes.
     */
    async replaceTotpSecretWithBackupCodes(userId, secret, hashedBackupCodes, { sessionsRevokedAt } = {}) {
        return prisma.user.update({
            where: { id: userId },
            data: {
                twoFactorSecret: secret,
                twoFactorEnabled: true,
                twoFactorMethod: 'TOTP',
                twoFactorBackupCodes: hashedBackupCodes,
                ...(sessionsRevokedAt ? { sessionsRevokedAt } : {}),
            },
        });
    }

    /**
     * Replaces routes/api/identity/mfa.js:276 prisma.user.findUnique
     * Full identity slice used after a successful MFA verify so the
     * route can issue auth tokens + return the safe user payload.
     * Soft-deleted users get null so the route falls through to the
     * "MFA not enabled" branch — preferable to a 500.
     * SECU-03: so do disabled / suspended accounts — a challenge issued just
     * before an admin disabled the account must not complete into a session.
     * The status rule is applied here in JS rather than as a Prisma `in`
     * filter: that filter is case-sensitive, while login() (the same shared
     * rule) upper-cases — a legacy lowercase 'active' row got the challenge
     * and then could never complete it.
     */
    async findUserForMfaVerify(userId) {
        const user = await prisma.user.findFirst({
            where: { id: userId, isDeleted: false },
            select: MFA_VERIFY_USER_SELECT,
        });
        return canAccountHoldSession(user) ? user : null;
    }

    /**
     * Replaces routes/api/identity/mfa.js:320 prisma.user.update
     * Persist the remaining backup-code array after one is consumed
     * during /verify. Caller already removed the used index.
     */
    async updateBackupCodes(userId, backupCodes) {
        return prisma.user.update({
            where: { id: userId },
            data: { twoFactorBackupCodes: backupCodes },
        });
    }

    /**
     * Replaces routes/api/identity/mfa.js:391 prisma.user.update
     * Last-login timestamp bump after a successful MFA verify completes
     * the auth flow.
     */
    async touchLastLogin(userId) {
        return prisma.user.update({
            where: { id: userId },
            data: { lastLoginAt: new Date() },
        });
    }

    /**
     * Replaces routes/api/identity/mfa.js:434 prisma.user.findUnique
     * Pre-disable check — returns just enough to verify the current TOTP
     * code and confirm MFA is actually active. No backup-code column.
     */
    async findMfaSecretForDisable(userId) {
        return prisma.user.findFirst({
            where: { id: userId, isDeleted: false },
            // /disable decides on the TOTP seed alone: a row without one cannot
            // prove a code, whatever method it still names.
            select: { twoFactorSecret: true, twoFactorEnabled: true },
        });
    }

    /**
     * Replaces routes/api/identity/mfa.js:457 prisma.user.update
     * Disables MFA and wipes the TOTP secret + backup codes. Caller has
     * already verified the supplied code.
     */
    async disableMfa(userId) {
        return prisma.user.update({
            where: { id: userId },
            data: {
                twoFactorEnabled: false,
                twoFactorMethod: 'TOTP', // reset the discriminator to the default
                twoFactorSecret: null,
                twoFactorBackupCodes: null,
            },
        });
    }
}

module.exports = new IdentityService();
