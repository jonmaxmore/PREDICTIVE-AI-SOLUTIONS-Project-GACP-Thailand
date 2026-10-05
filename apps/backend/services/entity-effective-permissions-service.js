/**
 * entity-effective-permissions-service — per-member farm-operation
 * GRANT/REVOKE engine (Farm-worker Wave B).
 *
 * Mirrors the Wave-2 provider-side engine (effective-permissions-service.js)
 * on the entity/workspace dimension. A workspace member's authority is:
 *
 *   effective(member) = DEFAULT_PERMISSIONS_BY_ROLE[membership.role]
 *                       ∪ legacy membership.permissions[]      (GRANT-only array)
 *                       ∪ { grants with effect = GRANT }
 *                       − { grants with effect = REVOKE }
 *
 * REVOKE wins over EVERYTHING — including the legacy permissions[] array,
 * which pre-Wave-B could only widen (the survey's "GRANT-only union" gap).
 * That is the whole point of this engine: the OWNER can now take a single
 * action away from a single member ("ลงแปลงปลูกได้ แต่บันทึกเก็บเกี่ยวไม่ได้").
 *
 * Grants live in the tiny `entity_member_permission_grants` table and are
 * read LIVE per request — NOT baked into any token — so an OWNER's change
 * takes effect on the member's very next request. Pass a per-request `cache`
 * (Map) to make several gates in one request cost ONE grant read.
 *
 * Fail-SAFE philosophy (same trade-off as the Wave-2 engine, documented
 * there): if the GRANT read throws (transient outage), fall back to the
 * role∪legacy baseline — i.e. exactly the pre-Wave-B authority — and log.
 * A grants-table hiccup must not lock every farm worker out. A REVOKE
 * therefore fails OPEN during an outage (accepted trade-off); a GRANT fails
 * closed-ish (the extra permission simply isn't added).
 *
 * MEMBERSHIP reads are different: `assertFarmActionPermission` guards
 * MUTATIONS, so a failed membership lookup denies (fail CLOSED) — the same
 * direction services/farm-access.js takes on its lookup failures.
 */

'use strict';

const { createLogger } = require('../shared/logger');
// S7 — EntityMemberPermissionGrant is in TENANT_SCOPED_MODELS: under
// TENANT_READ_ORG_SCOPE=true the tenant extension injects the CALLER's
// organizationId into findMany, but a cross-org member's grant rows carry
// the ENTITY's org → the read came back empty and a REVOKE silently
// dropped (fail-open). Grant rows belong to the ENTITY dimension, so the
// engine reads them without the org scope.
const { withoutTenantScope } = require('./tenant-context');
const { ENTITY_PERMISSION_DENIED_EN } = require('../shared/entity-permission-denied');
const {
    CAPABILITIES,
    FARM_OPERATION_CAPABILITIES,
    DEFAULT_PERMISSIONS_BY_ROLE,
} = require('./entity-service');

const logger = createLogger('entity-effective-permissions');

/** Every capability string value (workspace-management + farm-operation). */
const CAPABILITY_VALUES = Object.freeze([...Object.values(CAPABILITIES)]);
const CAPABILITY_VALUE_SET = new Set(CAPABILITY_VALUES);
const FARM_OPERATION_SET = new Set(FARM_OPERATION_CAPABILITIES);

/**
 * @param {*} p
 * @returns {boolean} true iff p is one of the CAPABILITIES values.
 */
function isValidEntityPermission(p) {
    return typeof p === 'string' && CAPABILITY_VALUE_SET.has(p);
}

/**
 * The grantable taxonomy for the OWNER permission admin API (chunk 5):
 * farm-operation codes only — workspace-management codes (INVITE_MEMBER,
 * TRANSFER_OWNERSHIP, …) stay role-bound in v1.
 * @param {*} p
 * @returns {boolean}
 */
function isGrantableFarmOperation(p) {
    return typeof p === 'string' && FARM_OPERATION_SET.has(p);
}

function getPrisma(injected) {
    if (injected) {
        return injected;
    }
    // Lazy require so a machine without DATABASE_URL doesn't process.exit(1)
    // merely by importing this module (unit tests inject their own prisma).
    return require('./prisma-database').prisma;
}

function baselineFor(role, legacyPermissions) {
    const rolePermissions = [...(DEFAULT_PERMISSIONS_BY_ROLE[role] || [])];
    const legacy = Array.isArray(legacyPermissions)
        ? legacyPermissions.filter(isValidEntityPermission)
        : [];
    return { rolePermissions, legacy };
}

/**
 * Resolve the membership row the grants hang off. Three shapes:
 *   - caller supplies membershipId + role + basePermissions → trusted as-is
 *     (no membership read; caller already validated ACTIVE)
 *   - membershipId              → findUnique by PK
 *   - userId + entityId         → findUnique by the (userId, entityId) unique
 */
async function resolveMembership({ membershipId, userId, entityId, role, basePermissions, db }) {
    if (membershipId && role !== undefined && basePermissions !== undefined) {
        return {
            id: membershipId,
            role,
            permissions: basePermissions,
            status: 'ACTIVE',
        };
    }
    const select = { id: true, role: true, permissions: true, status: true };
    if (membershipId) {
        return db.entityMembership.findUnique({ where: { id: membershipId }, select });
    }
    if (userId && entityId) {
        return db.entityMembership.findUnique({
            where: { userId_entityId: { userId, entityId } },
            select,
        });
    }
    return null;
}

/**
 * Compute a workspace member's effective farm-operation permissions.
 *
 * @param {object}  args
 * @param {string} [args.membershipId]     — EntityMembership.id (grant lookup key)
 * @param {string} [args.userId]           — with entityId, alternative membership key
 * @param {string} [args.entityId]
 * @param {string} [args.role]             — pass with basePermissions to skip the membership read
 * @param {string[]} [args.basePermissions]— legacy membership.permissions[] (with role)
 * @param {object} [args.prisma]           — injected Prisma client
 * @param {Map}    [args.cache]            — per-request memo keyed by membershipId
 * @returns {Promise<{
 *   membershipId: string|null,
 *   role: string|null,
 *   rolePermissions: string[],
 *   legacyPermissions: string[],
 *   grants: Array<{ permission: string, effect: string }>,
 *   effective: string[],
 * }>}
 */
async function getEffectiveEntityPermissions({
    membershipId, userId, entityId, role, basePermissions, prisma, cache,
} = {}) {
    const db = getPrisma(prisma);

    let membership = null;
    try {
        membership = await resolveMembership({
            membershipId, userId, entityId, role, basePermissions, db,
        });
    } catch (err) {
        // Membership resolution failure — we cannot even establish the role
        // baseline, so there is nothing safe to fall back to. Fail CLOSED.
        logger.warn('[entity-effective-permissions] membership lookup failed — returning empty set (fail closed)', {
            membershipId, userId, entityId, error: err?.message,
        });
        return emptyResult(membershipId || null);
    }

    // No membership, or a non-ACTIVE one (PENDING invite / REVOKED worker):
    // no authority at all. Reachability layers normally stop these earlier;
    // the engine stays safe on its own.
    if (!membership || (membership.status && membership.status !== 'ACTIVE')) {
        return emptyResult(membership?.id || membershipId || null);
    }

    const memId = membership.id;
    if (cache instanceof Map && cache.has(memId)) {
        return cache.get(memId);
    }

    const { rolePermissions, legacy } = baselineFor(membership.role, membership.permissions);

    let grantRows = [];
    let grantReadFailed = false;
    try {
        // S7 — bypass the tenant read scope: the grants are keyed by the
        // MEMBERSHIP (an entity-dimension key) and a REVOKE must be found
        // no matter which org the caller's request context is bound to.
        grantRows = await withoutTenantScope(() => db.entityMemberPermissionGrant.findMany({
            where: { membershipId: memId },
        }));
    } catch (err) {
        // Fail-SAFE: a grants-table outage must not lock the workers out —
        // fall back to the pre-Wave-B baseline (role ∪ legacy array). Log
        // the cause first (never swallow silently — golden rule #3).
        grantReadFailed = true;
        logger.warn('[entity-effective-permissions] grant read failed; falling back to role+legacy baseline', {
            membershipId: memId,
            role: membership.role,
            error: err?.message ? err.message : String(err),
        });
    }

    const grants = grantReadFailed
        ? []
        : (grantRows || []).map((g) => ({ permission: g.permission, effect: g.effect }));

    const effective = new Set([...rolePermissions, ...legacy]);
    for (const g of grants) {
        // Defensive: ignore a stored permission that is not a known
        // capability (the admin route validates; the engine tolerates drift
        // by simply not honouring it).
        if (g.effect === 'GRANT' && isValidEntityPermission(g.permission)) {
            effective.add(g.permission);
        }
    }
    // REVOKE applies last so it wins over role defaults, the legacy array
    // AND a same-permission GRANT. Revoking something the member never had
    // is a harmless no-op.
    for (const g of grants) {
        if (g.effect === 'REVOKE') {
            effective.delete(g.permission);
        }
    }

    const result = {
        membershipId: memId,
        role: membership.role || null,
        rolePermissions: [...rolePermissions].sort(),
        legacyPermissions: [...legacy].sort(),
        grants,
        effective: [...effective].sort(),
    };
    if (cache instanceof Map) {
        cache.set(memId, result);
    }
    return result;
}

function emptyResult(membershipId) {
    return {
        membershipId,
        role: null,
        rolePermissions: [],
        legacyPermissions: [],
        grants: [],
        effective: [],
    };
}

/**
 * Convenience predicate.
 * @param {object} args — same shape as getEffectiveEntityPermissions
 * @param {string} permission
 * @returns {Promise<boolean>}
 */
async function entityMemberHasPermission(args, permission) {
    const { effective } = await getEffectiveEntityPermissions(args);
    return effective.includes(permission);
}

/**
 * Build the canonical denial error. `statusCode` is set AT THE THROW SITE
 * (the project rules: errors with only `.code` map to 500 via sendServiceError).
 */
function buildDeniedError(permission) {
    // The permission travels on err.permission; the text is the catalogue's.
    const err = new Error(ENTITY_PERMISSION_DENIED_EN);
    err.code = 'ENTITY_PERMISSION_DENIED';
    err.statusCode = 403;
    err.httpStatus = 403;
    err.permission = permission;
    return err;
}

/**
 * THE chunk-4 gate primitive — "may this user perform <permission> on this
 * farm?". Encodes the binding rules:
 *
 *   (a) SOLO / legacy farm (entityId == null): the owner (farm.ownerId ===
 *       userId) passes with NO membership read — byte-identical to
 *       pre-Wave-B. There is no per-permission dimension on a solo farm.
 *   (b) personal-entity farms materialise as either a solo `entityId == null`
 *       farm (rule a) or a workspace farm on the caller's own personal entity,
 *       where the caller holds the entity's OWNER membership and therefore
 *       passes rule (c) via the OWNER role default.
 *   (c) WORKSPACE farm (entityId != null): the caller's EFFECTIVE permission
 *       set decides — for EVERYONE, including the farm's CREATOR. F3 fix
 *       (2026-07-06): authorship (farm.ownerId === caller) NO LONGER grants a
 *       fast-path here. Previously a creator with ANY ACTIVE membership
 *       short-circuited to LEGACY_OWNER before the effective set was read, so
 *       a per-member REVOKE never bound on farms a worker created — authorship
 *       standing in for authorization, against the "REVOKE wins over
 *       EVERYTHING" invariant. Now: entity OWNER passes (role default = all
 *       farm ops), a MANAGER/VIEWER creator is subject to their effective set
 *       (a REVOKE binds; a permission outside their role default is denied
 *       until GRANTed), and a fired/REVOKED creator gets an empty effective
 *       set → DENIED (M1 fired-worker protection preserved through this path).
 *
 * Deny = throw ENTITY_PERMISSION_DENIED (statusCode 403, permission named).
 * Membership/farm lookup failures on this MUTATION path deny (fail closed),
 * mirroring services/farm-access.js.
 *
 * @param {object} args
 * @param {{ ownerId?: string, entityId?: string|null }} [args.farm] — projected row
 * @param {string} [args.farmId] — alternative: the farm is loaded here
 * @param {string} args.userId
 * @param {string} args.permission — one of CAPABILITIES
 * @param {object} [args.prisma]
 * @param {Map}    [args.cache] — per-request effective-permission memo
 * @param {object} [args.holderScope] — a health door's holder scope (the farm is read within it)
 * @returns {Promise<{ allowed: true, via: 'LEGACY_OWNER'|'ENTITY_PERMISSION' }>}
 */
async function assertFarmActionPermission({ farm, farmId, userId, permission, prisma, cache, holderScope = null } = {}) {
    const uid = String(userId || '').trim();
    if (!uid || !permission) {
        throw buildDeniedError(permission || 'UNKNOWN');
    }

    const db = getPrisma(prisma);

    let farmRow = farm || null;
    if (!farmRow && farmId) {
        try {
            farmRow = await db.farm.findUnique({
                where: {
                    id: String(farmId),
                    // A health door passes its holder scope: a farm outside it is not
                    // found, which denies below. Other callers read by id.
                    ...require('./holder-access').holderReadWhereIfScoped(holderScope, 'Farm'),
                },
                select: { ownerId: true, entityId: true },
            });
        } catch (err) {
            logger.warn('[entity-effective-permissions] farm lookup failed — denying (fail closed)', {
                farmId, permission, error: err?.message,
            });
            throw buildDeniedError(permission);
        }
    }
    if (!farmRow) {
        throw buildDeniedError(permission);
    }

    const isOwner = farmRow.ownerId === uid;

    // (a) solo/legacy farm (no workspace dimension): the owner passes with
    // no membership read — byte-identical to pre-Wave-B.
    if (isOwner && !farmRow.entityId) {
        return { allowed: true, via: 'LEGACY_OWNER' };
    }

    // Non-owner on a farm with no workspace dimension could not have passed
    // farm-access reachability; deny defensively (fail closed).
    if (!farmRow.entityId) {
        throw buildDeniedError(permission);
    }

    // (c) workspace farm (entityId != null): the EFFECTIVE permission set
    // decides for EVERYONE — no authorship fast-path. F3 fix (2026-07-06):
    // the previous LEGACY_OWNER short-circuit anointed the farm CREATOR
    // (farm.ownerId === caller, ANY ACTIVE role) before the effective set was
    // consulted, so a per-member REVOKE never bound on farms a worker created
    // while employed. That used who-created-the-row (authorship) as an
    // authorization grant, contradicting the engine's "REVOKE wins over
    // EVERYTHING" invariant and the OWNER matrix that shows the REVOKE as
    // effective. Letting the effective set govern keeps every actor correct:
    //   - entity OWNER  → passes (OWNER role default = every farm-op code);
    //     an OWNER's grants are self-guarded from self-REVOKE at the admin API.
    //   - MANAGER/VIEWER creator → subject to their effective set: a REVOKE now
    //     BINDS, and a permission not in their role default (e.g. MANAGER +
    //     EDIT_FARM) is denied until the OWNER explicitly GRANTs it.
    //   - fired/REVOKED creator → getEffectiveEntityPermissions returns an
    //     empty set for a non-ACTIVE membership, so they stay DENIED (the M1
    //     fired-worker protection is preserved through the effective path).
    // Solo/legacy farms (entityId == null) keep their LEGACY_OWNER fast-path
    // above (rule (a)) — byte-identical, no per-permission dimension there.
    let effective;
    try {
        ({ effective } = await getEffectiveEntityPermissions({
            userId: uid,
            entityId: farmRow.entityId,
            prisma: db,
            cache,
        }));
    } catch (err) {
        // getEffectiveEntityPermissions never throws by contract, but keep
        // the mutation gate fail-closed regardless.
        logger.warn('[entity-effective-permissions] effective computation failed — denying (fail closed)', {
            permission, error: err?.message,
        });
        throw buildDeniedError(permission);
    }

    if (!effective.includes(permission)) {
        throw buildDeniedError(permission);
    }
    return { allowed: true, via: 'ENTITY_PERMISSION' };
}

/**
 * Entity gate with NO farm row yet (e.g. POST /farms creating a farm under the
 * holder the body names): the caller's ACTIVE membership on `entityId` must
 * hold `permission`. Same denial contract as assertFarmActionPermission. Every
 * holder is checked, the caller's personal entity included (spec 2026-09-30
 * §3.2, R2 Task 10).
 *
 * @param {object} args
 * @param {string} args.entityId
 * @param {string} args.userId
 * @param {string} args.permission
 * @param {object} [args.prisma]
 * @param {Map}    [args.cache]
 * @returns {Promise<{ allowed: true, via: 'ENTITY_PERMISSION' }>}
 */
async function assertEntityActionPermission({ entityId, userId, permission, prisma, cache } = {}) {
    const uid = String(userId || '').trim();
    const eid = String(entityId || '').trim();
    if (!uid || !eid || !permission) {
        throw buildDeniedError(permission || 'UNKNOWN');
    }

    let effective;
    try {
        ({ effective } = await getEffectiveEntityPermissions({
            userId: uid, entityId: eid, prisma, cache,
        }));
    } catch (err) {
        logger.warn('[entity-effective-permissions] entity-action effective computation failed — denying (fail closed)', {
            entityId: eid, permission, error: err?.message,
        });
        throw buildDeniedError(permission);
    }

    if (!effective.includes(permission)) {
        throw buildDeniedError(permission);
    }
    return { allowed: true, via: 'ENTITY_PERMISSION' };
}

module.exports = {
    CAPABILITY_VALUES,
    isValidEntityPermission,
    isGrantableFarmOperation,
    getEffectiveEntityPermissions,
    entityMemberHasPermission,
    assertFarmActionPermission,
    assertEntityActionPermission,
};
