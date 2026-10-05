/**
 * Admin role guard middleware.
 * Must be used AFTER authenticateProvider so that req.user is populated.
 * Uses canonical-rbac normalizeRole() to handle legacy aliases.
 */

const { normalizeRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');
const logger = require('../shared/logger');

function requireAdmin(req, res, next) {
    const user = req.user;
    if (!user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required',
        });
    }

    const canonicalRole = normalizeRole(user.role);
    if (canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        logger.warn(
            `[requireAdmin] Access denied for user ${user.id} with role "${user.role}" (canonical: "${canonicalRole}") on ${req.method} ${req.originalUrl}`,
        );
        return res.status(403).json({
            success: false,
            error: 'Admin access required',
        });
    }

    next();
}

module.exports = { requireAdmin };
