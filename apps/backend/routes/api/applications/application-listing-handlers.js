/**
 * Application Listing & Tracking Routes
 * Extracted from applications.js for readability.
 *
 * Routes: GET /, GET /my, GET /my/statuses, GET /:id/status, GET /:id/history
 *
 * @module routes/api/applications/application-listing-handlers
 */

const express = require('express');
const router = express.Router();
const applicationService = require('../../../services/application-service');
const { authenticateAny: authenticateHealth } = require('../../../middleware/auth-middleware');
const { prisma } = require('../../../services/prisma-database');
const logger = require('../../../shared/logger');
// X1-FIX-A / C-5 — canonical role table for the provider-side branch
// on `GET /api/applications/`. Pre-X1 the provider branch returned the
// first 100 applications system-wide to ANY token with no healthId, with
// zero requireRole gate. A leaked / malformed JWT could quietly walk away
// with the system-wide cross-tenant view (X1-D §4 H-2). The new gate
// uses normalizeRole + isProviderRole + an explicit allow-list, mirroring
// the matrix in canonical-rbac.js ROLE_GROUPS.ALL_PROVIDER.
const { normalizeRole, isProviderRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const {
    mapHealthApplication,
    mapMyApplication,
    getHealthScopeOptions,
} = require('../helpers/applications-helpers');
const {
    _asObject,
    isMissingApplicationCommentsTableError,
} = require('../helpers/application-constants');
const {
    buildApplicationHistoryPayload,
    buildTrackingPayload,
} = require('../helpers/application-payload-builders');
const { respondError } = require('../../../shared/api-response');
// Spec 2026-09-30 §3.1: every health read spreads the holder fragment, called
// inside the handler (after authentication and the active-entity middleware).
const { holderScope, r1HolderOrLegacy, r1ApplicationHolderOrPin } = require('../../../services/holder-access'); // R1-legacy-pin: removed in Task 12

// R1-legacy-pin: removed in Task 12. Adds one AND member beside the pin's own AND.
function withAndMember(where, member) {
    const and = where.AND === undefined ? [] : [].concat(where.AND);
    return { ...where, AND: [...and, member] };
}

// LISTING & TRACKING

// X1-FIX-A / C-5 — explicit provider-role allow-list for the system-wide
// branch of `GET /api/applications/`. Pre-X1 any caller without a
// healthId (e.g. provider tokens with a non-canonical role string, or a
// HEALTH token that lost its healthId claim) hit the unconditional
// `findMany` and walked away with the first 100 applications across
// every tenant. We now require the caller's role to canonicalise to a
// known provider role; HEALTH is blocked by definition because HEALTH is
// not in PROVIDER_CANONICAL_ROLES (canonical-rbac.js:219-229).
const PROVIDER_LISTING_ROLES = new Set([
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.DOCUMENT_REVIEWER,
    CANONICAL_ROLES.FIELD_INSPECTOR,
    CANONICAL_ROLES.DISPATCHER,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]);

router.get('/', authenticateHealth, async (req, res) => {
    try {
        const hasHealthId = String(req.user?.healthId || '').trim();
        if (!hasHealthId) {
            // Provider branch — system-wide listing. Gate on canonical
            // provider role to close X1-D §4 H-2: a non-canonical token
            // with no healthId previously fell through to the unfiltered
            // findMany. HEALTH role MUST never reach this branch (it's
            // blocked by the canonical role check below in addition to
            // the missing-healthId guard above).
            const canonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
            if (
                !canonicalRole
                || !isProviderRole(canonicalRole)
                || !PROVIDER_LISTING_ROLES.has(canonicalRole)
            ) {
                logger.warn('[Applications List] Provider-branch access denied', {
                    userId: req.user?.id,
                    canonicalRole,
                });
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    code: 'PROVIDER_ROLE_REQUIRED',
                });
            }
            const allApps = await prisma.application.findMany({
                where: { isDeleted: false },
                orderBy: { createdAt: 'desc' },
                take: 100,
                include: { certificates: { select: { id: true } } },
            });
            return res.json({ success: true, data: allApps.map(mapHealthApplication), viewType: 'provider' });
        }
        // R1-legacy-pin: removed in Task 12 — getHealthScopeOptions feeds the pre-R1 where.
        const applications = await applicationService.getHealthApplications(req.user.id, { ...getHealthScopeOptions(req.user), holderScope: await holderScope(req) });
        res.json({ success: true, data: applications.map(mapHealthApplication) });
    } catch (error) {
        logger.error('[Applications List] Error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch list' });
    }
});

router.get('/my', authenticateHealth, async (req, res) => {
    try {
        if (!String(req.user?.healthId || '').trim()) { return res.status(403).json({ success: false, error: 'Health healthId is required' }); }
        const limit = Number.parseInt(String(req.query.limit || ''), 10);
        // R1-legacy-pin: removed in Task 12 — getHealthScopeOptions feeds the pre-R1 where.
        const scopeOptions = getHealthScopeOptions(req.user);
        const applications = await applicationService.getHealthApplications(req.user.id, { take: Number.isFinite(limit) && limit > 0 ? limit : undefined, ...scopeOptions, holderScope: await holderScope(req) });
        res.json({
            success: true,
            // round 4: no `fees` — see applications-helpers.mapMyApplication
            data: applications.map(mapMyApplication),
        });
    } catch (error) {
        logger.error('[Applications My] Error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch applications' });
    }
});

router.get('/my/statuses', authenticateHealth, async (req, res) => {
    try {
        if (!String(req.user?.healthId || '').trim()) { return res.status(403).json({ success: false, error: 'Health healthId is required' }); }
        const identity = await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
        const limit = Number.parseInt(String(req.query.limit || ''), 10);
        const take = Number.isFinite(limit) && limit > 0 ? limit : undefined;

        const applications = await prisma.application.findMany({
            where: {
                // R1-legacy-pin: removed in Task 12 (→ ...holderReadWhere(await holderScope(req), 'Application')).
                // OR form: neutral also when no entity context is bound (final review C1).
                ...r1ApplicationHolderOrPin(await holderScope(req), { healthId: identity.healthId }),
                isDeleted: false,
            },
            orderBy: { createdAt: 'desc' },
            ...(take ? { take } : {}),
            select: { id: true, applicationNumber: true, status: true, phase1Status: true, phase2Status: true, formData: true },
        });

        const now = new Date();
        return res.json({ success: true, data: applications.map((app) => buildTrackingPayload(app, { now })) });
    } catch (error) {
        logger.error('[Applications My Statuses] Error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch application statuses' });
    }
});

router.get('/:id/status', authenticateHealth, async (req, res) => {
    try {
        const identity = await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
        const idOrNumber = String(req.params.id || '').trim();
        const application = await prisma.application.findFirst({
            where: {
                // R1-legacy-pin: removed in Task 12 (→ OR: [id, applicationNumber],
                // ...holderReadWhere(await holderScope(req), 'Application')).
                // The holder OR takes the top-level OR key, so the id-or-number OR sits in AND
                // beside the pin. OR form: neutral also when no entity context is bound (final review C1).
                ...withAndMember(
                    r1ApplicationHolderOrPin(await holderScope(req), { healthId: identity.healthId }),
                    { OR: [{ id: idOrNumber }, { applicationNumber: idOrNumber }] },
                ),
                isDeleted: false,
            },
            select: { id: true, applicationNumber: true, status: true, phase1Status: true, phase2Status: true, formData: true },
        });

        if (!application) { return res.status(404).json({ success: false, error: 'Application not found' }); }
        return res.json({ success: true, data: buildTrackingPayload(application, { now: new Date() }) });
    } catch (error) {
        logger.error('[Applications Tracking Status] Error:', error);
        return respondError(res, req, error, { message: 'Failed to load application status' });
    }
});

// B20-D (customer-statement, 2026-05-16): applicant-facing customer
// statement for ONE application. The application's holder must be in the
// caller's holder scope (spec 2026-09-30 §3.1), like the rest of this
// listing handler. The statement returns the same
// shape as the finance-team endpoint but unfiltered (applicant sees
// BOTH sides of their own bill — DTAM state fee + PLATFORM service fee
// — because they paid for both).
router.get('/:applicationId/statement', authenticateHealth, async (req, res) => {
    try {
        const identity = await applicationService.resolveHealthIdentity(
            req.user.id,
            getHealthScopeOptions(req.user),
        );
        const applicationId = String(req.params.applicationId || '').trim();
        if (!applicationId) {
            return res.status(400).json({ success: false, error: 'applicationId required' });
        }
        // Ownership guard — confirm this application's holder is in the
        // caller's scope before we hand the statement to them. Verifying
        // here first means the audit trail records a clean 404 for
        // cross-applicant attempts.
        const scope = await holderScope(req);
        // R1-legacy-pin: removed in Task 12 (→ const applicationWhere = holderReadWhere(scope,
        // 'Application'), used for this read too). The statement service reads the filing this
        // gate resolved, so its legacy branch is the id. OR form: neutral also when no entity
        // context is bound (final review C1).
        const applicationWhere = r1HolderOrLegacy(scope, 'Application', { id: applicationId });
        const application = await prisma.application.findFirst({
            where: {
                id: applicationId,
                ...r1ApplicationHolderOrPin(scope, { healthId: identity.healthId }),
                isDeleted: false,
            },
            select: { id: true, organizationId: true },
        });
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        const customerStatementService = require('../../../services/customer-statement-service');
        const statement = await customerStatementService.generateApplicationStatement({
            applicationId: application.id,
            organizationId: application.organizationId,
            applicationWhere,
            holderScope: scope,
        });
        return res.json({ success: true, data: statement });
    } catch (error) {
        if (error.code === 'NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        logger.error('[Application Statement] Error:', error?.message);
        return respondError(res, req, error, { message: 'Failed to load application statement' });
    }
});

router.get('/:id/history', authenticateHealth, async (req, res) => {
    try {
        const identity = await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
        const where = {
            id: req.params.id,
            // R1-legacy-pin: removed in Task 12 (→ ...holderReadWhere(await holderScope(req), 'Application')).
            // OR form: neutral also when no entity context is bound (final review C1).
            ...r1ApplicationHolderOrPin(await holderScope(req), { healthId: identity.healthId }),
            isDeleted: false,
        };
        let application;
        try {
            // P1-G leak-guard: applicant history must never include internal
            // staff notes (ApplicationComment.internalOnly) — see the identical
            // guard on GET /:id in application-workflow-handlers.js.
            application = await prisma.application.findFirst({ where, include: { comments: { where: { internalOnly: false }, orderBy: { createdAt: 'asc' } } } });
        } catch (error) {
            if (!isMissingApplicationCommentsTableError(error)) { throw error; }
            logger.warn('[Applications History] application_comments table missing; fallback without comments');
            application = await prisma.application.findFirst({ where });
            if (application) { application.comments = []; }
        }
        if (!application) { return res.status(404).json({ success: false, error: 'Application not found' }); }
        return res.json({ success: true, data: buildApplicationHistoryPayload(application) });
    } catch (error) {
        logger.error('[Applications History] Error:', error);
        return respondError(res, req, error, { message: 'Failed to load application history' });
    }
});

module.exports = router;
