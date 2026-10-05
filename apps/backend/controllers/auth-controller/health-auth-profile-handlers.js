const { CANONICAL_ROLES } = require('../../shared/canonical-rbac');
const { lookup } = require('../../shared/error-codes');

/**
 * Maps a login error message to an appropriate HTTP status, error code, and user-facing message.
 */
function mapLoginError(errorMessage) {
    const normalized = String(errorMessage || '').toLowerCase();

    if (normalized.includes('invalid credentials') || normalized.includes('identifier and password are required')) {
        return { status: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' };
    }
    if (normalized.includes('requires a health account')
        || normalized.includes('requires a provider account')
        || normalized.includes('use /auth/provider/login')) {
        return { status: 403, code: 'AUTH_ROUTE_MISMATCH', message: 'Account type does not match this login portal' };
    }
    if (normalized.includes('account locked')) {
        return { status: 423, code: 'ACCOUNT_LOCKED', message: 'Account is temporarily locked' };
    }
    if (normalized.includes('account is inactive')) {
        // SECU-03 — thrown by shared/account-status.js; the provider and ThaID
        // doors answer a disabled account with this same code.
        const row = lookup('ACCOUNT_INACTIVE');
        return { status: row.httpStatus, code: row.code, message: row.messageEn, messageTh: row.messageTh };
    }
    if (normalized.includes('rate limit')) {
        return { status: 429, code: 'RATE_LIMITED', message: 'Too many login attempts' };
    }
    if (normalized.includes('unknown argument') || normalized.includes('service unavailable')) {
        return { status: 503, code: 'AUTH_SERVICE_UNAVAILABLE', message: 'Authentication service is unavailable' };
    }

    return { status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Login failed. Please try again.' };
}

/**
 * Maps a profile-related error message to an appropriate HTTP response.
 */
function mapProfileError(errorMessage, defaultMessage) {
    const msg = String(errorMessage || '');

    if (msg.includes('User not found')) {
        return { status: 404, code: 'NOT_FOUND', message: 'ไม่พบข้อมูลผู้ใช้งานนี้ในระบบ' };
    }
    if (msg.includes('Token expired')) {
        return { status: 401, code: 'TOKEN_EXPIRED', message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
    }
    if (msg.includes('Invalid phone number')) {
        return { status: 400, code: 'VALIDATION_ERROR', message: 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง กรุณากรอกเบอร์โทรศัพท์ 10 หลัก' };
    }
    if (msg.includes('Unauthorized')) {
        return { status: 401, code: 'UNAUTHORIZED', message: 'ไม่ได้รับอนุญาตให้แก้ไขข้อมูลนี้ กรุณาเข้าสู่ระบบใหม่' };
    }

    return { status: 500, code: 'INTERNAL_SERVER_ERROR', message: defaultMessage };
}

function createHealthAuthProfileHandlers({
    AuthService,
    auditLogger,
    logger,
    fs,
    getRequestIp,
    sendErrorResponse,
    sendSuccessResponse,
    setAuthCookies,
    sanitizeUserPayload,
    consentManager,
    requiredConsents,
}) {
    return {
        async register(req, res) {
            try {
                logger.debug('[AuthController] Register request received');
                const idCardImage = req.file ? req.file.path : null;

                const result = await AuthService.registerHealthUser(req.body, idCardImage);

                // Cleanup file on validation failure
                if (result.status !== 201 && req.file && req.file.path) {
                    fs.unlink(req.file.path, () => { });
                }

                // Audit log on success
                if (result.status === 201 && result.body?.data?.user) {
                    const user = result.body.data.user;
                    const consentIp = getRequestIp(req);
                    const consentUa = req.headers['user-agent'];

                    // F-QA-01 (deep-qa 2026-09-06): registration used to write
                    // three audit rows in three separate locked transactions
                    // (REGISTER_SUCCESS, then one CONSENT_GRANTED per required
                    // consent, each from inside recordConsent). On an app/DB pair
                    // in two regions that alone cost ~15 network round trips.
                    // Same rows, same order, same hash chain — one transaction.
                    const auditEvents = [auditLogger.authEvent(
                        'REGISTER_SUCCESS', user.id, 'HEALTH', 'SUCCESS',
                        consentIp, consentUa, { accountType: 'INDIVIDUAL' },
                    )];

                    // COMP-006 (PDPA): persist the explicit consent captured at
                    // registration (the schema already enforced acceptance) as an
                    // auditable UserConsent trail. Non-fatal if persistence fails.
                    if (consentManager && Array.isArray(requiredConsents)) {
                        try {
                            const { auditEvents: consentEvents, failures } = await consentManager.recordRegistrationConsents({
                                userId: user.id,
                                // The row we just created already carries the
                                // tenant — one lookup per consent saved.
                                organizationId: user.organizationId,
                                categories: requiredConsents,
                                ipAddress: consentIp,
                                userAgent: consentUa,
                                metadata: { source: 'REGISTRATION' },
                            });
                            auditEvents.push(...consentEvents);
                            for (const { category, error } of failures || []) {
                                logger.error(
                                    `[AuthController] consent persist failed (${category}, non-fatal): ${error?.message}`,
                                );
                            }
                        } catch (e) {
                            logger.error(
                                `[AuthController] consent persist failed (non-fatal): ${e.message}`,
                            );
                        }
                    }

                    await auditLogger.logMany(auditEvents);

                    result.body.data.user = sanitizeUserPayload(user);
                }

                if (result.status >= 400) {
                    return sendErrorResponse(res, req, {
                        status: result.status,
                        code: result.body.code,
                        message: result.body.error,
                        messageTh: result.body.messageTh,
                    });
                }
                return sendSuccessResponse(res, req, {
                    status: result.status,
                    message: result.body.message,
                    data: result.body.data,
                });

            } catch (error) {
                logger.error('[AuthController] Register error:', error.message);
                if (req.file && req.file.path) {
                    fs.unlink(req.file.path, (err) => {
                        if (err) {
                            logger.error('[AuthController] File cleanup failed:', err.message);
                        }
                    });
                }
                return sendErrorResponse(res, req, { status: 500, code: 'REGISTER_FAILED', message: error.message });
            }
        },

        async login(req, res) {
            try {
                const { password, accountType, identifier, healthId, providerId } = req.body || {};
                const loginId = healthId || providerId || identifier;

                const authOptions = {
                    // /auth/health/login is the HEALTH portal — block any provider
                    // account from getting a token here, regardless of which field
                    // (identifier / healthId / providerId) the client sent.
                    expectedPortal: 'HEALTH',
                };
                if (healthId) {
                    authOptions.healthId = healthId;
                }
                if (providerId) {
                    authOptions.providerId = providerId;
                }

                if (!loginId || !password) {
                    return sendErrorResponse(res, req, {
                        status: 400,
                        code: 'MISSING_CREDENTIALS',
                        message: 'Please provide identifier and password',
                    });
                }

                const result = await AuthService.login(loginId, password, accountType, authOptions);

                // ─── Per-user 2FA challenge (any account with 2FA enabled) ───
                // BUGFIX: AuthService.login returns {mfaRequired:true} with NO token
                // for a twoFactorEnabled user. The old code only minted a challenge
                // under REQUIRE_MFA_FOR_PRIVILEGED && privileged-role, so a 2FA HEALTH
                // user (or any 2FA user with the flag off) fell through to
                // setAuthCookies(res, result.token=undefined, ...) → a broken "success"
                // with cookie='undefined'. The challenge must fire on result.mfaRequired
                // itself, independent of the privileged-enforcement flag.
                if (result.mfaRequired) {
                    const { mintMfaChallengeToken } = require('../../shared/mfa-challenge-binding');
                    // TOTP is the only second factor since 2026-09-15 (no email OTP);
                    // the mint helper refuses any other method, fail closed.
                    const mfaSessionToken = mintMfaChallengeToken({
                        userId: result.user.id,
                        method: result.twoFactorMethod,
                        ip: getRequestIp(req),
                        userAgent: req.headers['user-agent'],
                        tokenType: 'public',
                    });
                    await auditLogger.logAuth(
                        'MFA_CHALLENGE_ISSUED',
                        result.user.id,
                        result.user.role,
                        'PENDING',
                        getRequestIp(req),
                        req.headers['user-agent'],
                        { accountType, identifier: loginId?.substring(0, 4) + '****' },
                    );
                    return sendSuccessResponse(res, req, {
                        message: 'กรุณายืนยัน MFA เพื่อเข้าสู่ระบบ',
                        data: {
                            mfa_required: true,
                            mfa_session: mfaSessionToken,
                        },
                    });
                }

                // ─── P1-6: privileged-role MFA *enforcement* (separate lever) ───
                // For privileged roles that have NOT set up 2FA, optionally force/warn
                // when REQUIRE_MFA_FOR_PRIVILEGED is on. (2FA-enrolled users already
                // returned above via result.mfaRequired.)
                //
                // users.role is canonical (migration 20260801000000). The old
                // list held 'ADMIN' (matched nothing post-migration) and
                // 'PROVIDER' (a quarantined value no row has EVER held — it is
                // an accountType, not a role), so the lever had gone dead.
                // Only the value that actually matched pre-migration is kept.
                const PRIVILEGED_ROLES = [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM];
                const requireMfa = process.env.REQUIRE_MFA_FOR_PRIVILEGED === 'true';
                if (requireMfa && PRIVILEGED_ROLES.includes(result.user.role) && !result.user.twoFactorEnabled) {
                    // MFA not set up yet — warn but allow login for now.
                    logger.warn(`[AuthController] Privileged user ${result.user.id} (${result.user.role}) logged in without MFA`);
                }
                // ─── End MFA ───

                const csrfToken = setAuthCookies(res, result.token, result.refreshToken);
                const safeUser = sanitizeUserPayload(result.user);
                const accessToken = result.token;
                const refreshToken = result.refreshToken || '';

                await auditLogger.logAuth(
                    'LOGIN_SUCCESS',
                    result.user.id,
                    result.user.role,
                    'SUCCESS',
                    getRequestIp(req),
                    req.headers['user-agent'],
                    { accountType, identifier: loginId?.substring(0, 4) + '****' },
                );

                return sendSuccessResponse(res, req, {
                    message: 'Login successful',
                    data: {
                        tokens: { accessToken, refreshToken },
                        user: safeUser,
                        csrfToken,
                    },
                    extra: {
                        tokens: { access_token: accessToken, refresh_token: refreshToken },
                        user: safeUser,
                    },
                });

            } catch (error) {
                logger.error('[AuthController] Login error:', error.message);

                try {
                    // M-1 (audit 2026-06-11): mask the identifier — the raw
                    // 13-digit national ID must NOT land in AuditLog.metadata
                    // (plaintext + GIN-indexed). Failed-login rows often carry a
                    // typo / someone else's ID / enumeration probes, so storing
                    // the cleartext violates PDPA data-minimization. Masked the
                    // same way as the success/MFA paths in this file.
                    const failedIdentifier = req.body?.identifier || req.body?.healthId;
                    await auditLogger.logAuth(
                        'LOGIN_FAILURE',
                        'ANONYMOUS',
                        'PUBLIC',
                        'FAILURE',
                        getRequestIp(req),
                        req.headers['user-agent'],
                        {
                            error: error.message,
                            identifier: failedIdentifier ? `${String(failedIdentifier).substring(0, 4)}****` : null,
                        },
                    );
                } catch (auditError) {
                    logger.error('[AuthController] Audit log error:', auditError.message);
                }

                const { status, code, message, messageTh } = mapLoginError(error.message);
                return sendErrorResponse(res, req, { status, code, message, messageTh });
            }
        },

        async getMe(req, res) {
            try {
                if (!req.user || !req.user.id) {
                    return sendErrorResponse(res, req, {
                        status: 401,
                        code: 'UNAUTHORIZED',
                        message: 'Authentication required',
                        messageTh: 'ไม่ได้รับอนุญาตให้เข้าใช้งาน กรุณาเข้าสู่ระบบใหม่',
                    });
                }

                const user = await AuthService.getProfile(req.user.id);
                return sendSuccessResponse(res, req, { data: sanitizeUserPayload(user) });

            } catch (error) {
                logger.error('[AuthController] Get profile error:', error.message);
                const mapped = mapProfileError(error.message, 'ไม่สามารถดึงข้อมูลผู้ใช้งานได้ กรุณาลองใหม่');
                return sendErrorResponse(res, req, mapped);
            }
        },

        /**
         * Check if identifier (ID Card / Tax ID / CE No) already exists
         * POST /auth/check-identifier
         * Used for real-time validation at registration Step 2
         */
        async checkIdentifier(req, res) {
            try {
                const requestedAccountType = String(req.body?.accountType || 'INDIVIDUAL').trim().toUpperCase();
                const identifier = String(req.body?.identifier || '').trim();

                if (requestedAccountType !== 'INDIVIDUAL') {
                    return res.status(400).json({
                        success: false,
                        error: 'Health registration supports INDIVIDUAL only',
                        code: 'HEALTH_REGISTER_INDIVIDUAL_ONLY',
                        available: false,
                    });
                }

                if (!identifier) {
                    return res.status(400).json({
                        success: false,
                        error: 'Missing identifier',
                        code: 'MISSING_IDENTIFIER',
                        available: false,
                    });
                }

                const cleanId = identifier.replace(/-/g, '');
                if (cleanId.length !== 13) {
                    return res.status(400).json({
                        success: false,
                        error: 'Identifier must be 13 digits',
                        available: false,
                    });
                }

                if (!/^\d+$/.test(cleanId)) {
                    return res.status(400).json({
                        success: false,
                        error: 'Identifier must contain digits only',
                        available: false,
                    });
                }

                const isDuplicate = await AuthService.checkIdentifierExists(cleanId, 'INDIVIDUAL');
                if (isDuplicate) {
                    return res.status(200).json({
                        success: true,
                        available: false,
                        error: 'Identifier is already registered',
                    });
                }

                return res.status(200).json({
                    success: true,
                    available: true,
                    message: 'Identifier is available',
                });

            } catch (error) {
                logger.error('[AuthController] Check Identifier Error:', error.message);
                let statusCode = 500;
                let errorMessage = 'Unable to validate identifier right now';

                if (error.message.includes('Rate limit')) {
                    statusCode = 429;
                    errorMessage = 'Too many validation requests';
                }

                return res.status(statusCode).json({
                    success: false,
                    error: errorMessage,
                    available: false,
                    timestamp: new Date().toISOString(),
                    requestId: req.id || 'unknown',
                });
            }
        },

        async updateProfile(req, res) {
            try {
                const userId = req.user.id;
                const data = req.body || {};

                // Reject wrong-typed fields up front — otherwise an array/object
                // value flows into prisma.user.update and raises a
                // PrismaClientValidationError that mapProfileError turns into a 500.
                const STRING_FIELDS = [
                    'firstName', 'lastName', 'phoneNumber', 'address',
                    'province', 'district', 'subdistrict', 'zipCode', 'companyName',
                    'email',
                ];
                for (const field of STRING_FIELDS) {
                    if (data[field] !== undefined && data[field] !== null && typeof data[field] !== 'string') {
                        return sendErrorResponse(res, req, {
                            status: 400,
                            code: 'VALIDATION_ERROR',
                            message: `${field} must be a string`,
                        });
                    }
                }

                const updateData = {};
                if (data.firstName) { updateData.firstName = data.firstName; }
                if (data.lastName) { updateData.lastName = data.lastName; }
                if (data.phoneNumber) { updateData.phoneNumber = data.phoneNumber; }
                if (data.address) { updateData.address = data.address; }
                if (data.province) { updateData.province = data.province; }
                if (data.district) { updateData.district = data.district; }
                if (data.subdistrict) { updateData.subdistrict = data.subdistrict; }
                if (data.zipCode) { updateData.zipCode = data.zipCode; }
                if (data.companyName) { updateData.companyName = data.companyName; }

                // Email is contact data only: since 2026-09-15/16 it is neither a second
                // factor nor a password-reset channel (operator: login is หมอพร้อม/ThaID,
                // no forgot-password by email or SMS). A FIRST-TIME set is allowed.
                // CHANGING an established address still goes through DTAM staff — the
                // old account-takeover reason (repointing a reset inbox) is gone, but
                // loosening it is a separate, owner-gated decision.
                if (typeof data.email === 'string' && data.email.trim()) {
                    const newEmail = data.email.trim().toLowerCase();
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
                        return sendErrorResponse(res, req, {
                            status: 400,
                            code: 'VALIDATION_ERROR',
                            message: 'รูปแบบอีเมลไม่ถูกต้อง',
                        });
                    }
                    // Fast path: when the submitted email matches the SESSION's email
                    // (from the verified JWT), it's an unchanged resend — which the
                    // profile form does on every name/phone-only save. Treat it as a
                    // no-op WITHOUT a DB read, so a normal save neither pays a round-trip
                    // nor gets fail-closed 503'd on a transient read fault. This cannot
                    // bypass the change-gate: a real change submits a DIFFERENT address,
                    // which never equals the session email and always falls through to
                    // the authoritative read below.
                    const sessionEmail = (req.user?.email || '').trim().toLowerCase();
                    if (!sessionEmail || sessionEmail !== newEmail) {
                        // FAIL CLOSED: positively read the current email before deciding
                        // "first-time set" vs "change". A swallowed read error (the old
                        // `.catch(()=>null)`) would make a transient DB fault look like
                        // "no email on file" and let the 409 change-gate be bypassed — an
                        // account-takeover window (golden rule #3). A genuine missing row
                        // for an authenticated session is anomalous → 404, not first-time.
                        let current;
                        try {
                            current = await AuthService.getProfile(userId);
                        } catch (readErr) {
                            logger.error('[AuthController] email-gate getProfile read failed:', readErr?.message || readErr);
                            return sendErrorResponse(res, req, {
                                status: 503,
                                code: 'EMAIL_GATE_READ_FAILED',
                                message: 'ไม่สามารถตรวจสอบสถานะอีเมลได้ชั่วคราว กรุณาลองใหม่อีกครั้ง',
                            });
                        }
                        if (!current) {
                            return sendErrorResponse(res, req, {
                                status: 404,
                                code: 'NOT_FOUND',
                                message: 'ไม่พบข้อมูลผู้ใช้งานนี้ในระบบ',
                            });
                        }
                        const currentEmail = (current.email || '').trim().toLowerCase();
                        if (!currentEmail) {
                            updateData.email = newEmail; // first-time set (verified empty)
                        } else if (currentEmail !== newEmail) {
                            return sendErrorResponse(res, req, {
                                status: 409,
                                code: 'EMAIL_CHANGE_REQUIRES_VERIFICATION',
                                message: 'การเปลี่ยนอีเมลต้องยืนยันตัวตนก่อน กรุณาติดต่อเจ้าหน้าที่ DTAM',
                            });
                        }
                        // same email (DB) → no-op (do not include in updateData)
                    }
                    // sessionEmail === newEmail → unchanged → no-op
                }

                // Nothing recognised to update → 400 (AuthService otherwise throws
                // a generic 'No valid fields to update' that surfaced as a 500).
                if (Object.keys(updateData).length === 0) {
                    return sendErrorResponse(res, req, {
                        status: 400,
                        code: 'VALIDATION_ERROR',
                        message: 'No valid fields to update',
                    });
                }

                const user = await AuthService.updateProfile(userId, updateData);

                return sendSuccessResponse(res, req, {
                    message: 'อัปเดตข้อมูลส่วนตัวสำเร็จ',
                    data: sanitizeUserPayload(user),
                });

            } catch (error) {
                logger.error('[AuthController] Update profile error:', error.message);
                const mapped = mapProfileError(error.message, 'ไม่สามารถอัปเดตข้อมูลส่วนตัวได้ กรุณาลองใหม่');
                return sendErrorResponse(res, req, mapped);
            }
        },
    };
}

module.exports = { createHealthAuthProfileHandlers, mapLoginError };
