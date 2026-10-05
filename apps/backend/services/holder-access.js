/**
 * Holder access — THE membership-set read rule for health users
 * (spec 2026-09-30-remove-workspace-mode §3.1).
 *
 *     R(user) = { m.entityId | EntityMembership m: m.userId = user,
 *                 m.status = 'ACTIVE', m.entity.isDeleted = false }   (any role)
 *
 * A health user reads a holder-bearing row when its holder entity is in R.
 * There is no filer fallback: a row whose holder is null is readable by no one
 * on the health side. `editIds` is R without VIEWER memberships (the S2 floor
 * in farm-access). An empty set yields an empty result (fail closed); a lookup
 * failure yields [] and is logged (farm-access.listActiveMemberships, the one
 * membership query, does both).
 *
 * Every health read spreads `holderReadWhere(scope, model)`. The fragment
 * carries the HOLDER_SCOPED marker, which the read witness looks for.
 *
 * There is no active workspace and no filer pin (R2 Task 12 removed the R1
 * intersection with the workspace header and every filer branch R1 kept):
 * the membership set alone decides what a health user reads.
 *
 * Capability gating (which member may do WHICH action) stays with the
 * per-permission engine; assertHolderCapability only delegates to it.
 */

'use strict';

const { prisma } = require('./prisma-database');
const { createLogger } = require('../shared/logger');
const { listActiveMemberships, buildFarmAccessWhere } = require('./farm-access');
const { assertEntityActionPermission } = require('./entity-effective-permissions-service');
const {
    HOLDER_SCOPED,
    WATCHED_MODELS,
    isWatchedModel,
    markHolderScoped,
    hasHolderMarker,
} = require('./holder-marker');
const { registerHolderFragment } = require('./holder-fragment-registry');

const logger = createLogger('holder-access');

const byApplication = (ids) => ({ application: { entityId: { in: ids } } });

/**
 * Model → fragment builder (spec §3.1 table). `ids` is a fresh copy of
 * scope.readIds. Farm's builder returns a fragment farm-access has already
 * marked (and so frozen); the others return a plain object holderReadWhere marks.
 */
const FRAGMENTS = Object.freeze({
    Application: (ids) => ({ entityId: { in: ids } }),
    Farm: (ids, scope) => buildFarmAccessWhere(scope.userId, ids, ids),
    Certificate: byApplication,
    Invoice: byApplication,
    Quote: byApplication,
    Quotation: byApplication,
    PaymentTransaction: byApplication,
    CheckoutOrder: byApplication,
    CheckoutDocument: (ids) => ({ checkoutOrder: byApplication(ids) }),
    ApplicationDocument: byApplication,
    DocumentPrecheck: byApplication,
});

const uniq = (values) => [...new Set(values)];

/**
 * The membership set for a user.
 * @param {string} userId
 * @returns {Promise<{ userId: string, readIds: string[], editIds: string[] }>}
 */
async function holderScopeForUser(userId) {
    const uid = String(userId || '').trim();
    const memberships = await listActiveMemberships(uid);
    const readIds = uniq(memberships.map((m) => m.entityId));
    const editIds = uniq(memberships.filter((m) => m.role !== 'VIEWER').map((m) => m.entityId));
    return { userId: uid, readIds, editIds };
}

const scopeByRequest = new WeakMap();

/**
 * The membership set for this request's user, computed once per request.
 * A missing request rejects (never throws synchronously); a request with no
 * user resolves to the empty scope (fail closed).
 * @param {object} req — Express request (req.user.id)
 * @returns {Promise<{ userId: string, readIds: string[], editIds: string[] }>}
 */
function holderScope(req) {
    if (req === null || typeof req !== 'object') {
        return Promise.reject(new TypeError('holderScope: req must be the Express request object'));
    }
    const cached = scopeByRequest.get(req);
    if (cached) { return cached; }
    const pending = holderScopeForUser(req.user?.id);
    scopeByRequest.set(req, pending);
    return pending;
}

/**
 * The marked Prisma where-fragment that scopes `model` to the scope's holders.
 * Deep-frozen: spread it (`{ ...holderReadWhere(s, m), status }`), never mutate it.
 * Also registered by value in the request's tenant context
 * (holder-fragment-registry), which is what the read witness checks.
 * @param {{ userId: string, readIds: string[] }} scope
 * @param {string} model — one of WATCHED_MODELS
 * @returns {object}
 */
function holderReadWhere(scope, model) {
    const build = Object.prototype.hasOwnProperty.call(FRAGMENTS, model) ? FRAGMENTS[model] : null;
    if (!build) {
        throw new Error(`holderReadWhere: no holder fragment for model ${model}`);
    }
    const ids = Array.isArray(scope?.readIds) ? [...scope.readIds] : [];
    const built = build(ids, scope || {});
    const where = Object.prototype.hasOwnProperty.call(built, HOLDER_SCOPED) ? built : markHolderScoped(built);
    // The read witness checks by value (Prisma clones args before its hooks).
    registerHolderFragment(model, where);
    return where;
}

/**
 * holderReadWhere for a caller that may or may not be a health door: a health
 * door passes its holder scope and gets the marked fragment; staff, jobs and
 * system callers pass no scope and get `{}`, so their where stays byte for byte.
 * @param {{ userId: string, readIds: string[] }|null|undefined} scope
 * @param {string} model — one of WATCHED_MODELS
 * @returns {object} the fragment, or `{}`
 */
function holderReadWhereIfScoped(scope, model) {
    if (!scope || !Array.isArray(scope.readIds)) { return {}; }
    return holderReadWhere(scope, model);
}

/**
 * The one health read that the holder scope does NOT decide: a PDPA s.30
 * export of the data subject's own rows (pdpa-service), keyed by law on the
 * filer / owner column, not on the holder. The where is copied, marked and
 * registered for the request, so the read witness accepts it as scoped.
 * Nothing else may use it: every other health read spreads holderReadWhere.
 * A missing or empty where matches nothing.
 * @param {string} model — one of WATCHED_MODELS
 * @param {object} where — the data subject's own key, e.g. { healthId }
 * @returns {object} a frozen, marked, registered where
 */
function dataSubjectReadWhere(model, where) {
    if (!isWatchedModel(model)) {
        throw new Error(`dataSubjectReadWhere: ${model} is not a holder-bearing model`);
    }
    const body = where && typeof where === 'object' && Object.keys(where).length > 0
        ? JSON.parse(JSON.stringify(where))
        : { id: { in: [] } };
    const marked = markHolderScoped(body);
    registerHolderFragment(model, marked);
    return marked;
}

/**
 * Gate one action on the holder through the per-permission engine.
 * Throws the engine's 403 ENTITY_PERMISSION_DENIED on denial.
 * @param {string} userId
 * @param {string} entityId
 * @param {string} capability
 * @returns {Promise<void>}
 */
async function assertHolderCapability(userId, entityId, capability) {
    await assertEntityActionPermission({ userId, entityId, permission: capability });
}

/**
 * Destructive-grade predicate (spec §3.3): the application's creator
 * (`submitterId`) with an ACTIVE non-VIEWER membership on its holder, or the
 * holder's ACTIVE OWNER. A null holder, a deleted holder or a lookup failure
 * denies; never throws.
 * @param {{ entityId?: string|null, submitterId?: string|null }} app
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function resolveHolderOwnerOrCreator(app, userId) {
    const uid = String(userId || '').trim();
    const entityId = app?.entityId;
    if (!uid || !entityId) { return false; }
    try {
        const membership = await prisma.entityMembership.findFirst({
            where: { userId: uid, entityId, status: 'ACTIVE', entity: { isDeleted: false } },
            select: { role: true },
        });
        if (!membership) { return false; }
        if (membership.role === 'OWNER') { return true; }
        return app.submitterId === uid && membership.role !== 'VIEWER';
    } catch (error) {
        logger.error('[holder-access] owner-or-creator membership lookup failed — denying', {
            error: error?.message,
        });
        return false;
    }
}

module.exports = {
    HOLDER_SCOPED,
    WATCHED_MODELS,
    isWatchedModel,
    holderScope,
    holderScopeForUser,
    holderReadWhere,
    holderReadWhereIfScoped,
    dataSubjectReadWhere,
    hasHolderMarker,
    markHolderScoped,
    assertHolderCapability,
    resolveHolderOwnerOrCreator,
};
