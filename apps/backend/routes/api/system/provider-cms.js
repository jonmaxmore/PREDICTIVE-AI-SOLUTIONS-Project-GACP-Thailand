const express = require('express');

const router = express.Router();

const PROVIDER_CMS_SUNSET = process.env.PROVIDER_CMS_SUNSET || 'Wed, 31 Dec 2026 23:59:59 GMT';
const ENABLE_PROVIDER_LEGACY_ALIAS = String(process.env.ENABLE_PROVIDER_LEGACY_ALIAS || 'false').trim().toLowerCase() === 'true';

const LEGACY_ROUTE_REWRITES = [
    {
        method: 'POST',
        legacy: /^\/applications\/([^/]+)\/workflow-transition\/?$/i,
        toCanonical: (id) => `/applications/${id}/workflow-transitions`,
    },
    {
        method: 'POST',
        legacy: /^\/applications\/([^/]+)\/expire-overdue-revision\/?$/i,
        toCanonical: (id) => `/applications/${id}/revision-expirations`,
    },
    {
        method: 'GET',
        legacy: /^\/applications\/([^/]+)\/audit-timeline\/?$/i,
        toCanonical: (id) => `/applications/${id}/audit-timelines`,
    },
    {
        method: 'POST',
        legacy: /^\/auditor\/applications\/([^/]+)\/start-inspection\/?$/i,
        toCanonical: (id) => `/auditor/applications/${id}/inspection-starts`,
    },
    {
        method: 'POST',
        legacy: /^\/auditor\/applications\/([^/]+)\/decision\/?$/i,
        toCanonical: (id) => `/auditor/applications/${id}/audit-decisions`,
    },
    {
        method: 'GET',
        legacy: /^\/audits\/schedule\/?$/i,
        toCanonical: () => '/scheduler/audits/schedules',
    },
    {
        method: 'POST',
        legacy: /^\/audits\/schedule\/?$/i,
        toCanonical: () => '/scheduler/audits/schedules',
    },
    {
        method: 'POST',
        legacy: /^\/revision\/reminder-run\/?$/i,
        toCanonical: () => '/admin/revision-reminder-runs',
    },
    {
        method: 'POST',
        legacy: /^\/batch-action\/?$/i,
        toCanonical: () => '/admin/batch-actions',
    },
];

const resolveCanonicalPath = (method, requestedPath) => {
    const normalizedMethod = String(method || '').toUpperCase();
    for (const mapping of LEGACY_ROUTE_REWRITES) {
        if (mapping.method !== normalizedMethod) {
            continue;
        }
        const match = requestedPath.match(mapping.legacy);
        if (match) {
            return mapping.toCanonical(...match.slice(1));
        }
    }
    return requestedPath;
};

let providerRouter = null;
const getProviderRouter = () => {
    if (!providerRouter) {
         
        providerRouter = require('../provider/index');
    }
    return providerRouter;
};

router.use((req, res, next) => {
    if (!ENABLE_PROVIDER_LEGACY_ALIAS) {
        const canonicalPath = resolveCanonicalPath(req.method, req.path);
        return res.status(404).json({
            success: false,
            error: 'Legacy provider route is disabled',
            canonicalPath: `/api/provider${canonicalPath}`,
        });
    }

    const canonicalPath = resolveCanonicalPath(req.method, req.path);
    const suffix = req.url.slice(req.path.length);
    req.url = `${canonicalPath}${suffix}`;

    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', PROVIDER_CMS_SUNSET);
    res.setHeader('Link', `</api/provider${canonicalPath}>; rel="successor-version"`);
    return next();
});

router.use((req, res, next) => getProviderRouter()(req, res, next));

module.exports = router;
