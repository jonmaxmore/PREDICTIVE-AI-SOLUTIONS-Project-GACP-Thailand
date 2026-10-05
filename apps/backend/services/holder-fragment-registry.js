'use strict';

/**
 * Value registration of holder fragments: what the read witness checks
 * (spec 2026-09-30-remove-workspace-mode §3.1 guard, coordinator option D).
 *
 * Why not the symbol marker: Prisma 5.22 hands every query-extension hook a
 * deep clone of the caller's args (runtime `_a(t.args)`, a for...in copy), so
 * symbol keys and object identity never reach the hook. This replaces the
 * spec's WeakSet fallback, which fails the same way.
 *
 * holderReadWhere and farmAccessWhere call registerHolderFragment for every
 * fragment they build. The registry lives on the request's tenant context
 * object (the one tenant-context-middleware binds, as a non-enumerable symbol
 * property; no new ALS), keyed by model, holding each fragment's canonical form
 * and its keys. isRegisteredHolderScoped then answers, on Prisma's clone: does
 * this where hold, at top level or in a top-level AND member, a sub-object
 * (the fragment's keys picked out) whose canonical form equals a fragment
 * registered for that model in THIS request? For OR, every branch must.
 *
 * What equality catches: an overridden or deleted fragment key, a foreign id
 * pushed into `in` (the frozen fragment already throws on that in-process), and
 * a fragment built in another request (never registered in this one).
 * What it cannot catch: a hand-written where that is value-equal to a fragment
 * registered earlier in the same request is indistinguishable from it, and is
 * scoped, which it genuinely is (same predicate, same holders).
 *
 * Canonical form: JSON with object keys sorted, undefined values dropped, and
 * every array under an `in` key sorted. Other arrays (OR branches) keep order,
 * which Prisma's clone preserves.
 */

const { getTenantContext } = require('./tenant-context');
const witnessConfig = require('../config/holder-read-witness');

const REGISTRY = Symbol('gacp.holderFragmentRegistry');

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {*} value
 * @param {string} [key] — the property this value sits under (arrays under `in` are sorted)
 * @returns {string}
 */
function canonicalHolderForm(value, key) {
    if (Array.isArray(value)) {
        const items = value.map((item) => canonicalHolderForm(item));
        if (key === 'in') { items.sort(); }
        return `[${items.join(',')}]`;
    }
    if (value instanceof Date) { return JSON.stringify(value.toISOString()); }
    // JSON.stringify throws on BigInt; tag it so 5n and 5 stay distinct.
    if (typeof value === 'bigint') { return JSON.stringify(`${value}n`); }
    if (isPlainObject(value)) {
        const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalHolderForm(value[k], k)}`).join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

function pick(obj, keys) {
    const out = {};
    for (const key of keys) { out[key] = obj[key]; }
    return out;
}

function registryOf(ctx, create) {
    if (!ctx || typeof ctx !== 'object') { return null; }
    if (ctx[REGISTRY]) { return ctx[REGISTRY]; }
    if (!create) { return null; }
    const registry = new Map();
    Object.defineProperty(ctx, REGISTRY, { value: registry, enumerable: false });
    return registry;
}

/**
 * Record `fragment` as a holder fragment for `model` in the current request.
 * Records only where the witness will look: a bound context whose principal is
 * 'health', with the mode not 'off'. Scripts, jobs, withoutTenantScope and
 * staff requests record nothing. Never throws: a failed registration only
 * makes the witness count the read (the safe side).
 * @param {string} model
 * @param {object} fragment
 */
function registerHolderFragment(model, fragment) {
    try {
        if (!isPlainObject(fragment)) { return; }
        const ctx = getTenantContext();
        if (!ctx || ctx.principal !== 'health') { return; }
        if (witnessConfig.holderReadWitnessMode() === 'off') { return; }
        const registry = registryOf(ctx, true);
        if (!registry) { return; }
        const keys = Object.keys(fragment).filter((k) => fragment[k] !== undefined).sort();
        if (keys.length === 0) { return; }
        let byModel = registry.get(model);
        if (!byModel) {
            byModel = new Map();
            registry.set(model, byModel);
        }
        byModel.set(canonicalHolderForm(pick(fragment, keys)), keys);
    } catch (_) { /* registration failure → the witness counts the read */ }
}

function matchesRegistered(obj, byModel) {
    if (!isPlainObject(obj)) { return false; }
    for (const [canonical, keys] of byModel) {
        if (keys.every((k) => hasOwn(obj, k) && obj[k] !== undefined)
            && canonicalHolderForm(pick(obj, keys)) === canonical) {
            return true;
        }
    }
    return false;
}

/**
 * Is this where scoped by a fragment registered for `model` in the current request?
 * @param {string} model
 * @param {*} where — typically Prisma's clone of the caller's where
 * @param {object} [ctx] — the tenant context (defaults to the bound one)
 * @returns {boolean}
 */
function isRegisteredHolderScoped(model, where, ctx = getTenantContext()) {
    const registry = registryOf(ctx, false);
    const byModel = registry && registry.get(model);
    if (!byModel || byModel.size === 0 || !isPlainObject(where)) { return false; }
    if (matchesRegistered(where, byModel)) { return true; }
    const and = where.AND;
    if (Array.isArray(and) ? and.some((m) => matchesRegistered(m, byModel)) : matchesRegistered(and, byModel)) {
        return true;
    }
    const or = where.OR;
    return Array.isArray(or) && or.length > 0 && or.every((b) => matchesRegistered(b, byModel));
}

module.exports = {
    canonicalHolderForm,
    registerHolderFragment,
    isRegisteredHolderScoped,
};
