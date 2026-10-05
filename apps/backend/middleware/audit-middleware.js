/**
 * Audit Trail Middleware
 * 
 * Automatically intercepts requests and logs them to the AuditLog database.
 * Ideal for wrapping Provider and Admin API routes.
 */

const { logFromRequest, ACTIONS, ENTITIES } = require('../services/audit-trail');
const logger = require('../shared/logger');

/**
 * Middleware to log API actions automatically
 * @param {Object} options Configuration options
 * @param {string} options.action The primary action type (e.g. VIEW, UPDATE)
 * @param {string} options.entityType The target resource (e.g. Application, Farm)
 */
function auditMiddleware({ action, entityType = ENTITIES.SYSTEM }) {
    return async (req, res, next) => {
        // Intercept response finish event to ensure we log successful or failed requests
        res.on('finish', async () => {
            try {
                // If it's a GET request and status is 200, it's a VIEW
                // If it's a POST/PUT/PATCH/DELETE, derive action from method if not explicitly provided
                let dynamicAction = action;
                if (!dynamicAction) {
                    switch (req.method) {
                        case 'GET': dynamicAction = ACTIONS.VIEW; break;
                        case 'POST': dynamicAction = ACTIONS.CREATE; break;
                        case 'PUT': 
                        case 'PATCH': dynamicAction = ACTIONS.UPDATE; break;
                        case 'DELETE': dynamicAction = ACTIONS.DELETE; break;
                        default: dynamicAction = 'SYSTEM_EVENT';
                    }
                }

                // Determine severity based on HTTP status code
                let severity = 'INFO';
                if (res.statusCode >= 400 && res.statusCode < 500) {severity = 'WARNING';}
                if (res.statusCode >= 500) {severity = 'ERROR';}

                // Try to extract entity ID from params (e.g., /api/applications/:id).
                // Guard req.params — on an unmatched route (provider 404) Express
                // can leave it undefined; `req.params.id` then threw, the row was
                // dropped, and the cause was hidden by the blank-splat log below.
                const entityId = req.params?.id || req.params?.uuid || req.body?.id || null;

                await logFromRequest(req, {
                    action: dynamicAction,
                    entityType,
                    entityId,
                    severity,
                    description: `API Request: ${req.method} ${req.originalUrl} - Status: ${res.statusCode}`,
                    metadata: {
                        method: req.method,
                        url: req.originalUrl,
                        statusCode: res.statusCode,
                        query: req.query,
                        // We avoid logging the whole body for security reasons
                        bodyKeys: req.body ? Object.keys(req.body) : [], 
                    },
                });
            } catch (error) {
                // Pass an object — winston simple() drops a trailing string splat,
                // which printed a BLANK cause and masked this failure (golden rule #3).
                logger.error('[AuditMiddleware] Failed to log action:', { error: error?.stack || error?.message });
            }
        });

        next();
    };
}

module.exports = {
    auditMiddleware,
};
