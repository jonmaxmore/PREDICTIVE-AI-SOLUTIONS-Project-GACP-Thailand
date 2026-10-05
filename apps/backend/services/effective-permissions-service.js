/**
 * effective-permissions-service — per-permission GRANT/REVOKE engine (Wave 2).
 *
 * The standard ERP additive-override model on top of the role baseline:
 *
 *   effective(user) = ROLE_PERMISSIONS[canonicalRole(user)]
 *                     ∪ { grants with effect = GRANT }
 *                     − { grants with effect = REVOKE }
 *
 * Grants live in the tiny `user_permission_grants` table and are read LIVE
 * per request — they are NOT baked into the JWT. A grant or revoke therefore
 * takes effect on the very NEXT request (no session-epoch bump needed, unlike
 * a role change). This is the whole point of the design: an admin toggling a
 * single permission must not force the user to re-authenticate.
 *
 * ENGINE ONLY. No admin route / UI here — those are a later, reviewed task.
 * The middleware `requireEffectivePermission` (role-middleware.js) is the
 * consumer; it caches the per-request result so several gates in one request
 * cost ONE grant read.
 *
 * Fail-SAFE philosophy: if the grant read throws (transient DB/table outage),
 * we log and fall back to the ROLE BASELINE ONLY. A grant-table outage must
 * NOT lock everyone out — the role baseline still governs. This means a
 * REVOKE fails OPEN (the user keeps a permission the revoke would have taken
 * away) during an outage; that is an accepted, documented trade-off: the
 * alternative (fail-closed) would take down every gated route the moment the
 * grants table hiccups, which is far worse for an operator platform. GRANTs
 * of course also fail closed-ish (the extra permission simply isn't added),
 * which is the safe direction. When the read succeeds the full model applies.
 */

'use strict';

const logger = require('../shared/logger');
const {
    PERMISSIONS,
    normalizeRole,
    hasPermission,
} = require('../shared/canonical-rbac');

/**
 * All permission string values, frozen. Single source: canonical-rbac's
 * PERMISSIONS map. Kept derived here (not re-exported from the hot rbac
 * file) so this engine owns the array shape without touching rbac.
 * @type {ReadonlyArray<string>}
 */
const PERMISSION_VALUES = Object.freeze([...Object.values(PERMISSIONS)]);

const PERMISSION_VALUE_SET = new Set(PERMISSION_VALUES);

/**
 * @param {*} p
 * @returns {boolean} true iff p is one of the canonical PERMISSIONS values.
 */
function isValidPermission(p) {
    return typeof p === 'string' && PERMISSION_VALUE_SET.has(p);
}

/**
 * The role baseline permission set for a (possibly legacy-aliased) role.
 * Derived from the REAL canonical-rbac contract via hasPermission, so it
 * stays in lock-step with ROLE_PERMISSIONS without needing that map
 * exported. Unknown role → [].
 *
 * Memoized per CANONICAL role: the baseline is static for the process
 * lifetime (ROLE_PERMISSIONS is frozen), and this function used to run on
 * every gated request — |PERMISSIONS| hasPermission calls each time. The
 * cached array is frozen and pre-sorted; callers copy before exposing it.
 * @param {string} role
 * @returns {ReadonlyArray<string>}
 */
const ROLE_BASELINE_CACHE = new Map();
const EMPTY_BASELINE = Object.freeze([]);
function rolePermissionArray(role) {
    const canonical = normalizeRole(role);
    if (!canonical) {
        return EMPTY_BASELINE;
    }
    let baseline = ROLE_BASELINE_CACHE.get(canonical);
    if (!baseline) {
        baseline = Object.freeze(
            PERMISSION_VALUES.filter((p) => hasPermission(canonical, p)).sort(),
        );
        ROLE_BASELINE_CACHE.set(canonical, baseline);
    }
    return baseline;
}

function getPrisma(injected) {
    if (injected) {
        return injected;
    }
    // Lazy require so a machine without DATABASE_URL doesn't process.exit(1)
    // merely by importing this module (unit tests inject their own prisma).
    return require('./prisma-database').prisma;
}

/**
 * Compute a user's effective permissions.
 *
 * @param {object}  args
 * @param {string}  args.role     - the user's role (canonical or legacy alias)
 * @param {string}  args.userId   - the user's id (grant lookup key)
 * @param {object} [args.prisma]  - injected Prisma client (defaults to the
 *                                  shared prisma-database client)
 * @returns {Promise<{
 *   rolePermissions: string[],
 *   grants: Array<{ permission: string, effect: string }>,
 *   effective: string[],
 *   effectiveSet: Set<string>,
 * }>} effectiveSet mirrors effective for O(1) membership tests — it is what
 *     the request-cached permission gates check against. JSON consumers keep
 *     using the sorted array (a Set serializes to {}).
 */
async function getEffectivePermissions({ role, userId, prisma } = {}) {
    // Pre-sorted, frozen, memoized per role — see rolePermissionArray.
    const rolePermissions = rolePermissionArray(role);

    // No userId → nothing to look up; effective is the role baseline.
    if (!userId) {
        return {
            rolePermissions: [...rolePermissions],
            grants: [],
            effective: [...rolePermissions],
            effectiveSet: new Set(rolePermissions),
        };
    }

    let grantRows = [];
    try {
        const db = getPrisma(prisma);
        grantRows = await db.userPermissionGrant.findMany({ where: { userId } });
    } catch (err) {
        // Fail-SAFE: a transient grant-table outage must not lock everyone
        // out — fall back to the role baseline. Log the cause first (never
        // swallow silently — golden rule #3).
        logger.error('effective-permissions: grant read failed; falling back to role baseline', {
            userId,
            role,
            error: err && err.message ? err.message : String(err),
        });
        return {
            rolePermissions: [...rolePermissions],
            grants: [],
            effective: [...rolePermissions],
            effectiveSet: new Set(rolePermissions),
        };
    }

    const grants = (grantRows || []).map((g) => ({ permission: g.permission, effect: g.effect }));

    // Build the effective set: role baseline ∪ GRANTs − REVOKEs.
    const effective = new Set(rolePermissions);
    for (const g of grants) {
        // Defensive: ignore a stored permission that is not a known canonical
        // permission (validation belongs to the future admin route; the
        // engine must tolerate drift by simply not honouring it).
        if (g.effect === 'GRANT' && isValidPermission(g.permission)) {
            effective.add(g.permission);
        }
    }
    // REVOKE applies last so it wins over a same-permission GRANT. A REVOKE of
    // a permission the role/grant does not confer is a harmless no-op. We do
    // NOT require the permission to be valid to honour a REVOKE — revoking an
    // unknown/stale permission is inert (it isn't in the set) but harmless.
    for (const g of grants) {
        if (g.effect === 'REVOKE') {
            effective.delete(g.permission);
        }
    }

    return {
        rolePermissions: [...rolePermissions],
        grants,
        effective: [...effective].sort(),
        // The membership structure the request-cached gates test against —
        // O(1) .has per gate instead of a linear scan per gate.
        effectiveSet: effective,
    };
}

/**
 * Convenience predicate.
 * @param {{role: string, userId: string, prisma?: object}} args
 * @param {string} permission
 * @returns {Promise<boolean>}
 */
async function userHasEffectivePermission(args, permission) {
    const { effectiveSet } = await getEffectivePermissions(args);
    return effectiveSet.has(permission);
}

module.exports = {
    PERMISSION_VALUES,
    isValidPermission,
    getEffectivePermissions,
    userHasEffectivePermission,
};
