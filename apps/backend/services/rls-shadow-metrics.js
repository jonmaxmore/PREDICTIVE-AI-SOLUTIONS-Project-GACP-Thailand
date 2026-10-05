'use strict';
const logger = require('../shared/logger');
// Phase-0 shadow signals. Structured so an ops dashboard can aggregate:
// signal=MISSING_CONTEXT → a tenant-scoped op ran with no tenant context (would fail-closed under enforcement).
// signal=WOULD_BE_BLOCKED → a scoped read returned a row from another org (enforcement would have hidden it).
// Both emitters swallow logger failures: checkMissingContext runs BEFORE
// query() in the hooked verbs, so a throwing logger would turn a
// previously-succeeding read into a failure — a shadow probe must never be
// able to take down the path it only measures.
function emitMissingContext({ model, action }) {
  try {
    logger.warn('[rls-shadow] missing tenant context on a tenant-scoped op', { signal: 'MISSING_CONTEXT', model, action });
  } catch (_) { /* shadow metric must never affect the query path */ }
}
function emitWouldBeBlocked({ model, action, rowOrgId, contextOrgId }) {
  try {
    logger.warn('[rls-shadow] cross-tenant row would be blocked under enforcement', { signal: 'WOULD_BE_BLOCKED', model, action, rowOrgId, contextOrgId });
  } catch (_) { /* shadow metric must never affect the query path */ }
}
module.exports = { emitMissingContext, emitWouldBeBlocked };
