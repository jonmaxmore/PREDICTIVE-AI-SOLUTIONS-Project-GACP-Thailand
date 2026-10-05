const { prisma } = require('../../../../services/prisma-database');
const { resolveUserIdFromHealthIdSecurely } = require('../../../../services/user-lookup-service');
const { authenticateProvider, requireRole } = require('../../../../middleware/auth-middleware');
const logger = require('../../../../shared/logger');
const {
    PERMISSIONS,
    ROLE_GROUPS,
    hasPermission,
    normalizeRole,
} = require('../../../../shared/canonical-rbac');

// Backward-compatible aliases — prefer ROLE_GROUPS directly in new code.
const PROVIDERRoles = ROLE_GROUPS.FULL_STAFF;
const adminRoles = ROLE_GROUPS.ADMIN_ONLY;

// Safe-coercion helpers — canonical source is shared/safe-coerce.js.
// Re-exported here for backward compatibility with existing callers.
const { safeInt, safeObject, safeArray, safeDate } = require('../../../../shared/safe-coerce');

const getApplicantName = (Applicant) => {
    const firstName = String(Applicant?.firstName || '').trim();
    const lastName = String(Applicant?.lastName || '').trim();
    const fullName = `${firstName} ${lastName}`.trim();
    return fullName || '-';
};

const resolveUserIdFromHealthId = async (healthId) => {
    return resolveUserIdFromHealthIdSecurely(healthId);
};

const requireCanonicalPermission = (permission) => (req, res, next) => {
    const canonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (!canonicalRole || !hasPermission(canonicalRole, permission)) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: `Permission required: ${permission}`,
            canonicalRole: canonicalRole || null,
        });
    }
    req.user.canonicalRole = canonicalRole;
    return next();
};

module.exports = {
    prisma,
    authenticateProvider,
    requireRole,
    logger,
    PERMISSIONS,
    normalizeRole,
    PROVIDERRoles,
    adminRoles,
    // Readable names (preferred)
    safeInt,
    safeObject,
    safeArray,
    safeDate,
    // Legacy aliases (backward compat)
    toInt: safeInt,
    obj: safeObject,
    arr: safeArray,
    dt: safeDate,
    getApplicantName,
    resolveUserIdFromHealthId,
    requireCanonicalPermission,
};
