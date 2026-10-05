const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { prisma } = require('./prisma-database');
const { withoutTenantScope } = require('./tenant-context');
const { computeLookupHmac } = require('../utils/field-encryption');
const { resolveCanonicalIdForWrite } = require('../shared/fk-token');
const {
    CANONICAL_ROLES,
    normalizeRole,
    isProviderRole,
} = require('../shared/canonical-rbac');
const { validatePasswordStrength } = require('../utils/password-policy');

// Every users.role spelling for an administrator, in BOTH the legacy casing and the
// canonical one, so this query is correct on either side of migration
// 20260801000000_canonicalize_user_role. An uppercase-only filter would
// match nothing post-migration and fail silently, as an empty result.
const ADMIN_ROLES = Object.freeze([CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]);

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

function createStatusError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function asString(value) {
    return String(value || '').trim();
}

function normalizeProviderId(value) {
    return asString(value).replace(/-/g, '');
}

// Legacy raw-SHA-256 lookup hash (always written to `providerIdHash`).
// MUST match prisma-auth-service.js _generateHashes + user-lookup-service
// computeIdentifierHash on the flag-OFF path.
function hashProviderId(providerId) {
    if (!providerId) {
        return null;
    }

    return crypto.createHash('sha256').update(providerId).digest('hex');
}

// H-4 Phase 1: keyed-HMAC lookup hash for the `providerIdHmac` column, dual-
// written on create when `AUTH_LOOKUP_USE_HMAC === 'true'`. Returns null when
// the flag is off so the create payload omits the column (unchanged behaviour).
function providerIdHmacForCreate(providerId) {
    if (!providerId || process.env.AUTH_LOOKUP_USE_HMAC !== 'true') {
        return null;
    }
    return computeLookupHmac(providerId);
}

async function createProviderUser({
    providerId,
    email,
    password,
    firstName,
    lastName,
    role,
    actorId = null,
}) {
    const normalizedProviderId = normalizeProviderId(providerId);
    const normalizedEmail = asString(email).toLowerCase();
    const normalizedPassword = asString(password);
    const normalizedFirstName = asString(firstName);
    const normalizedLastName = asString(lastName);
    const canonicalRole = normalizeRole(role);

    if (!normalizedProviderId || !/^\d{13}$/.test(normalizedProviderId)) {
        throw createStatusError(400, 'providerId must be a 13-digit number');
    }

    if (!normalizedEmail || !normalizedPassword || !normalizedFirstName || !normalizedLastName || !canonicalRole) {
        throw createStatusError(400, 'providerId, email, password, firstName, lastName, role are required');
    }

    // Strong-password policy (owner directive 2026-06-11). Provider accounts are
    // the most privileged on the platform (AUDITOR issues certs, PLATFORM_ADMIN
    // crosses tenants) — admin-minted credentials must meet the same bar as
    // self-service ones. Seeds create users directly via prisma, so they bypass
    // this path and are unaffected.
    const passwordCheck = validatePasswordStrength(normalizedPassword);
    if (!passwordCheck.valid) {
        throw createStatusError(400, passwordCheck.errors[0] || 'รหัสผ่านไม่ผ่านเกณฑ์ความปลอดภัย');
    }

    if (!isProviderRole(canonicalRole)) {
        throw createStatusError(400, `Invalid provider role: ${role}`);
    }
    // PLATFORM_ADMIN is the only cross-tenant role (a superset of every
    // permission). It must never be mintable through the tenant-ADMIN user
    // API — isProviderRole(PLATFORM_ADMIN) is true, so it would otherwise pass.
    // Provision platform operators out-of-band (seed/ops), not via this route.
    if (canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM) {
        throw createStatusError(403, 'PLATFORM_ADMIN cannot be assigned through the admin user API');
    }

    // PR 2e (contract phase): the column is canonical, so write canonical.
    if (!canonicalRole || canonicalRole === CANONICAL_ROLES.HEALTH) {
        throw createStatusError(400, `Invalid provider role: ${role}`);
    }

    // Global uniqueness: email + providerId (national ID) must be unique across ALL
    // orgs, so this duplicate check must NOT be tenant-scoped. withoutTenantScope keeps
    // it global even when TENANT_READ_ORG_SCOPE flips ON (User is a tenant-scoped model).
    const existing = await withoutTenantScope(() => prisma.user.findFirst({
        where: {
            OR: [
                { email: normalizedEmail },
                { providerId: normalizedProviderId },
            ],
            isDeleted: false,
        },
        select: { id: true, email: true, providerId: true },
    }));

    if (existing) {
        throw createStatusError(409, 'User already exists with same email or providerId');
    }

    const user = await prisma.user.create({
        data: {
            // Canonical ID — required FK target. Detokenize STAGE 0
            // (RFC docs/handoffs/national-id-detokenize-rfc-2026-06-29.md):
            // flag OFF (default) → the providerId national ID (byte-for-byte
            // today); flag ON (APP_FK_USE_TOKEN) → the keyed-HMAC token. No new
            // crypto — same computeLookupHmac the *Hmac dual-write uses.
            canonicalId: resolveCanonicalIdForWrite({
                actualIdentifier: normalizedProviderId,
                isProvider: true,
            }),
            email: normalizedEmail,
            password: await bcrypt.hash(normalizedPassword, BCRYPT_ROUNDS),
            firstName: normalizedFirstName,
            lastName: normalizedLastName,
            role: canonicalRole,
            accountType: 'PROVIDER',
            authType: 'PROVIDER_ID',
            status: 'ACTIVE',
            providerId: normalizedProviderId,
            providerIdHash: hashProviderId(normalizedProviderId),
            // H-4 Phase 1 dual-write: only included when AUTH_LOOKUP_USE_HMAC is
            // on (helper returns null otherwise, leaving the column at NULL —
            // identical to the pre-H-4 create payload).
            providerIdHmac: providerIdHmacForCreate(normalizedProviderId),
            healthId: null,
            updatedBy: actorId,
            createdBy: actorId,
        },
        select: {
            id: true,
            uuid: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            accountType: true,
            authType: true,
            status: true,
            providerId: true,
            healthId: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    return {
        user,
        canonicalRole,
    };
}

/**
 * Look up an active provider account by id, returning the columns the
 * scheduler audit-schedule POST handler needs (id + role + email + first/last
 * name). Status=ACTIVE + providerId set ensures we never assign a soft-banned
 * or unconfirmed auditor. Used by routes/api/provider/handlers/scheduler-audit-schedules-post-handler.js
 * (batch 10 Prisma-bypass cleanup).
 *
 * X3-FIX-D / SC-TEN-1 (2026-05-18) — `arg` is either the raw id (string)
 * OR an options object `{ id, organizationId }`. When organizationId is
 * provided the lookup is narrowed to the caller's tenant so a SCHEDULER
 * in tenant A cannot assign tenant B's auditor (defense-in-depth, mirrors
 * the audits-reassign.js:97-105 pattern). Backward compat preserved for
 * callers that pass a bare id.
 */
async function findActiveProviderById(arg) {
    const id = (arg && typeof arg === 'object') ? arg.id : arg;
    const organizationId = (arg && typeof arg === 'object') ? arg.organizationId : undefined;
    if (!id) {return null;}
    const where = {
        id,
        isDeleted: false,
        status: 'ACTIVE',
        accountType: 'PROVIDER',
        providerId: { not: null },
    };
    if (organizationId) {where.organizationId = organizationId;}
    return prisma.user.findFirst({
        where,
        select: {
            id: true,
            role: true,
            email: true,
            firstName: true,
            lastName: true,
        },
    });
}

/**
 * Look up an active provider account by id with the projection used by the
 * scheduler-assign-reviewer handler (includes providerId for displayed name).
 */
async function findActiveProviderReviewerById(id) {
    if (!id) {return null;}
    return prisma.user.findFirst({
        where: {
            id,
            isDeleted: false,
            status: 'ACTIVE',
            accountType: 'PROVIDER',
        },
        select: { id: true, providerId: true, firstName: true, lastName: true, role: true },
    });
}

/**
 * List candidate reviewer accounts (legacy + canonical role spellings) for
 * the scheduler reviewer dropdown. Sorted by name.
 *
 * F-REVIEWER-DROPDOWN-EMPTY (2026-08-18): this used to filter in SQL with
 * `role: { in: reviewerRoles } }` where reviewerRoles is canonical-lowercase
 * only. Prisma's `in` on Postgres is a case-sensitive string comparison, and
 * a real-DB walk found live rows still holding legacy spellings (e.g.
 * `REVIEWER_AUDITOR`) — migration 20260801000000 did not in fact collapse
 * every row, contrary to the comment that used to sit on this filter. A
 * canonical-only `in` clause against those rows matches nothing and the
 * dropdown renders empty with no error.
 *
 * Fix: read the whole ACTIVE PROVIDER roster (small staff table — no role
 * predicate in SQL) and match in JS via normalizeRole(), the SAME
 * ROLE_ALIASES SSOT (shared/canonical-rbac.js) the rest of the app uses to
 * interpret a role column. This is alias-map-derived, not a hand-written
 * legacy-spelling list, so it is correct for ANY casing without needing to
 * be updated the next time a new legacy spelling turns up. Mirrors the same
 * pattern already used by listActiveProviders() below. Read-only — the
 * legacy DB values themselves are an intentionally deferred follow-up.
 */
async function listReviewerCandidates(reviewerRoles) {
    const wantedCanonicalRoles = new Set(
        (reviewerRoles || []).map((role) => normalizeRole(role)).filter(Boolean),
    );
    const candidates = await prisma.user.findMany({
        where: {
            isDeleted: false,
            status: 'ACTIVE',
            accountType: 'PROVIDER',
        },
        select: {
            id: true,
            providerId: true,
            firstName: true,
            lastName: true,
            role: true,
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return candidates.filter((candidate) => wantedCanonicalRoles.has(normalizeRole(candidate.role)));
}

/**
 * List active provider accounts (those with providerId set and status=ACTIVE)
 * suitable for fan-out notifications. Returns only `{ id, role }` because the
 * caller (CAR review, auditor reassignment) only needs the routing identity —
 * pulling firstName/email here would leak provider PII into route handlers that
 * have no business with it. The role filter is applied by the caller via
 * normalizeRole(), since the canonical-role mapping table lives in shared/.
 */
async function listActiveProviders() {
    return prisma.user.findMany({
        where: {
            isDeleted: false,
            providerId: { not: null },
            status: 'ACTIVE',
        },
        select: {
            id: true,
            role: true,
        },
    });
}

// Canonical column projection for the provider directory listing.
// Keeping this here means the provider directory cannot accidentally
// include columns that are PDPA-encrypted or that we have not approved
// for peer-to-peer visibility (e.g. password digests, MFA secrets).
// `providerId` IS returned because the directory caller masks it with
// `maskThaiId` before serialising; never expose this projection raw to
// the route layer.
const PROVIDER_DIRECTORY_SELECT = Object.freeze({
    id: true,
    uuid: true,
    email: true,
    firstName: true,
    lastName: true,
    role: true,
    status: true,
    providerId: true,
    accountType: true,
    lastLoginAt: true,
    loginAttempts: true,
    isLocked: true,
    lockedUntil: true,
    twoFactorEnabled: true,
    createdAt: true,
});

/**
 * Replaces routes/api/provider/provider-directory-utils.js:110
 * prisma.user.findMany — full provider directory listing with the
 * canonical projection above. Soft-deleted users are filtered at the
 * service boundary; the caller does the `isProviderUser` shape check
 * + `mapProviderUser` PDPA masking pass.
 */
async function listAllUsersForProviderDirectory() {
    return prisma.user.findMany({
        where: { isDeleted: false },
        select: PROVIDER_DIRECTORY_SELECT,
        orderBy: { createdAt: 'desc' },
    });
}

/**
 * Replaces routes/api/provider/provider-directory-utils.js:139
 * prisma.user.findUnique — single-provider lookup with the canonical
 * projection above. Same caveats as the listing helper.
 */
async function findUserForProviderDirectory(providerId) {
    if (!providerId) {return null;}
    return prisma.user.findUnique({
        where: { id: providerId },
        select: PROVIDER_DIRECTORY_SELECT,
    });
}

/**
 * Replaces routes/api/provider/handlers/communication.js:37
 * prisma.user.findMany — admin broadcast recipient resolution. Caller
 * supplies the additional predicates (role / userType) on top of the
 * baseline `isDeleted: false` enforced here. Returns only id columns;
 * the caller fans the ids into `createBulkNotifications`.
 */
async function listUserIdsForBroadcast({ where = {}, take = 500 } = {}) {
    return prisma.user.findMany({
        where: { ...where, isDeleted: false },
        select: { id: true },
        take,
    });
}

/**
 * Replaces routes/api/provider/handlers/scheduler-auditors-handler.js:16
 * prisma.user.findMany — full auditor roster. Soft-deleted users are filtered
 * at the service boundary.
 *
 * users.role is canonical (migration 20260801000000): every legacy spelling
 * this filter used to list (AUDITOR / INSPECTOR / audit / …) is collapsed
 * into 'auditor', so the canonical value alone matches the whole roster.
 */
async function listAuditorsForScheduler() {
    // F-AUDITOR-DROPDOWN-EMPTY (2026-08-19): the sibling of
    // F-REVIEWER-DROPDOWN-EMPTY that the 2026-08-18 fix missed. This used to
    // narrow in SQL with `role: { in: [CANONICAL_ROLES.FIELD_INSPECTOR] } }` —
    // Prisma's `in` on Postgres is case-sensitive and the live seed auditor
    // rows still hold legacy `AUDITOR`, so the AssignAuditorModal dropdown
    // rendered empty (Phase 0 C11, evidence/phase0/s05/C11-auditor-options.txt).
    // Same shape as listReviewerCandidates() above: read the ACTIVE PROVIDER
    // roster without a SQL role predicate and match via normalizeRole(), the
    // ROLE_ALIASES SSOT — correct for any casing, and REVIEWER_AUDITOR
    // (→ document_reviewer) stays correctly excluded.
    const candidates = await prisma.user.findMany({
        where: {
            isDeleted: false,
            status: 'ACTIVE',
            accountType: 'PROVIDER',
            providerId: { not: null },
        },
        select: {
            id: true,
            providerId: true,
            firstName: true,
            lastName: true,
            role: true,
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return candidates.filter((candidate) => normalizeRole(candidate.role) === CANONICAL_ROLES.FIELD_INSPECTOR);
}

/**
 * Replaces routes/api/auth/auth-provider.js prisma.user.findFirst
 * — provider-login deterministic lookup (the plaintext `providerId` column is
 * being dropped — Sprint 6 healthId-audit Phase B-M5 / PDPA Phase D-H4-H5).
 * Returns the full user row so the caller can run all the post-lookup guards
 * (role, accountType, status, password compare, MFA branch).
 *
 * H-4 Phase 1: the caller computes the lookup value with the SAME
 * `AUTH_LOOKUP_USE_HMAC` switch this function uses to pick the column —
 * `providerIdHash` (legacy raw SHA-256) when OFF, `providerIdHmac` (keyed HMAC)
 * when ON. Reader and the route-side hash computation stay in lockstep.
 */
async function findProviderForLoginByHash(providerIdLookup) {
    if (!providerIdLookup) {return null;}
    const col = process.env.AUTH_LOOKUP_USE_HMAC === 'true' ? 'providerIdHmac' : 'providerIdHash';
    return prisma.user.findFirst({
        where: {
            [col]: providerIdLookup,
            isDeleted: false,
        },
    });
}

/**
 * Replaces routes/api/auth/auth-provider.js:192 prisma.user.update
 * — bumps `lastLoginAt` after a successful provider login AND clears any
 * accumulated failed-attempt / lockout state (a successful sign-in resets the
 * brute-force counter, mirroring the HEALTH path). Status is unchanged so this
 * stays off the canonical writer.
 */
async function touchProviderLastLogin(userId, when = new Date()) {
    return prisma.user.update({
        where: { id: userId },
        data: { lastLoginAt: when, loginAttempts: 0, isLocked: false, lockedUntil: null },
    });
}

// Per-account brute-force lockout for provider login (H-3, audit 2026-06-11).
// Mirrors the HEALTH lockout in prisma-auth-service.login(): N failed attempts
// locks the account for a fixed window. The privileged provider accounts
// (AUDITOR issues certs, PLATFORM_ADMIN crosses tenants) previously had ONLY a
// coarse per-IP limiter, which an attacker defeats by rotating IPs.
const PROVIDER_MAX_LOGIN_ATTEMPTS = 5;
const PROVIDER_LOCKOUT_MINUTES = 15;

/**
 * Record a failed provider-login attempt. Increments loginAttempts and locks
 * the account for PROVIDER_LOCKOUT_MINUTES once it reaches the threshold.
 * @param {{ id: string, loginAttempts?: number }} user — the looked-up row
 * @returns {Promise<{ attempts: number, locked: boolean, lockedUntil: Date|null }>}
 */
async function registerFailedProviderLogin(user) {
    const attempts = (user.loginAttempts || 0) + 1;
    const locked = attempts >= PROVIDER_MAX_LOGIN_ATTEMPTS;
    const lockedUntil = locked ? new Date(Date.now() + PROVIDER_LOCKOUT_MINUTES * 60 * 1000) : null;
    await prisma.user.update({
        where: { id: user.id },
        data: locked
            ? { loginAttempts: attempts, isLocked: true, lockedUntil }
            : { loginAttempts: attempts },
    });
    return { attempts, locked, lockedUntil };
}

/**
 * Clear a provider's lockout state — used to auto-unlock once the lock window
 * has expired (so the next attempt starts from a clean counter).
 */
async function resetProviderLoginLock(userId) {
    return prisma.user.update({
        where: { id: userId },
        data: { loginAttempts: 0, isLocked: false, lockedUntil: null },
    });
}

/**
 * Replaces routes/api/auth/auth-provider.js:285 prisma.user.findUnique
 * — /auth/provider/me lookup. Caller treats `null` as "user not found".
 */
async function findProviderUserById(userId) {
    if (!userId) {return null;}
    return prisma.user.findUnique({ where: { id: userId } });
}

/**
 * Replaces routes/api/provider/handlers/scheduler-audit-schedules-get-handler.js:70
 * prisma.user.findMany — auditor lookup for the scheduler queue, keyed
 * by an explicit auditor-id list.
 */
async function listAuditorsByIdsForScheduler(auditorIds) {
    if (!Array.isArray(auditorIds) || auditorIds.length === 0) {return [];}
    return prisma.user.findMany({
        where: { id: { in: auditorIds } },
        select: { id: true, firstName: true, lastName: true },
    });
}

// Canonical column projection for the admin Users console. Keeping the select
// here means /api/admin/users cannot accidentally include columns that are
// PDPA-encrypted or that we have not approved for admin visibility (e.g. raw
// healthIdHash, password digests, MFA secrets). Update this list deliberately.
const ADMIN_USER_SELECT = Object.freeze({
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    role: true,
    accountType: true,
    authType: true,
    status: true,
    providerId: true,
    healthId: true,
    // P0-B: lifecycle columns the /admin/users console renders (mapUser
    // derives isActive/isLocked/username/lastLoginAt from these — without
    // them every row showed "ถูกระงับ" and disable always called enable).
    // Same source columns PROVIDER_DIRECTORY_SELECT already exposes.
    lastLoginAt: true,
    isLocked: true,
    lockedUntil: true,
    createdAt: true,
    updatedAt: true,
});

// Extra columns the role/disable mutations need to enforce server-side rules
// (e.g. "provider role requires providerId" identity conflicts). Kept narrower
// than the public projection to avoid pulling unnecessary fields into memory.
const ADMIN_USER_GUARD_SELECT = Object.freeze({
    id: true,
    role: true,
    status: true,
    accountType: true,
    authType: true,
    providerId: true,
    healthId: true,
    // S2(c): assertNotLastActiveAdmin falls back to `existing.organizationId`
    // when the caller passes no org — without this column that fallback was
    // ALWAYS undefined for admin-surface callers (last-admin count went
    // global instead of counting the target's org).
    organizationId: true,
});

/**
 * Paginated user search for the admin console. The `where` predicate is built
 * by the caller (it depends on canonical-role mapping which lives in the
 * shared module). Soft-deleted users are still filtered out at the service
 * boundary so a route bug cannot expose them.
 */
async function searchAdminUsers({ where = {}, skip = 0, take = 20 } = {}) {
    const safeWhere = { ...where, isDeleted: false };
    const [rows, total] = await Promise.all([
        prisma.user.findMany({
            where: safeWhere,
            select: ADMIN_USER_SELECT,
            orderBy: { createdAt: 'desc' },
            skip,
            take,
        }),
        prisma.user.count({ where: safeWhere }),
    ]);
    return { rows, total };
}

/**
 * Fetch the guard projection for an active (non-soft-deleted) user.
 * Returns null when the user is missing — the route caller decides whether
 * that is a 404 (admin role/disable mutations) or some other code path.
 */
async function getActiveAdminUserGuard(userId, { organizationId } = {}) {
    if (!userId) {return null;}
    // Optional tenant scope: when the caller passes its organizationId, a
    // cross-tenant target id resolves to null so the route 404s before any
    // mutation (the prisma extension does NOT auto-scope findFirst-by-id).
    // Omitting it preserves the prior unscoped behaviour for other callers.
    return prisma.user.findFirst({
        where: { id: userId, isDeleted: false, ...(organizationId ? { organizationId } : {}) },
        select: ADMIN_USER_GUARD_SELECT,
    });
}

/**
 * P0-D last-admin guard support: count the org's OTHER active tenant admins
 * (excluding the mutation target). Legacy DB role values for canonical admin
 * are ADMIN + SUPER_ADMIN (see canonical-rbac ADMIN_AUDIT_OVERRIDE). Used by
 * admin-user-service.assertNotLastActiveAdmin so a tenant can never demote or
 * disable its final ADMIN and lock itself out of permission control.
 */
async function countOtherActiveAdmins({ organizationId, excludeUserId } = {}) {
    // S6: this count carries its OWN explicit org filter — it counts in the
    // TARGET's org, which differs from the caller's request context on
    // cross-tenant PLATFORM_ADMIN edits. Under TENANT_READ_ORG_SCOPE (ON on
    // staging+prod) the tenant-prisma-extension spreads the CALLER-ctx
    // organizationId over every user.count WHERE, clobbering the target-org
    // count — so run outside the extension's scope.
    return withoutTenantScope(() => prisma.user.count({
        where: {
            role: { in: [...ADMIN_ROLES] },
            status: 'ACTIVE',
            isDeleted: false,
            ...(organizationId ? { organizationId } : {}),
            ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        },
    }));
}

/**
 * Apply an admin mutation to a user row and return the standard admin
 * projection. The data shape is validated by the caller (admin route), this
 * function only enforces "return exactly the columns we want admins to see".
 */
async function updateAdminUser(userId, data) {
    return prisma.user.update({
        where: { id: userId },
        data,
        select: ADMIN_USER_SELECT,
    });
}

/**
 * Tenant-scoped lookup of a reassignment-target user. Used by
 * routes/api/audit/audits-reassign.js. Caller passes the organizationId
 * resolved from the request; the service applies the canonical
 * isDeleted + ACTIVE + providerId filters so the route cannot regress
 * to a broader lookup (Batch 11). Thai PDPA Act B.E. 2562 s.32 — only
 * data subjects whose role authorises them to receive audit assignments
 * should appear in this list; the route layer applies the role check
 * after we have narrowed the row set.
 */
async function findReassignmentTargetUser({ id, organizationId } = {}) {
    if (!id) {return null;}
    const where = organizationId ? { id, organizationId } : { id };
    return prisma.user.findFirst({
        where,
        select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
            providerId: true,
            status: true,
            isDeleted: true,
        },
    });
}

/**
 * List ACTIVE provider auditors (legacy + canonical role names) for the
 * scheduler workload screen. Returns id + firstName/lastName/role only —
 * the screen renders a name + utilization bar, not full PII.
 *
 * Replaces prisma.user.findMany at routes/api/provider/scheduler.js:154.
 */
async function listActiveAuditors(auditorRoles) {
    return prisma.user.findMany({
        where: {
            role: { in: auditorRoles },
            accountType: 'PROVIDER',
            status: 'ACTIVE',
            isDeleted: false,
        },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
        },
    });
}

module.exports = {
    createProviderUser,
    listActiveProviders,
    findActiveProviderById,
    findActiveProviderReviewerById,
    listReviewerCandidates,
    searchAdminUsers,
    getActiveAdminUserGuard,
    updateAdminUser,
    countOtherActiveAdmins,
    findReassignmentTargetUser,
    listActiveAuditors,
    listAllUsersForProviderDirectory,
    findUserForProviderDirectory,
    listUserIdsForBroadcast,
    listAuditorsForScheduler,
    listAuditorsByIdsForScheduler,
    findProviderForLoginByHash,
    touchProviderLastLogin,
    registerFailedProviderLogin,
    resetProviderLoginLock,
    PROVIDER_MAX_LOGIN_ATTEMPTS,
    PROVIDER_LOCKOUT_MINUTES,
    findProviderUserById,
};
