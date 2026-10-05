/**
 * Entity Context (Wave C, PR C-2)
 *
 * Async-local active-entity scope used by:
 *   - the express middleware that resolves the active entity per request
 *     from the `x-active-entity-id` header
 *   - the Prisma client extension that auto-filters reads on
 *     entity-scoped models (Application, Farm, Certificate, Invoice, …)
 *     so a forgotten `where: { entityId }` in a route handler can no
 *     longer leak rows from another workspace
 *   - any service code that needs to know the current entity without
 *     plumbing it through every function signature
 *
 * Mirrors apps/backend/services/tenant-context.js exactly. Kept as a
 * separate ALS so the two scopes (Organization × Entity) stay
 * orthogonal — a request can be in a tenant scope without an entity
 * scope (anonymous, public, or platform-admin paths).
 *
 * Single rule: if `getEntityContext()` returns null, the calling code
 * is either pre-picker (no header) or it's a script / migration / test.
 * The Prisma extension treats null as "do not filter" so write paths
 * and admin code continue to work.
 */

'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Read the active-entity context bound to the current async chain.
 * @returns {{ entityId: string, role: string } | null}
 */
function getEntityContext() {
    return storage.getStore() || null;
}

/**
 * Throws if no active entity is bound. Use in code paths that must run
 * inside an entity scope (e.g., capability checks).
 */
function requireEntityContext() {
    const ctx = storage.getStore();
    if (!ctx || !ctx.entityId) {
        throw new Error(
            'EntityContext required but not set. '
            + 'Ensure active-entity-middleware ran before this code path.',
        );
    }
    return ctx;
}

/**
 * Run `fn` inside an active-entity scope. The scope propagates through
 * every awaited Promise spawned from fn via AsyncLocalStorage.
 *
 * @param {{ entityId: string, role: string }} context
 * @param {() => any} fn
 */
function runWithEntityContext(context, fn) {
    if (!context || !context.entityId) {
        throw new Error('runWithEntityContext: entityId is required');
    }
    return storage.run(context, fn);
}

/**
 * Explicit escape hatch for paths that must read across entities (admin
 * surfaces, cross-entity reports, jobs). Inside fn, getEntityContext()
 * returns null, so the Prisma extension does NOT auto-filter reads.
 */
function withoutEntityScope(fn) {
    return storage.run(null, fn);
}

module.exports = {
    getEntityContext,
    requireEntityContext,
    runWithEntityContext,
    withoutEntityScope,
};
