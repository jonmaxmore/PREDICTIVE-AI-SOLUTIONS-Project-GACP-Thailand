const { prisma } = require('./prisma-database');
const bcrypt = require('bcryptjs');
const jwtConfig = require('../config/jwt-security');
const {
    CANONICAL_ROLES,
    normalizeRole,
    isProviderRole,
} = require('../shared/canonical-rbac');
const crypto = require('crypto');
const { createLogger } = require('../shared/logger');
const { maskThaiId, computeLookupHmac } = require('../utils/field-encryption');
const { identityLookupColumns } = require('./auth/identity-lookup-columns');
const { resolveCanonicalIdForWrite } = require('../shared/fk-token');
const { hasUsableSecondFactor } = require('../shared/second-factor');
const { assertAccountCanHoldSession } = require('../shared/account-status');
const logger = createLogger('auth-service');

// H-4 Phase 1 (RFC docs/handoffs/H-4-national-id-hmac-migration-rfc.md):
// when `AUTH_LOOKUP_USE_HMAC === 'true'` the national-ID lookup columns switch
// from the legacy raw-SHA-256 `*Hash` columns to the keyed-HMAC `*Hmac`
// columns, and register/create DUAL-WRITES both. With the flag OFF (default)
// behaviour is byte-for-byte the current behaviour. The flag is read live (not
// cached) so a config flip needs no redeploy.
function useHmacLookup() {
    return process.env.AUTH_LOOKUP_USE_HMAC === 'true';
}
// Sprint 6 C-1/C-2: refresh-token JTI allowlist + MFA challenge are issued
// via the centralized token-revocation-service so that revocation/rotation
// can be enforced at the middleware layer. The login() flow registers a
// fresh JTI in Redis BEFORE signing the refresh token, so the signed JWT's
// jti matches the allowlist entry. MFA-enabled accounts never get tokens —
// only an opaque challenge token bound to userId.
const tokenRevocationService = require('./token-revocation-service');

// Bcrypt: OWASP recommends minimum 12 rounds
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

// Extracted sub-modules
const { changePassword } = require('./auth/password-management');
const { ensurePersonalIndividualEntity } = require('./entity-service');
class PrismaAuthService {
    // ── Private helpers (each does ONE thing) ──────────────────────────────

    /**
     * Remove internal/sensitive/non-column fields before processing.
     *
     * These keys arrive in the request body but are NOT columns on the User
     * model — they'd be spread into `prisma.user.create({ data })` and make
     * Prisma throw "Unknown argument", which surfaced as a generic
     * REGISTER_FAILED 500 for EVERY registration once COMP-006 began requiring
     * the PDPA consent booleans (acceptedTermsOfService / acceptedPrivacyPolicy
     * — validated by healthRegisterSchema, then persisted separately via
     * consentManager, never as User columns). acceptedConsent is the
     * single-checkbox alias some client builds send.
     */
    _sanitizeInput(data) {
        const cleaned = { ...(data || {}) };
        for (const key of [
            '_idCardImage', 'idCardImage',
            '_confirmPassword', 'confirmPassword',
            '_acceptTerms', 'acceptTerms',
            'acceptedTermsOfService', 'acceptedPrivacyPolicy', 'acceptedConsent',
            // Detokenize STAGE 0: canonicalId is server-derived (identity or
            // token), NEVER client-supplied. Strip it so a crafted register body
            // can't pin the FK key / pre-seed a chosen canonicalId (mass-
            // assignment defense — the explicit `canonicalId:` in user.create
            // already overrides the spread, but stripping makes it unconditional).
            'canonicalId', 'canonicalIdLegacy',
        ]) {
            delete cleaned[key];
        }
        return cleaned;
    }

    /** Resolve identity type, identifier, role, and auth type from input */
    _resolveIdentity(sanitizedInput) {
        const { identifier, healthId, providerId, ...userData } = sanitizedInput;
        const cleanHealthId = String(healthId || '').replace(/-/g, '').trim() || null;
        const cleanProviderId = String(providerId || '').replace(/-/g, '').trim() || null;
        const cleanIdentifier = String(identifier || userData.idCard || '').replace(/-/g, '').trim() || null;

        if (cleanHealthId && cleanProviderId) {
            throw new Error('Identity conflict: both healthId and providerId are not allowed');
        }

        const requestedRole = userData.role || 'HEALTH';
        const canonicalRole = normalizeRole(requestedRole)
            || (String(userData.accountType || '').toUpperCase() === 'PROVIDER'
                ? CANONICAL_ROLES.DOCUMENT_REVIEWER
                : CANONICAL_ROLES.HEALTH);
        const isProvider = isProviderRole(canonicalRole);
        const actualIdentifier = isProvider
            ? (cleanProviderId || cleanIdentifier)
            : (cleanHealthId || cleanIdentifier);

        if (!actualIdentifier || !/^\d{13}$/.test(actualIdentifier)) {
            throw new Error('Invalid identity number: expected 13 digits');
        }

        const authType = isProvider ? 'PROVIDER_ID' : 'HEALTH_ID';
        // PR 2e (contract phase): write the canonical spelling. This wrote
        // canonicalToLegacyRole(...) — the UPPERCASE legacy value — which put
        // back into users.role exactly what migration 20260801000000 had just
        // cleaned, on every single self-registration and provider signup.
        const role = canonicalRole
            || (isProvider ? CANONICAL_ROLES.FIELD_INSPECTOR : CANONICAL_ROLES.HEALTH);
        const accountType = isProvider
            ? 'PROVIDER'
            : (String(userData.accountType || '').toUpperCase() === 'PROVIDER' ? 'INDIVIDUAL' : (userData.accountType || 'INDIVIDUAL'));

        return { userData, actualIdentifier, authType, role, accountType, isProvider };
    }

    /** Check DB toggle + env for OCR bypass → determine verification status */
    async _resolveVerificationStatus() {
        let ocrBypass = false;
        try {
            // Use the Prisma model (mapped to table `system_configs` via @@map),
            // NOT a raw `FROM system_config` query — the singular raw table name
            // never existed, so this lookup always threw "relation system_config
            // does not exist" and silently fell through to the env var (the DB
            // toggle was effectively dead + it spammed prisma:error in logs).
            const row = await prisma.systemConfig.findUnique({
                where: { key: 'ocr_bypass_enabled' },
                select: { value: true },
            });
            if (row) {
                ocrBypass = String(row.value).trim().toLowerCase() === 'true';
            }
        } catch (_e) {
            // Config row/table unavailable — fall back to env var
        }
        if (!ocrBypass) {
            ocrBypass = String(process.env.ENABLE_OCR_BYPASS || 'false').trim().toLowerCase() === 'true';
        }
        return {
            status: ocrBypass ? 'ACTIVE' : 'PENDING_VERIFICATION',
            // NOTE: verificationStatus removed — field does not exist in Prisma schema
            // The 'status' field alone controls the user's verification state
        };
    }

    /**
     * Generate the lookup hashes for uniqueness checks + login lookup.
     *
     * Legacy `*Hash` columns hold RAW SHA-256 (no key) and are ALWAYS written —
     * unchanged. H-4 Phase 1: when `AUTH_LOOKUP_USE_HMAC` is on we ADDITIONALLY
     * dual-write the keyed-HMAC `*Hmac` columns (computeLookupHmac), which is
     * what login then resolves by. With the flag off the returned object is
     * byte-for-byte the legacy shape (no `*Hmac` keys), so the create payload is
     * identical to today's.
     */
    _generateHashes(actualIdCard, authType) {
        // The answer to "which columns make this id findable" now lives in ONE place,
        // because the seed used to answer it differently: it wrote *Hash only, so every
        // account it created on a host with AUTH_LOOKUP_USE_HMAC on could never log in
        // (measured on demo, 2026-09-07).
        return identityLookupColumns(actualIdCard, authType);
    }

    // ── Public API ─────────────────────────────────────────────────────────

    async register(data) {
        const sanitized = this._sanitizeInput(data);
        const identity = this._resolveIdentity(sanitized);
        const hashes = this._generateHashes(identity.actualIdentifier, identity.authType);

        logger.info('[AuthService] Register:', {
            authType: identity.authType,
            id: identity.actualIdentifier ? maskThaiId(identity.actualIdentifier) : null,
        });

        // F-QA-01 (deep-qa 2026-09-06 — registration measured at 5.6 s median):
        // these three steps do not depend on each other. The OCR-bypass config
        // read and the default-org read are two separate crossings to a
        // Supabase in another region (~364 ms each, measured), and bcrypt at 12
        // rounds is ~664 ms of CPU that bcryptjs yields the event loop during.
        // Run them together: the wall cost becomes the slowest one instead of
        // the sum. Nothing here mutates, so ordering carries no meaning.
        //
        // ADR-014: every user belongs to an organization. Public self-registration
        // lands new applicants in the default tenant. Tenant onboarding flows
        // (creating a new org) go through a different code path.
        const [verification, defaultOrg, hashedPassword] = await Promise.all([
            this._resolveVerificationStatus(),
            prisma.organization.findUnique({ where: { slug: 'default' } }),
            bcrypt.hash(identity.userData.password, BCRYPT_ROUNDS),
        ]);
        if (!defaultOrg) {
            const err = new Error('Default organization missing — DB not seeded');
            err.code = 'NO_DEFAULT_ORG';
            throw err;
        }

        // Wave B Phase 67 — User and the personal INDIVIDUAL Entity must
        // be created atomically. A user without their personal entity
        // can't submit applications (Phase 66 wired Application.entityId)
        // and a partial registration that left those out of sync would
        // surface as confusing 500s downstream. Provider users skip the
        // entity creation entirely — they're staff, not legal applicants.
        const user = await prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    ...identity.userData,
                    organizationId: defaultOrg.id,
                    // Canonical ID — required FK target. Detokenize STAGE 0
                    // (RFC docs/handoffs/national-id-detokenize-rfc-2026-06-29.md):
                    // flag OFF (default) → the national ID (byte-for-byte today);
                    // flag ON (APP_FK_USE_TOKEN) → the keyed-HMAC token
                    // (isProvider ? providerIdHmac : healthIdHmac) — the same
                    // *Hmac value dual-written below, recomputed/reused via the
                    // shared resolver. No new crypto.
                    canonicalId: resolveCanonicalIdForWrite({
                        actualIdentifier: identity.actualIdentifier,
                        isProvider: identity.isProvider,
                        precomputedHmac: identity.isProvider
                            ? hashes.providerIdHmac
                            : hashes.healthIdHmac,
                    }),
                    role: identity.role,
                    accountType: identity.accountType,
                    // Legacy fields (backward compatibility)
                    idCard: identity.actualIdentifier,
                    idCardHash: hashes.idCardHash,
                    // H-4 Phase 1 dual-write: keyed-HMAC lookup columns. These
                    // keys are `undefined` (Prisma omits them) when the flag is
                    // off, so the create payload is unchanged at flag-off.
                    idCardHmac: hashes.idCardHmac,
                    // GACP Thai Standard fields
                    authType: identity.authType,
                    healthId: identity.isProvider ? null : identity.actualIdentifier,
                    healthIdHash: hashes.healthIdHash,
                    healthIdHmac: hashes.healthIdHmac,
                    providerId: identity.isProvider ? identity.actualIdentifier : null,
                    providerIdHash: hashes.providerIdHash,
                    providerIdHmac: hashes.providerIdHmac,
                    password: hashedPassword,
                    ...verification,
                },
            });

            if (!identity.isProvider && created.healthId) {
                // `isNewUser` skips the "does this user already own a personal
                // entity?" membership probe — `created.id` was minted a
                // statement ago inside this transaction, so no EntityMembership
                // can reference it. The dedup lookup on the national ID still
                // runs (an entity CAN pre-exist from a backfill). F-QA-01.
                await ensurePersonalIndividualEntity({ user: created, tx, isNewUser: true });
            }

            return created;
        });

        // [UAT Fix] Force update if status doesn't match
        if (user.status !== verification.status) {
            logger.info('[AuthService] Status mismatch. Forcing update...');
            return await prisma.user.update({
                where: { id: user.id },
                data: { status: verification.status },
            });
        }
        return user;
    }
    async login(loginId, password, accountType, options = {}) {
        const { healthId, providerId } = options;
        const actualLoginId = healthId || providerId || loginId;
        // Portal hint: callers (auth-health route vs auth-provider route) MUST
        // pass `expectedPortal: 'HEALTH' | 'PROVIDER'` so we can reject cross-portal
        // logins even when the bare `identifier` field is used. Falls back to
        // the legacy hint inferred from healthId/providerId being set.
        const explicitPortal = String(options.expectedPortal || '').toUpperCase();
        const expectedPortal = ['HEALTH', 'PROVIDER'].includes(explicitPortal)
            ? explicitPortal
            : (healthId ? 'HEALTH' : (providerId ? 'PROVIDER' : null));
        logger.info('[AuthService] Login attempt:', {
            loginId: actualLoginId ? maskThaiId(actualLoginId) : null,
            authType: healthId ? 'HEALTH_ID' : (providerId ? 'PROVIDER_ID' : 'LEGACY'),
            expectedPortal: expectedPortal || 'LEGACY',
            accountType,
        });
        try {
            // Sprint 6 healthId-audit Phase B-M5: query the `*Hash` lookup
            // columns instead of the plaintext columns.
            // H-4 Phase 1: with `AUTH_LOOKUP_USE_HMAC` OFF (default) the lookup
            // hash is raw SHA-256 of the cleaned numeric ID — matches what
            // `_generateHashes()` writes on registration (legacy `*Hash`
            // columns). With the flag ON the lookup uses the keyed-HMAC `*Hmac`
            // columns instead (computeLookupHmac). Both writers + readers agree
            // via the single `useHmacLookup()` switch.
            const cleanedLoginId = String(actualLoginId || '').replace(/-/g, '').trim();
            const isNumericId = /^\d{13}$/.test(cleanedLoginId);

            // National-ID-only login (owner directive 2026-06-11): the ONLY valid
            // login identifier is a 13-digit Thai national ID. Email is NOT a login
            // credential — the previous `{ email: actualLoginId }` OR branches are
            // removed. A non-13-digit identifier can never resolve to a user, so
            // short-circuit to a generic "invalid credentials" rather than issue a
            // query (whose WHERE would otherwise be empty/ambiguous). The route-level
            // healthLoginSchema already rejects non-ID identifiers; this is the
            // service-layer backstop for any other caller.
            if (!isNumericId) {
                logger.info('[AuthService] Login rejected: identifier is not a 13-digit national ID');
                throw new Error('Invalid credentials');
            }
            // Deterministic hash lookups only. Plaintext columns are NEVER queried
            // (Phase D-H4/H5 drops them).
            const useHmac = useHmacLookup();
            const loginIdHash = useHmac
                ? computeLookupHmac(cleanedLoginId)
                : crypto.createHash('sha256').update(cleanedLoginId).digest('hex');
            const idCardCol = useHmac ? 'idCardHmac' : 'idCardHash';
            const healthIdCol = useHmac ? 'healthIdHmac' : 'healthIdHash';
            const providerIdCol = useHmac ? 'providerIdHmac' : 'providerIdHash';

            const whereClause = {
                OR: [
                    { [idCardCol]: loginIdHash },
                    { [healthIdCol]: loginIdHash },
                    { [providerIdCol]: loginIdHash },
                ],
            };
            // If a specific auth type is hinted, prioritize that column.
            if (healthId) {
                whereClause.OR = [
                    { [healthIdCol]: loginIdHash },
                    { [idCardCol]: loginIdHash },
                ];
            } else if (providerId) {
                whereClause.OR = [
                    { [providerIdCol]: loginIdHash },
                    { [idCardCol]: loginIdHash },
                ];
            }
            const user = await prisma.user.findFirst({ where: whereClause });
            logger.info('[AuthService] User found:', user ? 'YES' : 'NO', user ? `(authType: ${user.authType})` : '');
            if (!user) {
                logger.info('[AuthService] User not found');
                throw new Error('Invalid credentials');
            }
            if (user.healthId && user.providerId) {
                throw new Error('Identity conflict: account has both healthId and providerId');
            }
            const canonicalRole = normalizeRole(user.role) || CANONICAL_ROLES.HEALTH;
            const accountIsProvider = isProviderRole(canonicalRole);

            // Portal enforcement — block cross-portal login regardless of which
            // hint field the client used. This prevents a provider from getting
            // a health-signed JWT (or vice versa) by sending only `identifier`.
            if (expectedPortal === 'HEALTH' && accountIsProvider) {
                throw new Error('Health login requires a health account. Use /auth/provider/login.');
            }
            if (expectedPortal === 'PROVIDER' && !accountIsProvider) {
                throw new Error('Provider login requires a provider account. Use /auth/health/login.');
            }
            // Legacy hints (kept for any existing call site that doesn't pass expectedPortal).
            if (providerId && !accountIsProvider) {
                throw new Error('Provider login requires a provider account');
            }
            if (healthId && accountIsProvider) {
                throw new Error('Health login requires a health account');
            }
            // [LOCKOUT CHECK]
            if (user.isLocked && user.lockedUntil && new Date() < user.lockedUntil) {
                const remainingMs = user.lockedUntil.getTime() - new Date().getTime();
                const remainingMin = Math.ceil(remainingMs / 60000);
                throw new Error(`Account locked. Try again in ${remainingMin} minutes.`);
            }
            // [AUTO UNLOCK]
            if (user.isLocked && user.lockedUntil && new Date() >= user.lockedUntil) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { isLocked: false, lockedUntil: null, loginAttempts: 0 },
                });
            }
            logger.info('[AuthService] Comparing password...');
            const passwordMatch = await bcrypt.compare(password, user.password);
            logger.info('[AuthService] Password match:', passwordMatch ? 'YES' : 'NO');
            if (!passwordMatch) {
                logger.info('[AuthService] Password incorrect');
                // [INCREMENT ATTEMPTS]
                const newAttempts = (user.loginAttempts || 0) + 1;
                const updateData = { loginAttempts: newAttempts };
                if (newAttempts >= 5) {
                    updateData.isLocked = true;
                    updateData.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
                }
                await prisma.user.update({
                    where: { id: user.id },
                    data: updateData,
                });
                if (newAttempts >= 5) {
                    throw new Error('Account locked due to too many failed attempts.');
                }
                throw new Error('Invalid credentials');
            }
            // SECU-03: a disabled / suspended / deleted account gets no session.
            // Checked only once the password matched, so a caller without the
            // password cannot use it to learn the account's state (a wrong
            // password above still answers "Invalid credentials"), and before
            // the success bookkeeping, the MFA challenge and token minting.
            assertAccountCanHoldSession(user);
            logger.info('[AuthService] Login successful for user:', user.id);
            // [RESET ATTEMPTS using updateMany or update to match id]
            await prisma.user.update({
                where: { id: user.id },
                data: { loginAttempts: 0, isLocked: false, lockedUntil: null, lastLoginAt: new Date() },
            });
            // Closing-review NEW-1: the canonical 2FA column is `twoFactorEnabled`.
            // The legacy `mfaEnabled` column was renamed in the auth.prisma schema
            // (line 115-117). Earlier code paths read `user.mfaEnabled` and silently
            // returned `undefined` so 2FA was effectively disabled for every user.
            // The fallback to `user.mfaEnabled` is kept (inside the helper) so a
            // still-mid-migration database (renamed column not yet deployed) does not
            // break login. The helper also treats a row still marked with the retired
            // EMAIL method as NOT enrolled (shared/second-factor.js, operator 2026-09-15).
            const twoFactorEnabled = hasUsableSecondFactor(user);

            // Sprint 6 healthId-audit Phase B-C1/M1: when the account has 2FA enabled
            // we MUST NOT mint access/refresh tokens at the password-only stage.
            // Instead, issue an opaque MFA challenge (5-minute single-use, Redis-backed)
            // bound to the userId. The /verify endpoint exchanges the challenge for
            // real tokens once the TOTP code is confirmed. This closes the gap where
            // a stolen password alone produced a usable JWT.
            if (twoFactorEnabled) {
                // NOTE: the actual `mfa_session` the FE receives is the JWT minted by
                // the CALLER via mintMfaChallengeToken (it has the request IP/UA for the AUTH-5
                // bind) — NOT this opaque token, which /api/mfa/verify cannot consume.
                // `twoFactorMethod` names the factor the caller must challenge — TOTP is
                // the only one left (operator 2026-09-15).
                logger.info('[AuthService] MFA challenge required', { userId: user.id });
                return {
                    user,
                    mfaRequired: true,
                    twoFactorMethod: 'TOTP',
                };
            }

            // Sprint 6 healthId-audit Phase B-M1: JWT payload MUST NOT carry plaintext
            // PII. The Thai national ID (healthId) and the provider ID are PDPA-class
            // identifiers — embedding them in a JWT means every downstream service
            // that decodes the token sees the bare national ID, and any log line that
            // dumps the payload leaks it. Identity is resolved server-side from
            // `id` (UUID) via applicationService.resolveHealthIdentity at the few
            // call sites that actually need the healthId.
            //
            // Sprint 7 follow-up (Issue B): mint a per-login `sessionFamilyId` so
            // that refresh-token reuse-detection can scope its invalidation to the
            // compromised device tree instead of logging the user out of every
            // device. The family ID is embedded in BOTH the access and refresh
            // token payloads and propagated through rotation in /refresh. On RT
            // reuse, `invalidateSessionFamily(sessionFamilyId)` blocklists this
            // family namespace; the verify-side check rejects ANY RT whose family
            // is on the family-blocklist. Pre-Sprint-7 tokens (no `sessionFamilyId`
            // claim) fall back to user-wide revocation — preserving current
            // behavior for the migration window.
            // Token minting is extracted into a single helper so every flow
            // that establishes a session mints an
            // identical session shape — see issueTokensForAuthenticatedUser.
            return await this.issueTokensForAuthenticatedUser(user, options);
        } catch (error) {
            logger.info('[AuthService] Login error:', error.message);
            throw error;
        }
    }

    /**
     * Mint the access + refresh token pair for an already-authenticated user.
     *
     * Extracted from login() so any future flow that has already proven
     * identity by other means issues the EXACT same
     * HEALTH_JWT session — same payload claims, same per-role secret, same
     * Redis refresh-token allowlist registration, same per-login
     * sessionFamilyId. Keeping a single minting site prevents the two login
     * surfaces from drifting (e.g. a claim present on one path but not the
     * other, which would break tenant scoping or revocation for the
     * sessions only).
     *
     * Callers MUST have already verified the credential / token. This method
     * does NOT check passwords, lockout, or portal — it assumes a trusted,
     * resolved `user` row.
     *
     * R-A (Task 2): every caller of this shared minting site MUST honor an
     * enrolled 2FA user, so the twoFactorEnabled predicate that already gated
     * login() (:412 — password path) is ALSO checked here, at the mint
     * boundary itself. login() special-cases twoFactorEnabled and returns
     * BEFORE it ever reaches this method, so this branch is unreachable from
     * that caller — the password path's behavior is unchanged. It exists so
     * a caller that resolves identity by a different means (e.g. the ThaID
     * IdP path, auth-idp.js resolveThaidSession) cannot mint a full session
     * for a 2FA-enrolled user by going around login()'s check.
     *
     * @param {Object} user      Resolved User row.
     * @param {Object} [options] { ipAddress, userAgent, deviceId } for the
     *                           refresh-token allowlist metadata.
     * @returns {Promise<{ user: Object, token: string, refreshToken: string }
     *                  | { user: Object, mfaRequired: true, twoFactorMethod: string }>}
     * @throws {Error} code ACCOUNT_INACTIVE when the account may not hold a
     *                 session (shared/account-status.js — SECU-03)
     */
    async issueTokensForAuthenticatedUser(user, options = {}) {
        // SECU-03: same reasoning as the 2FA gate below — every caller's own
        // status check is backed by one at the mint site itself.
        assertAccountCanHoldSession(user);
        const canonicalRole = normalizeRole(user.role) || CANONICAL_ROLES.HEALTH;
        const accountIsProvider = isProviderRole(canonicalRole);
        const resolvedUserType = user.authType === 'PROVIDER_ID'
            ? 'PROVIDER_ID'
            : 'HEALTH_ID';
        const twoFactorEnabled = hasUsableSecondFactor(user);

        if (twoFactorEnabled) {
            logger.info('[AuthService] MFA challenge required at mint boundary', { userId: user.id });
            return {
                user,
                mfaRequired: true,
                twoFactorMethod: 'TOTP',
            };
        }

        const sessionFamilyId = crypto.randomUUID();
        const tokenPayload = {
            id: user.id,
            role: user.role,
            canonicalRole,
            userType: resolvedUserType,
            accountType: user.accountType,
            accountTier: user.accountTier || 'NORMAL',
            authType: user.authType,
            twoFactorEnabled,
            // ADR-014: tenant claim. tenant-context-middleware reads this
            // first; missing claim falls back to a User table lookup so
            // legacy tokens issued before this change still resolve.
            organizationId: user.organizationId || null,
            // Email is non-PDPA-sensitive (already public in directory views) and
            // small enough that the audit-log identity-correlation flow needs it
            // to avoid an extra DB round-trip per request.
            email: user.email || null,
            // Sprint 7 Issue B: session-family identifier for scoped revocation.
            sessionFamilyId,
        };
        // Sign access + refresh tokens with the correct secret per role,
        // so a provider cannot escape RBAC by going through the health portal.
        const tokenType = accountIsProvider ? 'provider' : 'public';
        const token = jwtConfig.generateToken(tokenPayload, tokenType);
        // Sprint 6 C-2: refresh-token allowlist. The JTI minted by
        // issueRefreshToken() is registered in Redis under the user's
        // namespace BEFORE the signed JWT is created, so the JWT's `jti`
        // claim is the same identifier the revocation lookup will match.
        const refreshJti = await tokenRevocationService.issueRefreshToken(user.id, {
            ipAddress: options.ipAddress || null,
            userAgent: options.userAgent || null,
            deviceId: options.deviceId || null,
        });
        const refreshToken = jwtConfig.generateRefreshToken(
            { ...tokenPayload, jti: refreshJti },
            tokenType,
        );
        return { user, token, refreshToken };
    }

    async getProfile(userId) {
        return await prisma.user.findUnique({ where: { id: userId } });
    }
    // Update Profile (whitelisted fields only to prevent privilege escalation)
    async updateProfile(userId, data) {
        const ALLOWED_FIELDS = [
            'firstName', 'lastName', 'phoneNumber', 'email',
            'address', 'province', 'district', 'subdistrict', 'zipCode',
            'companyName', 'representativeName', 'representativePosition',
            'communityName', 'privacySettings', 'notificationSettings',
        ];
        const safeData = {};
        for (const key of ALLOWED_FIELDS) {
            if (data[key] !== undefined) {
                safeData[key] = data[key];
            }
        }
        if (Object.keys(safeData).length === 0) {
            throw new Error('No valid fields to update');
        }
        return await prisma.user.update({
            where: { id: userId },
            data: safeData,
        });
    }
    async checkIdentifierExists(identifier, accountType = 'INDIVIDUAL') {
        const cleanId = (identifier || '').replace(/-/g, '');
        if (!cleanId) {
            return false;
        }
        // H-4 Phase 1: OFF (default) → legacy raw-SHA-256 `*Hash` columns;
        // ON → keyed-HMAC `*Hmac` columns (computeLookupHmac). Covers the
        // transitive taxId / communityRegistrationNo identifiers too.
        const useHmac = useHmacLookup();
        const hashed = useHmac
            ? computeLookupHmac(cleanId)
            : crypto.createHash('sha256').update(cleanId).digest('hex');
        let where;
        switch (accountType) {
            case 'JURISTIC':
                where = useHmac ? { taxIdHmac: hashed } : { taxIdHash: hashed };
                break;
            case 'COMMUNITY_ENTERPRISE':
                where = useHmac ? { communityRegistrationNoHmac: hashed } : { communityRegistrationNoHash: hashed };
                break;
            case 'INDIVIDUAL':
            default:
                where = useHmac ? { idCardHmac: hashed } : { idCardHash: hashed };
                break;
        }
        const existing = await prisma.user.findFirst({ where });
        return !!existing;
    }
    // ── Delegated methods ──────────────────────────────────────────────────

    async changePassword(userId, oldPassword, newPassword) { return changePassword(userId, oldPassword, newPassword); }
    // No resetPasswordWithToken: there is no account recovery (operator 2026-09-17).
    /**
     * Register a health user with validation and error classification.
     * Extracted from AuthController.register.
     *
     * @param {object} body - req.body fields
     * @param {string|null} idCardImagePath - uploaded file path
     * @returns {Promise<{ status: number, body: object }>}
     */
    async registerHealthUser(body, idCardImagePath) {
        // Wave B Phase 67 — the HEALTH_REGISTER_INDIVIDUAL_ONLY gate is
        // gone. The user model is now firmly "one person = one HealthID =
        // one personal INDIVIDUAL Entity"; juristic and community
        // applicants are NOT people and do not register. They appear at
        // application submission time as Entity rows the registered user
        // is OWNER/ADMIN of (Phase 66 wired Application.entityId).
        //
        // The 13-digit-Thai-ID validation below is the real gate: any
        // body that doesn't carry a valid healthId fails here regardless
        // of what `accountType` field they sent.
        const normalizedIdentifier = String(
            body?.healthId || body?.idCard || body?.identifier || '',
        ).replace(/-/g, '').trim();
        const isValid = Boolean(
            body?.password
            && body?.phoneNumber
            && normalizedIdentifier
            && /^\d{13}$/.test(normalizedIdentifier)
            && body?.firstName
            && body?.lastName,
        );
        if (!isValid) {
            return {
                status: 400,
                body: {
                    success: false,
                    error: 'INDIVIDUAL requires: healthId/identifier (13 digits), password, phoneNumber, firstName, lastName',
                    code: 'VALIDATION_ERROR',
                    messageTh: 'กรุณากรอกข้อมูลให้ครบถ้วน: เลขบัตรประชาชน 13 หลัก, รหัสผ่าน, เบอร์โทร, ชื่อ, นามสกุล',
                },
            };
        }
        const userData = {
            ...body,
            accountType: 'INDIVIDUAL',
            identifier: normalizedIdentifier,
            healthId: normalizedIdentifier,
            idCardImage: idCardImagePath,
        };
        // SECURITY (audit 2026-06-11): this is the PUBLIC, unauthenticated health
        // registration endpoint, and healthRegisterSchema uses `.passthrough()`,
        // so a client can smuggle privileged columns straight through validation.
        // register()'s `...identity.userData` spread then lands them in
        // prisma.user.create — and _resolveIdentity reads `userData.role`, so
        // POST /auth/health/register with {"role":"ADMIN"} mints a PROVIDER/ADMIN
        // account (an ACTIVE one if ENABLE_OCR_BYPASS is set). This endpoint may
        // ONLY ever create a HEALTH applicant: strip every authority/identity
        // field the server must own. register() recomputes each of these itself,
        // so dropping them is lossless for legitimate registrations (which never
        // send them). `email` is intentionally KEPT — it is the registrant's own
        // contact field, not a privilege.
        for (const privilegedKey of [
            'role', 'canonicalRole', 'status', 'verificationStatus',
            'ministryVerified', 'accountTier', 'organizationId', 'canonicalId',
            'authType', 'userType', 'isProvider',
            'providerId', 'providerIdHash', 'healthIdHash', 'idCardHash',
        ]) {
            delete userData[privilegedKey];
        }
        try {
            const user = await this.register(userData);
            return {
                status: 201,
                body: { success: true, message: 'ลงทะเบียนสำเร็จ', data: { user } },
            };
        } catch (error) {
            // Observability: this catch used to swallow the real cause and
            // return only the generic Thai message, so the server log showed
            // NOTHING about WHY a registration 500'd (NO_DEFAULT_ORG, schema
            // drift, an entity-creation failure, etc.). Log the underlying
            // error with enough context to diagnose, without leaking PII (the
            // identifier is already hashed; we log only its code/message/stack).
            logger.error('[AuthService] registerHealthUser failed', {
                errCode: error?.code || null,
                errName: error?.name || null,
                errMessage: error?.message || String(error),
                prismaMeta: error?.meta || null,
                stack: error?.stack,
            });
            let message = 'การลงทะเบียนล้มเหลว กรุณาลองใหม่อีกครั้ง';
            let code = 'REGISTER_FAILED';
            let statusCode = 500;
            if (error.code === 'P2002') {
                const target = error.meta?.target || [];
                const targetField = Array.isArray(target) ? target[0] : target;
                statusCode = 400;
                code = 'DUPLICATE_IDENTIFIER';
                if (targetField === 'idCardHash' || (typeof targetField === 'string' && targetField.includes('idCardHash'))) {
                    message = 'เลขบัตรประชาชนนี้ถูกลงทะเบียนแล้ว';
                } else if (targetField === 'taxIdHash' || (typeof targetField === 'string' && targetField.includes('taxIdHash'))) {
                    message = 'เลขทะเบียนนิติบุคคลนี้ถูกลงทะเบียนแล้ว';
                } else if (targetField === 'communityRegistrationNoHash' || (typeof targetField === 'string' && targetField.includes('communityRegistrationNoHash'))) {
                    message = 'เลขทะเบียนวิสาหกิจชุมชนนี้ถูกลงทะเบียนแล้ว';
                } else if (targetField === 'phoneNumber' || (typeof targetField === 'string' && targetField.includes('phoneNumber'))) {
                    message = 'เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว';
                } else if (targetField === 'email' || (typeof targetField === 'string' && targetField.includes('email'))) {
                    message = 'อีเมลนี้ถูกใช้งานแล้ว';
                } else {
                    message = 'ข้อมูลนี้ถูกลงทะเบียนในระบบแล้ว';
                }
            } else if (error.message && error.message.includes('Invalid file format')) {
                statusCode = 400;
                code = 'INVALID_FILE';
                message = 'รูปแบบไฟล์ไม่ถูกต้อง กรุณาอัปโหลดไฟล์ JPG, PNG หรือ PDF';
            }
            return {
                status: statusCode,
                body: { success: false, error: message, code },
            };
        }
    }
}
module.exports = new PrismaAuthService();
