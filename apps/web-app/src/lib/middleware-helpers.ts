/**
 * Pure helpers extracted from `apps/web-app/src/middleware.ts` so the
 * JWT-decoding + canonical-role gating logic can be unit-tested without
 * spinning up a NextRequest. Both the `/provider/*` and `/health/*`
 * branches in middleware.ts call into these helpers (V1-D, D1 fix).
 *
 * Why extract:
 *   - Pre-V1-D the `/health/*` branch only checked cookie presence and
 *     never asserted the JWT's role. A provider with an `auth_token`
 *     cookie (dev fixture, cross-tab leakage) bypassed the gate.
 *   - The `/provider/*` branch already decoded the JWT and applied role
 *     rules at middleware.ts:151-157, but the logic was inline so it
 *     could not be jest-tested.
 *   - Extracting both decoders into pure helpers lets the test suite
 *     prove the redirect decision for 6+ role inputs (admin, scheduler,
 *     auditor, account, health, unknown) without booting Next.
 *
 * @module middleware-helpers
 */

import { normalizeRole, isProviderRole, CANONICAL_ROLES, type CanonicalRole } from './constants/canonical-roles';

/**
 * Decode the payload of a JWT *without* verifying its signature. Used
 * only by Next middleware where we need to peek at the role claim to
 * decide a redirect — the actual signature verification happens on the
 * backend's `authenticateHealth` / `authenticateProvider` calls.
 *
 * Returns null for malformed input rather than throwing — middleware
 * must never crash on a bad cookie, only redirect to the login page.
 */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
    if (!token || typeof token !== 'string') {
        return null;
    }
    const parts = token.split('.');
    if (parts.length < 2) {
        return null;
    }
    try {
        // atob exists in the Edge runtime (Next middleware) and in
        // node 18+ test environments. Buffer/base64url is unavailable
        // in Edge, so atob is the portable choice.
        const encoded = parts[1];
        if (encoded === undefined) {
            return null;
        }
        // JWTs are base64url (RFC 7515): '-'/'_' instead of '+'/'/', no
        // padding. Bare atob() throws on those chars — any payload whose
        // bytes happen to encode with them (e.g. Thai name claims) decoded
        // to null here, so the middleware read role=null and bounced a
        // VALID session to login. Normalize like auth-service-jwt.ts does.
        const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
        const decoded = atob(padded);
        const parsed = JSON.parse(decoded);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

/**
 * Extract the canonical role from a JWT token, returning `null` if the
 * token is malformed or carries no recognisable role claim. The token
 * payload may use either `canonicalRole` (newer ThaID sessions) or
 * `role` (legacy / mobile). Both are normalised via `normalizeRole`.
 */
export function decodeCanonicalRoleFromToken(token: string | null | undefined): CanonicalRole | null {
    const payload = decodeJwtPayload(token);
    if (!payload) {
        return null;
    }
    const claim = (payload.canonicalRole ?? payload.role) as string | undefined;
    return normalizeRole(claim ?? null);
}

/**
 * Decide whether a `/health/*` request carrying the given cookie token
 * should pass through, redirect to the provider dashboard (because the
 * token belongs to staff), or redirect to the health login page (because
 * the token is missing/unknown).
 *
 * Returned object:
 *   - { decision: 'allow' }                        — HEALTH user, let through
 *   - { decision: 'redirect-provider-dashboard' }  — provider role, send to /provider/dashboard
 *   - { decision: 'redirect-health-login' }        — missing/unknown role, send to /auth/health/login
 *
 * D1 fix mirrors the existing /provider/* check at middleware.ts:151-157.
 */
export type HealthAccessDecision =
    | { decision: 'allow' }
    | { decision: 'redirect-provider-dashboard' }
    | { decision: 'redirect-health-login' };

export function decideHealthAccess(token: string | null | undefined): HealthAccessDecision {
    const role = decodeCanonicalRoleFromToken(token);
    if (role === CANONICAL_ROLES.HEALTH) {
        return { decision: 'allow' };
    }
    if (role && isProviderRole(role)) {
        return { decision: 'redirect-provider-dashboard' };
    }
    // Unknown / unmapped role, or token failed to decode entirely. Send
    // the user back to the health login so a cleared / corrupt cookie
    // doesn't deadlock them on a redirect loop.
    return { decision: 'redirect-health-login' };
}

/**
 * V2-B RB-1 — Decide whether the given canonical role may visit a
 * `/provider/*` pathname. Returns 'allow' when the role passes the
 * per-prefix role rule (or is ADMIN, which bypasses every rule), and
 * 'redirect-provider-dashboard' otherwise. Used by the unit test so the
 * routing decision is provable without spinning up Next middleware.
 *
 * Mirrors the inline logic at `middleware.ts:169-174`:
 *   - find the first prefix rule that matches the pathname
 *   - admin bypasses
 *   - role missing OR role not in rule.roles → redirect
 *
 * The middleware also redirects users without a token to the login
 * page — that path is *not* covered by this helper, only the
 * role-vs-rule decision.
 */
/**
 * FE-XC-02 / role-config Phase 1 — the /provider/* per-prefix route rules are now
 * PROJECTED from the single source of truth in `provider-role-config.ts` (which
 * also drives `NAV_ROLE_RULES` in constants.ts + the post-login landing). Re-exported
 * here under the original name so middleware.ts (the shipping Edge gate) and the
 * matrix/unit tests import the exact same ordered table — no hand-copied mirror that
 * can silently drift. `provider-role-config.ts` imports only `./constants/canonical-roles`
 * so this re-export stays Edge-safe (no next/server, no lucide).
 */
export { PROVIDER_ROUTE_ROLE_RULES } from './provider-role-config';

export type ProviderAccessDecision =
    | { decision: 'allow' }
    | { decision: 'redirect-provider-dashboard' }
    | { decision: 'redirect-provider-login' };

export function decideProviderRouteAccess(
    pathname: string,
    role: string | null | undefined,
    rules: ReadonlyArray<{ prefix: string; roles: readonly string[] }>,
): ProviderAccessDecision {
    const normalized = normalizeRole(role);
    const rule = rules.find((item) => pathname.startsWith(item.prefix));
    if (!rule) {
        // FE-XC-03 default-deny: an UNLISTED /provider/* path (e.g. the bare
        // /provider/dashboard) still requires a valid PROVIDER role. Previously
        // this fell through to 'allow', so a health-role token sitting in the
        // provider cookie slot could render the dashboard (defense-in-depth gap;
        // backend APIs already enforce). A non-provider role is bounced to the
        // provider login — NOT the dashboard, which would loop on this same path.
        if (normalized && isProviderRole(normalized)) {
            return { decision: 'allow' };
        }
        return { decision: 'redirect-provider-login' };
    }
    if (normalized === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        return { decision: 'allow' };
    }
    if (!normalized || !rule.roles.includes(normalized)) {
        return { decision: 'redirect-provider-dashboard' };
    }
    return { decision: 'allow' };
}
