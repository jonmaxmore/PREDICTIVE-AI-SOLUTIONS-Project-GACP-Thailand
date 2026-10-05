/**
 * SEC-002 — server-side session termination for /logout.
 *
 * The logout routes deliberately run WITHOUT auth middleware (logout must
 * succeed even when the access token has already expired), so `req.user` is
 * not populated. We therefore read whatever tokens the client presents
 * (cookies / Bearer) and revoke them server-side:
 *
 *   • access token  → blocklist its `jti`. auth-middleware consults
 *     isAccessTokenBlocklisted() on every request, so the token is dead at
 *     once instead of lingering until its natural exp (≤24h).
 *   • refresh token → drop its allowlist entry AND blocklist its `jti`, so a
 *     later POST /refresh hits the REFRESH_TOKEN_REVOKED gate instead of
 *     minting a fresh access token for the next 7 days.
 *
 * Best-effort by contract: an expired/invalid token needs no revocation (it is
 * already rejected by verify), and a Redis hiccup must never stop the user from
 * logging out. Never throws; returns a small summary so callers/tests can
 * assert what was revoked.
 *
 * @module utils/session-revocation
 */

const jwtConfig = require('../config/jwt-security');
const logger = require('../shared/logger');
const {
    blocklistAccessToken,
    revokeRefreshToken,
    blocklistRefreshToken,
} = require('../services/token-revocation-service');

// Blocklist entries only need to outlast the token's natural exp; a 60s floor
// guards against clock skew / already-near-expiry tokens.
function remainingTtlSeconds(decodedExp) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return Math.max(60, (Number(decodedExp) || nowSeconds) - nowSeconds);
}

/**
 * Revoke the access + refresh tokens carried by a logout request.
 *
 * @param {object} req  Express request — reads req.cookies, req.headers, req.body
 * @param {'public'|'provider'} [audience='public']  token family to verify against
 * @returns {Promise<{accessRevoked: boolean, refreshRevoked: boolean}>}
 */
async function revokeSessionFromRequest(req, audience = 'public') {
    const result = { accessRevoked: false, refreshRevoked: false };

    let config;
    try {
        config = jwtConfig.loadJWTConfiguration();
    } catch (err) {
        logger.warn('[session-revocation] could not load JWT config:', err.message);
        return result;
    }

    // ── Access token ──────────────────────────────────────────────────────
    const accessCookie = audience === 'provider'
        ? req.cookies?.provider_token
        : req.cookies?.auth_token;
    const bearer = req.headers?.authorization?.split(' ')[1];
    const accessToken = bearer || accessCookie;
    if (accessToken) {
        try {
            const decoded = jwtConfig.verifyToken(accessToken, audience, config);
            if (decoded?.jti) {
                await blocklistAccessToken(decoded.jti, remainingTtlSeconds(decoded.exp));
                result.accessRevoked = true;
            }
            // Signing out also ends a half-finished move of the 2FA to a new device
            // (the pending entry is bound to a session, and this one is ending).
            // Its own guard: it must never cost the access-token revocation above.
            if (decoded?.id) {
                try {
                    await require('../services/auth/mfa-reenrol-store').clear(decoded.id, 'logout');
                } catch (clearErr) {
                    logger.warn('[session-revocation] pending 2FA re-enrol not cleared:', clearErr.message);
                }
            }
        } catch (_err) {
            // Expired/invalid access token — already rejected by verify, nothing to revoke.
        }
    }

    // ── Refresh token (health flow; provider issues none today) ───────────
    const refreshToken = req.body?.refreshToken || req.cookies?.refresh_token;
    if (refreshToken) {
        try {
            const decodedRt = jwtConfig.verifyRefreshToken(refreshToken, audience, config);
            const rtJti = typeof decodedRt.jti === 'string' ? decodedRt.jti.trim() : '';
            if (rtJti) {
                if (decodedRt.id) {
                    await revokeRefreshToken(decodedRt.id, rtJti);
                }
                await blocklistRefreshToken(rtJti, remainingTtlSeconds(decodedRt.exp));
                result.refreshRevoked = true;
            }
        } catch (_err) {
            // Expired/invalid refresh token — already dead.
        }
    }

    return result;
}

module.exports = { revokeSessionFromRequest };
