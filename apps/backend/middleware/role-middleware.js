/**
 * Role-based Access Control Middleware (V2)
 * Enforces strict role permissions for closed-loop system
 */

const { AuthorizationError } = require('../shared/errors');
const logger = require('../shared/logger');
const { prisma } = require('../services/prisma-database');
const { normalizeRole, isProviderRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');
const { getEffectivePermissions } = require('../services/effective-permissions-service');

/**
 * Check if user has required role
 * @param {Array<string>} allowedRoles - Array of allowed roles
 * @returns {Function} Express middleware
 */
const requireRole = (allowedRoles) => {
  // The allowed list is fixed for the life of the guard, so both lookup
  // structures are built HERE, once — not per request. Every authenticated
  // request crosses one of these guards; re-normalizing a static list on each
  // one was pure allocation churn.
  const rawAllowed = new Set(allowedRoles);
  const canonicalAllowed = new Set(
    allowedRoles.map((role) => normalizeRole(role)).filter(Boolean),
  );

  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new AuthorizationError('Authentication required');
      }

      // Prefer the normalised value; the raw column is the legacy fallback.
      const userRole = req.user.canonicalRole || req.user.role;
      const normalizedUserRole = normalizeRole(userRole);

      // platform_admin is the cross-tenant platform operator (root): it
      // satisfies every provider role requirement. Tenant-scoped roles
      // (incl. tenant admin) never gain this — see SEC-PROV-001.
      if (normalizedUserRole === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM) {
        return next();
      }

      const rawMatch = rawAllowed.has(userRole);
      const canonicalMatch = normalizedUserRole
        ? canonicalAllowed.has(normalizedUserRole)
        : false;

      if (!rawMatch && !canonicalMatch) {
        logger.warn('Unauthorized role access attempt', {
          userId: req.user.id,
          userRole,
          normalizedUserRole,
          requiredRoles: allowedRoles,
          path: req.path,
        });
        throw new AuthorizationError(
          `Access denied. Required roles: ${allowedRoles.join(', ')}`,
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Predefined role middleware for common use cases
 * 
 * Provider roles (User model with accountType=provider):
 * - admin: System administrator
 * - reviewer: Document reviewer
 * - auditor: Field auditor
 * - scheduler: Schedule management
 * - accountant: Finance management
 * - inspector: Site inspector
 * - manager: Team manager
 * - super_admin: Full access
 * 
 * User Roles (from schema.prisma User):
 * - HEALTH_USER: Health user (legacy DB role value)
 * - REVIEWER_AUDITOR: Review and audit role
 * - SCHEDULER: Scheduling role
 * - ACCOUNTANT: Finance role
 * - ADMIN: Administrator
 * - SUPER_ADMIN: Super administrator
 */
const R = CANONICAL_ROLES;

// 2026-09-10 — รายชื่อพวกนี้เคยเขียนคำเป็นตัวอักษร ('auditor', 'scheduler') · requireRole
// normalize ทั้งสองฝั่งอยู่แล้ว การรีเนมจึงไม่ทำให้ประตูพัง แต่คำที่ปลดระวางแล้วไม่ควร
// เหลือเป็นคำสั่งของประตู — อ่านผ่านค่าคงที่ ประตูก็ย้ายตามคำศัพท์เองตลอดไป
const roleMiddleware = {
  // Admin only
  adminOnly: requireRole([R.SYSTEM_ADMIN_DTAM]),

  // Super Admin only (maps to admin canonical)
  superAdminOnly: requireRole([R.SYSTEM_ADMIN_DTAM]),

  // DTAM Provider (all provider provider types)
  providerOnly: requireRole([
    R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR,
    R.CERTIFICATE_APPROVER, R.DISPATCHER, R.FINANCE_OFFICER_PLATFORM,
  ]),

  // Document Reviewers (includes field inspectors who can also review)
  reviewerOnly: requireRole([R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR, R.SYSTEM_ADMIN_DTAM]),

  // Registrar (Document checker)
  registrarOnly: requireRole([R.DOCUMENT_REVIEWER, R.SYSTEM_ADMIN_DTAM]),

  // Finance provider — WRITE (the company holds the books; operator 2026-09-27
  // "กรมฯ ดูอย่างเดียว": finance_officer_dtam reads only)
  financeOnly: requireRole([R.FINANCE_OFFICER_PLATFORM, R.SYSTEM_ADMIN_DTAM]),

  // Finance provider — READ: both finance roles see the same data (operator 2026-09-11)
  financeReader: requireRole([R.FINANCE_OFFICER_PLATFORM, R.FINANCE_OFFICER_DTAM, R.SYSTEM_ADMIN_DTAM]),

  // Dispatcher — จ่ายงานและคุมคิว
  schedulerOnly: requireRole([R.DISPATCHER, R.SYSTEM_ADMIN_DTAM]),

  // Field inspector / document reviewer
  auditorOnly: requireRole([R.FIELD_INSPECTOR, R.DOCUMENT_REVIEWER, R.SYSTEM_ADMIN_DTAM]),

  // ผู้ตัดสินให้การรับรอง (ISO/IEC 17065 §7.6) — ผู้ตรวจหน้างานไม่อยู่ในรายชื่อนี้แล้ว
  // ตั้งแต่ F-CERT-SOD 2026-09-10 · ชื่อคีย์เดิมคงไว้เพราะผู้เรียกยังอ้างชื่อนี้อยู่
  headAuditorOnly: requireRole([R.CERTIFICATE_APPROVER, R.SYSTEM_ADMIN_DTAM]),

  // Health applicant (canonical)
  healthOnly: requireRole([R.HEALTH]),

  // Health or Provider (for viewing applications)
  healthOrProvider: requireRole([
    R.HEALTH, R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR,
    R.CERTIFICATE_APPROVER, R.DISPATCHER, R.FINANCE_OFFICER_PLATFORM,
  ]),
};

/**
 * Check if user has specific permission
 * @param {string} permission - Required permission
 * @returns {Function} Express middleware
 *
 * SUPERSEDED by requireEffectivePermission (below). This synchronous gate
 * reads `req.user.hasPermission`, which is never populated on the JWT-derived
 * req.user — so it always 403s (effectively dead). Left in place (not ripped
 * out) so any legacy caller keeps its exact behaviour; new gates should use
 * requireEffectivePermission, which computes role-baseline ∪ GRANT − REVOKE
 * live from the grants table.
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new AuthorizationError('Authentication required');
      }

      if (!req.user.hasPermission || !req.user.hasPermission(permission)) {
        logger.warn('Unauthorized permission access attempt', {
          userId: req.user.id,
          userRole: req.user.role,
          requiredPermission: permission,
          path: req.path,
        });
        throw new AuthorizationError(`Permission denied: ${permission}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Per-permission gate — the ERP GRANT/REVOKE-aware replacement for
 * requirePermission. Computes the user's EFFECTIVE permission set live per
 * request (role baseline ∪ GRANT − REVOKE, from user_permission_grants) so an
 * admin toggling a single permission takes effect on the very next request
 * without a re-login / session-epoch bump.
 *
 * Async: it does ONE grant read per request and caches the result on
 * `req._effectivePermissions`, so multiple gates in a single request cost a
 * single DB read. The read is fail-SAFE (see effective-permissions-service):
 * a grants-table outage falls back to the role baseline rather than locking
 * everyone out.
 *
 * Not wired into any live route yet (engine-only). Errors are surfaced via
 * next(err) so the express error handler maps AuthorizationError → 403,
 * matching requireRole / requirePermission.
 *
 * @param {string} permission - required permission (a PERMISSIONS value)
 * @returns {Function} async Express middleware
 */
const requireEffectivePermission = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw new AuthorizationError('Authentication required');
      }

      const role = req.user.canonicalRole || normalizeRole(req.user.role) || req.user.role;

      // Request-scoped cache: compute the effective set once per request even
      // if several gates run. Keyed defensively on userId so a hypothetical
      // re-auth mid-request can't serve a stale set.
      if (
        !req._effectivePermissions ||
        req._effectivePermissions.userId !== req.user.id
      ) {
        const result = await getEffectivePermissions({
          role,
          userId: req.user.id,
          prisma,
        });
        req._effectivePermissions = { userId: req.user.id, ...result };
      }

      if (!req._effectivePermissions.effectiveSet.has(permission)) {
        logger.warn('Unauthorized permission access attempt', {
          userId: req.user.id,
          userRole: req.user.role,
          requiredPermission: permission,
          path: req.path,
        });
        throw new AuthorizationError(`Permission denied: ${permission}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Check if user can access specific application
 * (Owner or assigned provider)
 */
const canAccessApplication = async (req, res, next) => {
  try {
    const { applicationId } = req.params;
    const userId = req.user.id;
    const userRole = normalizeRole(req.user.role);

    // Admin can access all
    if (userRole === 'admin') {
      return next();
    }

    // Provider roles can access all applications (they need to review/audit)
    if (isProviderRole(req.user.role)) {
      return next();
    }

    // Load application using Prisma — always scope to the user's organization
    // to enforce tenant boundary (prevents cross-tenant probing via applicationId).
    const userOrgId = req.user.organizationId || null;
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, userId: true, organizationId: true },
    });

    if (!application) {
      throw new AuthorizationError('Application not found');
    }

    // Tenant boundary check: if the requesting user has an organizationId and
    // the application belongs to a different organization, deny access.
    // (Users without organizationId — legacy/unassigned — skip this check.)
    if (userOrgId && application.organizationId && application.organizationId !== userOrgId) {
      throw new AuthorizationError('Application not found');
    }

    // Check if user is applicant (userId field in Application model)
    if (application.userId === userId) {
      return next();
    }

    throw new AuthorizationError('You do not have access to this application');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  requireRole,
  requirePermission,
  requireEffectivePermission,
  canAccessApplication,
  ...roleMiddleware,
};

