const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../shared/logger');

/**
 * Generate a fresh, non-empty `jti` (JWT ID) claim.
 *
 * Every token we mint MUST carry a `jti` so that the central auth-middleware
 * (`rejectIfNoJti` in middleware/auth-middleware.js) can consult the Redis
 * revocation blocklist. Without it, /logout cannot blocklist the token and
 * it stays valid until its natural `exp` — the very bypass JTI enforcement
 * was added to close.
 *
 * Uses `crypto.randomUUID()` (Node >=14.17) for a 128-bit collision-resistant
 * identifier. Falls back to randomBytes if randomUUID is unavailable in some
 * pinned runtime — both produce non-empty strings, which is the only contract
 * the middleware cares about.
 */
function generateJti() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

/**
 * JWT security config with long-term Health/Provider terminology.
 *
 * Backward compatibility:
 * - HEALTH_JWT_SECRET falls back to HEALTH_JWT_SECRET or JWT_SECRET
 * - PROVIDER_JWT_SECRET falls back to DTAM_JWT_SECRET
 * - token type "dtam" is kept as an alias of "provider"
 */

function resolveHealthSecret() {
  return process.env.HEALTH_JWT_SECRET || process.env.JWT_SECRET;
}

function resolveProviderSecret() {
  return process.env.PROVIDER_JWT_SECRET || process.env.DTAM_JWT_SECRET;
}

function resolveTokenType(type = 'public') {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'provider' || normalized === 'dtam') {
    return 'provider';
  }
  return 'public';
}

function getJWTConfiguration() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isDevelopment = nodeEnv === 'development' || nodeEnv === 'test';
  const isProduction = nodeEnv === 'production';

  const healthSecret = resolveHealthSecret();
  const providerSecret = resolveProviderSecret();

  if (isProduction) {
    if (!healthSecret) {
      throw new Error(
        'CRITICAL: HEALTH_JWT_SECRET (or HEALTH_JWT_SECRET / JWT_SECRET) is required in production.',
      );
    }
    if (!providerSecret) {
      throw new Error(
        'CRITICAL: PROVIDER_JWT_SECRET (or DTAM_JWT_SECRET) is required in production.',
      );
    }
    if (healthSecret.length < 32) {
      // Keep as warning to avoid hard-fail on existing environments.
      console.warn('WARNING: Health JWT secret is shorter than 32 chars.');
    }
    if (providerSecret.length < 32) {
      console.warn('WARNING: Provider JWT secret is shorter than 32 chars.');
    }
    // L-9 (audit 2026-06-11): the HEALTH and PROVIDER portals are meant to be
    // cryptographically separated — a token signed for one must not verify on
    // the other. Identical secrets defeat that separation (the audience claim
    // + DB role re-check are still in front, so this is defense-in-depth, not a
    // live hole — hence a loud warning rather than a refuse-boot that could
    // crash a currently-misconfigured prod).
    if (healthSecret === providerSecret) {
      // Route through the structured logger (not console.warn) so this surfaces
      // in prod error monitoring / ops triage. logger.error (not warn) because it
      // is an actionable prod misconfiguration — even though the aud claim + DB
      // role re-check keep it defense-in-depth (not a live hole), the secrets MUST
      // be distinct. (Kept as a loud log, not a refuse-boot, to avoid crashing a
      // currently-misconfigured prod.)
      logger.error(
        '[jwt-security] HEALTH_JWT_SECRET and PROVIDER_JWT_SECRET are IDENTICAL in production — ' +
        'the two portals are no longer cryptographically separated; set distinct secrets.',
      );
    }
  }

  // PR-1.11: dev fallback uses a STABLE constant rather than Date.now() so
  // that a dev restart does not invalidate every active session. The string
  // is intentionally not a "real-looking" secret — its presence in any prod
  // log is a clear smoking gun that NODE_ENV was misconfigured.
  const DEV_HEALTH_SECRET = 'dev-health-secret-NOT-FOR-PRODUCTION-USE-XXXXXXXXXXXXXXXXXXXX';
  const DEV_PROVIDER_SECRET = 'dev-provider-secret-NOT-FOR-PRODUCTION-USE-XXXXXXXXXXXXXXXXXX';

  const finalHealthSecret = healthSecret || (isDevelopment ? DEV_HEALTH_SECRET : null);
  const finalProviderSecret = providerSecret || (isDevelopment ? DEV_PROVIDER_SECRET : null);

  if (!finalHealthSecret || !finalProviderSecret) {
    throw new Error('CRITICAL: JWT secrets are missing. Verify health/provider JWT environment variables.');
  }

  if (isDevelopment && !process.env.HEALTH_JWT_SECRET && !process.env.JWT_SECRET) {
    console.warn('DEVELOPMENT MODE: Using stable dev Health JWT secret. Do NOT ship this to production.');
  }

  if (isDevelopment && !process.env.PROVIDER_JWT_SECRET && !process.env.DTAM_JWT_SECRET) {
    console.warn('DEVELOPMENT MODE: Using stable dev Provider JWT secret. Do NOT ship this to production.');
  }

  const providerConfig = {
    secret: finalProviderSecret,
    expiry: process.env.PROVIDER_JWT_EXPIRES_IN || process.env.DTAM_JWT_EXPIRES_IN || '12h',
    issuer: process.env.JWT_ISSUER || 'gacp-backend',
    audience: process.env.PROVIDER_JWT_AUDIENCE || process.env.DTAM_JWT_AUDIENCE || 'gacp-provider',
    algorithm: 'HS256',
  };

  return {
    public: {
      secret: finalHealthSecret,
      expiry: process.env.JWT_EXPIRES_IN || '24h',
      issuer: process.env.JWT_ISSUER || 'gacp-backend',
      audience: process.env.JWT_AUDIENCE || 'gacp-health',
      algorithm: 'HS256',
    },
    provider: providerConfig,
    // Legacy alias.
    dtam: providerConfig,
  };
}

function getTokenConfig(type = 'public', config = null) {
  const activeConfig = config || getJWTConfiguration();
  const resolvedType = resolveTokenType(type);
  return resolvedType === 'provider' ? activeConfig.provider : activeConfig.public;
}

function buildVerifyOptions(tokenConfig, tokenType) {
  const options = {
    issuer: tokenConfig.issuer,
    algorithms: [tokenConfig.algorithm],
  };

  if (tokenType === 'provider') {
    // Accept legacy audience in verify path for older tokens.
    const audiences = new Set([tokenConfig.audience, 'gacp-provider']);
    options.audience = Array.from(audiences).filter(Boolean);
  } else {
    options.audience = tokenConfig.audience;
  }

  return options;
}

function verifyToken(token, type = 'public', config = null) {
  const resolvedType = resolveTokenType(type);
  const tokenConfig = getTokenConfig(resolvedType, config);
  const options = buildVerifyOptions(tokenConfig, resolvedType);

  try {
    return jwt.verify(token, tokenConfig.secret, options);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      error.code = 'TOKEN_EXPIRED';
    } else if (!error.code) {
      error.code = 'INVALID_TOKEN';
    }
    throw error;
  }
}

function generateToken(payload, type = 'public', overrides = {}) {
  const resolvedType = resolveTokenType(type);
  const tokenConfig = getTokenConfig(resolvedType);
  // Inject a fresh jti on every mint. Honour caller-supplied jti (in payload
  // or overrides) for tests / explicit rotation flows; otherwise generate.
  // Required so the central auth-middleware's revocation lookup can succeed.
  const jwtid = overrides.jwtid || payload?.jti || generateJti();
  const options = {
    expiresIn: overrides.expiresIn || tokenConfig.expiry,
    issuer: tokenConfig.issuer,
    audience: tokenConfig.audience,
    algorithm: tokenConfig.algorithm,
    jwtid,
  };

  // Strip any payload-level `jti` before signing — `jwtid` option is the
  // canonical place and double-setting throws in jsonwebtoken.
  const { jti: _payloadJti, ...payloadWithoutJti } = payload || {};
  // TASK-2: stamp the token CLASS so the access path can ALLOWLIST rather than
  // blocklist. See classifyTokenForAccessPath() below.
  return jwt.sign({ ...payloadWithoutJti, tokenType: 'access' }, tokenConfig.secret, options);
}

function generateRefreshToken(payload, type = 'public') {
  const resolvedType = resolveTokenType(type);
  const tokenConfig = getTokenConfig(resolvedType);
  // Refresh tokens also need their own jti — refresh-token revocation /
  // rotation reuse detection depends on a stable identifier per token.
  const jwtid = payload?.jti || generateJti();
  const options = {
    expiresIn: '7d',
    issuer: tokenConfig.issuer,
    audience: tokenConfig.audience,
    algorithm: tokenConfig.algorithm,
    jwtid,
  };

  const { jti: _payloadJti, ...payloadWithoutJti } = payload || {};
  return jwt.sign({ ...payloadWithoutJti, tokenType: 'refresh' }, tokenConfig.secret, options);
}

function verifyRefreshToken(token, type = 'public', config = null) {
  const resolvedType = resolveTokenType(type);
  const tokenConfig = getTokenConfig(resolvedType, config);
  const options = buildVerifyOptions(tokenConfig, resolvedType);

  try {
    const decoded = jwt.verify(token, tokenConfig.secret, options);
    if (decoded.tokenType !== 'refresh') {
      const error = new Error('Invalid refresh token');
      error.code = 'INVALID_TOKEN';
      throw error;
    }
    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      error.code = 'TOKEN_EXPIRED';
    } else if (!error.code) {
      error.code = 'INVALID_TOKEN';
    }
    throw error;
  }
}

// PR-1.11: in production, fail fast at module-load time rather than
// waiting for the first verifyToken() call. A misconfigured prod
// container should refuse to start, not crash on the first user login.
if (process.env.NODE_ENV === 'production') {
  // getJWTConfiguration throws when health/provider secrets are missing.
  // We discard the result; we only care about the side effect of
  // surfacing config errors at startup.
  getJWTConfiguration();
}

/**
 * TASK-2 — resolve the legacy "untyped token" grace deadline.
 *
 * Mirrors getLegacyJtiGraceDeadlineMs() in middleware/auth-middleware.js. While
 * the wall clock is before `LEGACY_UNTYPED_TOKEN_GRACE_UNTIL`, an access token
 * minted BEFORE this change (no `tokenType` claim at all) is still accepted.
 * After the deadline (or when unset/malformed) the allowlist is strict.
 *
 * @returns {number|null} epoch ms of the deadline, or null for "no grace".
 */
let _LOGGED_INVALID_TYPE_GRACE = false;
function getLegacyUntypedTokenGraceDeadlineMs() {
  const raw = process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL;
  if (!raw || !String(raw).trim()) {
    return null;
  }
  const parsed = Date.parse(String(raw).trim());
  if (Number.isNaN(parsed)) {
    if (!_LOGGED_INVALID_TYPE_GRACE) {
      logger.warn(
        `[jwt-security] LEGACY_UNTYPED_TOKEN_GRACE_UNTIL is set but not a valid ISO ` +
        `timestamp: "${raw}". Treating as no grace period (strict allowlist).`,
      );
      _LOGGED_INVALID_TYPE_GRACE = true;
    }
    return null;
  }
  return parsed;
}

/**
 * TASK-2 — the ONE place that decides whether a verified JWT may establish an
 * authenticated session. ALLOWLIST, not blocklist.
 *
 * Before this, the only gate was `rejectPurposeScopedToken`, which rejects a
 * token ONLY when it carries a `purpose` claim. A REFRESH token carries no
 * `purpose`: generateRefreshToken() above reuses `tokenConfig` verbatim, so it
 * is signed with the SAME secret, issuer and audience as an access token, and
 * carries the FULL login payload (id/role/canonicalRole/organizationId). So
 * `Authorization: Bearer <refresh token>` produced a complete authenticated
 * session that ALSO survived /logout and /refresh rotation, because both of
 * those blocklist the RT jti under `auth:rt-blocklist:` while the access path
 * reads `auth:blocklist:`.
 *
 * Verdicts:
 *   'ok'         — a real access token (tokenType === 'access', no purpose)
 *   'legacy'     — no tokenType at all, inside the grace window: accept + warn
 *   'purpose'    — purpose-scoped (mfa_challenge / mfa_setup)
 *   'wrong-type' — tokenType present but not 'access' (i.e. 'refresh')
 *   'untyped'    — no tokenType and the grace window has expired
 *
 * NOTE the asymmetry that makes this safe to ship on day one: the grace window
 * tolerates an ABSENT tokenType only. A token that explicitly says
 * `tokenType:'refresh'` is rejected immediately, grace window or not — so the
 * vulnerability closes at deploy time and the grace only keeps already-issued
 * untyped ACCESS tokens (<=24h health / <=12h provider) alive through rollout.
 *
 * @param {object} decoded verified JWT payload
 * @returns {'ok'|'legacy'|'purpose'|'wrong-type'|'untyped'}
 */
function classifyTokenForAccessPath(decoded) {
  if (!decoded || typeof decoded !== 'object') {
    return 'untyped';
  }
  if (decoded.purpose) {
    return 'purpose';
  }
  const tokenType = typeof decoded.tokenType === 'string' ? decoded.tokenType.trim() : '';
  if (tokenType === 'access') {
    return 'ok';
  }
  if (tokenType) {
    return 'wrong-type';
  }
  const graceUntil = getLegacyUntypedTokenGraceDeadlineMs();
  if (graceUntil !== null && Date.now() < graceUntil) {
    return 'legacy';
  }
  return 'untyped';
}

module.exports = {
  getJWTConfiguration,
  classifyTokenForAccessPath,
  getLegacyUntypedTokenGraceDeadlineMs,
  loadJWTConfiguration: getJWTConfiguration,
  resolveTokenType,
  verifyToken,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  // Exposed for tests / token-rotation flows that need to mint a fresh jti
  // outside the standard generators.
  generateJti,
};
