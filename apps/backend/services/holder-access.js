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
 * R1 (operator ruling C1): while the active-entity middleware still exists,
 * holderScope intersects R with req.activeEntity. That one line is the only
 * place this module touches the workspace mode; Task 12 deletes it.
 *
 * R1 caveat — no fail-closed claim for Application/Farm top-level spreads:
 * with an entity context bound, tenantInjectExtension's entity dimension
 * overwrites a top-level `where.entityId` with the active entity AFTER the
 * witness has passed the read. A fragment `{ entityId: { in: [] } }` (empty
 * R ∩ active, e.g. a personal entity found by citizen-id hash without a
 * membership row) therefore reads as `entityId = active` in R1, not as an
 * empty set. The empty-set guarantee holds only where no entity context is
 * bound, and for relation fragments (`application: { entityId: … }`), which
 * the extension does not rewrite. It becomes unconditional when Task 12
 * removes the entity dimension. R1 also keeps each door's pre-R1 filer pin
 * (r1LegacyApplicantPin), so R1 rows equal the pre-R1 rows.
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
 * @param {{ activeEntityId?: string|null }} [options] — R1 only: intersect with this entity
 * @returns {Promise<{ userId: string, readIds: string[], editIds: string[] }>}
 */
async function holderScopeForUser(userId, options = {}) {
    const uid = String(userId || '').trim();
    const memberships = await listActiveMemberships(uid);
    let readIds = uniq(memberships.map((m) => m.entityId));
    let editIds = uniq(memberships.filter((m) => m.role !== 'VIEWER').map((m) => m.entityId));
    const active = options.activeEntityId ? String(options.activeEntityId) : '';
    if (active) {
        readIds = readIds.filter((id) => id === active);
        editIds = editIds.filter((id) => id === active);
    }
    return { userId: uid, readIds, editIds };
}

const scopeByRequest = new WeakMap();

/**
 * The membership set for this request's user, computed once per request.
 * A missing request rejects (never throws synchronously); a request with no
 * user resolves to the empty scope (fail closed).
 * @param {object} req — Express request (req.user.id; R1: req.activeEntity)
 * @returns {Promise<{ userId: string, readIds: string[], editIds: string[] }>}
 */
function holderScope(req) {
    if (req === null || typeof req !== 'object') {
        return Promise.reject(new TypeError('holderScope: req must be the Express request object'));
    }
    const cached = scopeByRequest.get(req);
    if (cached) { return cached; }
    const pending = holderScopeForUser(req.user?.id, {
        // R1 intersection (ruling C1) — deleted in Task 12.
        activeEntityId: req.activeEntity?.entityId,
    });
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
 * R1-legacy-pin: removed in Task 12.
 *
 * Operator ruling C1 (controller ruling, Task 3 fix round 1): R1 returns
 * exactly what the pre-R1 code returned. Every applicant read therefore keeps
 * its pre-R1 filer where — verbatim, per door — as one extra AND member beside
 * the unchanged holder fragment. The fragment is what the read witness looks
 * for; the pin is what keeps the rows the same. R2 widens reads by deleting
 * every call of this helper (Task 12, together with the R1 intersection in
 * holderScope); the call sites carry the same `R1-legacy-pin` marker.
 *
 * Where a door's old where relaxed to the workspace entity (buildHealthWhereClause
 * with personal:false → { entityId }), the caller passes that relaxed where as
 * the pin; it sits inside AND, so it never overwrites the fragment's entityId.
 *
 * A missing pin (the old code would have had no filer to pin on) matches
 * nothing.
 * @param {object|null|undefined} pin — the door's pre-R1 filer where
 * @returns {{ AND: object[] }} spread into the where
 */
function r1LegacyApplicantPin(pin) {
    if (!pin || typeof pin !== 'object' || Object.keys(pin).length === 0) {
        return { AND: [{ id: { in: [] } }] };
    }
    return { AND: [pin] };
}

/**
 * R1-legacy-pin: removed in Task 12.
 *
 * The door's pre-R1 where (its filer pin, or the id the door's gate already
 * resolved), marked and REGISTERED for the request as a holder fragment of
 * `model`, so the read witness accepts it as one OR branch. A copy is marked:
 * the caller's object is never frozen. A missing or empty pin matches nothing.
 *
 * Why (Task 4 fix round 1, controller ruling on C1): `fragment AND pin` can only
 * narrow. Where the pre-R1 read was decided by the pin alone (models outside the
 * ALS entity dimension, and child reads behind an Application gate), a filer
 * whose membership was revoked, or a personal entity with no membership row
 * (readIds = []), lost rows. `{ OR: [fragment, legacy] }` beside the same pin
 * gives (F ∪ P) ∩ P = P: exactly the pre-R1 rows, with every OR branch
 * registered.
 * @param {string} model — one of WATCHED_MODELS
 * @param {object|null|undefined} pin — the pre-R1 where, verbatim
 * @returns {object} a frozen, marked, registered where
 */
function r1LegacyFilerFragment(model, pin) {
    if (!isWatchedModel(model)) {
        throw new Error(`r1LegacyFilerFragment: ${model} is not a holder-bearing model`);
    }
    const body = pin && typeof pin === 'object' && Object.keys(pin).length > 0
        ? JSON.parse(JSON.stringify(pin))
        : { id: { in: [] } };
    const where = markHolderScoped(body);
    registerHolderFragment(model, where);
    return where;
}

/**
 * R1-legacy-pin: removed in Task 12 (each call becomes holderReadWhere(scope, model)).
 *
 * `{ OR: [holderReadWhere(scope, model), r1LegacyFilerFragment(model, legacy)] }`.
 * Spread it into a where that ALSO carries the pre-R1 pin (as its own key, e.g.
 * `applicationId`, `id`, or via r1LegacyApplicantPin), so the OR can never widen.
 * A where that already has a top-level OR must move that OR into AND first.
 * @param {{ readIds: string[] }} scope
 * @param {string} model
 * @param {object} legacy — the pre-R1 where the door's rows were decided by
 * @returns {{ OR: object[] }}
 */
function r1HolderOrLegacy(scope, model, legacy) {
    return { OR: [holderReadWhere(scope, model), r1LegacyFilerFragment(model, legacy)] };
}

/**
 * R1-legacy-pin: removed in Task 12 (each call becomes ...holderReadWhere(scope, 'Application')).
 *
 * An applicant Application read beside the door's pre-R1 filer pin:
 * `{ OR: [fragment, legacy(pin)], AND: [pin] }` = exactly the pin's rows.
 *
 * Why not `fragment AND pin` (final review C1, 2026-10-03): that form relied on
 * tenantInjectExtension overwriting the top-level entityId with the active
 * entity, which happens only when an entity context is bound. A user with no
 * personal entity, or any user when the active-entity middleware's resolution
 * fails, has no context, so `entityId IN R` stayed in the where and dropped
 * the filings whose holder is null or outside R. With a context bound both
 * forms read `pin AND entityId = active`; without one this form reads the pin,
 * as the pre-R1 code did.
 *
 * The result owns the top-level OR and AND keys: a door with its own OR moves
 * it into AND. A missing or empty pin matches nothing.
 * @param {{ readIds: string[] }} scope
 * @param {object|null|undefined} pin — the door's pre-R1 filer where, verbatim
 * @returns {{ OR: object[], AND: object[] }}
 */
function r1ApplicationHolderOrPin(scope, pin) {
    return { ...r1HolderOrLegacy(scope, 'Application', pin), ...r1LegacyApplicantPin(pin) };
}

/**
 * R1-legacy-pin: removed in Task 12 (each call becomes holderReadWhere(scope, model)).
 *
 * r1HolderOrLegacy when the caller is a health door that passed its scope, and
 * nothing otherwise: staff, jobs and system callers pass no scope and keep their
 * where byte for byte. For reads behind a gate the door already passed (child
 * rows of an application or farm it resolved, the door's own id), so the legacy
 * branch is the read's own key and the rows stay exactly the pre-R1 rows.
 * @param {{ readIds: string[] }|null|undefined} scope
 * @param {string} model
 * @param {object} legacy — the pre-R1 where, which the caller ALSO keeps beside it
 * @returns {object} `{ OR: [...] }` or `{}`
 */
function r1HolderOrLegacyWhenScoped(scope, model, legacy) {
    if (!scope || !Array.isArray(scope.readIds)) { return {}; }
    return r1HolderOrLegacy(scope, model, legacy);
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
    hasHolderMarker,
    markHolderScoped,
    assertHolderCapability,
    resolveHolderOwnerOrCreator,
    r1LegacyApplicantPin, // R1-legacy-pin: removed in Task 12
    r1LegacyFilerFragment, // R1-legacy-pin: removed in Task 12
    r1HolderOrLegacy, // R1-legacy-pin: removed in Task 12
    r1HolderOrLegacyWhenScoped, // R1-legacy-pin: removed in Task 12
    r1ApplicationHolderOrPin, // R1-legacy-pin: removed in Task 12
};
