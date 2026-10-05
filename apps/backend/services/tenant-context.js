/**
 * Tenant Context (ADR-014, Phase 2)
 *
 * Async-local tenant scope used by:
 *   - the express middleware that resolves a tenant per request
 *   - the Prisma client extension that auto-injects organizationId on writes
 *   - any service code that needs to know the current tenant without
 *     plumbing it through every function signature
 *
 * Single rule: if `getTenantContext()` returns null, the calling code is
 * either platform-admin (and must have entered `withoutTenantScope`) or it
 * is misconfigured. The Prisma extension treats null as "do not inject" so
 * scripts, tests, and migrations continue to work.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Read the tenant context bound to the current async chain.
 * @returns {{ organizationId: string } | null}
 */
function getTenantContext() {
  return storage.getStore() || null;
}

/**
 * Convenience accessor that throws if no tenant is bound. Use in code paths
 * that must run inside a tenant scope (e.g., write operations on
 * tenant-scoped tables that did not get an explicit organizationId).
 */
function requireTenantContext() {
  const ctx = storage.getStore();
  if (!ctx || !ctx.organizationId) {
    throw new Error(
      'TenantContext required but not set. ' +
        'Ensure tenant-context-middleware ran before this code path, ' +
        'or wrap admin/system code in withoutTenantScope().',
    );
  }
  return ctx;
}

/**
 * Run `fn` inside a tenant scope. The scope is shared with all async work
 * spawned from `fn` (Promises, setImmediate, etc.) via AsyncLocalStorage.
 *
 * @param {{ organizationId: string }} context
 * @param {() => any} fn
 */
function runWithTenantContext(context, fn) {
  if (!context || !context.organizationId) {
    throw new Error('runWithTenantContext: organizationId is required');
  }
  return storage.run(context, fn);
}

/**
 * Explicit escape hatch for platform-admin / system paths that must read or
 * write across tenants (super-admin listing, billing reconciliation,
 * cross-tenant migrations).
 *
 * Inside `fn`, getTenantContext() returns null. Any write through the
 * Prisma extension will refuse to auto-inject organizationId — callers must
 * either supply it explicitly or operate on global tables only.
 *
 * A thenable returned by `fn` is STARTED here, inside the null store. A
 * Prisma query returned without `await` — `withoutTenantScope(() =>
 * prisma.user.count(...))` — is a lazy PrismaPromise: it does nothing until
 * `.then` is called. Returned as-is, the caller's `await` would start it
 * after storage.run had exited, under the CALLER's tenant, and the read
 * scope would overwrite the query's own organizationId (2026-09-29: the S6
 * last-admin count and the S7 REVOKE lookup were both defeated this way).
 * Calling `.then` synchronously here pins the whole query to "no tenant";
 * the caller gets a native Promise with the same value or rejection.
 * Non-thenables are returned unchanged and synchronously.
 *
 * Consequence: the returned value is never a PrismaPromise, so it cannot be
 * placed in the array form of `prisma.$transaction([...])`. No caller does
 * that; use the callback form inside withoutTenantScope instead.
 *
 * @param {() => any} fn
 */
function withoutTenantScope(fn) {
  return storage.run(null, () => {
    const result = fn();
    if (result !== null && (typeof result === 'object' || typeof result === 'function')
        && typeof result.then === 'function') {
      return new Promise((resolve, reject) => {
        result.then(resolve, reject);
      });
    }
    return result;
  });
}

/**
 * True only for code running inside an active `withoutTenantScope()` call —
 * an intentional "no tenant, on purpose" bypass. This is NOT the same as
 * "no tenant context is bound": `getTenantContext()` returns null in BOTH
 * that case and the genuinely-unbound case (nothing ever called
 * runWithTenantContext or withoutTenantScope on this async chain), because
 * it normalizes via `storage.getStore() || null`.
 *
 * The raw AsyncLocalStorage store distinguishes the two: it is `undefined`
 * when no `storage.run()` is active, and exactly `null` when the active run
 * is `withoutTenantScope`'s `storage.run(null, fn)`. This accessor exposes
 * that raw distinction so callers (e.g., services/rls-shadow-metrics.js) can
 * tell "genuinely missing context" (a bug/misconfiguration — would fail
 * closed under future RLS enforcement) apart from "deliberately bypassed"
 * (platform-admin / cron / system code) — the metric must fire only for the
 * former.
 */
function isWithoutTenantScope() {
  return storage.getStore() === null;
}

module.exports = {
  getTenantContext,
  requireTenantContext,
  runWithTenantContext,
  withoutTenantScope,
  isWithoutTenantScope,
};
