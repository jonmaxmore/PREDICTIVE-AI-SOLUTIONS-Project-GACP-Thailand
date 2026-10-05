/**
 * Farm ownership middleware.
 * Ensures the authenticated health user may act on the farm referenced in
 * the request.
 *
 * Supports:
 *   - req.params.farmId
 *   - req.body.farmId
 *   - req.query.farmId
 *
 * Must be used AFTER authenticateHealth so that req.user is populated.
 *
 * Farm-worker Wave B (chunk 4): this middleware learns the workspace
 * dimension. Wave A widened every other cultivation guard to
 * owner-OR-ACTIVE-co-member but MISSED this one (site-analyses /
 * training-records were still strictly owner-pinned). Semantics now:
 *   - legacy owner (farm.ownerId === userId): passes, byte-identical
 *     fast-path (the employer — rule a).
 *   - reads (no `permission` option): ACTIVE co-member of the farm's
 *     entity passes via resolveFarmAccess (read-shaped, VIEWER included).
 *   - writes (`{ permission: 'RECORDS_MANAGE' }` etc.): the co-member's
 *     EFFECTIVE permission decides (role defaults ∪ legacy ∪ GRANT −
 *     REVOKE) → 403 ENTITY_PERMISSION_DENIED naming the permission.
 *   - non-member: the legacy 403 unchanged.
 */

const { prisma } = require('../services/prisma-database');
const { resolveFarmAccess } = require('../services/farm-access');
const { assertFarmActionPermission } = require('../services/entity-effective-permissions-service');
const logger = require('../shared/logger');

/**
 * Creates a middleware that verifies farm access.
 * @param {object} options
 * @param {string} [options.paramName='farmId'] - Name of the param/body/query field
 * @param {boolean} [options.optional=false] - If true, skip check when farmId is not present
 * @param {string} [options.permission] - Wave B: required effective entity
 *        permission for non-owner co-members (mutation call sites pass it,
 *        e.g. 'RECORDS_MANAGE'); reads omit it.
 * @returns {Function} Express middleware
 */
function requireFarmOwnership(options = {}) {
    const { paramName = 'farmId', optional = false, permission = null } = options;

    return async (req, res, next) => {
        try {
            const farmId =
                req.params[paramName] || req.body[paramName] || req.query[paramName];

            if (!farmId) {
                if (optional) {
                    return next();
                }
                return res.status(400).json({
                    success: false,
                    error: 'Farm ID is required',
                });
            }

            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required',
                });
            }

            // R1-legacy-pin: removed in Task 12 — the farm id decides, as pre-R1; the
            // holder fragment rides beside it so the read witness sees a scoped read.
            const { holderScope, r1HolderOrLegacyWhenScoped } = require('../services/holder-access');
            const farm = await prisma.farm.findUnique({
                where: {
                    id: farmId,
                    ...r1HolderOrLegacyWhenScoped(await holderScope(req), 'Farm', { id: farmId }),
                },
                // Farm ownership FK is `ownerId` (-> User.id); there is no `userId`
                // column. Selecting `userId` raised a PrismaClientValidationError in
                // this middleware (before any route catch) → blanket 500 on every
                // farm-scoped route (site-analyses, training-records, …).
                // Wave B adds `entityId` for the workspace co-member branch.
                select: { id: true, ownerId: true, entityId: true },
            });

            if (!farm) {
                return res.status(404).json({
                    success: false,
                    error: 'Farm not found',
                });
            }

            if (farm.ownerId === userId && !farm.entityId) {
                // Solo/legacy farm (no workspace dimension) — byte-identical
                // owner fast-path. Wave B fix M1: a WORKSPACE farm's creator
                // (ownerId stamped at create) must NOT be fast-pathed here —
                // the branches below re-check that their membership on the
                // farm's entity is still ACTIVE (a fired worker's REVOKE must
                // be enforceable on farms they created while employed).
                req.farm = farm;
                return next();
            }

            // Wave B — workspace co-member branch.
            if (permission) {
                try {
                    await assertFarmActionPermission({ farm, userId, permission });
                    req.farm = farm;
                    return next();
                } catch (permError) {
                    if (permError?.code === 'ENTITY_PERMISSION_DENIED') {
                        logger.warn(
                            `[farmOwnership] User ${userId} lacks ${permission} on farm ${farmId}`,
                        );
                        return res.status(403).json({
                            success: false,
                            code: 'ENTITY_PERMISSION_DENIED',
                            permission: permError.permission || permission,
                            error: 'คุณไม่มีสิทธิ์ดำเนินการรายการนี้ในพื้นที่ทำงาน',
                        });
                    }
                    throw permError;
                }
            }

            // Read-shaped: any ACTIVE co-member of the farm's entity may read.
            if (await resolveFarmAccess(farm, userId)) {
                req.farm = farm;
                return next();
            }

            logger.warn(
                `[farmOwnership] User ${userId} attempted to access farm ${farmId} owned by ${farm.ownerId}`,
            );
            return res.status(403).json({
                success: false,
                error: 'Access denied: you do not own this farm',
            });
        } catch (error) {
            logger.error('[farmOwnership] Error checking farm ownership:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to verify farm ownership',
            });
        }
    };
}

module.exports = { requireFarmOwnership };
