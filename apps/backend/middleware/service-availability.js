const prismaDatabase = require('../services/prisma-database');

/**
 * Service Availability Middleware
 * Returns 503 if the database is not connected.
 */
module.exports = (req, res, next) => {
    // Skip for health checks (so allow checks to see status)
    if (req.path === '/health' || req.path === '/api/health') {
        return next();
    }

    if (!prismaDatabase.getStatus()) {
        return res.status(503).json({
            success: false,
            error: 'Service Unavailable',
            message: 'Database connection is initializing. Please try again shortly.',
            timestamp: new Date().toISOString(),
        });
    }

    next();
};
