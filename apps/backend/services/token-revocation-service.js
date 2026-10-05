/**
 * Token Revocation Service
 *
 * Sprint 5B (2026-05-15): Created in response to audit findings:
 *   - HIGH: No server-side refresh token revocation (stateless 7-day JWT)
 *   - HIGH: Logout did not invalidate JWTs
 *   - HIGH: MFA /verify accepted arbitrary userId without session binding
 *
 * Uses Redis (already in use for Bull queues) to track:
 *   - Refresh token allowlist (one entry per issued refresh token, with TTL = 7 days)
 *   - Access token blocklist (JTI-keyed, with TTL = remaining access token lifetime)
 *   - MFA challenge tokens (one-time, short-lived, bound to a userId)
 *
 * @module services/token-revocation-service
 */

const crypto = require('crypto');
const redisService = require('./redis-service');
const logger = require('../shared/logger');

const REFRESH_TOKEN_PREFIX = 'auth:refresh:';
const ACCESS_BLOCKLIST_PREFIX = 'auth:blocklist:';
// Refresh-token blocklist (parallel namespace to ACCESS_BLOCKLIST_PREFIX).
// Keyed on the refresh-token JTI so /refresh can detect reuse of a rotated
// (already-spent) RT and reject it. We deliberately use a different prefix
// from the access blocklist to keep the two lifecycles isolated — an access
// JTI and refresh JTI may legitimately collide if generated independently.
const REFRESH_BLOCKLIST_PREFIX = 'auth:rt-blocklist:';
// Sprint 7 Issue B: session-family blocklist. Keyed on the sessionFamilyId
// minted at login. When a refresh-token-reuse is detected, the WHOLE family
// (and only that family) is blocklisted — sibling sessions on other devices
// keep working. Verify-side: /refresh additionally consults this namespace
// against the decoded RT's sessionFamilyId claim.
const FAMILY_BLOCKLIST_PREFIX = 'auth:family-blocklist:';
const MFA_CHALLENGE_PREFIX = 'auth:mfa-challenge:';

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;   // 7 days
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;        // 5 minutes (long enough for user to enter code)
const ACCESS_BLOCKLIST_TTL_SECONDS = 24 * 60 * 60;  // 24 hours (max access token lifetime)
// Refresh tokens live 7 days; the blocklist entry only needs to outlast the
// token's natural exp. Anything beyond that is wasted RAM and can't be
// presented anyway because jwt.verify would reject it as expired first.
const REFRESH_BLOCKLIST_TTL_SECONDS = REFRESH_TTL_SECONDS;
// Family-blocklist entries last as long as the longest-lived RT in the family
// could possibly be, i.e. the RT TTL. Anything past that point is unreachable
// because the RT itself expires.
const FAMILY_BLOCKLIST_TTL_SECONDS = REFRESH_TTL_SECONDS;

/**
 * Issue a refresh token allowlist entry.
 * Call after generateRefreshToken(); the returned `tokenId` (JTI) should be embedded
 * in the JWT payload as `jti` for later revocation lookup.
 *
 * @param {string} userId
 * @param {object} metadata - optional context (IP, user agent, device)
 * @returns {Promise<string>} tokenId (JTI) — random 32-byte hex
 */
async function issueRefreshToken(userId, metadata = {}) {
    const tokenId = crypto.randomBytes(32).toString('hex');
    const key = `${REFRESH_TOKEN_PREFIX}${userId}:${tokenId}`;
    const value = {
        userId,
        issuedAt: new Date().toISOString(),
        ipAddress: metadata.ipAddress || null,
        userAgent: metadata.userAgent || null,
        deviceId: metadata.deviceId || null,
    };

    try {
        // KNOWN RESIDUAL (W1-5, 2026-08-22) — deliberately left on the cache
        // accessor. `set` returns false on a Redis outage rather than throwing,
        // so this catch is unreachable and login instead issues a refresh token
        // that was never allowlisted: dead on arrival, because
        // isRefreshTokenValid() will reject it. That direction is fail-SAFE (a
        // useless credential, not a bypass), so it is not a security hole — but
        // it is a silent UX cliff: the user logs in and their session cannot be
        // renewed. Switching this to setStrict makes login itself 500 during a
        // Redis outage, which is a much larger blast radius and touches
        // prisma-auth-service.js:532 (outside this change's file ownership).
        // OPERATOR DECISION NEEDED: 503 at login vs. a session that silently
        // cannot refresh.
        await redisService.set(key, value, REFRESH_TTL_SECONDS);
    } catch (err) {
        logger.error('[token-revocation] Failed to store refresh token', { userId, error: err.message });
        throw err;
    }
    return tokenId;
}

/**
 * Verify that a refresh token is still allowlisted (i.e., not revoked).
 *
 * @param {string} userId
 * @param {string} tokenId
 * @returns {Promise<boolean>}
 */
async function isRefreshTokenValid(userId, tokenId) {
    if (!userId || !tokenId) {return false;}
    try {
        const key = `${REFRESH_TOKEN_PREFIX}${userId}:${tokenId}`;
        // getStrict, not get: `get` returns null for BOTH "not allowlisted"
        // and "Redis unreachable", so this catch (and its fail-closed log)
        // could never run. The verdict is the same either way here (an
        // unverifiable allowlist entry is not a valid one), but the outage
        // must be visible to operators rather than silently indistinguishable
        // from a revoked token.
        const value = await redisService.getStrict(key);
        return Boolean(value);
    } catch (err) {
        logger.warn('[token-revocation] Redis read failed; failing closed', { error: err.message });
        return false;  // Fail closed: if Redis is down, refresh tokens cannot be verified
    }
}

/**
 * Revoke a specific refresh token (logout, password change, etc.).
 *
 * @param {string} userId
 * @param {string} tokenId
 */
async function revokeRefreshToken(userId, tokenId) {
    if (!userId || !tokenId) {return;}
    try {
        // delStrict: `del` returns false on an outage without throwing, so this
        // warn never fired and a logout during a Redis outage left the refresh
        // token ALIVE in the allowlist — usable again the moment Redis came
        // back. Still non-throwing (logout must not 500), but now audible.
        await redisService.delStrict(`${REFRESH_TOKEN_PREFIX}${userId}:${tokenId}`);
    } catch (err) {
        logger.warn('[token-revocation] Failed to revoke refresh token', { userId, error: err.message });
    }
}

/**
 * Revoke ALL refresh tokens for a user (security event: password change, account compromise).
 * Uses Redis KEYS pattern — acceptable for occasional security events, not for hot paths.
 *
 * @param {string} userId
 */
async function revokeAllUserTokens(userId) {
    if (!userId) {return;}
    // Revoking every session also ends a half-finished 2FA re-enrol (best-effort,
    // never throws). Required lazily: the store requires redis-service too.
    await require('./auth/mfa-reenrol-store').clear(userId, 'revoke-all-sessions');
    try {
        const client = redisService.client;
        if (!client) {return;}
        const pattern = `${REFRESH_TOKEN_PREFIX}${userId}:*`;
        const keys = await client.keys(pattern);
        if (keys.length > 0) {
            await client.del(...keys);
            logger.info('[token-revocation] Revoked all refresh tokens for user', { userId, count: keys.length });
        }
    } catch (err) {
        logger.warn('[token-revocation] Failed to revoke all user tokens', { userId, error: err.message });
    }
}

/**
 * Add an access token JTI to the blocklist (immediate revocation).
 * Stored only until the natural expiry of the access token.
 *
 * @param {string} jti
 * @param {number} ttlSeconds - remaining lifetime of the access token in seconds
 */
async function blocklistAccessToken(jti, ttlSeconds = ACCESS_BLOCKLIST_TTL_SECONDS) {
    if (!jti) {return;}
    try {
        // setStrict so a dropped revocation write is not silent. The access-token
        // policy stays fail-OPEN (we do not throw — /logout must still succeed),
        // but the same SecOps alert as the read path fires, because a swallowed
        // write here is exactly the condition that alert exists to surface: the
        // token the user just revoked is still honoured.
        await redisService.setStrict(`${ACCESS_BLOCKLIST_PREFIX}${jti}`, { revokedAt: new Date().toISOString() }, ttlSeconds);
    } catch (err) {
        logger.warn('[token-revocation] Failed to blocklist access token', { jti, error: err.message });
        _emitAccessTokenBlocklistOutage(jti, err);
    }
}

// Throttle for the SecOps audit event so a sustained Redis outage doesn't
// flood the SIEM with one entry per request. We still want the FIRST entry
// in any outage window to fire immediately for fast detection, then
// dampen to one entry per ~5s thereafter. Keyed by truncated jti so a
// single suspicious jti can't suppress alerts for other tokens.
const _BLOCKLIST_OUTAGE_THROTTLE_MS = 5_000;
const _blocklistOutageLastEmitAt = new Map();

/**
 * Emit the structured high-severity audit event for an access-token blocklist
 * Redis-outage fail-open. Exported as `_emitAccessTokenBlocklistOutage` for
 * test inspection. Shape is stable — SIEM / SOC dashboards key on
 * `event: 'ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE'` and `severity: 'CRITICAL'`.
 *
 * @param {string} jti
 * @param {Error}  err
 */
function _emitAccessTokenBlocklistOutage(jti, err) {
    const now = Date.now();
    const throttleKey = String(jti).slice(0, 16); // truncate so we don't leak full jti
    const last = _blocklistOutageLastEmitAt.get(throttleKey) || 0;
    if (now - last < _BLOCKLIST_OUTAGE_THROTTLE_MS) {
        return; // throttled — already fired recently for this jti prefix
    }
    _blocklistOutageLastEmitAt.set(throttleKey, now);

    // High-severity structured event. The `securityEvent: true` marker plus
    // the canonical `event` string is what the SIEM pipeline filters on.
    logger.error('[SECURITY] ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE', {
        securityEvent: true,
        event: 'ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE',
        severity: 'CRITICAL',
        timestamp: new Date().toISOString(),
        // Truncated jti is enough to correlate with the original /login or
        // /refresh audit row without persisting a hot credential identifier.
        jtiPrefix: throttleKey,
        error: (err && err.message) || String(err),
        recommendedAction:
            'Verify Redis health (auth:blocklist namespace). If a credential ' +
            'compromise is suspected during this window, manually invalidate ' +
            'affected sessions via revokeAllUserTokens(userId) or rotate the ' +
            'JWT signing key.',
        failMode: 'OPEN',
    });
}

/**
 * Check if an access token JTI is in the blocklist.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SECURITY POLICY (Sprint 8, 2026-05-16) — DO NOT REVERSE WITHOUT REVIEW.
 *
 * This function fails OPEN on Redis errors: when the blocklist cannot be
 * consulted, the access token is treated as NOT-blocklisted and the request
 * is allowed to proceed.
 *
 * This is the OPPOSITE policy from `isRefreshTokenBlocklisted` (which fails
 * CLOSED) and the asymmetry is intentional. The decision was reviewed by
 * Security Lead on 2026-05-16; the three options considered were:
 *
 *   (A) Fail-CLOSED, symmetric with refresh tokens.
 *   (B) Fail-OPEN, with a high-severity audit alert. <-- CHOSEN
 *   (C) Hybrid (separate namespace for "user-revoked-all" vs. churn).
 *
 * THREAT MODEL — why fail-OPEN is the right call here:
 *
 *   - Access tokens have a ~15-minute TTL. Natural churn already evicts
 *     any blocklisted token within that window, so a missed blocklist
 *     entry is bounded.
 *   - Most blocklist entries today are NOT explicit revocations; they are
 *     rotation-by-product entries written by /refresh. The high-signal
 *     case (explicit revoke via /logout or admin force-logout) is a small
 *     fraction of the entries.
 *   - Failing CLOSED on Redis outage would 401 EVERY authenticated user
 *     in the platform simultaneously — auditors, applicants, admins, the
 *     whole certification workflow. A transient Redis blip would turn
 *     into a total auth outage. For a Thai-government health-certification
 *     system that is operationally unacceptable.
 *   - Refresh tokens fail CLOSED because their TTL is 7 days, the security
 *     value of catching a replay is much higher, and a re-login on a
 *     handful of refresh attempts during an outage is a far smaller
 *     blast radius than logging everyone out at once.
 *
 * RISK ACCEPTED — and what we do about it:
 *
 *   When Redis is unreachable, a token that was explicitly revoked via
 *   /logout or admin force-logout will be honoured for up to its
 *   remaining TTL (~15 min). To compensate, this function emits a
 *   structured high-severity SecOps audit event
 *   (`ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE`) on every fail-open. SecOps
 *   monitors and pages on this event. If a credential compromise is
 *   suspected during the outage window, the operator playbook is:
 *
 *     1. Restore Redis (primary mitigation — restores the blocklist).
 *     2. If specific user(s) compromised: revokeAllUserTokens(userId)
 *        to flush all RT allowlist entries (the AT will then naturally
 *        expire within 15 min).
 *     3. If the compromise scope is uncertain: rotate the JWT signing
 *        key — invalidates ALL access tokens immediately.
 *
 * W1-5 AMENDMENT (2026-08-22) — the safety valve was not connected.
 *
 *   The policy above is unchanged, but until this date the compensating
 *   control did not exist. `redisService.get()` never throws (it returns
 *   null when disconnected AND null from its own catch), so on a real
 *   Redis outage this function returned false WITHOUT entering the catch:
 *   the fail-open happened silently and `ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE`
 *   was never emitted. Every argument for (B) over (A) rests on SecOps being
 *   paged; that page could not fire. The read now uses `getStrict`, so the
 *   alert is real.
 *
 *   OPERATOR: this is worth re-deciding now that the trade-off is honest.
 *   Option (B) was chosen on the assumption that the alert worked. It did
 *   not, so the policy has been running as bare fail-open since Sprint 8.
 *   If option (A) or (C) is preferred, this is the moment to say so.
 *
 * If you change this policy:
 *   1. Update `isRefreshTokenBlocklisted` if you want to keep symmetry.
 *   2. Update `auth-middleware.js` (search for TOKEN_REVOKED, the caller
 *      currently swallows revocation-check failures — that branch must
 *      become a 503 BLOCKLIST_UNAVAILABLE response if you flip to CLOSED).
 *   3. Update this docstring with the new threat-model rationale.
 *   4. Update access-token-blocklist.test.js — the fail-mode assertion
 *      is the canonical regression guard.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * @param {string} jti
 * @returns {Promise<boolean>}
 */
async function isAccessTokenBlocklisted(jti) {
    if (!jti) {return false;}
    try {
        // getStrict is what makes the fail-open branch below REACHABLE. With
        // the cache accessor a Redis outage returned null, which reads as
        // "not blocklisted" — the fail-open still happened, but SILENTLY, so
        // the ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE alert this entire policy
        // leans on never fired. The policy is unchanged; its safety valve
        // now actually works.
        const value = await redisService.getStrict(`${ACCESS_BLOCKLIST_PREFIX}${jti}`);
        return Boolean(value);
    } catch (err) {
        // Fail OPEN — see SECURITY POLICY block above. Emit the structured
        // high-severity audit event so SecOps notices the degraded posture.
        _emitAccessTokenBlocklistOutage(jti, err);
        return false;
    }
}

/**
 * Add a refresh token JTI to the blocklist.
 *
 * Called after a successful /refresh rotation so the OLD refresh token can
 * never be presented again, even if it was intercepted in transit. Combined
 * with `isRefreshTokenBlocklisted()`, this gives us single-use semantics
 * (OWASP refresh-token rotation pattern).
 *
 * Sprint 7 follow-up to Wave-D: closes the bypass noted in
 * auth-session-security-handlers.js (the "Wave-D" inline comment) where a
 * stolen refresh token remained replayable for its full 7-day lifetime even
 * after rotation. Failure to write is logged but not thrown — better to
 * complete the user's /refresh than to fail closed on a Redis hiccup
 * (the symmetric verify-side fails CLOSED, see `isRefreshTokenBlocklisted`).
 *
 * @param {string} jti  refresh-token JWT ID
 * @param {number} ttlSeconds  remaining lifetime in seconds (defaults to full 7d)
 * @returns {Promise<void>}
 */
async function blocklistRefreshToken(jti, ttlSeconds = REFRESH_BLOCKLIST_TTL_SECONDS) {
    if (!jti) {return;}
    try {
        // setStrict so the documented "logged but not thrown" behaviour is real:
        // with `set` the write failure returned false and this warn never ran,
        // meaning a rotated RT stayed replayable for 7 days with no trace in
        // the logs. Deliberately still non-throwing (see docstring).
        await redisService.setStrict(
            `${REFRESH_BLOCKLIST_PREFIX}${jti}`,
            { revokedAt: new Date().toISOString() },
            ttlSeconds,
        );
    } catch (err) {
        logger.warn('[token-revocation] Failed to blocklist refresh token', { jti, error: err.message });
    }
}

/**
 * Check if a refresh-token JTI is in the blocklist.
 *
 * Fails CLOSED on Redis errors: an unverifiable refresh token must be
 * treated as suspect because the cost of accepting a replayed RT is far
 * higher than the cost of asking the user to re-authenticate. This is the
 * opposite policy from `isAccessTokenBlocklisted` (which fails OPEN) and
 * is intentional — access tokens churn every 15 minutes anyway, while a
 * refresh token grants 7 days of session lifetime.
 *
 * @param {string} jti
 * @returns {Promise<boolean>}
 */
async function isRefreshTokenBlocklisted(jti) {
    if (!jti) {return false;}
    try {
        // getStrict, not get. `redisService.get` NEVER throws — it returns
        // null when disconnected and null again from its own catch — so the
        // fail-CLOSED branch below was unreachable and a Redis outage made
        // every blocklisted refresh token look valid for up to 7 days.
        const value = await redisService.getStrict(`${REFRESH_BLOCKLIST_PREFIX}${jti}`);
        return Boolean(value);
    } catch (err) {
        logger.warn('[token-revocation] Refresh-token blocklist read failed; failing closed', { jti, error: err.message });
        return true;  // Fail CLOSED — see docstring rationale.
    }
}

/**
 * Reuse-detection: if a blocklisted refresh token is presented, invalidate
 * just that session family — the device tree whose RT chain was rotated and
 * then re-presented. This is the OWASP-recommended response to detected RT
 * reuse, scoped narrowly so the user stays logged in on sibling devices.
 *
 * Sprint 7 Issue B (2026-05-16): rewritten from user-wide to family-scoped.
 * Previously aliased `revokeAllUserTokens(userId)` because there was no
 * sessionFamilyId claim — a single replayed RT logged the user out of every
 * device, creating a DoS vector. The new architecture mints a `sessionFamilyId`
 * at login (see prisma-auth-service.js login() — random UUID per login) and
 * propagates it through every /refresh rotation, so this function can blocklist
 * exactly one family namespace and leave everything else alive.
 *
 * Implementation: writes the familyId to a Redis blocklist namespace; the
 * /refresh handler additionally checks `isSessionFamilyBlocklisted(familyId)`
 * against the incoming RT's `sessionFamilyId` claim on every verify, so any
 * sibling RT in this family also gets rejected even though it isn't on the
 * per-JTI blocklist.
 *
 * Backward compat: if `sessionFamilyId` is null/undefined (token issued
 * before Sprint 7 minted the claim) the caller MUST fall back to
 * `revokeAllUserTokens(userId)` — see /refresh handler. This function itself
 * is a no-op on falsy input so callers can pass through without branching.
 *
 * Defense-in-depth (Sprint 7 Issue B follow-up, 2026-05-16): fails CLOSED
 * on Redis write error. This function is invoked on the /refresh reuse-
 * detection path — a previously-rotated RT has just been re-presented,
 * which is a strong theft signal. If we cannot record the family blocklist
 * entry due to a Redis outage, the attacker's entire RT chain would otherwise
 * remain replayable until natural exp. We RE-THROW so the caller's outer
 * handler can short-circuit token issuance (HTTP 503) instead of issuing
 * fresh tokens to either party. Mirrors the fail-CLOSED policy of the
 * read-side companion `isSessionFamilyBlocklisted`. Compare with
 * `blocklistAccessToken` (fails OPEN, different threat model — short-lived
 * churn).
 *
 * @param {string} sessionFamilyId
 * @throws {Error} if Redis write fails
 */
async function invalidateSessionFamily(sessionFamilyId) {
    if (!sessionFamilyId) {return;}
    try {
        // setStrict, not set: `redisService.set` returns false on an outage
        // instead of throwing, so the re-throw below (and the /refresh 503
        // that depends on it) was dead code — the reuse-detection write was
        // silently dropped and fresh tokens were issued to both parties.
        await redisService.setStrict(
            `${FAMILY_BLOCKLIST_PREFIX}${sessionFamilyId}`,
            { revokedAt: new Date().toISOString() },
            FAMILY_BLOCKLIST_TTL_SECONDS,
        );
        logger.warn('[token-revocation] Refresh-token reuse detected — invalidated session family', { sessionFamilyId });
    } catch (err) {
        // Fail CLOSED — see docstring. The reuse-detection path is a known-
        // attack signal; we must not silently swallow a Redis outage here.
        logger.error('[token-revocation] Failed to blocklist session family — re-throwing to fail CLOSED', {
            sessionFamilyId,
            error: err.message,
        });
        throw err;
    }
}

/**
 * Check whether a sessionFamilyId is on the family-blocklist.
 *
 * Called from /refresh on every RT verify, in addition to the per-JTI
 * blocklist gate. A family hit means an earlier RT in this chain was
 * replayed (reuse-detection fired) and every sibling RT issued from the
 * same login must also be rejected.
 *
 * Fails CLOSED (treats Redis errors as "blocklisted") for the same reason
 * `isRefreshTokenBlocklisted` does — an unverifiable refresh credential is
 * suspect, and a 7-day session lifetime is too long a window to fail open on.
 *
 * @param {string} sessionFamilyId
 * @returns {Promise<boolean>}
 */
async function isSessionFamilyBlocklisted(sessionFamilyId) {
    if (!sessionFamilyId) {return false;}
    try {
        // getStrict — same reason as isRefreshTokenBlocklisted: with the cache
        // accessor a store outage was indistinguishable from "family is clean",
        // so a replayed RT chain stayed usable for the whole outage window.
        const value = await redisService.getStrict(`${FAMILY_BLOCKLIST_PREFIX}${sessionFamilyId}`);
        return Boolean(value);
    } catch (err) {
        logger.warn('[token-revocation] Family-blocklist read failed; failing closed', { sessionFamilyId, error: err.message });
        return true;
    }
}

/**
 * Issue an MFA challenge token (after password verification succeeds, before TOTP is verified).
 * The challenge token is opaque and bound to a specific userId. The /verify endpoint
 * must accept this token rather than trusting a raw userId from the request body.
 *
 * @param {string} userId
 * @returns {Promise<string>} challengeToken (opaque, 32-byte hex)
 */
async function issueMfaChallenge(userId) {
    if (!userId) {throw new Error('userId is required to issue MFA challenge');}
    const challengeToken = crypto.randomBytes(32).toString('hex');
    const key = `${MFA_CHALLENGE_PREFIX}${challengeToken}`;
    // setStrict: `set` returned false on an outage and we handed the caller a
    // challenge token the store never persisted — consumeMfaChallenge would
    // then reject it, stranding the user mid-login with no explanation. Throw
    // so the caller can surface an honest "try again shortly" instead.
    await redisService.setStrict(key, { userId, issuedAt: new Date().toISOString() }, MFA_CHALLENGE_TTL_SECONDS);
    return challengeToken;
}

/**
 * Verify an MFA challenge token and return the bound userId.
 * Consumes the challenge (single-use).
 *
 * @param {string} challengeToken
 * @returns {Promise<string|null>} userId if valid, null if expired/invalid
 */
async function consumeMfaChallenge(challengeToken) {
    if (!challengeToken) {return null;}
    const key = `${MFA_CHALLENGE_PREFIX}${challengeToken}`;
    try {
        // getStrict so an outage is logged as an outage rather than silently
        // reported as "challenge expired". The verdict is unchanged (null =
        // the challenge is not honoured) — an unverifiable MFA challenge must
        // never complete a login.
        const value = await redisService.getStrict(key);
        if (!value || !value.userId) {return null;}
        await redisService.del(key);  // Single-use
        return value.userId;
    } catch (err) {
        logger.warn('[token-revocation] MFA challenge lookup failed', { error: err.message });
        return null;
    }
}

module.exports = {
    issueRefreshToken,
    isRefreshTokenValid,
    revokeRefreshToken,
    revokeAllUserTokens,
    blocklistAccessToken,
    isAccessTokenBlocklisted,
    blocklistRefreshToken,
    isRefreshTokenBlocklisted,
    invalidateSessionFamily,
    isSessionFamilyBlocklisted,
    issueMfaChallenge,
    consumeMfaChallenge,
    // Test helpers — DO NOT use in production code
    _REFRESH_TOKEN_PREFIX: REFRESH_TOKEN_PREFIX,
    _ACCESS_BLOCKLIST_PREFIX: ACCESS_BLOCKLIST_PREFIX,
    _REFRESH_BLOCKLIST_PREFIX: REFRESH_BLOCKLIST_PREFIX,
    _FAMILY_BLOCKLIST_PREFIX: FAMILY_BLOCKLIST_PREFIX,
    _MFA_CHALLENGE_PREFIX: MFA_CHALLENGE_PREFIX,
    // Test helper for the fail-OPEN audit alert throttle; tests reset between cases.
    _resetBlocklistOutageThrottle: () => _blocklistOutageLastEmitAt.clear(),
    _BLOCKLIST_OUTAGE_THROTTLE_MS,
};
