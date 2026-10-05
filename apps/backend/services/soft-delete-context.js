/**
 * Soft-Delete Context (Wave A Phase 16)
 *
 * Async-local opt-out for the soft-delete auto-filter applied by
 * soft-delete-extension.js. The default behaviour is to filter out
 * tombstoned rows (`isDeleted = true`) on read/aggregate paths so callers
 * that don't think about soft-delete still get correct results.
 *
 * Two ways to read tombstoned rows when you actually need them:
 *
 *   1. Wrap the call in `withDeletedRows()` — the most common pattern for
 *      admin recycle-bin views and PDPA delete-by-user pipelines.
 *
 *      withDeletedRows(() => prisma.application.findMany({ where: { id } }));
 *
 *   2. Pass `where.isDeleted` explicitly. The extension respects what the
 *      caller provided, so `where: { isDeleted: true }` finds tombstones
 *      and `where: { id, isDeleted: { in: [true, false] } }` finds both.
 *
 * Single rule: if `getSoftDeleteContext()` returns `{ includeDeleted: true }`,
 * the extension is a no-op for that async chain. Otherwise it injects
 * `isDeleted: false` on read/aggregate operations.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

/**
 * @returns {{ includeDeleted: boolean } | null}
 */
function getSoftDeleteContext() {
  return storage.getStore() || null;
}

/**
 * Run `fn` with the soft-delete auto-filter disabled. All reads see
 * tombstoned rows alongside live ones for the duration of the callback.
 *
 * @param {() => any} fn
 */
function withDeletedRows(fn) {
  return storage.run({ includeDeleted: true }, fn);
}

module.exports = {
  getSoftDeleteContext,
  withDeletedRows,
};
