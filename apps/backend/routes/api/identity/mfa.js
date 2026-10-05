/**
 * MFA API Routes (V2)
 * For provider accounts (User model with providerId identity)
 * Prisma Implementation
 */

const express = require('express');
const router = express.Router();
const { mfaService } = require('../../../middleware/mfa-service');
// ยามของด่านลงทะเบียน: รับตั๋ว purpose='mfa_setup' ที่ประตูล็อกอินยื่นให้ หรือ session ปกติ
// ถ้าใช้ยามของ session อย่างเดียว คนที่ยังไม่ได้ลงทะเบียนจะไม่มีทางลงทะเบียนได้เลย
const { authenticateForMfaSetup } = require('../../../middleware/mfa-setup-guard');
const { auditLogger, AuditCategory } = require('../../../middleware/audit-logger');
const identityService = require('../../../services/identity-service');
const { getRequestIp } = require('../../../utils/client-ip');
const { isSecureCookie } = require('../../../utils/cookie-security');
const { computeMfaChallengeBinding, isMfaChallengeBindingEnforced } = require('../../../shared/mfa-challenge-binding');
const logger = require('../../../shared/logger');

// Middleware to ensure user is provider
const { authenticateProvider, authenticateAny } = require('../../../middleware/auth-middleware');
const { isTokenBeforeSessionEpoch } = require('../../../utils/session-epoch');
const redisService = require('../../../services/redis-service');
const { createRateLimiter } = require('../../../middleware/rate-limiter');

// Rate limiters — defined here so they are in scope for every route below.
// 5/15min per IP on the verification + state-change surfaces (mirrors /verify).
const mfaVerifyLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: 'Too many MFA verification attempts. Please try again in 15 minutes.',
});
/**
 * GET /status
 * Read-only check: does the current provider have MFA enabled?
 * Used by the security settings page so it can render either the
 * "enable" CTA or the "disable" form without first calling /setup
 * (which would overwrite an in-progress secret).
 */
// authenticateAny: both portals (health + provider) can read/manage their 2FA.
router.get('/status', authenticateAny, async (req, res) => {
    try {
        const user = await identityService.getMfaStatus(req.user.id);
        res.json({
            success: true,
            data: { enabled: Boolean(user?.twoFactorEnabled) },
        });
    } catch (error) {
        logger.error('[MFA] Status error:', error);
        res.status(500).json({ success: false, error: 'Status read failed' });
    }
});

// ── Re-enrolling an ENABLED second factor (2026-09-26, round 4 of fix/no-recovery) ──
// /setup used to overwrite twoFactorSecret and set twoFactorEnabled=false on ANY
// session, so a stolen session could strip 2FA without the code DELETE /disable
// asks for. Operator ruling the same day: no one clears a second factor without
// proof ("ถอดทั้งสองประตู"). Now, when 2FA is enabled:
//   - /setup needs the CURRENT TOTP code (same verifier and 401 as /disable), and a
//     code-bearing /setup goes through mfaVerifyLimiter like /disable;
//   - the new secret waits in a short-lived pending slot (Redis, strict) and does
//     not touch the user row, so the old factor stays active;
//   - /verify-setup confirms with a code from the NEW secret, and only then swaps
//     the secret and issues new backup codes (audit MFA_REENROLLED).
// First enrolment (2FA not enabled) is unchanged.
// Round 5 (security re-review 2026-09-26, MEDIUM) guards the consuming door too:
//   - /verify-setup goes through mfaVerifyLimiter (the /disable limiter);
//   - the pending entry is bound to the session that created it (token id) —
//     any other session is refused 403 MFA_REENROL_SESSION_MISMATCH;
//   - 5 wrong codes delete the entry (400 MFA_REENROL_RESTART);
//   - a finished re-enrol stamps sessionsRevokedAt (other sessions out) and hands
//     THIS session a fresh cookie issued at the stamp, so it stays signed in.
// The entry lives in services/auth/mfa-reenrol-store.js, which also clears it on
// /disable, password change, logout and revoke-all-sessions.
const reenrolStore = require('../../../services/auth/mfa-reenrol-store');
const { sessionEpochStamp } = require('../../../utils/session-epoch');

// The session that is asking: the token id (stable for a provider access token).
const sessionIdOf = (req) => {
    const sid = req.user?.sessionFamilyId || req.user?.jti;
    return typeof sid === 'string' && sid.trim() ? sid.trim() : null;
};

function reenrolUnavailable(res) {
    return res.status(503).json({
        success: false,
        code: 'MFA_REENROL_UNAVAILABLE',
        error: 'Cannot start re-enrolment right now. Your current 2FA is unchanged; try again later.',
    });
}

async function auditMfa(req, action, metadata) {
    await auditLogger.log({
        category: AuditCategory.SECURITY,
        action,
        actorId: req.user.id,
        actorRole: req.user.role,
        resourceType: 'USER',
        resourceId: req.user.id,
        ipAddress: getRequestIp(req),
        userAgent: req.headers['user-agent'],
        ...(metadata ? { metadata } : {}),
    });
}

// Only a /setup that carries a code is a guessing surface; first enrolment sends none.
const limitSetupWhenProving = (req, res, next) => (
    req.body && req.body.code !== undefined ? mfaVerifyLimiter(req, res, next) : next()
);

/**
 * POST /setup
 * Initialize MFA setup for provider user
 */
router.post('/setup', limitSetupWhenProving, authenticateForMfaSetup, async (req, res) => {
    try {
        const userId = req.user.id;
        const email = req.user.email;

        const status = await identityService.getMfaStatus(userId);
        if (status?.twoFactorEnabled) {
            const current = await identityService.findMfaSecretForDisable(userId);
            const code = req.body?.code;
            const isValid = current?.twoFactorSecret && typeof code === 'string'
                ? mfaService.verifyTOTP(current.twoFactorSecret, code)
                : false;
            if (!isValid) {
                await auditMfa(req, 'MFA_REENROL_REFUSED', { reason: code ? 'Invalid current code' : 'Current code missing' });
                return res.status(401).json({
                    success: false,
                    code: 'MFA_CODE_REQUIRED',
                    error: 'Invalid code',
                });
            }
            const session = sessionIdOf(req);
            if (!session) {
                // A re-enrol must be finishable only by the session that started it.
                await auditMfa(req, 'MFA_REENROL_REFUSED', { reason: 'Session has no token id' });
                return res.status(403).json({
                    success: false,
                    code: 'MFA_REENROL_SESSION_MISMATCH',
                    error: 'Sign in again to move your 2FA to a new device.',
                });
            }
            const secret = mfaService.generateSecret();
            try {
                await reenrolStore.start(userId, { secret, session });
            } catch (storeErr) {
                if (storeErr instanceof redisService.RedisUnavailableError) {
                    return reenrolUnavailable(res);
                }
                throw storeErr;
            }
            await auditMfa(req, 'MFA_REENROL_INITIATED');
            return res.json({
                success: true,
                data: {
                    secret,
                    qrCodeUri: mfaService.generateQRCodeUri(secret, email),
                    reenrol: true,
                    message: 'Scan QR code with authenticator app, then verify with a code from the new entry. Your current 2FA stays active until then.',
                },
            });
        }

        // Generate new secret
        const secret = mfaService.generateSecret();
        const qrCodeUri = mfaService.generateQRCodeUri(secret, email);

        // Store secret temporarily (not yet verified)
        await identityService.storePendingTotpSecret(userId, secret);

        // Log MFA setup initiation
        await auditLogger.log({
            category: AuditCategory.SECURITY,
            action: 'MFA_SETUP_INITIATED',
            actorId: userId,
            actorRole: req.user.role,
            resourceType: 'USER',
            resourceId: userId,
            ipAddress: getRequestIp(req),
            userAgent: req.headers['user-agent'],
        });

        res.json({
            success: true,
            data: {
                secret,
                qrCodeUri,
                message: 'Scan QR code with authenticator app, then verify with a code',
            },
        });
    } catch (error) {
        logger.error('[MFA] Setup error:', error);
        res.status(500).json({ success: false, error: 'Setup failed' });
    }
});

/**
 * POST /verify-setup
 * Verify MFA setup with first code
 */
router.post('/verify-setup', mfaVerifyLimiter, authenticateForMfaSetup, async (req, res) => {
    try {
        const { code } = req.body;
        const userId = req.user.id;

        if (!code || code.length !== 6) {
            return res.status(400).json({
                success: false,
                error: 'Invalid code format',
            });
        }

        const status = await identityService.getMfaStatus(userId);
        if (status?.twoFactorEnabled) {
            // Re-enrol: confirm against the PENDING secret; the enabled one stays until this succeeds.
            let pending;
            try {
                pending = await reenrolStore.read(userId);
            } catch (storeErr) {
                if (storeErr instanceof redisService.RedisUnavailableError) {
                    return reenrolUnavailable(res);
                }
                throw storeErr;
            }
            if (!pending?.secret) {
                return res.status(400).json({
                    success: false,
                    error: 'MFA is already enabled. To move to a new device, start setup with your current code first.',
                });
            }
            const session = sessionIdOf(req);
            if (!session || !pending.session || session !== pending.session) {
                await auditMfa(req, 'MFA_REENROL_REFUSED', { reason: 'Different session' });
                return res.status(403).json({
                    success: false,
                    code: 'MFA_REENROL_SESSION_MISMATCH',
                    error: 'Finish moving your 2FA from the same sign-in that started it.',
                });
            }
            // Claim the attempt BEFORE checking the code (atomic INCR): at most 5 code
            // checks against this pending secret, however many run in parallel.
            let claim;
            try {
                claim = await reenrolStore.claimAttempt(userId, pending);
            } catch (storeErr) {
                if (storeErr instanceof redisService.RedisUnavailableError) {
                    return reenrolUnavailable(res);
                }
                throw storeErr;
            }
            if (!claim.allowed) {
                await reenrolStore.clear(userId, 'attempts-exhausted');
                return res.status(400).json({
                    success: false,
                    code: 'MFA_REENROL_RESTART',
                    error: 'Too many wrong codes. Start again with the code from your current app. Your current 2FA is unchanged.',
                });
            }
            if (!mfaService.verifyTOTP(pending.secret, code)) {
                let outcome;
                try {
                    outcome = await reenrolStore.recordFailure(userId, claim.attempt);
                } catch (storeErr) {
                    if (storeErr instanceof redisService.RedisUnavailableError) {
                        return reenrolUnavailable(res);
                    }
                    throw storeErr;
                }
                await auditMfa(req, 'MFA_SETUP_FAILED', {
                    reason: 'Invalid verification code', reenrol: true, failedCodes: outcome.failures,
                });
                if (outcome.exhausted) {
                    return res.status(400).json({
                        success: false,
                        code: 'MFA_REENROL_RESTART',
                        error: 'Too many wrong codes. Start again with the code from your current app. Your current 2FA is unchanged.',
                    });
                }
                return res.status(400).json({
                    success: false,
                    error: 'Invalid code. Please try again.',
                });
            }
            const backupCodes = mfaService.generateBackupCodes();
            const hashedCodes = backupCodes.map(c => mfaService.hashBackupCode(c));
            // One write: the new factor, its backup codes, and the session epoch that
            // signs every OTHER session out (tokens issued before the stamp are refused).
            const stamp = sessionEpochStamp();
            await identityService.replaceTotpSecretWithBackupCodes(userId, pending.secret, hashedCodes, {
                sessionsRevokedAt: stamp,
            });
            await reenrolStore.clear(userId, 'reenrolled');
            try {
                await require('../../../services/token-revocation-service').revokeAllUserTokens(userId);
            } catch (revokeErr) {
                logger.warn('[MFA] re-enrol: refresh-token revocation failed (epoch still applies):', revokeErr.message);
            }
            // Keep THIS session: a fresh provider token issued AT the stamp, so the
            // epoch check (iat < stamp → refused) lets it through.
            const freshToken = jwtConfig.generateToken({
                id: req.user.id,
                uuid: req.user.uuid,
                email: req.user.email,
                role: req.user.role,
                canonicalRole: req.user.canonicalRole,
                authType: req.user.authType || 'PROVIDER_ID',
                userType: req.user.userType || 'PROVIDER_ID',
                organizationId: req.user.organizationId || null,
                iat: Math.floor(stamp.getTime() / 1000),
            }, 'provider');
            res.cookie('provider_token', freshToken, {
                httpOnly: true,
                secure: isSecureCookie(),
                sameSite: 'lax',
                maxAge: 8 * 60 * 60 * 1000,
                path: '/',
            });
            await auditMfa(req, 'MFA_REENROLLED', { otherSessionsRevoked: true });
            return res.json({
                success: true,
                data: {
                    message: 'MFA moved to the new authenticator. You were signed out everywhere else.',
                    backupCodes, // Show once only!
                    token: freshToken,
                    warning: 'Save these backup codes securely. They will not be shown again. The old ones no longer work.',
                },
            });
        }

        // Get stored secret
        const user = await identityService.findPendingTotpSecret(userId);

        if (!user?.twoFactorSecret) {
            return res.status(400).json({
                success: false,
                error: 'MFA not initialized. Please start setup first.',
            });
        }

        // Verify code
        const isValid = mfaService.verifyTOTP(user.twoFactorSecret, code);

        if (!isValid) {
            await auditLogger.log({
                category: AuditCategory.SECURITY,
                action: 'MFA_SETUP_FAILED',
                actorId: userId,
                actorRole: req.user.role,
                resourceType: 'USER',
                resourceId: userId,
                ipAddress: getRequestIp(req),
                userAgent: req.headers['user-agent'],
                metadata: { reason: 'Invalid verification code' },
            });

            return res.status(400).json({
                success: false,
                error: 'Invalid code. Please try again.',
            });
        }

        // Generate backup codes
        const backupCodes = mfaService.generateBackupCodes();
        const hashedCodes = backupCodes.map(code => mfaService.hashBackupCode(code));

        // Enable MFA. The Prisma `twoFactorBackupCodes` column is `Json`,
        // so write the native array directly (Tier 2 HIGH-1 fix). The
        // legacy `JSON.stringify(hashedCodes)` double-serialized — Postgres
        // would store a JSON-encoded string of a JSON array, breaking the
        // `JSON.parse(...).indexOf(hashedInput)` lookup in /verify.
        await identityService.enableMfaWithBackupCodes(userId, hashedCodes);

        // Log success
        await auditLogger.log({
            category: AuditCategory.SECURITY,
            action: 'MFA_ENABLED',
            actorId: userId,
            actorRole: req.user.role,
            resourceType: 'USER',
            resourceId: userId,
            ipAddress: getRequestIp(req),
            userAgent: req.headers['user-agent'],
        });

        res.json({
            success: true,
            data: {
                message: 'MFA enabled successfully',
                backupCodes, // Show once only!
                warning: 'Save these backup codes securely. They will not be shown again.',
            },
        });
    } catch (error) {
        logger.error('[MFA] Verify setup error:', error);
        res.status(500).json({ success: false, error: 'Verification failed' });
    }
});

/**
 * POST /verify
 * Verify MFA code during login and complete authentication.
 * Accepts a signed mfa_session token (not raw userId) for security.
 * On success, issues full auth JWT tokens + sets cookies.
 * Rate limited: 5 attempts per 15 minutes per IP
 */
const jwtConfig = require('../../../config/jwt-security');
const { normalizeRole, isProviderRole } = require('../../../shared/canonical-rbac');

router.post('/verify', mfaVerifyLimiter, async (req, res) => {
    try {
        const { mfa_session, code, isBackupCode } = req.body;

        // Phase 2 #2.13: the legacy `userId` body field is no longer
        // accepted. Before this commit, callers could bypass the signed
        // mfa_session token by sending a plaintext userId — an MFA bypass
        // for any client that knew the target user's ID. The signed
        // session token (purpose='mfa_challenge', short TTL, audience-
        // bound to provider/public) is now the only path.
        let userId;
        let challengeBind = null;
        let challengeMethod = null; // from the JWT challenge (decoded.method) — only 'TOTP' can be minted since 2026-09-15
        let challengeJti = null;    // single-use key (M-2 replay guard)
        let challengeExp = null;    // unix seconds — bounds the jti's Redis TTL
        let challengeIat = null;    // unix seconds — compared with the owner's session epoch (SECU-03)

        if (!mfa_session || typeof mfa_session !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'MFA session token is required. Please log in again.',
                errorTh: 'ต้องการ MFA session token กรุณาเข้าสู่ระบบใหม่',
            });
        }
        // Type-guard the code up front: a non-string (e.g. {} or number) would
        // otherwise reach hashBackupCode(code).replace()/verifyTOTP and throw a
        // 500 instead of a clean 400 (no bypass — no token is issued on bad input).
        if (code !== undefined && code !== null && typeof code !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Verification code must be a string',
                errorTh: 'รหัสยืนยันไม่ถูกต้อง',
            });
        }

        // Verify the signed MFA session token. Provider audience first,
        // then public. Mismatched purpose / expired / wrong audience all
        // surface as 401 — never a soft fallback.
        try {
            let decoded;
            try {
                decoded = jwtConfig.verifyToken(mfa_session, 'provider');
            } catch {
                decoded = jwtConfig.verifyToken(mfa_session, 'public');
            }

            if (decoded.purpose !== 'mfa_challenge') {
                return res.status(403).json({
                    success: false,
                    error: 'Invalid MFA session token',
                });
            }

            // Enforce JTI on the MFA challenge token. This verifies the token
            // directly rather than through the central middleware, so it needs
            // its own jti check to keep the revocation gate consistent. Honour
            // the LEGACY_NO_JTI_GRACE_UNTIL rollout window.
            const jti = decoded && typeof decoded.jti === 'string' ? decoded.jti.trim() : '';
            if (!jti) {
                const graceRaw = process.env.LEGACY_NO_JTI_GRACE_UNTIL;
                const graceUntil = graceRaw ? Date.parse(String(graceRaw).trim()) : NaN;
                const inGrace = Number.isFinite(graceUntil) && Date.now() < graceUntil;
                if (!inGrace) {
                    return res.status(401).json({
                        success: false,
                        code: 'TOKEN_NO_JTI',
                        error: 'MFA session token missing JTI claim',
                        errorTh: 'โทเค็น MFA ไม่มี JTI claim กรุณาเข้าสู่ระบบใหม่',
                    });
                }
                console.warn(
                    `[AUTH] /mfa/verify accepting legacy mfa_session without jti during grace window ` +
                    `(until=${new Date(graceUntil).toISOString()}). Revocation cannot be enforced.`,
                );
            }

            userId = decoded.id;
            challengeBind = typeof decoded.bind === 'string' ? decoded.bind : null;
            challengeMethod = typeof decoded.method === 'string' ? decoded.method : null;
            challengeJti = jti || null;
            challengeExp = typeof decoded.exp === 'number' ? decoded.exp : null;
            challengeIat = typeof decoded.iat === 'number' ? decoded.iat : null;
        } catch (_tokenError) {
            return res.status(401).json({
                success: false,
                error: 'MFA session expired. Please login again.',
                errorTh: 'เซสชัน MFA หมดอายุ กรุณาเข้าสู่ระบบใหม่',
            });
        }

        // AUTH-5: enforce the IP/User-Agent binding the challenge was issued
        // with. A mismatch means the mfa_session is being completed from a
        // different network/agent than the one that passed the password step —
        // the classic challenge-hijack signal. Legacy tokens minted before this
        // rollout carry no `bind` claim and pass through (they expire in 5 min);
        // enforcement can be relaxed via MFA_CHALLENGE_BIND_ENFORCE=false.
        if (challengeBind) {
            const expectedBind = computeMfaChallengeBinding(getRequestIp(req), req.headers['user-agent']);
            if (challengeBind !== expectedBind) {
                await auditLogger.log({
                    category: AuditCategory.SECURITY,
                    action: 'MFA_CHALLENGE_BINDING_MISMATCH',
                    actorId: userId,
                    actorRole: 'UNKNOWN',
                    resourceType: 'USER',
                    resourceId: userId,
                    ipAddress: getRequestIp(req),
                    userAgent: req.headers['user-agent'],
                    result: 'FAILURE',
                }).catch(() => {});
                if (isMfaChallengeBindingEnforced()) {
                    return res.status(401).json({
                        success: false,
                        code: 'MFA_CHALLENGE_BINDING_MISMATCH',
                        error: 'MFA session does not match this device or network. Please log in again.',
                        errorTh: 'เซสชัน MFA ไม่ตรงกับอุปกรณ์หรือเครือข่ายนี้ กรุณาเข้าสู่ระบบใหม่',
                    });
                }
                logger.warn('[AUTH] /mfa/verify binding mismatch (monitor mode — allowed)', { userId });
            }
        }

        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Verification code required',
            });
        }

        const user = await identityService.findUserForMfaVerify(userId);

        if (!user?.twoFactorEnabled) {
            return res.status(400).json({
                success: false,
                error: 'MFA not enabled for this user',
            });
        }

        // SECU-03: a challenge minted before the owner's sessions were revoked
        // (password change/reset, disable, role change) is dead like every
        // access/refresh token of that age — refused before any factor is
        // checked, so a backup code is not consumed either.
        if (isTokenBeforeSessionEpoch({ iat: challengeIat }, user.sessionsRevokedAt || null)) {
            return res.status(401).json({
                success: false,
                code: 'TOKEN_REVOKED',
                error: 'MFA session has been revoked. Please log in again.',
                errorTh: 'เซสชัน MFA ถูกเพิกถอนแล้ว กรุณาเข้าสู่ระบบใหม่',
            });
        }

        let isValid = false;

        // Which factor to verify: the JWT challenge carries `method` (minted by
        // mintMfaChallengeToken); fall back to the user row, then TOTP for legacy.
        // Since 2026-09-15 TOTP is the only factor (operator: no email second factor).
        // A challenge or row still naming the retired EMAIL method cannot be
        // verified by anything — refuse it rather than pretend to check a code.
        const method = challengeMethod || user.twoFactorMethod || 'TOTP';
        if (method !== 'TOTP') {
            return res.status(400).json({
                success: false,
                code: 'MFA_METHOD_RETIRED',
                error: 'This second-factor method has been retired. Please log in again.',
                errorTh: 'วิธียืนยันตัวตนนี้ถูกยกเลิกแล้ว กรุณาเข้าสู่ระบบใหม่',
            });
        }

        if (isBackupCode) {
            // Verify backup code. The column is Prisma `Json`, so Postgres
            // returns a native array. Defensive: if a legacy row still has
            // a JSON-encoded string from the pre-HIGH-1 writer, parse it.
            const hashedInput = mfaService.hashBackupCode(code);
            let backupCodes = user.twoFactorBackupCodes;
            if (typeof backupCodes === 'string') {
                try { backupCodes = JSON.parse(backupCodes); } catch { backupCodes = []; }
            }
            if (!Array.isArray(backupCodes)) {backupCodes = [];}
            const codeIndex = backupCodes.indexOf(hashedInput);

            if (codeIndex !== -1) {
                isValid = true;
                // Remove used backup code; write back as native array.
                backupCodes.splice(codeIndex, 1);
                await identityService.updateBackupCodes(userId, backupCodes);
            }
        } else {
            // Verify TOTP (authenticator app). Guard the null-secret case: a row a
            // not-yet-run migration left without a seed would otherwise hit
            // verifyTOTP(null,…) → base32 decode throws → 500. Return a clean 400 (still no bypass — isValid stays false).
            if (!user.twoFactorSecret) {
                return res.status(400).json({
                    success: false,
                    code: 'MFA_METHOD_MISMATCH',
                    error: 'MFA method mismatch. Please log in again.',
                    errorTh: 'วิธียืนยันตัวตนไม่ตรงกัน กรุณาเข้าสู่ระบบใหม่',
                });
            }
            isValid = mfaService.verifyTOTP(user.twoFactorSecret, code);
        }

        // Log attempt
        await auditLogger.log({
            category: AuditCategory.AUTHENTICATION,
            action: isValid ? 'MFA_VERIFY_SUCCESS' : 'MFA_VERIFY_FAILED',
            actorId: userId,
            actorRole: user.role,
            resourceType: 'USER',
            resourceId: userId,
            ipAddress: getRequestIp(req),
            userAgent: req.headers['user-agent'],
            result: isValid ? 'SUCCESS' : 'FAILURE',
        });

        if (!isValid) {
            return res.status(401).json({
                success: false,
                error: 'Invalid code',
                errorTh: 'รหัส MFA ไม่ถูกต้อง',
            });
        }

        // M-2 (replay guard): single-use the challenge jti now that the code
        // verified. The mfa_session JWT is otherwise valid for its full ~5-min
        // TTL, and TOTP stays valid across its time window — so a captured
        // SUCCESSFUL /verify could be replayed to mint extra 8h sessions. Backup
        // codes are already single-use (splice); this
        // closes the TOTP gap. Fail OPEN if Redis is unreachable (the IP/UA bind
        // + 5/15min limiter still constrain replay; 2FA is opt-in) but REJECT a
        // confirmed reuse.
        //
        // W1-5 (2026-08-22): setNX returns false on BOTH "exists" and
        // "redis-down". This used to be disambiguated by a follow-up `get`
        // whose null could ALSO mean either — it happened to land on "allow"
        // because both unknowns collapse to null, which is right by luck, not
        // by construction. `getStrict` makes it explicit: a rejection is the
        // outage (documented fail-open, now logged as such), a null is a
        // genuinely absent key, and a value is a confirmed replay.
        //
        // OPERATOR NOTE: this fail-open is inherited from the original design
        // and is the one MFA-adjacent path still allowed to pass during an
        // outage. It guards replay of an ALREADY-verified challenge, not the
        // code check itself, which reads the TOTP seed or backup codes from the
        // database and cannot pass on a store outage. Worth revisiting alongside
        // the access-token blocklist policy.
        if (challengeJti) {
            try {
                const jtiKey = `mfa-jti:${challengeJti}`;
                const nowSec = Math.floor(Date.now() / 1000);
                const ttl = challengeExp && challengeExp > nowSec ? (challengeExp - nowSec) : 300;
                const claimed = await redisService.setNX(jtiKey, '1', ttl);
                if (!claimed && (await redisService.getStrict(jtiKey))) {
                    await auditLogger.log({
                        category: AuditCategory.SECURITY,
                        action: 'MFA_CHALLENGE_REPLAY_BLOCKED',
                        actorId: userId,
                        actorRole: user.role,
                        resourceType: 'USER',
                        resourceId: userId,
                        ipAddress: getRequestIp(req),
                        userAgent: req.headers['user-agent'],
                        result: 'FAILURE',
                    }).catch(() => {});
                    return res.status(401).json({
                        success: false,
                        code: 'MFA_CHALLENGE_REUSED',
                        error: 'This verification was already used. Please log in again.',
                        errorTh: 'การยืนยันนี้ถูกใช้ไปแล้ว กรุณาเข้าสู่ระบบใหม่',
                    });
                }
            } catch (jtiErr) {
                logger.warn('[MFA] jti single-use check failed (allowing — Redis issue):', jtiErr?.message || jtiErr);
            }
        }

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // MFA verified — complete login by issuing full auth tokens
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const canonicalRole = normalizeRole(user.role);
        const isProvider = isProviderRole(canonicalRole);
        const jwtTokenType = isProvider ? 'provider' : 'public';

        // PDPA Sprint 6 (final sweep): JWTs no longer carry raw 13-digit
        // identifiers — see prisma-auth-service.js for the canonical login
        // payload shape. Embedding `healthId`/`providerId` in the JWT here
        // meant every downstream service that decoded the token saw the
        // bare national ID, undoing the Batch 1 fix on the MFA path.
        // Identity is now resolved server-side from `id` (UUID).
        const tokenPayload = {
            id: user.id,
            uuid: user.uuid,
            email: user.email,
            role: user.role,
            canonicalRole,
            authType: isProvider ? 'PROVIDER_ID' : 'HEALTH_ID',
            userType: isProvider ? 'PROVIDER_ID' : 'HEALTH_ID',
            // ADR-014: tenant claim — see tenant-context-middleware.
            organizationId: user.organizationId || null,
        };

        const fullToken = jwtConfig.generateToken(tokenPayload, jwtTokenType);

        // Set auth cookie
        const isSecure = isSecureCookie();
        const cookieName = isProvider ? 'provider_token' : 'auth_token';
        res.cookie(cookieName, fullToken, {
            httpOnly: true,
            secure: isSecure,
            sameSite: 'lax',
            maxAge: 8 * 60 * 60 * 1000,
            path: '/',
        });

        // Update last login
        await identityService.touchLastLogin(userId);

        logger.info(`[MFA] Login completed after MFA verification for: ${user.role} ${userId}`);

        // PDPA Sprint 6 (final sweep): never echo raw 13-digit identifier
        // in the response. Clients that need a display value should call
        // the profile endpoint, which returns a masked form.
        res.json({
            success: true,
            message: 'MFA verification successful',
            data: {
                token: fullToken,
                user: {
                    id: user.id,
                    uuid: user.uuid,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    canonicalRole,
                    authType: tokenPayload.authType,
                    userType: tokenPayload.userType,
                },
            },
        });
    } catch (error) {
        logger.error('[MFA] Verify error:', error);
        res.status(500).json({ success: false, error: 'Verification failed' });
    }
});

/**
 * DELETE /disable
 * Disable MFA (requires current code)
 */
router.delete('/disable', mfaVerifyLimiter, authenticateAny, async (req, res) => {
    try {
        const { code } = req.body;
        const userId = req.user.id;

        const user = await identityService.findMfaSecretForDisable(userId);

        if (!user?.twoFactorEnabled) {
            return res.status(400).json({
                success: false,
                error: 'MFA is not enabled',
            });
        }

        // Verify the current TOTP code before disabling. A legacy row still on the
        // retired EMAIL method (no seed) cannot prove anything — refuse; the
        // migration turns such rows off anyway.
        const isValid = user.twoFactorSecret ? mfaService.verifyTOTP(user.twoFactorSecret, code) : false;

        if (!isValid) {
            return res.status(401).json({
                success: false,
                error: 'Invalid code',
            });
        }

        // Disable MFA
        await identityService.disableMfa(userId);
        // A half-finished move to a new device must not outlive the factor it was replacing.
        await reenrolStore.clear(userId, 'disable');

        // Log
        await auditLogger.log({
            category: AuditCategory.SECURITY,
            action: 'MFA_DISABLED',
            actorId: userId,
            actorRole: req.user.role,
            resourceType: 'USER',
            resourceId: userId,
            ipAddress: getRequestIp(req),
            userAgent: req.headers['user-agent'],
        });

        res.json({
            success: true,
            message: 'MFA disabled successfully',
        });
    } catch (error) {
        logger.error('[MFA] Disable error:', error);
        res.status(500).json({ success: false, error: 'Failed to disable MFA' });
    }
});

module.exports = router;
