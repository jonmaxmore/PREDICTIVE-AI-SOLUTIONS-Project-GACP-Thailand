/**
 * The HOLDER_SCOPED marker (spec 2026-09-30 §3.1) — the primitives only.
 *
 * A health read proves it is holder-scoped by spreading a where-fragment that
 * carries this symbol key. Prisma 5.22 ignores symbol keys (pinned on a real
 * Postgres by holder-marker-prisma-real-postgres.test.js), and object spread
 * copies them, so `{ ...fragment, status }` keeps the marker. A Prisma
 * query-extension hook never sees it, though: Prisma 5.22 deep-clones args for
 * each hook. The read witness therefore checks by value
 * (holder-fragment-registry.js); the marker protects in-process code and unit
 * callers.
 *
 * The marker is not a flag. It records the keys it vouches for and the exact
 * value each held when the fragment was built. `hasHolderMarker` accepts a
 * where only while every vouched key still holds that same value (by
 * reference), so a spread followed by `entityId: 'victim'` or
 * `application: {...}`, or a deleted key, reads as unscoped.
 *
 * A marked fragment is deep-frozen (plain objects and arrays, every level), so
 * a vouched value cannot be widened in place either: with a by-reference check,
 * `fragment.entityId.in.push('victim')` would otherwise keep the marker valid.
 * Spread a fragment into a new where; never mutate one.
 *
 * Its own module, with no requires, so farm-access (which marks its fragment),
 * holder-access (which requires farm-access) and the read witness (which the
 * Prisma extension loads while prisma-database is still initialising) do not
 * require each other. Route and service code imports these through
 * holder-access; farm-access, the witness and their tests import this module
 * directly.
 */

'use strict';

const HOLDER_SCOPED = Symbol.for('gacp.holderScoped');

/** The holder-bearing models the read witness watches (spec §3.1 table). Frozen. */
const WATCHED_MODELS = Object.freeze([
    'Application',
    'Farm',
    'Certificate',
    'Invoice',
    'Quote',
    'Quotation',
    'PaymentTransaction',
    'CheckoutOrder',
    'CheckoutDocument',
    'ApplicationDocument',
    'DocumentPrecheck',
]);
const watchedModelSet = new Set(WATCHED_MODELS);

/**
 * @param {string} name — Prisma model name
 * @returns {boolean}
 */
function isWatchedModel(name) {
    return watchedModelSet.has(name);
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function isObject(value) {
    return value !== null && typeof value === 'object';
}

function isPlainContainer(value) {
    if (Array.isArray(value)) { return true; }
    if (!isObject(value)) { return false; }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** Freeze plain objects and arrays at every level (Dates, Decimals etc. are left alone). */
function deepFreeze(value) {
    if (!isPlainContainer(value) || Object.isFrozen(value)) { return value; }
    Object.freeze(value);
    for (const key of Object.keys(value)) { deepFreeze(value[key]); }
    return value;
}

/**
 * Tag a where object as holder-scoped, vouching for every own string key it
 * has now, then deep-freeze it. Returns the same object. Throws when there is
 * nothing to vouch for (no keys, or a key whose value is undefined, which
 * Prisma treats as absent), or when the object is already frozen.
 * @template T
 * @param {T} where
 * @returns {T}
 */
function markHolderScoped(where) {
    if (!isObject(where) || Array.isArray(where)) {
        throw new TypeError('markHolderScoped: where must be a plain object');
    }
    const keys = Object.keys(where);
    if (keys.length === 0 || keys.some((key) => where[key] === undefined)) {
        throw new TypeError('markHolderScoped: where must hold at least one defined key to vouch for');
    }
    if (Object.isFrozen(where)) {
        throw new TypeError('markHolderScoped: where is frozen (already marked?); spread it instead');
    }
    where[HOLDER_SCOPED] = Object.freeze(keys.map((key) => Object.freeze({ key, ref: where[key] })));
    return deepFreeze(where);
}

function isMarked(where) {
    if (!isObject(where)) { return false; }
    const vouches = where[HOLDER_SCOPED];
    if (!Array.isArray(vouches) || vouches.length === 0) { return false; }
    return vouches.every((v) => isObject(v) && typeof v.key === 'string'
        && hasOwn(where, v.key) && where[v.key] === v.ref);
}

/**
 * Does this where carry an intact marker? Top level, or one level down:
 *   - AND (array or single object): any element marked narrows the whole read;
 *   - OR: every branch must be marked, because one unmarked branch widens it.
 * @param {*} where
 * @returns {boolean}
 */
function hasHolderMarker(where) {
    if (!isObject(where)) { return false; }
    if (isMarked(where)) { return true; }
    const and = where.AND;
    if (Array.isArray(and) ? and.some(isMarked) : isMarked(and)) { return true; }
    const or = where.OR;
    return Array.isArray(or) && or.length > 0 && or.every(isMarked);
}

module.exports = {
    HOLDER_SCOPED,
    WATCHED_MODELS,
    isWatchedModel,
    markHolderScoped,
    hasHolderMarker,
};
