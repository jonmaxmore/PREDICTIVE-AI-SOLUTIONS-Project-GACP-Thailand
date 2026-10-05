/**
 * Authentication Middleware (Production + Test Safe)
 *
 * Provides authentication functions for Clean Architecture modules.
 * Supports both Health (public) and Provider authentication.
 *
 * Improvements:
 * - Safe fallback JWT config for Jest/test environment
 * - Upper/lowercase role normalization
 * - Logger downgraded to .warn in catch blocks (no false Jest fail)
 * - Defensive error handling for missing/malformed tokens
 * - Clean exit prevention for unit tests
 *
 * Workflow:
 * Request → Extract Token → Verify with Correct Secret → Check Role → Attach User → Continue
 */

const { createLogger } = require('../shared/logger');
const logger = createLogger('auth-middleware');
const jwtConfig = require('../config/jwt-security');
const { normalizeRole, isProviderRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');
const { tenantContextMiddleware } = require('./tenant-context-middleware');
const { isAccessTokenBlocklisted } = require('../services/token-revocation-service');
// Sprint 6 B-C1: middleware fetches healthId/providerId from DB after JWT
// verify (those columns were removed from the JWT payload). Use the named
// `prisma` export so we land on the test-mocked client in unit tests.
const { prisma: authDbClient } = require('../services/prisma-database');
// Detokenize STAGE 0: the FK-token flag controls whether req.user.canonicalId
// is the token (the *Hmac column) or the national ID. See shared/fk-token.js.
const { useFkToken } = require('../shared/fk-token');
const { canAccountHoldSession } = require('../shared/account-status');
const { lookup: lookupErrorCode } = require('../shared/error-codes');
// BE-AUTH-03-03 (session epoch): true when a token predates User.sessionsRevokedAt.
const { isTokenBeforeSessionEpoch } = require('../utils/session-epoch');

// One shared instance — runs after req.user is attached and binds the
// tenant scope for the rest of the request. See ADR-014.
const bindTenant = tenantContextMiddleware();

// The only per-request scope is the tenant. There is no active workspace:
// health reads follow the caller's holder memberships, computed per request
// by services/holder-access.js (spec 2026-09-30-remove-workspace-mode, R2 Task 12).
const bindScopes = bindTenant;

// Safe load of JWT configuration
let JWT_CONFIG;
function loadConfigSafely() {
  try {
    JWT_CONFIG = jwtConfig.loadJWTConfiguration();
  } catch (error) {
    if (process.env.NODE_ENV === 'test') {
      JWT_CONFIG = {
        public: { secret: 'test-health-jwt-secret-for-jest' },
        provider: { secret: 'test-provider-jwt-secret-for-jest' },
      };
      // Legacy alias for backward compatibility.
      JWT_CONFIG.dtam = JWT_CONFIG.provider;

      process.env.HEALTH_JWT_SECRET =
        process.env.HEALTH_JWT_SECRET || JWT_CONFIG.public.secret;

      process.env.PROVIDER_JWT_SECRET =
        process.env.PROVIDER_JWT_SECRET || process.env.DTAM_JWT_SECRET || JWT_CONFIG.provider.secret;
      process.env.DTAM_JWT_SECRET =
        process.env.DTAM_JWT_SECRET || process.env.PROVIDER_JWT_SECRET;
      logger.warn('Using fallback JWT config for test environment');
    } else {
      logger.error('Failed to load JWT configuration:', error.message);
      logger.error('   Application cannot start without valid JWT secrets');
      throw new Error('Cannot start without valid JWT secrets: ' + error.message);
    }
  }
}

loadConfigSafely();

function getActiveJwtConfig() {
  if (!JWT_CONFIG) {
    loadConfigSafely();
  }

  const activeConfig = JWT_CONFIG;

  const healthSecret = process.env.HEALTH_JWT_SECRET || process.env.JWT_SECRET;
  if (activeConfig.public && healthSecret && activeConfig.public.secret !== healthSecret) {
    activeConfig.public.secret = healthSecret;
  }

  const providerSecret = process.env.PROVIDER_JWT_SECRET || process.env.DTAM_JWT_SECRET;
  const providerConfig = activeConfig.provider || activeConfig.dtam;
  if (providerConfig && providerSecret && providerConfig.secret !== providerSecret) {
    providerConfig.secret = providerSecret;
    activeConfig.provider = providerConfig;
    activeConfig.dtam = providerConfig;
  }

  return activeConfig;
}

function resolveTokenUserId(decodedToken) {
  if (!decodedToken || typeof decodedToken !== 'object') {
    return null;
  }

  // Sprint 6 M1: `healthId` is no longer a valid fallback for the user
  // ID. Pre-Sprint-6 tokens carried it, but the canonical user PK is the
  // UUID in `id`/`userId`/`sub`/`accountId`. A token that only has a
  // healthId is malformed by Sprint 6's invariants — reject it so a
  // legacy token can't be used to address the wrong user row after the
  // Phase D plaintext column drop.
  const candidates = [
    decodedToken.id,
    decodedToken.userId,
    decodedToken.sub,
    decodedToken.accountId,
  ];
  for (const value of candidates) {
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return null;
}

/**
 * Sprint 6 B-C1: post-verify DB lookup for healthId/providerId.
 *
 * The JWT no longer carries the user's healthId/providerId. After verifying
 * the token, fetch those columns from the User row keyed by `decoded.id`
 * and attach them to req.user so the 17+ route callers keep working.
 *
 * Defensive: never block the request on DB failure — log a warning and
 * continue with nulls. The callers that NEED the healthId already 401
 * on their own when it's missing.
 *
 * Legacy: when the row's healthId/providerId column is null but the
 * (pre-Sprint-6) decoded token still carries one, honour it as a fallback so
 * in-flight sessions don't break during the rollout window. (A row that is
 * GONE is refused by the callers since SECU-03 — see canHoldSession.)
 *
 * Detokenize STAGE 0 (RFC docs/handoffs/national-id-detokenize-rfc-2026-06-29.md,
 * breaker 8): ALSO resolve `canonicalId` — the value the FK columns
 * (Application/Invoice/Bundle.healthId) point at. It is SOURCED FROM THE DB
 * COLUMNS ONLY (never the JWT fallback) so it always equals the live FK key:
 *   - flag OFF (default): canonicalId = healthId ?? providerId (the national ID
 *     == the FK key today — byte-for-byte the current behaviour, where callers
 *     read req.user.canonicalId || req.user.healthId and get the national ID).
 *   - flag ON: canonicalId = providerIdHmac ?? healthIdHmac (the token == the
 *     re-keyed FK key). NOT the JWT, NOT the plaintext column — the *Hmac column.
 *
 * @param {string} userId
 * @param {object} decoded   verified JWT payload (used for legacy fallback)
 * @returns {Promise<{ healthId: string|null, providerId: string|null, canonicalId: string|null,
 *   sessionsRevokedAt: Date|null, canHoldSession: boolean, dbHealthy: boolean }>}
 */
async function fetchIdentityFromDb(userId, decoded) {
  let dbRow = null;
  let dbHealthy = true;
  try {
    dbRow = await authDbClient.user.findUnique({
      where: { id: userId },
      // *Hmac columns added for the FK-token read chokepoint. They are the only
      // source of req.user.canonicalId when APP_FK_USE_TOKEN is on.
      select: {
        healthId: true,
        providerId: true,
        healthIdHmac: true,
        providerIdHmac: true,
        // The FK column itself — the ONLY authority on what the FK value is.
        canonicalId: true,
        // BE-AUTH-03-03 (session epoch): the instant of the last password
        // change/reset. Any access token whose `iat` predates this is rejected
        // (mirror of the /refresh gate) so an already-issued AT is cut off too.
        sessionsRevokedAt: true,
        // SECU-03: the owner's standing, read on every request — see rejectInactiveAccount.
        status: true,
        isDeleted: true,
        // The rule depends on it: staff may hold a session only while ACTIVE.
        role: true,
      },
    });
  } catch (err) {
    logger.warn(`[AUTH] Identity lookup failed for user ${userId}: ${err.message}`);
    dbRow = null;
    dbHealthy = false;
  }
  const healthIdFromDb = dbRow ? dbRow.healthId : null;
  const providerIdFromDb = dbRow ? dbRow.providerId : null;
  // canonicalId is sourced from DB columns ONLY (never decoded JWT) — it must
  // match the live FK key, and a stale JWT could carry a pre-re-key value.
  //
  // 2026-09-07 — "match the live FK key" means READ the canonicalId column, not
  // derive what it would be after a re-key. With APP_FK_USE_TOKEN on, this used
  // to answer the *Hmac token unconditionally; on a database whose re-key
  // backfill never ran (demo, measured), User.canonicalId — and therefore every
  // Application.healthId and Invoice.healthId written through fkValue() — still
  // holds the pre-re-key value. The middleware then handed every money read a
  // key no row carries: a farmer who paid ฿105,930 opened /invoices/my and got
  // zero rows, ฿0 ยอดชำระแล้ว, "ไม่พบรายการชำระเงิน". The derivations remain only
  // as fallbacks for a row whose canonicalId column is genuinely null.
  let canonicalId = null;
  if (dbRow) {
    canonicalId = dbRow.canonicalId
      ?? (useFkToken()
        ? (dbRow.providerIdHmac ?? dbRow.healthIdHmac ?? null)
        : (dbRow.healthId ?? dbRow.providerId ?? null));
  }
  return {
    healthId: healthIdFromDb != null
      ? healthIdFromDb
      // Legacy fallback for pre-Sprint-6 tokens still in flight.
      : (decoded && typeof decoded.healthId === 'string' && decoded.healthId
        ? decoded.healthId
        : null),
    providerId: providerIdFromDb != null
      ? providerIdFromDb
      : (decoded && typeof decoded.providerId === 'string' && decoded.providerId
        ? decoded.providerId
        : null),
    canonicalId,
    // BE-AUTH-03-03 (session epoch): null when no epoch set or the row is absent.
    sessionsRevokedAt: dbRow ? (dbRow.sessionsRevokedAt || null) : null,
    // SECU-03: false for a disabled / suspended / soft-deleted owner and for a
    // row that is gone. Only meaningful when dbHealthy.
    canHoldSession: canAccountHoldSession(dbRow),
    dbHealthy,
  };
}

/**
 * SECU-03 — refuse an access token whose owner may no longer hold a session
 * (shared/account-status.js: the rule every login door and /refresh apply).
 *
 * The session epoch above only cuts off tokens minted BEFORE a stamp. A token
 * minted by a login that raced the admin's disable (inside the bcrypt window),
 * or one whose owner's status was written without a stamp (direct SQL), would
 * otherwise pass every request until its natural exp (HEALTH 24h, PROVIDER 12h).
 *
 * Same code and HTTP status as the /refresh door. Skipped when the identity
 * read failed (dbHealthy=false): the status is unknown there, and each caller
 * already has its degraded-DB policy (HEALTH keep-alive, C4 fail-closed for
 * privileged providers).
 *
 * @returns {boolean} true if the request was rejected (caller must stop)
 */
function rejectInactiveAccount(identity, res) {
  if (!identity.dbHealthy || identity.canHoldSession) {
    return false;
  }
  const row = lookupErrorCode('ACCOUNT_INACTIVE');
  res.status(row.httpStatus).json({
    success: false,
    error: 'Forbidden',
    message: `${row.messageTh} / ${row.messageEn}`,
    code: row.code,
  });
  return true;
}

/**
 * C4 (BE-AUTH epoch fail-open) — a provider session has NO refresh token, so the
 * post-verify DB epoch/identity read is the ONLY eviction path for an
 * already-issued provider access token. When that read fails (pool
 * timeout/failover → dbHealthy=false) the request must NOT pass through on the
 * token's STALE role for a PRIVILEGED provider (a fired/demoted auditor could
 * record AUDIT_PASSED during the blip). These are the provider roles that can
 * act on money/workflow/cert surfaces — i.e. every provider role (see
 * canonical-rbac PROVIDER_CANONICAL_ROLES). HEALTH is deliberately excluded: it
 * keeps the degraded-DB keep-alive because /refresh is its authoritative
 * eviction backstop (a stale HEALTH AT lives ≤ its natural exp; the RT can no
 * longer renew it).
 */
const PRIVILEGED_PROVIDER_ROLES = new Set([
  CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
  CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM,
  CANONICAL_ROLES.DISPATCHER,
  CANONICAL_ROLES.DOCUMENT_REVIEWER,
  CANONICAL_ROLES.FIELD_INSPECTOR,
  CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
  CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
  CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]);

function isPrivilegedProviderRole(role) {
  const canonical = normalizeRole(role);
  return canonical ? PRIVILEGED_PROVIDER_ROLES.has(canonical) : false;
}

/**
 * C4 — 401 for a privileged provider whose identity/epoch could not be verified
 * against the DB (transient read failure). Signals the client to RETRY (the
 * session is not necessarily invalid — we simply could not confirm it), rather
 * than TOKEN_REVOKED (which would prompt a re-login).
 */
function rejectIdentityUnverified(res) {
  return res.status(401).json({
    success: false,
    error: 'Unauthorized',
    message: 'ไม่สามารถยืนยันเซสชันได้ชั่วคราว กรุณาลองใหม่ / Session could not be verified right now. Please retry.',
    code: 'IDENTITY_UNVERIFIED',
  });
}

/**
 * PENTEST A1 — reject purpose-scoped tokens on ANY access-token path.
 *
 * The MFA challenge token (`mfa_session`, minted by shared/mfa-challenge-binding.js
 * with `purpose:'mfa_challenge'`) and the provider `mfa_setup` token are signed
 * with the SAME per-portal secret + audience as a real access token — the only
 * thing distinguishing them is the `purpose` claim. Without this guard, a
 * password-only attacker on a 2FA-enabled account could replay the challenge
 * token returned by the password step as a full authenticated session, skipping
 * the second factor entirely. A genuine access token NEVER carries `purpose`
 * (AuthService issues role/canonicalRole payloads with no purpose), so rejecting
 * any purpose-bearing token here is safe and closes the 2FA bypass. The
 * challenge is still consumable at POST /api/mfa/verify, which calls
 * jwtConfig.verifyToken directly (not these middlewares).
 */
/**
 * TASK-2 — widened from "reject purpose-scoped" to a positive ALLOWLIST on the
 * token class. The purpose blocklist missed the REFRESH token: it carries no
 * `purpose`, is signed with the same secret/issuer/audience as an access token,
 * and carries the whole login payload — so `Authorization: Bearer <rt>` was a
 * full 7-day session that ALSO survived /logout and /refresh rotation (both
 * blocklist the RT jti under `auth:rt-blocklist:`, while this path reads
 * `auth:blocklist:`). Classification lives in config/jwt-security.js so the
 * mint side and the verify side can never drift.
 */
function rejectPurposeScopedToken(decoded, res, authType = 'access') {
  const verdict = jwtConfig.classifyTokenForAccessPath(decoded);
  if (verdict === 'ok') {
    return false;
  }
  if (verdict === 'legacy') {
    console.warn(
      `[AUTH] Accepting legacy token without tokenType claim during grace window ` +
      `(authType=${authType}). Unset LEGACY_UNTYPED_TOKEN_GRACE_UNTIL to close this.`,
    );
    return false;
  }
  if (verdict === 'wrong-type') {
    logger.warn(
      `[AUTH] Non-access token presented on an access path ` +
      `(authType=${authType}, tokenType=${decoded && decoded.tokenType}).`,
    );
  }
  res.status(401).json({
    success: false,
    error: 'Unauthorized',
    message: 'This token cannot be used to authenticate a session',
    code: 'INVALID_TOKEN',
  });
  return true;
}

/**
 * Resolve the legacy "no-jti" grace deadline from env.
 *
 * `LEGACY_NO_JTI_GRACE_UNTIL` accepts an ISO-8601 timestamp. While the current
 * wall clock is before that deadline, tokens missing the `jti` claim are still
 * accepted (with a warn-level log) so existing sessions issued before the
 * revocation upgrade keep working through the rollout window. After the
 * deadline (or if the env var is unset / malformed), the hard reject below
 * kicks back in — closing the token-revocation bypass.
 *
 * Defensive: invalid ISO string -> warn + return null (default: hard reject).
 *
 * @returns {number|null} epoch ms of deadline, or null if no grace period.
 */
let _LOGGED_INVALID_GRACE = false;
function getLegacyJtiGraceDeadlineMs() {
  const raw = process.env.LEGACY_NO_JTI_GRACE_UNTIL;
  if (!raw || !String(raw).trim()) {
    return null;
  }
  const parsed = Date.parse(String(raw).trim());
  if (Number.isNaN(parsed)) {
    if (!_LOGGED_INVALID_GRACE) {
      logger.warn(
        `[AUTH] LEGACY_NO_JTI_GRACE_UNTIL is set but not a valid ISO timestamp: "${raw}". ` +
        'Treating as no grace period (default: hard reject tokens missing jti).',
      );
      _LOGGED_INVALID_GRACE = true;
    }
    return null;
  }
  return parsed;
}

/**
 * Enforce that a decoded JWT carries a non-empty `jti` claim.
 *
 * If the claim is missing/empty AND we are inside the grace window, log a
 * warning and let the request through (rollout window for legacy tokens).
 * Otherwise, write a 401 response onto `res` and return true to signal the
 * caller that the request was rejected.
 *
 * @param {object} decoded   verified JWT payload
 * @param {object} res       Express response (used on rejection)
 * @param {string} authType  'health' | 'provider' | 'any' (for logging)
 * @returns {boolean}        true if the request was rejected (caller must stop)
 */
function rejectIfNoJti(decoded, res, authType) {
  const jti = decoded && typeof decoded.jti === 'string' ? decoded.jti.trim() : '';
  if (jti) {
    return false;
  }

  const graceUntil = getLegacyJtiGraceDeadlineMs();
  if (graceUntil !== null && Date.now() < graceUntil) {
    // Inside grace window — accept the legacy token but loudly warn so the
    // remaining pre-upgrade tokens are visible in logs ahead of the deadline.
    console.warn(
      `[AUTH] Accepting legacy token without jti claim during grace window ` +
      `(authType=${authType}, until=${new Date(graceUntil).toISOString()}). ` +
      `Revocation cannot be enforced for this token.`,
    );
    return false;
  }

  res.status(401).json({
    success: false,
    code: 'TOKEN_NO_JTI',
    error: 'Token missing JTI claim',
    message: 'โทเค็นไม่มี JTI claim กรุณาเข้าสู่ระบบใหม่ / Token missing JTI claim. Please re-login.',
  });
  return true;
}

try {
  if (JWT_CONFIG?.public?.secret) {
    process.env.HEALTH_JWT_SECRET = process.env.HEALTH_JWT_SECRET || JWT_CONFIG.public.secret;
  }
  if (JWT_CONFIG?.provider?.secret || JWT_CONFIG?.dtam?.secret) {
    const providerSecret = JWT_CONFIG?.provider?.secret || JWT_CONFIG?.dtam?.secret;
    process.env.PROVIDER_JWT_SECRET = process.env.PROVIDER_JWT_SECRET || providerSecret;
    process.env.DTAM_JWT_SECRET = process.env.DTAM_JWT_SECRET || process.env.PROVIDER_JWT_SECRET;
  }
} catch (error) {
  logger.warn('Unable to synchronize JWT secrets with environment:', error.message);
}

/**
 * Authenticate HEALTH_USER (Public Users)
 *
 * Logic:
 * 1. Extract Bearer token from Authorization header
 * 2. Verify token ด้วย public JWT secret
 * 3. ตรวจสอบ role ต้องเป็น HEALTH_USER หรือ PUBLIC
 * 4. Attach decoded user info ไปที่ req.user
 * 5. Continue to next middleware
 */
async function authenticateHealth(req, res, next) {
  try {
    // Priority: 1. Cookie (web clients), 2. Authorization header (mobile apps)
    const cookieToken = req.cookies?.auth_token;
    const authHeader = req.headers['authorization'];
    const headerToken = authHeader && authHeader.split(' ')[1];
    const token = cookieToken || headerToken;

    if (!token) {
      if (req.path.includes('/applications/draft')) {
        logger.warn(`[Auth] No token found for request to ${req.originalUrl}`);
      }
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'No token provided',
        code: 'NO_TOKEN',
      });
    }


    // ใช้ secure JWT secret จาก configuration
    const decoded = jwtConfig.verifyToken(token, 'public', getActiveJwtConfig());

    // PENTEST A1: an mfa_challenge / purpose-scoped token must never authenticate.
    if (rejectPurposeScopedToken(decoded, res)) {
      return;
    }

    // Enforce JTI claim so the Redis revocation blocklist can actually be
    // consulted. Without `jti`, a revoked token would stay valid until its
    // natural `exp` — that is the bypass we are closing here.
    if (rejectIfNoJti(decoded, res, 'health')) {
      return; // response already sent
    }

    // Sprint 6 B-C1: consult the JTI blocklist BEFORE the DB identity
    // lookup. A revoked token should never trigger a User row read.
    try {
      const revoked = await isAccessTokenBlocklisted(decoded.jti);
      if (revoked) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Token has been revoked',
          code: 'TOKEN_REVOKED',
        });
      }
    } catch (revErr) {
      // Defensive: a Redis outage must not silently grant access nor
      // block legitimate users — log and continue (the JWT is still
      // signature-valid). Operators should monitor this.
      logger.warn(`[AUTH] Token revocation check failed: ${revErr.message}`);
    }

    const resolvedUserId = resolveTokenUserId(decoded);
    if (!resolvedUserId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid token payload',
        code: 'TOKEN_PAYLOAD_INVALID',
      });
    }

    // Sprint 6 B-C1: fetch healthId/providerId from DB (no longer in JWT).
    const identity = await fetchIdentityFromDb(resolvedUserId, decoded);

    // BE-AUTH-03-03 (session epoch): cut off an already-issued access token whose
    // `iat` predates the owner's last password change/reset. Only enforced when
    // the identity read succeeded (dbHealthy) — the degraded-DB path below is a
    // deliberate keep-alive, and the AUTHORITATIVE eviction happens at /refresh
    // (a stale AT lives ≤ its natural exp; the RT can no longer renew it).
    if (identity.dbHealthy && isTokenBeforeSessionEpoch(decoded, identity.sessionsRevokedAt)) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Session was revoked (password changed). Please log in again.',
        code: 'TOKEN_REVOKED',
      });
    }

    // SECU-03: a disabled / deleted owner's token is refused even without a stamp.
    if (rejectInactiveAccount(identity, res)) {
      return;
    }

    // Attach user info to request
    req.user = {
      ...decoded,
      id: resolvedUserId,
      healthId: identity.healthId,
      providerId: identity.providerId,
      // Detokenize STAGE 0: the live FK key (national ID today, token when
      // APP_FK_USE_TOKEN is on). Sourced from DB *Hmac columns, never the JWT.
      canonicalId: identity.canonicalId,
      canonicalRole: normalizeRole(decoded.canonicalRole || decoded.role) || CANONICAL_ROLES.HEALTH,
    };
    // ADR-014: bind tenant scope before continuing to the route handler.
    // When the identity DB lookup failed (Redis/Prisma outage), skip the
    // tenant scope bind — it would just hit the same broken DB and 500
    // out an otherwise-recoverable request.
    if (!identity.dbHealthy) {
      return next();
    }
    return bindScopes(req, res, next);
  } catch (error) {
    logger.error('[AUTH] Health authentication failed:', error.message);

    // Enhanced error response
    if (error.code === 'TOKEN_EXPIRED') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Token has expired',
        code: 'TOKEN_EXPIRED',
        expiredAt: error.expiredAt,
      });
    }

    if (error.code === 'INVALID_TOKEN') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid token',
        code: 'INVALID_TOKEN',
      });
    }

    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Authentication failed',
      code: 'AUTH_FAILED',
    });
  }
}

/**
 * Authenticate Provider (GACP Thai Standard)
 *
 * Logic:
 * 1. Extract Bearer token from Authorization header
 * 2. Verify token ด้วย Provider JWT secret (แยกจาก public)
 * 3. ตรวจสอบ role ต้องเป็น Provider roles
 * 4. Attach decoded user info ไปที่ req.user
 * 5. Continue to next middleware
 */
async function authenticateProvider(req, res, next) {
  try {
    // Prefer the httpOnly cookie (the web flow's source of truth, refreshed on
    // every login) over the Authorization header. The web client also attaches a
    // Bearer header from a *stored* token; when that stored token goes stale it
    // would otherwise override the fresh cookie and 401 every navigation. Cookie
    // first matches authenticateHealth; header is the fallback for cookieless
    // API/mobile clients.
    const authHeader = req.headers['authorization'];
    const headerToken = authHeader && authHeader.split(' ')[1];
    const cookieToken = req.cookies?.provider_token;
    const token = cookieToken || headerToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Access token required',
        code: 'NO_TOKEN',
      });
    }

    // ใช้ Provider JWT secret (แยกจาก public เพื่อความปลอดภัย)
    const decoded = jwtConfig.verifyToken(token, 'provider', getActiveJwtConfig());

    // PENTEST A1: reject purpose-scoped (mfa_challenge / mfa_setup) tokens.
    if (rejectPurposeScopedToken(decoded, res)) {
      return;
    }

    // Enforce JTI claim so Redis revocation lookups work. Without a `jti`,
    // /logout cannot blocklist this token and it stays valid until `exp`.
    if (rejectIfNoJti(decoded, res, 'provider')) {
      return; // response already sent
    }

    // Sprint 6 B-C1: consult JTI blocklist before DB lookup (mirrors health path).
    try {
      const revoked = await isAccessTokenBlocklisted(decoded.jti);
      if (revoked) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Token has been revoked',
          code: 'TOKEN_REVOKED',
        });
      }
    } catch (revErr) {
      logger.warn(`[AUTH] Token revocation check failed: ${revErr.message}`);
    }

    const resolvedUserId = resolveTokenUserId(decoded);
    if (!resolvedUserId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid token payload',
        code: 'TOKEN_PAYLOAD_INVALID',
      });
    }

    // Check role must be a Provider role (uses canonical-rbac)
    const canonicalRole = normalizeRole(decoded.role);
    if (!decoded.role || !isProviderRole(decoded.role)) {
      logger.warn(`[AUTH] Non-provider role attempted provider access: ${canonicalRole || 'UNMAPPED'}`);
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Provider access only',
        code: 'INVALID_ROLE',
      });
    }

    // Sprint 6 B-C1: fetch healthId/providerId from DB.
    const identity = await fetchIdentityFromDb(resolvedUserId, decoded);

    // BE-AUTH-03-03 (session epoch): mirror of the health path — reject an
    // access token issued before the owner's last password change/reset.
    if (identity.dbHealthy && isTokenBeforeSessionEpoch(decoded, identity.sessionsRevokedAt)) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Session was revoked (password changed). Please log in again.',
        code: 'TOKEN_REVOKED',
      });
    }

    // SECU-03: mirror of the health path — refuse a disabled / deleted owner.
    if (rejectInactiveAccount(identity, res)) {
      return;
    }

    // Attach user info to request
    req.user = {
      ...decoded,
      id: resolvedUserId,
      healthId: identity.healthId,
      providerId: identity.providerId,
      // Detokenize STAGE 0: live FK key (national ID today, token when flag on).
      canonicalId: identity.canonicalId,
      canonicalRole: normalizeRole(decoded.canonicalRole || decoded.role),
    };
    // ADR-014: bind tenant scope before continuing to the route handler.
    // Skip when the identity DB lookup itself failed — bindScopes would
    // re-hit the same broken DB and 500 out a recoverable request.
    if (!identity.dbHealthy) {
      // C4: a privileged provider has no /refresh backstop, so the DB epoch
      // read is the ONLY eviction path. Fail CLOSED (401, retry) rather than
      // pass through on a possibly-stale role during the DB blip.
      if (isPrivilegedProviderRole(decoded.role)) {
        return rejectIdentityUnverified(res);
      }
      return next();
    }
    return bindScopes(req, res, next);
  } catch (error) {
    logger.error('[AUTH] Provider authentication failed:', error.message);

    // Enhanced error response
    if (error.code === 'TOKEN_EXPIRED') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Token has expired - please login again',
        code: 'TOKEN_EXPIRED',
        expiredAt: error.expiredAt,
      });
    }

    if (error.code === 'INVALID_TOKEN') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid token',
        code: 'INVALID_TOKEN',
      });
    }

    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Authentication failed',
      code: 'AUTH_FAILED',
    });
  }
}

/**
 * Optional Authentication (for public + authenticated endpoints)
 *
 * Logic:
 * - ถ้ามี token → verify และ attach user
 * - ถ้าไม่มี token หรือ token ไม่ถูกต้อง → continue โดยไม่มี user
 * - ไม่ return error เพราะเป็น optional
 */
function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      try {
        const decoded = jwtConfig.verifyToken(token, 'public', getActiveJwtConfig());
        // Only an ACCESS token may become an identity here. A refresh token
        // verifies against the same secret, issuer and audience and carries the
        // full login payload, so without this it became a complete req.user —
        // and bindScopes below derives the tenant binding from req.user. Same
        // for a purpose-scoped mfa_challenge token. classifyTokenForAccessPath
        // is the same source of truth rejectPurposeScopedToken uses, so this
        // path cannot drift from the mandatory ones.
        //
        // A wrong-class token degrades to ANONYMOUS rather than 401: the caller
        // mounted "optional" auth, so the request must still work. That also
        // keeps the existing anonymous-fallback behaviour for malformed tokens.
        const verdict = jwtConfig.classifyTokenForAccessPath(decoded);
        if (verdict === 'ok' || verdict === 'legacy') {
          req.user = decoded;
        } else {
          logger.warn(`[AUTH] Optional auth ignoring non-access token (verdict=${verdict}).`);
        }
      } catch (error) {
        // Token ไม่ถูกต้อง แต่ไม่ block request
        logger.info('[AUTH] Optional auth failed:', error.message);
      }
    }

    // Continue ไม่ว่าจะมี user หรือไม่ — bindTenant is a no-op when req.user
    // is missing, so this is safe for anonymous requests too (ADR-014).
    return bindScopes(req, res, next);
  } catch (_error) {
    // Continue without user
    next();
  }
}

/**
 * Authenticate Any (Dual Auth — Health or Provider)
 *
 * Tries Provider token first, then Health token.
 * Useful for shared routes like notifications, dashboard that both
 * Health users and Provider staff should be able to access.
 */
async function authenticateAny(req, res, next) {
  // Cookie-first (see authenticateProvider): the web client attaches a Bearer
  // header from a stored token that can go stale and otherwise overrides the
  // fresh login cookie, 401-ing every navigation. Header remains the fallback
  // for cookieless API/mobile clients.
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1];
  const cookieToken = req.cookies?.provider_token || req.cookies?.auth_token;
  const token = cookieToken || headerToken;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'No token provided',
      code: 'NO_TOKEN',
    });
  }

  // Try provider token first
  try {
    const decoded = jwtConfig.verifyToken(token, 'provider', getActiveJwtConfig());
    // PENTEST A1: purpose-scoped (mfa_challenge / mfa_setup) tokens must never
    // authenticate on the dual-auth path either.
    if (rejectPurposeScopedToken(decoded, res)) {
      return;
    }
    const resolvedUserId = resolveTokenUserId(decoded);
    if (resolvedUserId) {
      // Enforce JTI: this token clearly decodes against the provider secret,
      // so reject with a specific code rather than masking as INVALID_TOKEN.
      if (rejectIfNoJti(decoded, res, 'any:provider')) {
        return; // response already sent
      }
      // Consult the JTI revocation blocklist BEFORE the DB identity lookup —
      // authenticateAny previously skipped this (authenticateHealth/Provider
      // both do it), so a logged-out / password-changed / revoked token kept
      // full access on every dual-auth route (payment-slips, workflow
      // transitions, certificates, entities, dashboard) until natural exp.
      try {
        if (await isAccessTokenBlocklisted(decoded.jti)) {
          return res.status(401).json({
            success: false,
            error: 'Unauthorized',
            message: 'Token has been revoked',
            code: 'TOKEN_REVOKED',
          });
        }
      } catch (revErr) {
        // Redis outage must not silently grant nor block — log and continue
        // (the JWT is still signature-valid). Mirrors the health/provider paths.
        logger.warn(`[AUTH] Token revocation check failed (any:provider): ${revErr.message}`);
      }
      // Sprint 6 B-C1 parity: healthId/providerId are no longer in the JWT —
      // enrich from DB just like authenticateHealth/authenticateProvider do,
      // otherwise routes mounted on authenticateAny that read req.user.healthId
      // (dashboard /my, payments, entities…) 403 for every user.
      const identity = await fetchIdentityFromDb(resolvedUserId, decoded);
      // BE-AUTH-03-03 (session epoch): reject a pre-password-change access token
      // on the dual-auth path too (certificates/payments/entities mount here).
      if (identity.dbHealthy && isTokenBeforeSessionEpoch(decoded, identity.sessionsRevokedAt)) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Session was revoked (password changed). Please log in again.',
          code: 'TOKEN_REVOKED',
        });
      }
      // SECU-03: refuse a disabled / deleted owner on the dual-auth path too.
      if (rejectInactiveAccount(identity, res)) {
        return;
      }
      req.user = {
        ...decoded,
        id: resolvedUserId,
        healthId: identity.healthId,
        providerId: identity.providerId,
        // Detokenize STAGE 0: live FK key (national ID today, token when flag on).
        canonicalId: identity.canonicalId,
        canonicalRole: normalizeRole(decoded.canonicalRole || decoded.role),
        authType: 'provider',
      };
      // On a DB identity-lookup outage, continue without the tenant bind
      // rather than 500 an otherwise-recoverable request (parity w/ authenticateHealth).
      if (!identity.dbHealthy) {
        // C4: fail CLOSED for a privileged provider on the dual-auth path too —
        // the provider has no /refresh backstop so this is the sole eviction
        // check. HEALTH (below) keeps the keep-alive.
        if (isPrivilegedProviderRole(decoded.role)) {
          return rejectIdentityUnverified(res);
        }
        return next();
      }
      // ADR-014: bind tenant scope before continuing
      return bindScopes(req, res, next);
    }
  } catch (_providerErr) {
    // Provider verification failed, try health
  }

  // Try health token
  try {
    const decoded = jwtConfig.verifyToken(token, 'public', getActiveJwtConfig());
    // PENTEST A1: reject purpose-scoped (mfa_challenge) health tokens.
    if (rejectPurposeScopedToken(decoded, res)) {
      return;
    }
    const resolvedUserId = resolveTokenUserId(decoded);
    if (resolvedUserId) {
      // Enforce JTI on the health branch as well.
      if (rejectIfNoJti(decoded, res, 'any:health')) {
        return; // response already sent
      }
      // Consult the JTI revocation blocklist before the DB identity lookup
      // (see provider branch above for the rationale — same logout-bypass).
      try {
        if (await isAccessTokenBlocklisted(decoded.jti)) {
          return res.status(401).json({
            success: false,
            error: 'Unauthorized',
            message: 'Token has been revoked',
            code: 'TOKEN_REVOKED',
          });
        }
      } catch (revErr) {
        logger.warn(`[AUTH] Token revocation check failed (any:health): ${revErr.message}`);
      }
      // Sprint 6 B-C1 parity: enrich healthId/providerId from DB (see provider branch).
      const identity = await fetchIdentityFromDb(resolvedUserId, decoded);
      // BE-AUTH-03-03 (session epoch): reject a pre-password-change access token
      // on the health branch of the dual-auth path (parity with provider branch).
      if (identity.dbHealthy && isTokenBeforeSessionEpoch(decoded, identity.sessionsRevokedAt)) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Session was revoked (password changed). Please log in again.',
          code: 'TOKEN_REVOKED',
        });
      }
      // SECU-03: same refusal on the health branch.
      if (rejectInactiveAccount(identity, res)) {
        return;
      }
      req.user = {
        ...decoded,
        id: resolvedUserId,
        healthId: identity.healthId,
        providerId: identity.providerId,
        // Detokenize STAGE 0: live FK key (national ID today, token when flag on).
        canonicalId: identity.canonicalId,
        canonicalRole: normalizeRole(decoded.canonicalRole || decoded.role) || CANONICAL_ROLES.HEALTH,
        authType: 'health',
      };
      if (!identity.dbHealthy) {
        return next();
      }
      // ADR-014: bind tenant scope before continuing
      return bindScopes(req, res, next);
    }
  } catch (_healthErr) {
    // Both failed
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized',
    message: 'Invalid or expired token',
    code: 'INVALID_TOKEN',
  });
}

const { RBACService } = require('../services/security-compliance');
const rbacService = new RBACService();
const prisma = require('../services/prisma-database');

// Middleware to require Identity Verification (Active Status)
async function requireVerification(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { status: true, role: true },
    });

    // Skip for Admin/provider (canonical check)
    if (isProviderRole(user.role)) {
      return next();
    }

    // Check if verified
    if (user.status === 'ACTIVE') {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: 'Identity verification required',
      code: 'VERIFICATION_REQUIRED',
      status: 'NEW',
    });

  } catch (error) {
    logger.error('Verification Check Error:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
}

// Import requireRole from role-middleware for re-export
const { requireRole } = require('./role-middleware');

// Re-export requireConsent from consent-manager so route files can import it
// from auth-middleware alongside authenticateHealth without an extra require.
const { requireConsent } = require('./consent-manager');

module.exports = {
  authenticateHealth,
  authenticateProvider,
  authenticateAny,
  // Exported so self-verifying endpoints (GET /auth/provider/me verifies the
  // token inline, NOT via authenticateProvider) can enforce the SAME
  // session-epoch eviction as the central middleware (Wave-3 /me follow-up).
  isTokenBeforeSessionEpoch,
  // @deprecated Legacy aliases — only kept for test mock compatibility.
  authenticateDTAM: authenticateProvider,
  authenticate: authenticateHealth,
  /** @deprecated Use requireRole from role-middleware instead */
  authorize: (roles) => {
    // Fixed at guard construction — normalized once, not per request.
    const allowedRoles = new Set(
      (Array.isArray(roles) ? roles : [roles]).map(r => normalizeRole(r)).filter(Boolean),
    );
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
      }
      const userCanonical = normalizeRole(req.user.role);
      if (!userCanonical || !allowedRoles.has(userCanonical)) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'Insufficient permissions' });
      }
      next();
    };
  },
  optionalAuth,
  requireVerification,
  requireConsent,   // PDPA consent gate (apply after authenticateHealth on protected routes)
  requireRole, // Re-export from role-middleware

  // New Granular Permission Check (RBAC)
  checkPermission: (permission, resourceType, idParam) => rbacService.rbacMiddleware(permission, resourceType, idParam),

  rateLimitSensitive: (windowMs, max) => {
    try {
      const rateLimit = require('express-rate-limit');
      return rateLimit({
        windowMs: windowMs || 15 * 60 * 1000,
        max: max || 10,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
      });
    } catch (_err) {
      logger.warn('[Auth] express-rate-limit not available, rateLimitSensitive is a passthrough');
      return (_req, _res, next) => next();
    }
  },
};

