/**
 * Farm access predicate — Farm-worker Wave A, Chunk 3 (2026-07-02).
 *
 * THE single home for "may this HEALTH user act on this farm?". Every
 * cultivation guard used to pin `farm.ownerId === req.user.id` (directly or
 * via the chain Plot/Cycle/Unit/Batch → farm). Wave A widens that one
 * predicate to the holder-entity dimension; Wave B fix M1 (2026-07-03) closes
 * the fired-worker hole in the owner fast-path:
 *
 *     access = (farm.ownerId === userId AND farm.entityId == null)   (solo/legacy)
 *           OR (farm.ownerId === userId
 *               AND EntityMembership(userId, farm.entityId).status === 'ACTIVE')
 *                                                     (creator, still employed)
 *           OR (farm.entityId != null
 *               AND EntityMembership(userId, farm.entityId).status === 'ACTIVE')
 *                                                     (holder co-member)
 *
 * Wave B fix M1 — the LEGACY_OWNER fast-path must not anoint the farm
 * CREATOR forever: farms created under a holder entity stamp ownerId = the
 * creating WORKER, and revokeMember only flips membership status. So when
 * `farm.entityId != null` the ownerId fast-path ALSO requires an ACTIVE
 * membership on that entity (ANY role — the creator keeps full owner
 * authority while employed, VIEWER included); a REVOKED/PENDING/missing
 * membership falls through to the membership path, which denies. Farms with
 * `entityId == null` (solo legacy farms) stay byte-identical.
 *
 * Three shapes, one predicate:
 *   - resolveFarmAccess(farm, userId)   → boolean, for row compares
 *   - farmAccessWhere(userId)           → Prisma where-fragment, for query guards
 *     (built by the pure buildFarmAccessWhere(userId, anyRoleIds, branchIds),
 *     which holder-access reuses; both carry the HOLDER_SCOPED marker)
 *   - listAccessibleFarmIds(userId)     → id set, for `.includes(farmId)` guards
 *
 * Compat invariants (plan risk #2 — never lock out the existing solo farmer):
 *   - farm.entityId = null → owner-only, exactly today's behaviour
 *   - membership lookup failure → solo owner rows stay reachable; the
 *     holder-entity dimension DENIES (fail closed — an unverifiable membership
 *     must not re-open the fired-worker hole); NEVER throw out of these
 *     helpers
 *
 * Capability gating (which member may do WHICH action) is the Wave-B
 * per-permission engine — this module answers reachability only. Do NOT use
 * it on provider/admin routes; those have their own RBAC.
 *
 * Wave A fix S2 (adversarial-verify 2026-07-02) — interim VIEWER floor:
 * every helper accepts `{ forMutation: true }` and the entity-MEMBERSHIP
 * branch then EXCLUDES role VIEWER (read-only by definition —
 * entity.prisma:135). The owner disjuncts are unaffected (any ACTIVE role).
 * Wave B fix M2: surfaces where the per-permission engine runs pass
 * read-shaped lookups instead (the engine subsumes the floor and makes
 * GRANT-to-VIEWER effective); the floor stays only on engine-less surfaces.
 *
 * Wave A fix M1 — `resolveFarmOwnerAccess` is the DELETE-grade predicate:
 * legacy owner OR ACTIVE entity-role OWNER only (farm soft-delete is
 * permanent-grade; no FARM_DELETE exists in the Wave-B taxonomy). Wave B M1:
 * the legacy-owner branch requires the same ACTIVE membership when the farm
 * carries an entityId.
 */

'use strict';

const { prisma } = require('./prisma-database');
const { createLogger } = require('../shared/logger');
const { markHolderScoped } = require('./holder-marker');
const { registerHolderFragment } = require('./holder-fragment-registry');

const logger = createLogger('farm-access');

/**
 * The user's ACTIVE memberships (entityId + role) on entities that are not
 * soft-deleted. [] on missing user or lookup failure (→ callers degrade to
 * solo-owner-only scope). The single membership query behind both farm access
 * and holder-access (spec 2026-09-30 §3.1).
 * @param {string} userId
 * @returns {Promise<Array<{ entityId: string, role: string }>>}
 */
async function listActiveMemberships(userId) {
    const uid = String(userId || '').trim();
    if (!uid) { return []; }
    try {
        const memberships = await prisma.entityMembership.findMany({
            where: { userId: uid, status: 'ACTIVE', entity: { isDeleted: false } },
            select: { entityId: true, role: true },
        });
        return memberships.filter((m) => Boolean(m.entityId));
    } catch (error) {
        logger.error('[farm-access] ACTIVE-membership lookup failed — degrading to solo-owner-only scope', {
            error: error?.message,
        });
        return [];
    }
}

/**
 * Entity ids on which the user holds an ACTIVE membership.
 * [] on missing user or lookup failure.
 * @param {string} userId
 * @param {{ forMutation?: boolean }} [options] — exclude VIEWER memberships
 *        (S2 floor — only meaningful for the membership BRANCH; the owner
 *        disjunct in farmAccessWhere always uses the any-role list)
 * @returns {Promise<string[]>}
 */
async function listActiveEntityIds(userId, options = {}) {
    const memberships = await listActiveMemberships(userId);
    const rows = options.forMutation === true
        ? memberships.filter((m) => m.role !== 'VIEWER')
        : memberships;
    return [...new Set(rows.map((m) => m.entityId))];
}

/**
 * Prisma where-fragment for Farm queries (or `farm: {...}` relation guards).
 * Pure: the caller supplies the membership id sets.
 *
 * Shape (Wave B fix M1):
 *   { ownerId, entityId: null }                                  — solo rows
 *   OR { ownerId, entityId: { in: anyRoleIds } }                 — creator rows
 *   OR { entityId: { in: branchIds } }                           — member rows
 *
 * Empty id sets drop their disjunct, so zero memberships → `{ ownerId,
 * entityId: null }` (a fired worker's ownerId no longer reaches the holder entity
 * farms they created). The result carries the HOLDER_SCOPED marker.
 * @param {string} userId
 * @param {string[]} anyRoleIds — ACTIVE memberships, any role
 * @param {string[]} branchIds — the member-branch set (VIEWER dropped for mutations)
 * @returns {object}
 */
function buildFarmAccessWhere(userId, anyRoleIds, branchIds) {
    const uid = String(userId || '').trim();
    const anyRole = [...new Set(anyRoleIds || [])];
    const branch = [...new Set(branchIds || [])];

    const or = [{ ownerId: uid, entityId: null }];
    if (anyRole.length > 0) {
        or.push({ ownerId: uid, entityId: { in: anyRole } });
    }
    if (branch.length > 0) {
        or.push({ entityId: { in: branch } });
    }
    return markHolderScoped(or.length === 1 ? or[0] : { OR: or });
}

/**
 * The user's Farm where-fragment, from their ACTIVE memberships.
 * @param {string} userId
 * @param {{ forMutation?: boolean }} [options]
 * @returns {Promise<object>} marked — see buildFarmAccessWhere
 */
async function farmAccessWhere(userId, options = {}) {
    const uid = String(userId || '').trim();
    const memberships = await listActiveMemberships(uid);
    const branchRows = options.forMutation === true
        ? memberships.filter((m) => m.role !== 'VIEWER')
        : memberships;
    const where = buildFarmAccessWhere(
        uid,
        memberships.map((m) => m.entityId),
        branchRows.map((m) => m.entityId),
    );
    // The read witness checks by value (holder-fragment-registry).
    registerHolderFragment('Farm', where);
    return where;
}

/**
 * Row-based check for already-loaded rows (plot.farm, unit.cycle.farm, …).
 * The farm projection must include `ownerId` and `entityId`.
 *
 * Wave B fix M1: the owner fast-path on a holder-entity farm (entityId != null)
 * requires an ACTIVE membership (any role). Non-owners need ACTIVE too, plus
 * the S2 VIEWER floor when `forMutation`.
 * @param {{ ownerId?: string, entityId?: string|null } | null | undefined} farm
 * @param {string} userId
 * @param {{ forMutation?: boolean }} [options]
 * @returns {Promise<boolean>}
 */
async function resolveFarmAccess(farm, userId, options = {}) {
    const uid = String(userId || '').trim();
    if (!farm || !uid) { return false; }
    const isOwner = farm.ownerId === uid;
    if (isOwner && !farm.entityId) { return true; }
    if (!farm.entityId) { return false; }
    try {
        const membership = await prisma.entityMembership.findUnique({
            where: { userId_entityId: { userId: uid, entityId: farm.entityId } },
            select: { status: true, role: true, entity: { select: { isDeleted: true } } },
        });
        // A soft-deleted entity grants nothing — the same rule
        // listActiveMemberships applies in SQL, so all three shapes agree.
        if (membership?.status !== 'ACTIVE' || membership.entity?.isDeleted === true) { return false; }
        // M1 — the creator keeps full owner authority while ACTIVE (any role).
        if (isOwner) { return true; }
        // S2 — VIEWER floor on mutations only; reads unchanged.
        if (options.forMutation === true && membership.role === 'VIEWER') { return false; }
        return true;
    } catch (error) {
        logger.error('[farm-access] resolveFarmAccess membership lookup failed — denying (fail closed on the holder-entity dimension)', {
            error: error?.message,
        });
        return false;
    }
}

/**
 * M1 — DELETE-grade predicate. Farm soft-delete must NOT ride the widened
 * co-member access: only the legacy owner (`ownerId === userId`, with an
 * ACTIVE membership when the farm carries an entityId — Wave B fix M1) or an
 * ACTIVE entity-role OWNER may delete. Lookup failure → deny for the
 * holder-entity dimension (fail-closed); NEVER throws.
 * @param {{ ownerId?: string, entityId?: string|null } | null | undefined} farm
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function resolveFarmOwnerAccess(farm, userId) {
    const uid = String(userId || '').trim();
    if (!farm || !uid) { return false; }
    const isOwner = farm.ownerId === uid;
    if (isOwner && !farm.entityId) { return true; }
    if (!farm.entityId) { return false; }
    try {
        const membership = await prisma.entityMembership.findUnique({
            where: { userId_entityId: { userId: uid, entityId: farm.entityId } },
            select: { status: true, role: true, entity: { select: { isDeleted: true } } },
        });
        // A soft-deleted entity grants nothing — the same rule
        // listActiveMemberships applies in SQL, so all three shapes agree.
        if (membership?.status !== 'ACTIVE' || membership.entity?.isDeleted === true) { return false; }
        // Creator with a live membership (any role) keeps delete authority;
        // otherwise only the entity-role OWNER may delete.
        return isOwner || membership.role === 'OWNER';
    } catch (error) {
        logger.error('[farm-access] resolveFarmOwnerAccess membership lookup failed — denying (owner-only floor)', {
            error: error?.message,
        });
        return false;
    }
}

/**
 * Accessible farm-id set (non-deleted). The membership-aware replacement for
 * farm-service.listOwnerFarmIds at cultivation call sites.
 * @param {string} userId
 * @param {{ forMutation?: boolean }} [options]
 * @returns {Promise<string[]>}
 */
async function listAccessibleFarmIds(userId, options = {}) {
    const uid = String(userId || '').trim();
    if (!uid) { return []; }
    const accessWhere = await farmAccessWhere(uid, options);
    const farms = await prisma.farm.findMany({
        where: { ...accessWhere, isDeleted: false },
        select: { id: true },
    });
    return farms.map((f) => f.id);
}

module.exports = {
    listActiveMemberships,
    listActiveEntityIds,
    buildFarmAccessWhere,
    farmAccessWhere,
    resolveFarmAccess,
    resolveFarmOwnerAccess,
    listAccessibleFarmIds,
};
