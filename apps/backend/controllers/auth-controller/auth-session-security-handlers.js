const { canAccountHoldSession } = require('../../shared/account-status');
const { lookup } = require('../../shared/error-codes');

function createAuthSessionSecurityHandlers({
    AuthService,
    auditLogger,
    jwtConfig,
    logger,
    getRequestIp,
    sendErrorResponse,
    sendSuccessResponse,
    setAuthCookies,
    // BE-AUTH-03-03 (session epoch): resolves { id, sessionsRevokedAt } for the
    // refresh-token owner so /refresh can reject a token issued before the last
    // password change/reset. SECU-03 added { status, isDeleted } so a disabled
    // owner is refused too, and `role` because canAccountHoldSession holds staff
    // to ACTIVE only (a row read without role is judged by the applicant rule).
    // Injectable for unit tests; defaults to a LAZY
    // prisma read (required inside the fn so importing this module never triggers
    // the prisma-database process.exit on a DATABASE_URL-less test env).
    fetchUserForSessionEpoch = async (userId) => {
        const { prisma } = require('../../services/prisma-database');
        return prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, sessionsRevokedAt: true, status: true, isDeleted: true, role: true },
        });
    },
}) {
    /**
     * Change the CALLER's own password: old + new, never someone else's
     * (req.user.id only). One body for both doors so a staff member and an
     * applicant get the same checks, the same errors and the same session
     * revocation — `actorType` only labels the audit row.
     *   HEALTH   → POST /auth/health/change-password   (authenticateHealth)
     *   PROVIDER → POST /auth/provider/change-password (authenticateProvider),
     *              added 2026-09-26 (operator: "ปิด + เพิ่มเปลี่ยนรหัสของตัวเองให้เจ้าหน้าที่")
     *              when the staff directory stopped setting passwords.
     */
    async function changeOwnPassword(req, res, actorType) {
        try {
            const { oldPassword, newPassword } = req.body;
            const userId = req.user.id;

            if (!oldPassword || !newPassword) {
                return sendErrorResponse(res, req, {
                    status: 400,
                    code: 'VALIDATION_ERROR',
                    message: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่',
                });
            }

            if (newPassword.length < 8) {
                return sendErrorResponse(res, req, {
                    status: 400,
                    code: 'VALIDATION_ERROR',
                    message: 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 8 ตัวอักษร',
                });
            }

            await AuthService.changePassword(userId, oldPassword, newPassword);

            await auditLogger.logAuth(
                'PASSWORD_CHANGE',
                userId,
                actorType,
                'SUCCESS',
                getRequestIp(req),
                req.headers['user-agent'],
            );

            return sendSuccessResponse(res, req, { message: 'เปลี่ยนรหัสผ่านสำเร็จ' });

        } catch (error) {
            logger.error('[AuthController] Change password error:', error.message);

            let status = 500;
            let code = 'INTERNAL_SERVER_ERROR';
            let message = 'ไม่สามารถเปลี่ยนรหัสผ่านได้';

            if (error.message === 'รหัสผ่านเดิมไม่ถูกต้อง') {
                status = 400;
                code = 'INVALID_CREDENTIALS';
                message = 'รหัสผ่านเดิมไม่ถูกต้อง';
            } else if (error.code === 'ACCOUNT_LOCKED') {
                status = 423;
                code = 'ACCOUNT_LOCKED';
                message = 'บัญชีถูกล็อกชั่วคราวเพราะกรอกรหัสผ่านผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่';
            }

            // Failed attempts are audited (security re-review 2026-09-26, LOW):
            // reason + count only, never a password or a hash.
            if (status === 400 || status === 423) {
                const failure = code === 'ACCOUNT_LOCKED'
                    ? { reason: 'ACCOUNT_LOCKED', ...(error.failedAttempts ? { failedAttempts: error.failedAttempts } : {}) }
                    : { reason: 'WRONG_CURRENT_PASSWORD', failedAttempts: error.failedAttempts };
                try {
                    await auditLogger.logAuth(
                        'PASSWORD_CHANGE',
                        req.user?.id,
                        actorType,
                        'FAILURE',
                        getRequestIp(req),
                        req.headers['user-agent'],
                        failure,
                    );
                } catch (auditErr) {
                    logger.error('[AuthController] change-password failure audit failed:', auditErr?.message);
                }
            }

            return sendErrorResponse(res, req, { status, code, message });
        }
    }

    return {
        /**
         * Change Password (applicant)
         */
        async changePassword(req, res) {
            return changeOwnPassword(req, res, 'HEALTH');
        },

        /**
         * Change Password (staff) — the caller's own password only
         */
        async changeProviderPassword(req, res) {
            return changeOwnPassword(req, res, 'PROVIDER');
        },

        // requestPasswordReset was removed 2026-09-16 (operator: no forgot-password
        // by email or SMS). The staff-issued reset token that remained went on
        // 2026-09-17 (operator: no account recovery), so no reset starts anywhere.

        /**
         * Upload Avatar (Profile Image)
         */
        async uploadAvatar(req, res) {
            try {
                const userId = req.user.id;

                if (!req.file) {
                    return sendErrorResponse(res, req, {
                        status: 400,
                        code: 'VALIDATION_ERROR',
                        message: 'กรุณาเลือกไฟล์รูปภาพ',
                    });
                }

                const fileUrl = `/uploads/${req.file.filename}`;
                const { prisma } = require('../../services/prisma-database');
                const currentUser = await prisma.user.findUnique({ where: { id: userId } });
                const currentSettings = currentUser.privacySettings || {};

                await prisma.user.update({
                    where: { id: userId },
                    data: {
                        privacySettings: {
                            ...currentSettings,
                            avatar: fileUrl,
                        },
                    },
                });

                return sendSuccessResponse(res, req, {
                    message: 'อัปโหลดรูปโปรไฟล์สำเร็จ',
                    data: { profileImage: fileUrl },
                });

            } catch (error) {
                logger.error('[AuthController] Avatar upload error:', error.message);
                return sendErrorResponse(res, req, {
                    status: 500,
                    code: 'UPLOAD_FAILED',
                    message: 'ไม่สามารถอัปโหลดรูปภาพได้',
                });
            }
        },

        /**
         * Refresh Access Token
         * POST /auth/health/refresh
         */
        async refreshToken(req, res) {
            try {
                const { refreshToken } = req.body;
                const cookieRefreshToken = req.cookies?.refresh_token;
                const token = refreshToken || cookieRefreshToken;

                if (!token) {
                    return sendErrorResponse(res, req, {
                        status: 400,
                        code: 'NO_REFRESH_TOKEN',
                        message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
                    });
                }

                const config = jwtConfig.loadJWTConfiguration();
                let decoded;

                try {
                    decoded = jwtConfig.verifyRefreshToken(token, 'public', config);
                } catch (_verifyError) {
                    res.clearCookie('auth_token', { path: '/' });
                    res.clearCookie('refresh_token', { path: '/' });
                    res.clearCookie('csrf_token', { path: '/' });

                    return sendErrorResponse(res, req, {
                        status: 401,
                        code: _verifyError.code || 'INVALID_REFRESH_TOKEN',
                        message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
                    });
                }

                // Sprint 7 (follow-up to Wave-D): refresh-token BLOCKLIST gate.
                //
                // Signature is valid, but the JTI may have been revoked by:
                //   - a prior /refresh that rotated this token away (single-use)
                //   - /logout
                //   - reuse-detection on a sibling token
                //
                // If we see a blocklisted JTI, this is either (a) a benign
                // duplicate /refresh from a confused client or (b) RT theft
                // and the attacker is replaying a token we already rotated.
                // We can't distinguish at this layer, so we assume the worst
                // and invalidate the entire session family — every honest
                // device must re-login, but the attacker is locked out too.
                //
                // The blocklist check requires a `jti` claim. Refresh tokens
                // minted by `generateRefreshToken` always carry one (see
                // config/jwt-security.js). Tokens missing `jti` are pre-Wave-D
                // legacy artifacts; we treat the absence as untrustworthy and
                // reject, mirroring the access-token JTI enforcement policy.
                const tokenRevocationService = require('../../services/token-revocation-service');
                const {
                    isRefreshTokenBlocklisted,
                    blocklistRefreshToken,
                    invalidateSessionFamily,
                    isSessionFamilyBlocklisted,
                    revokeAllUserTokens,
                } = tokenRevocationService;

                const rtJti = typeof decoded.jti === 'string' ? decoded.jti.trim() : '';
                if (!rtJti) {
                    res.clearCookie('auth_token', { path: '/' });
                    res.clearCookie('refresh_token', { path: '/' });
                    res.clearCookie('csrf_token', { path: '/' });
                    return sendErrorResponse(res, req, {
                        status: 401,
                        code: 'REFRESH_TOKEN_NO_JTI',
                        message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
                    });
                }

                // Sprint 7 Issue B: session-family claim. New logins mint a
                // `sessionFamilyId` (random UUID) into both AT and RT payloads;
                // we propagate it through every /refresh rotation. The claim
                // lets us scope reuse-detection invalidation to just the
                // compromised device tree rather than logging the user out
                // everywhere. Tokens minted BEFORE this change won't carry the
                // claim — fall back to the old user-wide revocation so we
                // don't silently lose protection during the migration window.
                const sessionFamilyId = typeof decoded.sessionFamilyId === 'string' && decoded.sessionFamilyId.trim()
                    ? decoded.sessionFamilyId.trim()
                    : null;

                try {
                    // First gate: is this exact RT JTI on the rotation blocklist?
                    const isBlocked = await isRefreshTokenBlocklisted(rtJti);
                    // Second gate: is the whole session family revoked (sibling
                    // RT was replayed earlier, blasting the entire chain)? Only
                    // meaningful when the token carries a family claim.
                    const isFamilyBlocked = sessionFamilyId
                        ? await isSessionFamilyBlocklisted(sessionFamilyId)
                        : false;

                    if (isBlocked || isFamilyBlocked) {
                        // Reuse-detection: limit blast radius to the compromised
                        // device tree when a sessionFamilyId is present. For
                        // legacy tokens (no family claim) we fall back to the
                        // pre-Sprint-7 behavior (revoke ALL user RTs) so users
                        // still issued tokens before this change get the same
                        // protection while they're still circulating.
                        //
                        // Defense-in-depth (Sprint 7 Issue B follow-up,
                        // 2026-05-16): `invalidateSessionFamily` now fails
                        // CLOSED — if Redis is unreachable for the family
                        // namespace, it re-throws so we can refuse the request
                        // outright instead of silently letting the attacker's
                        // chain stay valid. The reuse-detection path is a
                        // known-attack signal; we explicitly choose 503
                        // (service-unavailable + audit log) over issuing fresh
                        // tokens to either party.
                        try {
                            if (sessionFamilyId) {
                                await invalidateSessionFamily(sessionFamilyId);
                            } else {
                                await revokeAllUserTokens(decoded.id);
                            }
                        } catch (familyErr) {
                            logger.error('[AuthController] refresh: session-family invalidation FAILED CLOSED — refusing /refresh', {
                                error: familyErr.message,
                                userId: decoded.id,
                                sessionFamilyId,
                            });

                            // Audit the security event even though we couldn't
                            // record the blocklist entry — operators need to
                            // see the reuse signal for incident response.
                            try {
                                await auditLogger.logAuth(
                                    'REFRESH_TOKEN_REUSE_INVALIDATION_FAILED',
                                    decoded.id,
                                    'HEALTH',
                                    'BLOCKED',
                                    getRequestIp(req),
                                    req.headers['user-agent'],
                                );
                            } catch (auditErr) {
                                logger.warn('[AuthController] refresh-reuse-fail audit log failed:', auditErr.message);
                            }

                            res.clearCookie('auth_token', { path: '/' });
                            res.clearCookie('refresh_token', { path: '/' });
                            res.clearCookie('csrf_token', { path: '/' });

                            return sendErrorResponse(res, req, {
                                status: 503,
                                code: 'REFRESH_TOKEN_INVALIDATION_UNAVAILABLE',
                                message: 'ระบบยืนยันเซสชันไม่พร้อมใช้งาน กรุณาเข้าสู่ระบบใหม่',
                            });
                        }

                        try {
                            await auditLogger.logAuth(
                                'REFRESH_TOKEN_REUSE_DETECTED',
                                decoded.id,
                                'HEALTH',
                                'BLOCKED',
                                getRequestIp(req),
                                req.headers['user-agent'],
                            );
                        } catch (auditErr) {
                            logger.warn('[AuthController] refresh-reuse audit log failed:', auditErr.message);
                        }

                        res.clearCookie('auth_token', { path: '/' });
                        res.clearCookie('refresh_token', { path: '/' });
                        res.clearCookie('csrf_token', { path: '/' });

                        return sendErrorResponse(res, req, {
                            status: 401,
                            code: 'REFRESH_TOKEN_REVOKED',
                            message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
                        });
                    }
                } catch (blocklistErr) {
                    // isRefreshTokenBlocklisted fails CLOSED internally, so any
                    // exception bubbling here is a programming error, not a
                    // Redis outage. Log and reject defensively.
                    logger.error('[AuthController] refresh blocklist check threw:', blocklistErr.message);
                    res.clearCookie('auth_token', { path: '/' });
                    res.clearCookie('refresh_token', { path: '/' });
                    res.clearCookie('csrf_token', { path: '/' });
                    return sendErrorResponse(res, req, {
                        status: 401,
                        code: 'REFRESH_TOKEN_CHECK_FAILED',
                        message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
                    });
                }

                // BE-AUTH-03-03 (session epoch): a valid, non-blocklisted RT can
                // still be a STOLEN copy whose owner has since changed/reset their
                // password. The password flow stamps User.sessionsRevokedAt; here
                // we re-fetch the owner and reject any RT minted before that
                // instant. FAIL-CLOSED: if the re-fetch throws or the user is gone,
                // we refuse to mint (never fall through) — a token we cannot
                // validate against the live epoch is treated as suspect.
                let sessionOwner;
                try {
                    sessionOwner = await fetchUserForSessionEpoch(decoded.id);
                } catch (fetchErr) {
                    logger.error('[AuthController] refresh: session-epoch user re-fetch FAILED — refusing /refresh', {
                        error: fetchErr.message,
                        userId: decoded.id,
                    });
                    res.clearCookie('auth_token', { path: '/' });
                    res.clearCookie('refresh_token', { path: '/' });
                    res.clearCookie('csrf_token', { path: '/' });
                    return sendErrorResponse(res, req, {
                        status: 503,
                        code: 'REFRESH_SESSION_CHECK_UNAVAILABLE',
                        message: 'ระบบยืนยันเซสชันไม่พร้อมใช้งาน กรุณาเข้าสู่ระบบใหม่',
                    });
                }

                if (!sessionOwner) {
                    // User row gone (deleted / anonymized) — never mint.
                    res.clearCookie('auth_token', { path: '/' });
                    res.clearCookie('refresh_token', { path: '/' });
                    res.clearCookie('csrf_token', { path: '/' });
                    return sendErrorResponse(res, req, {
                        status: 401,
                        code: 'REFRESH_TOKEN_REVOKED',
                        message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
                    });
                }

                // SECU-03: disabling an account stamps the epoch below, but a
                // status written without the stamp, or a token minted after it,
                // must not renew either. Same rule as every login door.
                if (!canAccountHoldSession(sessionOwner)) {
                    try {
                        await auditLogger.logAuth(
                            'REFRESH_TOKEN_REFUSED_ACCOUNT_INACTIVE',
                            decoded.id,
                            'HEALTH',
                            'BLOCKED',
                            getRequestIp(req),
                            req.headers['user-agent'],
                        );
                    } catch (auditErr) {
                        logger.warn('[AuthController] refresh-inactive audit log failed:', auditErr.message);
                    }
                    res.clearCookie('auth_token', { path: '/' });
                    res.clearCookie('refresh_token', { path: '/' });
                    res.clearCookie('csrf_token', { path: '/' });
                    const row = lookup('ACCOUNT_INACTIVE');
                    return sendErrorResponse(res, req, {
                        status: row.httpStatus,
                        code: row.code,
                        message: row.messageEn,
                        messageTh: row.messageTh,
                    });
                }

                const revokedAtMs = sessionOwner.sessionsRevokedAt
                    ? new Date(sessionOwner.sessionsRevokedAt).getTime()
                    : null;
                // decoded.iat is epoch SECONDS (JWT standard) → ×1000 for ms compare.
                const rtIssuedAtMs = typeof decoded.iat === 'number' ? decoded.iat * 1000 : null;
                if (revokedAtMs !== null && rtIssuedAtMs !== null && rtIssuedAtMs < revokedAtMs) {
                    try {
                        await auditLogger.logAuth(
                            'REFRESH_TOKEN_REVOKED_BY_EPOCH',
                            decoded.id,
                            'HEALTH',
                            'BLOCKED',
                            getRequestIp(req),
                            req.headers['user-agent'],
                        );
                    } catch (auditErr) {
                        logger.warn('[AuthController] refresh-epoch audit log failed:', auditErr.message);
                    }
                    res.clearCookie('auth_token', { path: '/' });
                    res.clearCookie('refresh_token', { path: '/' });
                    res.clearCookie('csrf_token', { path: '/' });
                    return sendErrorResponse(res, req, {
                        status: 401,
                        code: 'REFRESH_TOKEN_REVOKED',
                        message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
                    });
                }

                // Mirror the (already-stripped) login payload shape — see
                // services/prisma-auth-service.js login() `tokenPayload`. The
                // new access/refresh tokens MUST carry only the same minimal
                // claims that login() mints today; the old behaviour of
                // forwarding everything from the decoded RT was the source
                // of two security gaps:
                //
                //   Sprint 7 Issue A (2026-05-16): PDPA — plaintext healthId /
                //   providerId. The login flow stopped embedding these PDPA-
                //   class identifiers in JWTs (Sprint 6 healthId-audit
                //   Phase B-M1), but ANY user who logged in BEFORE that fix
                //   still carries them in their refresh token. Forwarding the
                //   decoded claims unfiltered would re-emit the leak into
                //   every newly-issued access token for the next 7 days
                //   (the RT lifetime). We strip these claims unconditionally
                //   regardless of what the incoming RT carried.
                //
                //   PR #178 history: the original forwarding was only
                //   `{id, role, organizationId}` — three claims. The fix
                //   that came later added the full set; this one trims it
                //   back to exactly the login claim set.
                //
                // Excludes refresh-specific fields (`tokenType`, `iat`,
                // `exp`, `jti`, `iss`, `aud`) so the new tokens get fresh
                // correctly-scoped versions from the JWT library. NEVER add
                // healthId / providerId / idCard / taxId / communityRegistrationNo
                // back to this payload — they are PDPA-class identifiers.
                const renewedPayload = {
                    id: decoded.id,
                    role: decoded.role,
                    canonicalRole: decoded.canonicalRole || null,
                    userType: decoded.userType || null,
                    accountType: decoded.accountType || null,
                    accountTier: decoded.accountTier || 'NORMAL',
                    authType: decoded.authType || null,
                    twoFactorEnabled: decoded.twoFactorEnabled || false,
                    // ADR-014: forward the tenant claim across token refresh
                    // so the new access token continues to short-circuit
                    // the tenant-context-middleware DB lookup.
                    organizationId: decoded.organizationId || null,
                    email: decoded.email || null,
                    // Sprint 7 Issue B: keep the same sessionFamilyId across
                    // every rotation in this chain. Both new tokens carry it
                    // so reuse-detection can scope its invalidation when an
                    // attacker replays a rotated RT. If the incoming RT was
                    // pre-Sprint-7 (no claim), we leave the new ones without
                    // a family ID rather than minting a fresh one — the
                    // backward-compat fallback in the reuse-detection branch
                    // (revokeAllUserTokens) handles those, and minting a new
                    // family on rotation would create an unprotected window
                    // for the existing siblings.
                    sessionFamilyId: sessionFamilyId || null,
                };
                const newAccessToken = jwtConfig.generateToken(renewedPayload);

                // Refresh-token ROTATION: every /refresh issues a new
                // refresh-token alongside the new access-token. Without
                // this, a stolen refresh-token is usable for its full 7-day
                // lifetime; with rotation, the old token is overwritten in
                // the browser cookie and only the new one is used by honest
                // clients.
                //
                // What this does NOT yet implement: server-side reuse
                // detection (Wave-D). True single-use semantics need a
                // revocation table or Redis blacklist of seen refresh-token
                // JTIs — when an old JTI is presented, the server invalidates
                // the entire session family. That's the OWASP-recommended
                // pattern but requires shared state. For pre-launch this
                // rotation alone shrinks the attacker window from "7 days"
                // to "until next refresh" (typically minutes), which is the
                // bulk of the value.
                const newRefreshToken = jwtConfig.generateRefreshToken(renewedPayload);

                const csrfToken = setAuthCookies(res, newAccessToken, newRefreshToken);

                // Sprint 7 (Wave-D follow-up): blocklist the OLD refresh-token
                // JTI now that rotation has succeeded. Single-use semantics
                // mean a second presentation of `rtJti` will hit the gate
                // above and trigger reuse-detection. We compute remaining
                // TTL from `decoded.exp` (epoch seconds) so the blocklist
                // entry expires no later than the natural token exp — there
                // is no value in storing a revocation record past the point
                // where jwt.verify would reject it as expired anyway.
                try {
                    const nowSeconds = Math.floor(Date.now() / 1000);
                    const remainingTtl = Math.max(60, (decoded.exp || nowSeconds) - nowSeconds);
                    await blocklistRefreshToken(rtJti, remainingTtl);
                } catch (blocklistErr) {
                    // Best-effort: if Redis fails here we still want the user
                    // to receive their new tokens. The replay window is
                    // bounded by the natural exp regardless.
                    logger.warn('[AuthController] failed to blocklist rotated RT', blocklistErr.message);
                }

                try {
                    await auditLogger.logAuth(
                        'TOKEN_REFRESHED',
                        decoded.id,
                        'HEALTH',
                        'SUCCESS',
                        getRequestIp(req),
                        req.headers['user-agent'],
                    );
                } catch (auditError) {
                    logger.warn('[AuthController] refresh audit log failed:', auditError.message);
                }

                logger.info('[AuthController] Token refreshed (rotated) for user:', decoded.id);

                return sendSuccessResponse(res, req, {
                    message: 'Token refreshed successfully',
                    data: { accessToken: newAccessToken, csrfToken },
                });

            } catch (error) {
                logger.error('[AuthController] Refresh token error:', error.message);
                return sendErrorResponse(res, req, {
                    status: 500,
                    code: 'REFRESH_FAILED',
                    message: 'ระบบเกิดข้อผิดพลาด กรุณาลองใหม่',
                });
            }
        },

        async logout(req, res) {
            try {
                const userId = req.user?.id || 'anonymous';

                // SEC-002: end the session SERVER-SIDE, not just by clearing the
                // browser's cookies. Until now logout left the access token valid
                // until its exp (≤24h) and the refresh token replayable for its
                // full 7-day TTL — so a leaked copy (XSS per SEC-003, a shared
                // machine, or in-transit capture) kept working after "logout".
                // This route has no auth middleware (it must work with an expired
                // AT), so revokeSessionFromRequest reads the tokens from the
                // cookies directly. Best-effort: never blocks the logout itself.
                const { revokeSessionFromRequest } = require('../../utils/session-revocation');
                await revokeSessionFromRequest(req, 'public');

                res.clearCookie('auth_token', { path: '/' });
                res.clearCookie('refresh_token', { path: '/' });
                res.clearCookie('csrf_token', { path: '/' });

                try {
                    await auditLogger.logAuth(
                        'LOGOUT',
                        userId,
                        'HEALTH',
                        'SUCCESS',
                        getRequestIp(req),
                        req.headers['user-agent'],
                    );
                } catch (auditError) {
                    logger.error('[AuthController] Audit log error:', auditError.message);
                }

                return sendSuccessResponse(res, req, { message: 'ออกจากระบบสำเร็จ' });

            } catch (error) {
                logger.error('[AuthController] Logout error:', error.message);
                return sendErrorResponse(res, req, {
                    status: 500,
                    code: 'LOGOUT_FAILED',
                    message: 'ระบบเกิดข้อผิดพลาด กรุณาลองใหม่',
                });
            }
        },

        async verifyToken(req, res) {
            try {
                return sendSuccessResponse(res, req, {
                    message: 'เซสชันยังใช้งานได้',
                    data: {
                        userId: req.user?.id,
                        role: req.user?.role,
                    },
                });
            } catch (_error) {
                return sendErrorResponse(res, req, {
                    status: 401,
                    code: 'TOKEN_EXPIRED',
                    message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
                });
            }
        },

        /**
         * DELETE /me — PDPA Section 33 Right-to-Erasure.
         *
         * Sprint 6 healthId-audit H7 (2026-05-15): the authenticated user can
         * request anonymisation of their own account. We:
         *   1. require a password-confirmation in the body to defeat session-hijack
         *      "delete my account" attacks;
         *   2. null every identity-bearing column and every identifier-hash column
         *      so even hash-based correlation is defeated;
         *   3. set `password = 'PDPA_ANONYMIZED'` (a non-bcrypt sentinel value so
         *      no future login can succeed against this row);
         *   4. revoke ALL of the user's sessions and blocklist the current access
         *      JTI so the deletion call's own token cannot be replayed;
         *   5. clear the auth cookies on the response.
         *
         * The row itself is NOT deleted — foreign-key relationships to Applications,
         * Invoices, Certificates etc. must remain for accounting / compliance.
         */
        async deleteMe(req, res) {
            try {
                if (!req.user || !req.user.id) {
                    return sendErrorResponse(res, req, {
                        status: 401,
                        code: 'UNAUTHENTICATED',
                        message: 'กรุณาเข้าสู่ระบบ',
                    });
                }

                const { password } = req.body || {};
                if (!password) {
                    return sendErrorResponse(res, req, {
                        status: 400,
                        code: 'PASSWORD_CONFIRMATION_REQUIRED',
                        message: 'ต้องยืนยันรหัสผ่านก่อนลบบัญชี',
                    });
                }

                const userId = req.user.id;
                const { prisma } = require('../../services/prisma-database');
                const user = await prisma.user.findUnique({ where: { id: userId } });

                if (!user) {
                    return sendErrorResponse(res, req, {
                        status: 404,
                        code: 'USER_NOT_FOUND',
                        message: 'ไม่พบบัญชีผู้ใช้',
                    });
                }

                if (user.isAnonymized === true) {
                    return sendErrorResponse(res, req, {
                        status: 410,
                        code: 'ALREADY_ANONYMIZED',
                        message: 'บัญชีนี้ถูกลบไปแล้ว',
                    });
                }

                const bcrypt = require('bcryptjs');
                const passwordMatches = await bcrypt.compare(password, user.password || '');
                if (!passwordMatches) {
                    return sendErrorResponse(res, req, {
                        status: 401,
                        code: 'INVALID_PASSWORD',
                        message: 'รหัสผ่านไม่ถูกต้อง',
                    });
                }

                const anonymizationData = {
                    // Identity fields
                    healthId: null,
                    providerId: null,
                    idCard: null,
                    taxId: null,
                    communityRegistrationNo: null,
                    // Identifier hashes — defeat hash-based correlation
                    healthIdHash: null,
                    providerIdHash: null,
                    idCardHash: null,
                    taxIdHash: null,
                    communityRegistrationNoHash: null,
                    // Personal data
                    firstName: null,
                    lastName: null,
                    email: null,
                    phoneNumber: null,
                    // Credentials — invalidate
                    password: 'PDPA_ANONYMIZED',
                    // Closing-review NEW-1: canonical column names are `twoFactor*`
                    // (auth.prisma:115-117). Earlier `mfaSecret` / `mfaBackupCodes`
                    // names do NOT exist on the User model — Prisma would throw.
                    twoFactorSecret: null,
                    twoFactorBackupCodes: null,
                    twoFactorEnabled: false,
                    // Soft-delete marker
                    isDeleted: true,
                    // Anonymisation markers — created by migration
                    // 20260803130000_add_user_anonymization_markers (`isAnonymized`
                    // NOT NULL default false, `anonymizedAt`). `anonymizedAt` is not a
                    // mere idempotency flag: it is the PDPA evidence of WHEN this
                    // erasure was performed, which is what an auditor asks for. It must
                    // never be stripped to make a failing write succeed.
                    isAnonymized: true,
                    anonymizedAt: new Date(),
                };

                // No fallback: a write that fails here has anonymized nothing (the
                // update is atomic), so it must surface to the catch below rather
                // than be retried without the markers. Same removal as #737 made in
                // jobs/pdpa-retention-job.js — completing the irreversible null-out
                // while dropping the evidence of it is worse than failing loudly.
                await prisma.user.update({ where: { id: userId }, data: anonymizationData });

                // Revoke all sessions for this user.
                const { revokeAllUserTokens, blocklistAccessToken } = require('../../services/token-revocation-service');
                try {
                    if (req.user.jti) {
                        await blocklistAccessToken(req.user.jti);
                    }
                    await revokeAllUserTokens(userId);
                } catch (revokeErr) {
                    logger.warn('[AuthController] deleteMe: session-revocation failed:', revokeErr.message);
                }

                // Clear auth cookies.
                res.clearCookie('auth_token', { path: '/' });
                res.clearCookie('refresh_token', { path: '/' });
                res.clearCookie('csrf_token', { path: '/' });

                try {
                    await auditLogger.logAuth(
                        'ACCOUNT_DELETED',
                        userId,
                        req.user.role || 'HEALTH',
                        'SUCCESS',
                        getRequestIp(req),
                        req.headers['user-agent'],
                    );
                } catch (auditErr) {
                    logger.warn('[AuthController] deleteMe: audit log failed:', auditErr.message);
                }

                return sendSuccessResponse(res, req, { message: 'ลบบัญชีเรียบร้อย' });
            } catch (error) {
                logger.error('[AuthController] deleteMe error:', error.message);
                return sendErrorResponse(res, req, {
                    status: 500,
                    code: 'DELETE_ME_FAILED',
                    message: 'ไม่สามารถลบบัญชีได้ กรุณาลองใหม่',
                });
            }
        },
    };
}

module.exports = { createAuthSessionSecurityHandlers };
