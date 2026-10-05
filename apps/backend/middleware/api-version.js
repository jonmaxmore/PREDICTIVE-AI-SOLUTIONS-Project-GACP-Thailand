/**
 * API Versioning Middleware
 * รองรับ versioning ทั้งแบบ URL prefix และ header
 *
 * Usage:
 *   - URL:    /api/v1/health → req.apiVersion = '1'
 *   - Header: X-API-Version: 2 → req.apiVersion = '2'
 *   - Default: req.apiVersion = '1'
 *
 * Response header X-API-Version จะถูกเพิ่มทุก request
 *
 * @version 1.0.0
 */

const CURRENT_VERSION = '1';
const SUPPORTED_VERSIONS = ['1'];

/**
 * Global middleware — sets req.apiVersion and adds response header
 */
function apiVersionMiddleware(req, res, next) {
    // 1. Check URL prefix  /api/v{N}/...
    const versionMatch = req.path.match(/^\/api\/v(\d+)\//);
    if (versionMatch) {
        req.apiVersion = versionMatch[1];
    }
    // 2. Check header
    else if (req.headers['x-api-version']) {
        req.apiVersion = String(req.headers['x-api-version']).trim();
    }
    // 3. Default
    else {
        req.apiVersion = CURRENT_VERSION;
    }

    // Add response header
    res.setHeader('X-API-Version', req.apiVersion);
    res.setHeader('X-API-Supported-Versions', SUPPORTED_VERSIONS.join(','));

    next();
}

/**
 * Version-check middleware — reject unsupported versions
 * Usage: router.use(requireVersion('1'))
 */
function requireVersion(...versions) {
    return (req, res, next) => {
        if (!versions.includes(req.apiVersion)) {
            return res.status(400).json({
                success: false,
                error: `API version ${req.apiVersion} is not supported for this endpoint`,
                supportedVersions: versions,
            });
        }
        next();
    };
}

/**
 * Route-level deprecation warning
 * Usage: router.use(deprecateEndpoint('Use /api/v2/health instead'))
 */
function deprecateEndpoint(alternativeMessage) {
    return (req, res, next) => {
        res.setHeader('Deprecation', 'true');
        if (alternativeMessage) {
            res.setHeader('Sunset', alternativeMessage);
        }
        next();
    };
}

module.exports = {
    apiVersionMiddleware,
    requireVersion,
    deprecateEndpoint,
    CURRENT_VERSION,
    SUPPORTED_VERSIONS,
};
