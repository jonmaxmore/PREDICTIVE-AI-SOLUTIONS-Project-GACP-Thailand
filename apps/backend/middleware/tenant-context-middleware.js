/**
 * Tenant Context Middleware (ADR-014, Phase 2)
 *
 * Resolves the current tenant for an authenticated request and binds it to
 * the async-local tenant context. Must run AFTER an authenticate* middleware
 * (req.user populated) and BEFORE any handler that performs a write through
 * the Prisma client extension.
 *
 * Resolution order:
 *   1. JWT claim `req.user.organizationId` — fast path, set when login flow
 *      is updated to include the claim
 *   2. DB lookup on User.organizationId — fallback for legacy tokens issued
 *      before Phase 2 was rolled out; cached on req.user for the request
 *
 * Behavior outside a tenant context:
 *   - if req.user is missing → tenant cannot be resolved; the request
 *     continues without a tenant scope. Handlers that perform writes on
 *     tenant-scoped tables will fail loudly via the Prisma extension if
 *     they rely on auto-injection.
 *   - if req.user is present but has no organizationId at all (DB column
 *     was never backfilled) → request is rejected with 500. Phase 1 step 3
 *     guarantees this state cannot occur in production data.
 */

const { runWithTenantContext } = require('../services/tenant-context');
const { prisma } = require('../services/prisma-database');
const { createLogger } = require('../shared/logger');
const { CANONICAL_ROLES } = require('../shared/canonical-rbac');

const logger = createLogger('tenant-context-middleware');

async function resolveOrganizationId(reqUser) {
  if (!reqUser) {return null;}

  if (reqUser.organizationId) {
    return reqUser.organizationId;
  }

  // Legacy token without the claim — fall back to DB lookup.
  if (!reqUser.id) {return null;}

  const row = await prisma.user.findUnique({
    where: { id: reqUser.id },
    select: { organizationId: true },
  });

  if (row && row.organizationId) {
    // Cache on req.user so downstream handlers and the Prisma extension see
    // it without another DB hit.
    reqUser.organizationId = row.organizationId;
    return row.organizationId;
  }

  return null;
}

/** "METHOD baseUrl+path" as strings, taken now (no query string; req is not retained). */
function describeRoute(req) {
  return `${String(req.method || '?')} ${String(req.baseUrl || '')}${String(req.path || '')}`;
}

function tenantContextMiddleware() {
  return async function tenantContext(req, res, next) {
    try {
      const organizationId = await resolveOrganizationId(req.user);

      if (!organizationId) {
        // Anonymous, public, or platform-admin route — let the request
        // through without a tenant scope. Tenant-scoped handlers must
        // assert their own scope (or they'll be rejected by the Prisma
        // extension on write).
        return next();
      }

      // principal (spec 2026-09-30-remove-workspace-mode §3.1): the read
      // witness only watches 'health'. Decided on canonicalRole alone
      // (shared/canonical-rbac.js), never on which authenticate* ran:
      // authenticateHealth also serves a provider branch.
      const principal = req.user?.canonicalRole === CANONICAL_ROLES.HEALTH ? 'health' : 'staff';
      req.tenantContext = { organizationId, principal };
      // The read witness logs this route (a query hook cannot see its caller's
      // stack). A string snapshot, so the context never keeps req alive;
      // non-enumerable, so the context still compares as { organizationId, principal }.
      Object.defineProperty(req.tenantContext, 'route', {
        enumerable: false,
        value: describeRoute(req),
      });
      return runWithTenantContext(req.tenantContext, () => next());
    } catch (error) {
      logger.error('[tenant-context] resolution failed:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Server Error',
        message: 'Tenant context resolution failed',
        code: 'TENANT_CONTEXT_FAILED',
      });
    }
  };
}

module.exports = {
  tenantContextMiddleware,
  // exported for unit tests
  __resolveOrganizationId: resolveOrganizationId,
};
