'use strict';

/**
 * ThaID identity service — resolve an authenticated ThaID (DOPA/BORA) profile
 * to a local GACP user, creating/touching the identity link.
 * (feat/auth-thaid-oauth; operator-mandated guards 2026-08-05)
 *
 * Split from the adapter (services/auth/idp/thaid-adapter.js) on purpose: the
 * adapter returns the raw BORA token response and NEVER touches user rows; this
 * module owns the linking/lookup/auto-provision policy.
 *
 * subject = the `sub` claim from the id_token (backchannel, TLS, our client
 * creds → origin trusted). ThaID's `sub` is documented (sandbox onboarding
 * doc, 2026-08) as the RAW 13-digit national ID (CID) itself — NOT an opaque
 * per-app identifier the OIDC shape implies. It is NEVER stored or logged in
 * that raw form: every identity_links read/write below goes through
 * thaidSubjectKey(sub) — a domain-separated, non-reversible HMAC (council
 * ruling R-D, Task 3; see thaidSubjectKey's own doc comment). The audit-log
 * subjectHash in routes/api/auth/auth-idp.js uses the SAME function so the
 * raw CID never reaches a log either.
 * The national ID (`pid`) is used ONLY to match an existing registered user
 * (computeLookupHmac, unlabelled — unchanged by this task) and is likewise
 * never stored as identity_links.subject.
 *
 * Guards (operator-mandated):
 *   - only citizen (non-provider) roles may be auto-provisioned / auto-linked —
 *     a national ID that resolves to a privileged/staff account is REJECTED
 *     (a staff member must sign in through their own portal; an admin manages
 *     the link explicitly). See assertAutoProvisionableRole.
 *   - auto-provision is fail-closed in production (AUTH_AUTOPROVISION_DISABLED).
 *
 * identity_links is NOT tenant-scoped, so every read/write here runs inside
 * withoutTenantScope() (the Prisma tenant extension must not inject an
 * organizationId onto a global table).
 */

const crypto = require('crypto');

const { prisma } = require('../prisma-database');
const { computeLookupHmac } = require('../../utils/field-encryption');
const { normalizeRole, CANONICAL_ROLES } = require('../../shared/canonical-rbac');
const { withoutTenantScope } = require('../tenant-context');
const { isProduction } = require('../../config/auth-providers');
const authService = require('../prisma-auth-service');

const PROVIDER = 'thaid';

/**
 * Decode the FULL set of id_token claims this codebase reads: `sub` plus —
 * present ONLY when the RP requested them via scope AND BORA folded them
 * INSIDE the id_token instead of the top-level token response — `pid`,
 * `given_name`, `family_name`.
 *
 * Task 4 (audit-verified two-shape gap): §6.2.2's "**" note (manual-citations.md
 * :134-135) says these are mutually exclusive on the WIRE per scope choice —
 * without `openid` the values sit top-level on the token response; WITH
 * `openid` they move inside the id_token instead. Whether BORA's sandbox also
 * echoes them top-level alongside an id_token cannot be known statically (no
 * prior sandbox call exists to observe) — so this reader tolerates BOTH: it
 * never assumes a shape, it just reports what THIS token's payload contains.
 * The caller (auth-idp.js resolveThaidSession) is what applies the
 * id_token-first / top-level-fallback precedence.
 *
 * Same trust model as the rest of this module: the token arrived over the
 * backchannel token endpoint (TLS + our client credentials) so its origin is
 * trusted and this reads the payload WITHOUT verifying the JWS signature.
 * Never throws.
 *
 * @param {string} idToken compact JWS (header.payload.signature)
 * @returns {{sub:string|null,pid:string|null,given_name:string|null,family_name:string|null}|null}
 *   null when the token has no decodable payload at all; otherwise an object
 *   whose fields are each either the claim's string value or null (claim
 *   absent, or not a non-empty string).
 */
function decodeIdTokenClaims(idToken) {
    try {
        if (!idToken || typeof idToken !== 'string') {
            return null;
        }
        const parts = idToken.split('.');
        if (parts.length < 2) {
            return null;
        }
        const json = Buffer.from(parts[1], 'base64url').toString('utf8');
        const payload = JSON.parse(json);
        if (!payload || typeof payload !== 'object') {
            return null;
        }
        const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
        return {
            sub: str(payload.sub),
            pid: str(payload.pid),
            given_name: str(payload.given_name),
            family_name: str(payload.family_name),
        };
    } catch {
        return null;
    }
}

/**
 * Decode the opaque subject (`sub`) out of a ThaID id_token. Thin wrapper over
 * decodeIdTokenClaims, kept as its own export because resolveThaidLogin's
 * `subject` argument is documented (file header) as coming from exactly this
 * call. Never throws — returns the string `sub`, or null for anything
 * malformed.
 *
 * @param {string} idToken compact JWS (header.payload.signature)
 * @returns {string|null}
 */
function decodeIdTokenSubject(idToken) {
    const claims = decodeIdTokenClaims(idToken);
    return claims ? claims.sub : null;
}

/**
 * Domain-separated, non-reversible key for ONE ThaID subject (council ruling
 * R-D, Task 3). ThaID's `sub` is documented as the raw 13-digit national ID
 * (CID) — see the file-level doc comment above — so it must never be written
 * to identity_links.subject, an audit log, or anywhere else verbatim.
 *
 * computeLookupHmac('idp:thaid:' + sub) keys the HMAC input with a
 * provider-specific label BEFORE hashing. That label is the whole point:
 * without it, this would be byte-identical to computeLookupHmac(sub)
 * unlabelled — the exact value users.healthIdHmac / users.idCardHmac store
 * for the SAME national id — which would let anyone with read access join
 * identity_links to a user's other PII columns by CID. The identity_links
 * schema comment (prisma/schema/auth.prisma) forbids exactly that.
 *
 * Deterministic: the same sub always derives the same key, so the existing
 * `@@unique([provider, subject])` constraint on IdentityLink keeps working
 * unchanged — every read (findUnique) and write (upsert) below keys off
 * this SAME function, never the raw subject.
 *
 * Scope: ThaID subjects ONLY. provider='local' rows in identity_links store
 * users.id verbatim (a prior migration backfilled that shape — see the
 * model's own doc comment) and must never be passed through this function.
 *
 * @param {string} sub raw `sub` claim from the ThaID id_token
 * @returns {string|null} hex-encoded HMAC, or null for empty input
 */
function thaidSubjectKey(sub) {
    return computeLookupHmac(`idp:thaid:${sub}`);
}

/**
 * Guard: only a citizen (HEALTH) role may be auto-provisioned or auto-linked
 * from a ThaID sign-in. This is an ALLOW-list, not a deny-list: normalizeRole()
 * returns null for an unknown/foreign role string, so a deny-list on
 * isProviderRole() would FAIL OPEN and auto-link the stranger. Anything that
 * does not normalise to the citizen role (provider/privileged, system, unknown,
 * null) is refused so a ThaID login can never mint or attach to a non-citizen
 * account.
 *
 * @param {string} role user role (canonical or legacy spelling)
 * @throws {Error & { code: 'AUTH_AUTOPROVISION_ROLE_FORBIDDEN' }}
 */
function assertAutoProvisionableRole(role) {
    if (normalizeRole(role) !== CANONICAL_ROLES.HEALTH) {
        throw Object.assign(
            new Error(`role "${role}" is not an auto-provisionable citizen role — ThaID auto-provision/auto-link is forbidden`),
            { code: 'AUTH_AUTOPROVISION_ROLE_FORBIDDEN' },
        );
    }
}

/**
 * Create-or-touch the (provider='thaid', subject) → user link. The compound
 * unique key on IdentityLink is `provider_subject` (@@unique([provider, subject])).
 * Runs unscoped — identity_links is a global table.
 *
 * `subjectKey` MUST already be the output of thaidSubjectKey() — this
 * function never derives it and never sees the raw ThaID sub (R-D, Task 3).
 *
 * Council final-fix round, Item 2: this is now the ONLY place identity_links
 * is written for ThaID. The caller (auth-idp.js resolveThaidSession) invokes
 * it ONLY on the actual-mint branch — after its own 2FA gate has decided no
 * challenge is needed. resolveThaidLogin (identity RESOLUTION, below) never
 * calls this: a failed/pending-MFA attempt therefore leaves identity_links
 * untouched — no create, no lastLoginAt/isActive touch. Accepted trade-off
 * (council ruling): a 2FA-enrolled citizen's login re-resolves via the
 * national-ID re-match (step 3 below) on every attempt until a non-challenge
 * mint runs this — correct security over a minor repeated lookup.
 *
 * Item 4 (isActive kill-switch): the UPDATE clause no longer forces
 * `isActive: true`. An admin-deactivated link (isActive=false) must not be
 * silently resurrected by a later login — resolveThaidLogin's existing-link
 * read already refuses to resolve (and therefore never reaches this
 * function for) an inactive row, so in normal operation this only ever runs
 * against an active link; the update clause simply stops overwriting
 * whatever isActive value the row actually holds. isActive is set true ONLY
 * on create, where it is unambiguous (a brand-new link is active).
 */
function persistThaidLink(subjectKey, userId) {
    return withoutTenantScope(() => prisma.identityLink.upsert({
        where: { provider_subject: { provider: PROVIDER, subject: subjectKey } },
        update: { lastLoginAt: new Date() },
        create: { provider: PROVIDER, subject: subjectKey, userId, isActive: true },
    }));
}

/**
 * Resolve an authenticated ThaID profile to a local user. Council final-fix
 * round, Item 2: pure RESOLUTION — this function never writes identity_links
 * (the auto-provision branch still calls authService.register(), which
 * writes the USER row; that is unavoidable — you cannot know a fresh
 * account's 2FA status without creating it, and a brand-new account never
 * has 2FA enrolled). The identity_links write is the caller's job
 * (persistThaidLink, above), invoked only once the 2FA gate has cleared.
 *
 * Order (operator-mandated; step 2 role-gated per council ruling R-A Task 2):
 *   1. no subject → AUTH_IDP_PROFILE_INCOMPLETE.
 *   2. existing link → isActive guard (Item 4), then auto-provisionable-role
 *      guard, then return the linked user (no touch — see persistThaidLink).
 *      An existing link no longer exempts the row from the same citizen-only
 *      guard steps 3/4 enforce — a staff account that acquired a link (admin
 *      error, or a link predating this guard) must not become a 2FA-free
 *      ThaID door; see assertAutoProvisionableRole below.
 *   3. national-ID match → auto-provisionable-role guard, then return (no
 *      link write here either — the caller persists it after the 2FA gate).
 *   4. auto-provision (citizen only): fail-closed in production; needs a
 *      national ID; register a HEALTH applicant, guard, return.
 *
 * @param {{ subject:string, nationalId?:string, firstNameTh?:string, lastNameTh?:string }} p
 * @returns {Promise<{user:object, subjectKey:string}>} the resolved User row
 *   plus the derived key persistThaidLink needs — callers must not re-derive
 *   it themselves (R-D, Task 3: one derivation site).
 */
async function resolveThaidLogin({ subject, nationalId, firstNameTh, lastNameTh } = {}) {
    // 1 — subject is the identity; without it there is nothing to resolve.
    if (!subject) {
        throw Object.assign(
            new Error('ThaID id_token carries no opaque subject (sub) — cannot resolve identity'),
            { code: 'AUTH_IDP_PROFILE_INCOMPLETE' },
        );
    }

    // R-D Task 3: derive the domain-separated key ONCE — every identity_links
    // read/write below uses subjectKey, never the raw subject (which ThaID
    // documents as the raw 13-digit CID; see the file-level doc comment).
    const subjectKey = thaidSubjectKey(subject);

    // 2 — existing link. READ ONLY (Item 2) — no write happens on this path;
    // the caller persists the link only once its own 2FA gate clears.
    const existing = await withoutTenantScope(() => prisma.identityLink.findUnique({
        where: { provider_subject: { provider: PROVIDER, subject: subjectKey } },
        include: { user: true },
    }));
    if (existing && existing.user) {
        // Item 4: an admin-deactivated link must not be resolved for login —
        // reject before the role guard and before any write, so the row is
        // left exactly as it was (still inactive).
        if (existing.isActive === false) {
            throw Object.assign(
                new Error('ThaID identity link is deactivated — refusing to resolve identity'),
                { code: 'AUTH_LINKING_INACTIVE' },
            );
        }
        // R-A Task 2: role-gated (same guard as steps 3/4) — a privileged/
        // staff account must not sign in via ThaID even if a link already
        // exists.
        assertAutoProvisionableRole(existing.user.role);
        return { user: existing.user, subjectKey };
    }

    // 3 — match an already-registered user by national ID (deterministic HMAC).
    if (nationalId) {
        const hmac = computeLookupHmac(nationalId);
        const found = await withoutTenantScope(() => prisma.user.findFirst({
            where: { OR: [{ idCardHmac: hmac }, { healthIdHmac: hmac }] },
        }));
        if (found) {
            // Privileged/staff account must not be auto-linked by a ThaID login.
            assertAutoProvisionableRole(found.role);
            return { user: found, subjectKey };
        }
    }

    // 4 — auto-provision a fresh citizen account. Fail-closed in production.
    // Production is detected via the auth-config domain's single predicate
    // (isProduction), so this fail-closed guard reads the NODE_ENV
    // environment discriminator through the one SSOT source (Law 3.6).
    if (isProduction()) {
        throw Object.assign(
            new Error('ThaID auto-provision is disabled in production (fail-closed)'),
            { code: 'AUTH_AUTOPROVISION_DISABLED' },
        );
    }
    if (!nationalId) {
        throw Object.assign(
            new Error('ThaID profile has no national ID — cannot auto-provision a new account'),
            { code: 'AUTH_IDP_PROFILE_INCOMPLETE' },
        );
    }
    const user = await authService.register({
        healthId: nationalId,
        password: crypto.randomBytes(24).toString('hex'),
        firstName: firstNameTh || 'ผู้ใช้ ThaID',
        lastName: lastNameTh || '',
        accountType: 'INDIVIDUAL',
    });
    // Belt-and-suspenders: register() defaults to HEALTH from these inputs, but
    // re-assert so a future change to register cannot yield a privileged row here.
    assertAutoProvisionableRole(user.role);
    return { user, subjectKey };
}

module.exports = {
    resolveThaidLogin,
    persistThaidLink,
    decodeIdTokenSubject,
    decodeIdTokenClaims,
    assertAutoProvisionableRole,
    thaidSubjectKey,
};
