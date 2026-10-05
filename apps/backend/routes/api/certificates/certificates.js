/**
 * Certificate Routes for V2 API (Prisma Implementation)
 * GET /api/certificates/my - Get user's certificates
 */

const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
// Route-level Prisma access removed: every read now goes through
// certificate-service so ownership and soft-delete filters live in one place.
// See docs/tech-debt/prisma-bypass-routes.md for the broader rationale.
const authModule = require('../../../middleware/auth-middleware');
const certificateService = require('../../../services/certificate-service');
// Required lazily: holder-access loads the permission engine, which suites that
// stub entity-service cannot load.
const holderScopeOf = (req) => require('../../../services/holder-access').holderScope(req);
const entityService = require('../../../services/entity-service');
const pdfGenerator = require('../../../services/pdf/pdf-generator.service');
const logger = require('../../../shared/logger');
const { isProviderRole, normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { AREA_UNIT } = require('../../../shared/area-utils');
const { toCertificateSlug } = require('../../../services/certificate-number-display');

// C3 (tenant isolation, ADR-014): only PLATFORM_ADMIN may read across tenants.
// Every other provider role (ADMIN/AUDITOR/SCHEDULER/DOCUMENT_REVIEWER/ACCOUNT*)
// is bounded to its own organizationId — otherwise cert list/detail leaks every
// tenant's PII (farmName/applicantName/province/issuedBy).
function isCrossTenantRole(role) {
    return normalizeRole(role) === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM;
}

/**
 * F-G4-47: the display identity for an actor id stored on the row
 * (issuedBy / revokedBy). null when the row carries no actor; otherwise the
 * resolved { id, displayName } or — when the tenant-scoped lookup could not
 * match — { id, displayName: null } so the client still has the id to build
 * a short handle from.
 */
function staffIdentityFor(actorId, identities) {
    const key = String(actorId || '').trim();
    if (!key) { return null; }
    return identities[key] || { id: key, displayName: null };
}

// Safe middleware wrapper — use authenticateAny for dual-auth support
const authenticateAny = authModule.authenticateAny || ((req, res, next) => {
    if (typeof authModule.authenticateHealth === 'function') {
        return authModule.authenticateHealth(req, res, next);
    }
    return res.status(500).json({ error: 'Auth middleware not loaded' });
});

const authenticateHealth = (req, res, next) => {
    if (typeof authModule.authenticateHealth === 'function') {
        return authModule.authenticateHealth(req, res, next);
    }
    return res.status(500).json({ error: 'Auth middleware not loaded' });
};

// ── F-PDF-COLD-START-TIMEOUT retry budget (2026-08-20 review follow-up) ───
// nginx fronts every /api/* route — including this one — with
// `proxy_read_timeout 60s` and no override on the general catch-all
// (nginx/gacp.production.conf:157, inherited by the location block at
// nginx/gacp.production.conf:334-349). If our own cold-start retry (added
// below) ran longer than that with no cap, nginx would kill the connection
// and the caller would get an opaque 504 — WORSE than the single ~30-35s
// failure this route was fixed to retry around. These three constants keep
// the worst case (a cold first attempt + a bounded retry) safely inside
// that ceiling:
//   PDF_TOTAL_BUDGET_MS    — ceiling for the ENTIRE attempt sequence (first
//                            attempt + retry), well under nginx's 60s so
//                            there's still margin for network/TLS/response-
//                            write overhead on top.
//   PDF_ATTEMPT_TIMEOUT_MS — hard deadline for a SINGLE attempt. Even a
//                            Puppeteer launch that never resolves can only
//                            consume this much of the budget before we
//                            treat it ourselves as a (once-retryable)
//                            cold-start failure — see withAttemptDeadline().
//   PDF_RETRY_CUTOFF_MS    — only retry if the FIRST attempt failed within
//                            this much elapsed time. A first attempt that
//                            needed its own full PDF_ATTEMPT_TIMEOUT_MS just
//                            to fail is treated as too slow to be worth a
//                            second try inside PDF_TOTAL_BUDGET_MS — we
//                            return the failure immediately instead, which
//                            is NEVER worse than the pre-retry behaviour (a
//                            single failed attempt).
// NOTE: none of this touches Puppeteer's own global launch/setContent
// timeouts (pdf-generator.service.js) — those stay at puppeteer's 30s
// default for every OTHER PDF path (invoices, CAR reports, ...). This
// budget is scoped to THIS route only.
const PDF_TOTAL_BUDGET_MS = 50_000;
const PDF_ATTEMPT_TIMEOUT_MS = 25_000;
const PDF_RETRY_CUTOFF_MS = 20_000;

/**
 * Race a PDF-generation attempt against a hard per-attempt deadline so a
 * hung Puppeteer launch can't silently eat the whole PDF_TOTAL_BUDGET_MS.
 * `factory()` is invoked immediately; if it hasn't settled within `ms` this
 * resolves with a synthetic cold-start-class TimeoutError instead. The
 * underlying promise is given a noop `.catch()` up front so its EVENTUAL
 * (late) settlement — even a late rejection, arriving after we've already
 * moved on — can never surface as an unhandled promise rejection.
 */
function withAttemptDeadline(factory, ms, label) {
    const settlement = factory();
    settlement.catch(() => {}); // late settlement must never go unhandled
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const timeoutErr = new Error(`${label} exceeded the ${ms}ms attempt deadline`);
            timeoutErr.name = 'TimeoutError';
            reject(timeoutErr);
        }, ms);
        settlement.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (err) => { clearTimeout(timer); reject(err); },
        );
    });
}

/**
 * GET /api/certificates
 * Provider roles → list across the system (for review/audit).
 * Health user → list scoped to their own certificates only.
 *
 * NOTE: For *public* QR-based verification, use `/api/trace/...` endpoints
 * which intentionally expose verifiable certificate data without auth.
 *
 * @swagger
 * /api/certificates:
 *   get:
 *     tags: [Certificates]
 *     summary: List GACP certificates (scope depends on caller role)
 *     description: |
 *       Provider roles (ADMIN/SCHEDULER/REVIEWER/AUDITOR/ACCOUNT*) get the
 *       cross-tenant view (up to 100 rows). HEALTH applicants get a
 *       self-scoped view. For public QR verification use the
 *       /api/trace/* endpoints — those need no auth.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Returns the list of certificates with a count
 *       401:
 *         description: AUTH_ERROR — missing or invalid token
 *       500:
 *         description: Failed to fetch certificates
 */
router.get('/', authenticateAny, async (req, res) => {
    try {
        // Prefer the value auth-middleware already normalised; the raw column
        // is only a fallback for a token minted before canonicalRole existed.
        const userRole = req.user?.canonicalRole || req.user?.role;
        const userId = req.user?.id;
        const organizationId = req.user?.organizationId || null;
        const crossTenant = isCrossTenantRole(userRole);

        // Provider roles get the cross-tenant view; health users are scoped to
        // their own data. The service enforces the same where-clause shape so
        // a route bug cannot accidentally leak rows.
        // C3: a non-PLATFORM_ADMIN provider is bounded to its own org.
        let certificates;
        if (isProviderRole(userRole)) {
            certificates = await certificateService.listCertificates({
                scope: 'all',
                organizationId,
                crossTenant,
                take: 100,
            });
        } else {
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized',
                });
            }
            // Spec 2026-09-30 §3.1: the holder scope (R1: the service keeps the pre-R1
            // userId pin decisive — see certificate-service listCertificates).
            certificates = await certificateService.listCertificates({
                scope: 'self',
                userId,
                holderScope: await holderScopeOf(req),
                take: 100,
            });
        }

        res.json({
            success: true,
            count: certificates.length,
            data: certificates,
        });
    } catch (error) {
        logger.error('[Certificates] getAll error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch certificates',
        });
    }
});
router.get('/my', authenticateHealth, async (req, res) => {
    try {
        // Spec 2026-09-30 §3.1 — the holder scope (R1: the pre-R1 userId pin decides).
        const certificates = await certificateService.listCertificatesForUser(
            await holderScopeOf(req),
        );

        // Check expiry and format
        const now = new Date();
        const formattedCerts = certificates.map(cert => {
            let status = cert.status;
            // Certificate.status is stored lowercase ('active' — schema @default),
            // so the old `status === 'ACTIVE'` never matched and expired certs were
            // never relabeled in the applicant's list (audit 2.4 / case-mismatch).
            // The public verify endpoint already lowercases (line ~321) — match it.
            if (String(status).toLowerCase() === 'active' && cert.expiryDate && new Date(cert.expiryDate) < now) {
                status = 'EXPIRED';
            }

            // Extract unique crop names from certificate cropType
            const crops = cert.cropType ? [cert.cropType] : [];

            return {
                id: cert.id,
                certificateNumber: cert.certificateNumber,
                applicationId: cert.applicationId,
                farmId: cert.farmId,
                siteName: cert.farmName,
                plantType: cert.cropType,
                issuedDate: cert.issuedDate,
                expiryDate: cert.expiryDate,
                status: status,
                canonicalStatus: String(status || '').toLowerCase(),
                qrCode: cert.qrData,
                // Enhanced data for new UI (farm data stored inline on certificate)
                farm: cert.farmName ? {
                    name: cert.farmName,
                    province: cert.province,
                    district: cert.district,
                    subDistrict: cert.subDistrict,
                    location: [cert.district, cert.province].filter(Boolean).join(', '),
                    totalArea: cert.farmSize,
                    areaUnit: AREA_UNIT,
                } : null,
                crops,
                audit: null,
            };
        });

        res.json({
            success: true,
            data: formattedCerts,
        });
    } catch (error) {
        logger.error('[Certificates] getMy error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch certificates',
        });
    }
});

/**
 * GET /api/certificates/:id
 * Get certificate by ID.
 *
 * Provider roles (ADMIN/SCHEDULER/REVIEWER/AUDITOR/ACCOUNT*) get the
 * cross-tenant view via `findById` (no ownership filter — the route
 * itself is the gate). Health users continue through the ownership-
 * scoped `getCertificateForUser` path so the IDOR protection is
 * preserved for self-service callers.
 *
 * R7-A (2026-05-17): added provider branch so the new admin detail
 * page at /admin/certificates/[id] can fetch any certificate by id.
 * The list endpoint at line 41 uses the same `isProviderRole()` gate
 * — keeping both routes' gating in lockstep avoids the surprise where
 * ADMIN can list but not drill into a row.
 *
 * @swagger
 * /api/certificates/{id}:
 *   get:
 *     tags: [Certificates]
 *     summary: Fetch a single certificate by id (RBAC-aware)
 *     description: Provider roles get any certificate via findById; HEALTH users only see their own (IDOR-safe through service-layer ownership filter).
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Certificate detail with linked applicationNumber
 *       401:
 *         description: AUTH_ERROR — missing or invalid token
 *       404:
 *         description: Certificate not found (or HEALTH user is not the owner)
 *       500:
 *         description: Failed to fetch certificate
 */
router.get('/:id', authenticateAny, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        // Prefer the value auth-middleware already normalised; the raw column
        // is only a fallback for a token minted before canonicalRole existed.
        const userRole = req.user?.canonicalRole || req.user?.role;
        const organizationId = req.user?.organizationId || null;
        const crossTenant = isCrossTenantRole(userRole);

        let certificate;
        // F-G4-47: the provider (admin) branch also carries display
        // identities for issuedBy / revokedBy so the detail page never has
        // to print a raw User id. Stays null on the HEALTH branch.
        let staffIdentities = null;
        if (isProviderRole(userRole)) {
            // Provider view — soft-delete filter still applies in the service
            // layer; revoked certs are visible (REVOKED is a status, not a
            // delete). C3: a non-PLATFORM_ADMIN provider only sees its own
            // org's certs — a tenant-B id → null → 404 below (mirrors the IDOR
            // 404 for a HEALTH user). PLATFORM_ADMIN keeps the cross-tenant view.
            certificate = await certificateService.findById(id, {
                organizationId,
                crossTenant,
                include: {
                    application: { select: { id: true, applicationNumber: true } },
                },
            });
            if (certificate) {
                // Same tenant predicate as the row itself (organizationId +
                // crossTenant) — a read-only, display-projection lookup.
                staffIdentities = await certificateService.resolveStaffIdentities(
                    [certificate.issuedBy, certificate.revokedBy],
                    { organizationId, crossTenant },
                );
            }
        } else {
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized',
                });
            }
            // Ownership enforcement (the holder scope, and in R1 the filer pin) lives
            // inside the service so this route cannot drop it (the classic IDOR pattern).
            certificate = await certificateService.getCertificateForUser(id, await holderScopeOf(req), {
                include: {
                    application: { select: { applicationNumber: true } },
                },
            });
        }

        if (!certificate) {
            return res.status(404).json({
                success: false,
                error: 'Certificate not found',
            });
        }

        // Additive only: every column of the row stays; the provider branch
        // gains issuer / revoker as { id, displayName } (displayName null
        // when the lookup could not match — the screen then shows a role
        // label + short handle, never the uuid).
        const payload = staffIdentities
            ? {
                ...certificate,
                issuer: staffIdentityFor(certificate.issuedBy, staffIdentities),
                revoker: staffIdentityFor(certificate.revokedBy, staffIdentities),
            }
            : certificate;

        res.json({
            success: true,
            data: payload,
        });
    } catch (error) {
        logger.error('[Certificates] getById error:', error);
        res.status(500).json({
            success: false,
            error: safeErrorMessage(error),
        });
    }
});

/**
 * GET /api/certificates/:id/download
 * Download certificate as PDF
 */
router.get('/:id/download', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const scope = await holderScopeOf(req);

        // Verify ownership before allowing download — same IDOR guard as above,
        // but only selecting the columns we need to build the filename.
        const certificate = await certificateService.getCertificateForUser(id, scope, {
            select: { id: true, certificateNumber: true },
        });

        if (!certificate) {
            return res.status(404).json({
                success: false,
                error: 'Certificate not found or access denied',
            });
        }

        // Wave C PR-6 — capability gate. Downloading the cert PDF embeds
        // the QR code that drives /api/trace/* public verification, so it
        // is gated by PRINT_QR. Default permissions: OWNER, ADMIN, MANAGER
        // can print; VIEWER cannot.
        if (req.activeEntity?.role) {
            try {
                entityService.assertCapability(req.activeEntity.role, 'PRINT_QR');
            } catch (_capErr) {
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    code: 'CAPABILITY_DENIED',
                    capability: 'PRINT_QR',
                    role: req.activeEntity.role,
                });
            }
        }

        // F-PDF-COLD-START-TIMEOUT (evidence/phase0/FINDINGS.md:177-178):
        // the FIRST certificate PDF after a backend restart pays the
        // Puppeteer browser-launch cost inline and can trip puppeteer's own
        // 30s launch timeout (walk C15: attempt 1 = 503, attempts 2-4
        // succeeded once the browser was already warm). Boot now kicks off
        // a warm-up (server.js), but a request can still race a cold or
        // still-launching browser, so absorb exactly ONE such failure here
        // — by the retry, the singleton browser is already launched (or the
        // in-flight launch it shares has resolved). Genuine render/data
        // errors (bad template data, "Certificate not found") are NOT
        // retried — a second attempt would fail identically and only
        // double the caller's wait. Every attempt is bounded by
        // PDF_TOTAL_BUDGET_MS overall (see the constants above the routes)
        // so this can never run long enough for nginx's proxy_read_timeout
        // to fire an opaque 504 instead of us returning a clean failure.
        let pdfBuffer;
        const attempt1StartedAt = Date.now();
        try {
            pdfBuffer = await withAttemptDeadline(
                () => certificateService.getCertificatePdf(id, { holderScope: scope }),
                PDF_ATTEMPT_TIMEOUT_MS,
                'certificate PDF generation',
            );
        } catch (genErr) {
            const elapsedAfterAttempt1 = Date.now() - attempt1StartedAt;
            const coldStart = pdfGenerator.isColdStartError(genErr);
            const withinRetryCutoff = elapsedAfterAttempt1 < PDF_RETRY_CUTOFF_MS;

            if (!coldStart || !withinRetryCutoff) {
                if (coldStart && !withinRetryCutoff) {
                    logger.warn(
                        `[Certificates] PDF cold-start failure for id=${id} after ${elapsedAfterAttempt1}ms `
                        + `— no retry budget left (cutoff ${PDF_RETRY_CUTOFF_MS}ms), returning failure`,
                    );
                }
                throw genErr;
            }

            // Cap the retry to whatever's left of PDF_TOTAL_BUDGET_MS (never
            // more than PDF_ATTEMPT_TIMEOUT_MS) so the total sequence can
            // never exceed the route's overall budget, regardless of exactly
            // how long the first attempt took before failing.
            const remainingBudgetMs = PDF_TOTAL_BUDGET_MS - elapsedAfterAttempt1;
            const retryDeadlineMs = Math.min(PDF_ATTEMPT_TIMEOUT_MS, remainingBudgetMs);
            logger.warn(
                `[Certificates] PDF cold-start failure on first attempt for id=${id} after ${elapsedAfterAttempt1}ms `
                + `(${genErr.message}); retrying once with a ${retryDeadlineMs}ms budget`,
            );
            pdfBuffer = await withAttemptDeadline(
                () => certificateService.getCertificatePdf(id, { holderScope: scope }),
                retryDeadlineMs,
                'certificate PDF generation (retry)',
            );
        }

        // Use the user-recognisable certificate number for the filename
        // (GACP-Certificate-TH-GACP-87-2568.pdf; the slug, because the stored number holds a slash), not the internal cuid.
        const filenameSlug = toCertificateSlug(certificate.certificateNumber) || id;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="GACP-Certificate-${filenameSlug}.pdf"`);
        res.send(pdfBuffer);

    } catch (error) {
        logger.error('[Certificates] download error:', error);
        res.status(500).send('Error generating certificate PDF');
    }
});

// GET /api/certificates/verify/:certificateNumber was removed (round 3): a dead
// duplicate of /api/v1/public/verify with no caller, returning unmasked facts and
// no per-door limiter. The one public verify door is /api/v1/public/verify.

module.exports = router;
