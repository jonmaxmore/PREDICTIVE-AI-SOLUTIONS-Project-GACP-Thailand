/**
 * Provider Authentication Routes (MOPH Standard)
 * Uses Provider ID (13-digit Thai ID) for authentication
 * @version 3.0.0 - MOPH Standard
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const providerUserService = require('../../../services/provider-user-service');
const jwtConfig = require('../../../config/jwt-security');
const logger = require('../../../shared/logger');
const { normalizeRole, isProviderRole } = require('../../../shared/canonical-rbac');
const { hasUsableSecondFactor } = require('../../../shared/second-factor');
const { isTokenBeforeSessionEpoch } = require('../../../middleware/auth-middleware');
const { isAccessTokenBlocklisted } = require('../../../services/token-revocation-service');
const { sendErrorResponse, sendSuccessResponse, safeErrorMessage } = require('../../../shared/api-response');
const { lookup: lookupErrorCode } = require('../../../shared/error-codes');
const { validate } = require('../../../middleware/validate');
const { providerLoginSchema, changePasswordSchema } = require('../../../shared/schemas/auth-schemas');
const { maskThaiId, computeLookupHmac } = require('../../../utils/field-encryption');
const { isSecureCookie } = require('../../../utils/cookie-security');
const { getRequestIp } = require('../../../utils/client-ip');
const { mintMfaChallengeToken } = require('../../../shared/mfa-challenge-binding');

// POST /auth/provider/login - Provider login with Provider ID (MOPH Standard)
//
// Zod-validated body: see `providerLoginSchema` in shared/schemas/auth-schemas.js.
// The validate middleware rejects non-string providerId/password (e.g.
// `{"providerId":["x"]}` or `{"providerId":{"$ne":null}}`) with a 400
// VALIDATION_ERROR + Thai message — earlier those payloads bypassed the
// `if (!providerId || !password)` truthiness check, hit `providerId.replace`
// on a non-string, and 500'd with SERVER_ERROR. Caught in the post-PR-#197
// public-endpoint fuzz sweep.
router.post('/login', validate(providerLoginSchema), async (req, res) => {
    try {
        // MOPH Standard: Use Provider ID (13-digit Thai ID)
        const { providerId, password } = req.body;

        if (!providerId || !password) {
            return sendErrorResponse(res, req, {
                status: 400,
                code: 'MISSING_CREDENTIALS',
                message: 'Please provide Provider ID and password',
                messageTh: 'กรุณากรอก Provider ID (เลขบัตรประชาชน 13 หลัก) และรหัสผ่าน',
            });
        }

        // Validate Provider ID format (13 digits)
        const cleanProviderId = providerId.replace(/-/g, '');
        if (!/^\d{13}$/.test(cleanProviderId)) {
            return sendErrorResponse(res, req, {
                status: 400,
                code: 'INVALID_PROVIDER_ID',
                message: 'Provider ID must be a 13-digit Thai citizen ID',
                messageTh: 'Provider ID ต้องเป็นเลขบัตรประชาชน 13 หลัก',
            });
        }

        // Find provider by Provider ID
        // Sprint 6 healthId-audit Phase B-M5 / PDPA Phase D-H4-H5: query the
        // deterministic lookup column instead of the plaintext `providerId`
        // column — the plaintext column is being dropped.
        // H-4 Phase 1 (RFC docs/handoffs/H-4-national-id-hmac-migration-rfc.md):
        // with `AUTH_LOOKUP_USE_HMAC` OFF (default) the lookup hash is raw
        // SHA-256 of the cleaned numeric ID and resolves the legacy
        // `providerIdHash` column — matches `prisma-auth-service.js
        // _generateHashes` + user-lookup-service computeIdentifierHash. With the
        // flag ON it is the keyed HMAC (computeLookupHmac) resolving the
        // `providerIdHmac` column. The service-side query column is selected by
        // the SAME flag so writer + reader never drift.
        const useHmac = process.env.AUTH_LOOKUP_USE_HMAC === 'true';
        const providerIdLookup = useHmac
            ? computeLookupHmac(cleanProviderId)
            : crypto.createHash('sha256').update(cleanProviderId).digest('hex');
        const providerUser = await providerUserService.findProviderForLoginByHash(providerIdLookup);

        if (!providerUser) {
            return sendErrorResponse(res, req, {
                status: 401,
                code: 'USER_NOT_FOUND',
                message: 'Provider account not found',
                messageTh: 'ไม่พบผู้ใช้งาน หรือ Provider ID ไม่ถูกต้อง',
            });
        }

        const canonicalRole = normalizeRole(providerUser.role);
        if (!canonicalRole || !isProviderRole(canonicalRole)) {
            return sendErrorResponse(res, req, {
                status: 403,
                code: 'INVALID_PROVIDER_ROLE',
                message: 'Not a provider account',
                messageTh: 'บัญชีนี้ไม่ใช่บัญชีผู้ให้บริการ',
            });
        }

        if (providerUser.healthId) {
            return sendErrorResponse(res, req, {
                status: 409,
                code: 'IDENTITY_CONFLICT',
                message: 'Identity conflict: provider account cannot include healthId',
                messageTh: 'ข้อมูลบัญชีไม่ถูกต้อง: บัญชีผู้ให้บริการต้องไม่มี healthId',
            });
        }

        if (!['PROVIDER', 'PROVIDER'].includes(String(providerUser.accountType || '').toUpperCase())) {
            return sendErrorResponse(res, req, {
                status: 403,
                code: 'INVALID_ACCOUNT_TYPE',
                message: 'Provider accountType required',
                messageTh: 'บัญชีนี้ยังไม่ถูกตั้งค่าเป็นประเภทผู้ให้บริการ',
            });
        }

        // Check if account is active. The login form shows messageTh, so it is the
        // catalogue's sentence — the same one the HEALTH door and /refresh send.
        if (providerUser.status !== 'ACTIVE') {
            const inactive = lookupErrorCode('ACCOUNT_INACTIVE');
            return sendErrorResponse(res, req, {
                status: inactive.httpStatus,
                code: 'ACCOUNT_INACTIVE',
                message: inactive.messageEn,
                messageTh: inactive.messageTh,
            });
        }

        // ── Per-account brute-force lockout (H-3, audit 2026-06-11) ──
        // The HEALTH login path locks after 5 failed attempts; provider login
        // previously had ONLY a per-IP limiter (defeated by IP rotation), which
        // left the most privileged accounts brute-forceable. Auto-unlock once
        // the window has expired, then hard-stop while still locked — both
        // BEFORE bcrypt so a locked account never even reaches the compare.
        const lockedUntilDate = providerUser.lockedUntil ? new Date(providerUser.lockedUntil) : null;
        if (providerUser.isLocked && lockedUntilDate && Date.now() >= lockedUntilDate.getTime()) {
            await providerUserService.resetProviderLoginLock(providerUser.id);
            providerUser.loginAttempts = 0;
            providerUser.isLocked = false;
        }
        if (providerUser.isLocked && lockedUntilDate && Date.now() < lockedUntilDate.getTime()) {
            const remainingMin = Math.max(1, Math.ceil((lockedUntilDate.getTime() - Date.now()) / 60000));
            logger.warn(`[Auth MOPH] Login blocked — account locked: ${maskThaiId(providerUser.providerId)}`);
            return sendErrorResponse(res, req, {
                status: 423,
                code: 'ACCOUNT_LOCKED',
                message: `Account locked due to too many failed attempts. Try again in ${remainingMin} minute(s).`,
                messageTh: `บัญชีถูกล็อกชั่วคราวเนื่องจากกรอกรหัสผ่านผิดหลายครั้ง กรุณาลองใหม่ในอีก ${remainingMin} นาที`,
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, providerUser.password);
        if (!isValidPassword) {
            // Count the failure toward the lockout threshold.
            const { locked, lockedUntil } = await providerUserService.registerFailedProviderLogin(providerUser);
            if (locked) {
                const remainingMin = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
                logger.warn(`[Auth MOPH] Account locked after repeated failures: ${maskThaiId(providerUser.providerId)}`);
                return sendErrorResponse(res, req, {
                    status: 423,
                    code: 'ACCOUNT_LOCKED',
                    message: `Account locked due to too many failed attempts. Try again in ${remainingMin} minute(s).`,
                    messageTh: `บัญชีถูกล็อกชั่วคราวเนื่องจากกรอกรหัสผ่านผิดหลายครั้ง กรุณาลองใหม่ในอีก ${remainingMin} นาที`,
                });
            }
            return sendErrorResponse(res, req, {
                status: 401,
                code: 'INVALID_PASSWORD',
                message: 'Invalid password',
                messageTh: 'รหัสผ่านไม่ถูกต้อง',
            });
        }

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // PER-USER 2FA CHALLENGE
        // Any provider/admin who ENABLED 2FA must complete the challenge before a
        // token is issued — fires regardless of REQUIRE_MFA_FOR_PRIVILEGED (that
        // flag is a separate force-SETUP lever for accounts that have NOT enrolled).
        // The JWT mfa_session is minted via the shared helper so every login
        // surface emits the identical format /api/mfa/verify understands.
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // hasUsableSecondFactor: a row still marked with the retired EMAIL method
        // (operator 2026-09-15) counts as not enrolled — it never held a TOTP seed,
        // so challenging it would be a lockout; REQUIRE_MFA_FOR_PRIVILEGED below
        // sends such an account to enrol TOTP instead.
        if (hasUsableSecondFactor(providerUser)) {
            const mfaSessionToken = mintMfaChallengeToken({
                userId: providerUser.id,
                method: 'TOTP',
                ip: getRequestIp(req),
                userAgent: req.headers['user-agent'],
                tokenType: 'provider',
            });
            logger.info(`[Auth MOPH] MFA challenge issued for: ${maskThaiId(providerUser.providerId)}`);
            return sendSuccessResponse(res, req, {
                data: {
                    mfa_required: true,
                    mfa_session: mfaSessionToken,
                },
                message: 'กรุณายืนยัน MFA เพื่อเข้าสู่ระบบ',
            });
        }

        // Privileged force-SETUP (separate flag). 2FA-enrolled users already
        // returned above; this only catches privileged accounts WITHOUT 2FA.
        const requireMfa = process.env.REQUIRE_MFA_FOR_PRIVILEGED === 'true';
        if (requireMfa) {
            const setupToken = jwtConfig.generateToken({
                id: providerUser.id,
                purpose: 'mfa_setup',
            }, 'provider', { expiresIn: '10m' });

            logger.info(`[Auth MOPH] MFA setup required for: ${maskThaiId(providerUser.providerId)}`);
            return sendSuccessResponse(res, req, {
                data: {
                    mfa_setup_required: true,
                    setup_token: setupToken,
                },
                message: 'กรุณาตั้งค่า MFA ก่อนเข้าใช้งาน',
            });
        }

        // Generate JWT token (no MFA enforcement)
        const token = jwtConfig.generateToken({
            id: providerUser.id,
            uuid: providerUser.uuid,
            email: providerUser.email,
            // PDPA (Sprint 6 Phase B-M1): do NOT embed the plaintext Thai national ID
            // (providerId) in the signed JWT — every service that decodes the token,
            // and any log dumping the payload, would see the bare PII. auth-middleware
            // resolves req.user.providerId from the DB by id (DB-first, line ~157), so
            // downstream reads keep working. Mirrors the health-login tokenPayload
            // refactor that deliberately omits healthId.
            role: providerUser.role,
            canonicalRole,
            authType: 'PROVIDER_ID',
            userType: 'PROVIDER_ID',
            // ADR-014: tenant claim — see tenant-context-middleware.
            organizationId: providerUser.organizationId || null,
        }, 'provider');

        const isSecure = isSecureCookie();
        res.cookie('provider_token', token, {
            httpOnly: true,
            secure: isSecure,
            sameSite: 'lax',
            maxAge: 8 * 60 * 60 * 1000,
            path: '/',
        });

        // Update last login
        await providerUserService.touchProviderLastLogin(providerUser.id);

        logger.info(`[Auth MOPH] Provider login: ${providerUser.firstName} ${providerUser.lastName} (${providerUser.role})`);

        return sendSuccessResponse(res, req, {
            data: {
                token,
                user: {
                    id: providerUser.id,
                    uuid: providerUser.uuid,
                    // PDPA: mask the national ID in the response body too — the officer
                    // confirms their own id, but cleartext PII stays out of caches/logs.
                    providerId: maskThaiId(providerUser.providerId),
                    email: providerUser.email,
                    firstName: providerUser.firstName,
                    lastName: providerUser.lastName,
                    role: providerUser.role,
                    canonicalRole,
                    authType: providerUser.authType,
                    userType: 'PROVIDER_ID',
                    ministryVerified: providerUser.ministryVerified,
                    department: 'ระบบรับรองมาตรฐาน GACP สมุนไพร',
                    dashboardUrl: '/provider/dashboard',
                },
            },
        });
    } catch (error) {
        logger.error('[Auth MOPH] Login error:', error.message);
        return sendErrorResponse(res, req, {
            status: 500,
            code: 'SERVER_ERROR',
            message: 'Provider login failed',
            messageTh: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ',
            details: process.env.NODE_ENV === 'production' ? null : { reason: safeErrorMessage(error, 'Provider login failed') },
        });
    }
});

// A Firebase Authentication exchange for the provider portal was mounted here
// behind a feature flag. Removed so Google is not the identity provider for
// DTAM officers. The provider login above, verified against our own
// Postgres, is the only path.

// POST /auth/provider/logout - Clear provider auth cookie
router.post('/logout', async (req, res) => {
    // SEC-002: blocklist the provider access token's jti so it can't be replayed
    // until its natural exp — clearing the cookie alone left it valid. Provider
    // sessions carry no separate refresh-token cookie, so this revokes the AT.
    const { revokeSessionFromRequest } = require('../../../utils/session-revocation');
    await revokeSessionFromRequest(req, 'provider');

    const isSecure = isSecureCookie();
    res.clearCookie('provider_token', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecure,
    });
    return sendSuccessResponse(res, req, {
        message: 'Logged out',
    });
});

// GET /auth/provider/me - Get current provider info
router.get('/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1] || req.cookies?.provider_token;
        if (!token) {
            return sendErrorResponse(res, req, {
                status: 401,
                code: 'TOKEN_MISSING',
                message: 'Token is required',
                messageTh: 'ไม่พบ Token',
            });
        }

        const config = jwtConfig.loadJWTConfiguration();
        const decoded = jwtConfig.verifyToken(token, 'provider', config);

        // Reject anything that is not an ACCESS token, before touching the DB.
        //
        // This endpoint verifies inline rather than going through
        // authenticateProvider, so it never inherited the central token-class
        // gate. An `mfa_challenge` token — issued by /login to anyone who
        // supplies only the correct PASSWORD on a 2FA-enabled account — is
        // signed with the same provider secret, issuer and audience as a real
        // access token and carries `id` and an auto-injected `jti`, so it
        // cleared every check below: jti presence, the Redis blocklist,
        // account status and the session epoch. A password-only attacker read a
        // 2FA-protected officer's profile, which is precisely what the second
        // factor exists to stop. Same shape for `mfa_setup` and for a refresh
        // token. classifyTokenForAccessPath is the single source of truth the
        // central middleware uses, so the two cannot drift.
        const tokenClass = jwtConfig.classifyTokenForAccessPath(decoded);
        if (tokenClass !== 'ok' && tokenClass !== 'legacy') {
            return res.status(401).json({
                success: false,
                code: 'INVALID_TOKEN',
                error: 'Unauthorized',
                message: 'โทเค็นนี้ใช้ยืนยันตัวตนไม่ได้ กรุณาเข้าสู่ระบบใหม่ / This token cannot be used to authenticate a session.',
            });
        }

        // Enforce JTI claim — this endpoint verifies tokens directly instead of
        // going through `authenticateProvider`, so it needs its own jti check
        // to stay consistent with the central middleware's revocation gate.
        // Matches the LEGACY_NO_JTI_GRACE_UNTIL rollout window pattern.
        const jti = decoded && typeof decoded.jti === 'string' ? decoded.jti.trim() : '';
        if (!jti) {
            const graceRaw = process.env.LEGACY_NO_JTI_GRACE_UNTIL;
            const graceUntil = graceRaw ? Date.parse(String(graceRaw).trim()) : NaN;
            const inGrace = Number.isFinite(graceUntil) && Date.now() < graceUntil;
            if (!inGrace) {
                return res.status(401).json({
                    success: false,
                    code: 'TOKEN_NO_JTI',
                    error: 'Token missing JTI claim',
                    message: 'โทเค็นไม่มี JTI claim กรุณาเข้าสู่ระบบใหม่ / Token missing JTI claim. Please re-login.',
                });
            }
            console.warn(
                `[AUTH] /auth/provider/me accepting legacy token without jti during grace window ` +
                `(until=${new Date(graceUntil).toISOString()}). Revocation cannot be enforced.`,
            );
        }

        // Consult the Redis JTI blocklist that /logout populates, before the
        // DB lookup — same order + fail-open policy as authenticateProvider.
        // Without this, a logged-out token keeps returning a 200 profile here
        // until exp even though every ACTION route already rejects it.
        if (jti) {
            try {
                if (await isAccessTokenBlocklisted(jti)) {
                    return res.status(401).json({
                        success: false,
                        code: 'TOKEN_REVOKED',
                        error: 'Token has been revoked',
                        message: 'โทเค็นถูกเพิกถอนแล้ว กรุณาเข้าสู่ระบบใหม่ / Token has been revoked. Please log in again.',
                    });
                }
            } catch (revErr) {
                logger.warn(`[AUTH] /auth/provider/me revocation check failed: ${revErr.message}`);
            }
        }

        const providerUser = await providerUserService.findProviderUserById(decoded.id);

        if (!providerUser) {
            return sendErrorResponse(res, req, {
                status: 404,
                code: 'USER_NOT_FOUND',
                message: 'Provider account not found',
                messageTh: 'ไม่พบผู้ใช้งาน',
            });
        }

        // Wave-3 follow-up: this endpoint verifies the token inline (not via
        // authenticateProvider), so it must enforce the SAME session-epoch +
        // account-status checks the central middleware does — otherwise a
        // disabled / demoted / password-changed staffer whose token predates
        // their eviction still gets a 200 profile here (every ACTION route IS
        // gated, so this was profile-only, but /me should tell the truth).
        if (providerUser.isDeleted || String(providerUser.status || '').toUpperCase() !== 'ACTIVE') {
            const inactive = lookupErrorCode('ACCOUNT_INACTIVE'); // the login door's sentence; 401 kept
            return res.status(401).json({
                success: false, code: 'ACCOUNT_INACTIVE', error: inactive.messageEn,
                message: `${inactive.messageTh} / ${inactive.messageEn}`,
                messageTh: inactive.messageTh,
            });
        }
        if (isTokenBeforeSessionEpoch(decoded, providerUser.sessionsRevokedAt || null)) {
            return res.status(401).json({
                success: false,
                code: 'SESSION_REVOKED',
                error: 'Session was revoked',
                message: 'เซสชันถูกเพิกถอน (เปลี่ยนรหัสผ่าน/สิทธิ์) กรุณาเข้าสู่ระบบใหม่ / Session was revoked. Please log in again.',
            });
        }

        return sendSuccessResponse(res, req, {
            data: {
                id: providerUser.id,
                // Masked, matching the authenticated login response (:267).
                // /me returned the RAW 13-digit citizen ID, so a caller here
                // received MORE plaintext PII than one who completed 2FA.
                providerId: maskThaiId(providerUser.providerId),
                email: providerUser.email,
                firstName: providerUser.firstName,
                lastName: providerUser.lastName,
                role: providerUser.role,
                authType: providerUser.authType,
                userType: 'PROVIDER_ID',
                ministryVerified: providerUser.ministryVerified,
            },
        });
    } catch (error) {
        return sendErrorResponse(res, req, {
            status: 401,
            code: 'TOKEN_INVALID',
            message: 'Invalid or expired token',
            messageTh: 'Token ไม่ถูกต้องหรือหมดอายุ',
            details: process.env.NODE_ENV === 'production' ? null : { reason: safeErrorMessage(error, 'Invalid or expired token') },
        });
    }
});

// Phase 7: per-user notification preferences for provider staff.
const { authenticateProvider } = require('../../../middleware/auth-middleware');
const prefsService = require('../../../services/notification-preferences-service');
router.get('/me/notification-prefs', authenticateProvider, async (req, res) => {
    try {
        const data = await prefsService.getPrefs(req.user.id);
        return res.json({ success: true, data });
    } catch (error) {
        logger.error('[Provider Notification Prefs GET] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error, 'ไม่สามารถดึงการตั้งค่าการแจ้งเตือนได้ / Unable to load notification preferences') });
    }
});
router.put('/me/notification-prefs', authenticateProvider, async (req, res) => {
    try {
        const data = await prefsService.updatePrefs(req.user.id, req.body || {});
        return res.json({ success: true, data });
    } catch (error) {
        logger.error('[Provider Notification Prefs PUT] Error:', error);
        return res.status(400).json({ success: false, error: safeErrorMessage(error, 'ไม่สามารถบันทึกการตั้งค่าการแจ้งเตือนได้ / Unable to update notification preferences') });
    }
});

// POST /auth/provider/change-password — a staff member changes their OWN password
// with the current one (operator 2026-09-26: "ปิด + เพิ่มเปลี่ยนรหัสของตัวเองให้เจ้าหน้าที่").
// The staff directory no longer sets anyone's password, so this is the only way a
// staff password changes after the account is created. Same body as the applicant
// door POST /auth/health/change-password: changePasswordSchema (registration
// strength policy), the old password must match, every session of the caller is
// revoked (sessionsRevokedAt + token revocation), PASSWORD_CHANGE audit row. The
// rate limit is mounted in server.js (changePasswordLimiter), shared with the
// applicant door. AuthController is required lazily: it pulls the whole auth
// service, which the login-only tests of this router do not need.
router.post('/change-password', authenticateProvider, validate(changePasswordSchema), (req, res) => {
    const AuthController = require('../../../controllers/auth-controller');
    return AuthController.changeProviderPassword(req, res);
});

module.exports = router;
