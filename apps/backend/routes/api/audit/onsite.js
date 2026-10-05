/**
 * Onsite Audit API — Iter 25 (B25-B), Iter V3 (V3-A /context handler).
 *
 * Endpoints the auditor's on-the-farm UI calls:
 *   GET  /api/audit/onsite/:auditId/context    — initial state for the inspect page
 *   POST /api/audit/onsite/:auditId/start      — open inspection + log GPS
 *   POST /api/audit/onsite/:auditId/checklist  — submit one or many checklist items
 *   POST /api/audit/onsite/:auditId/photo      — multipart upload, returns photoId + hash
 *   POST /api/audit/onsite/:auditId/decision   — PASS|FAIL|NEEDS_REVIEW + workflow transition
 *   GET  /api/audit/onsite/:auditId/gps-verify — verify auditor GPS vs farm coordinates
 *
 * RBAC: AUDIT_STAFF gate at the file level (defence in depth); the
 * mutation endpoints additionally narrow to AUDITORS so a scheduler
 * cannot file a decision on behalf of an auditor. The /context endpoint
 * keeps the file-level AUDIT_STAFF gate so a document reviewer or
 * scheduler can preview an audit's loaded state without being able to
 * mutate it.
 *
 * IMPORTANT (DI-1, fixed in V3-A): prior to V3-A this router was defined
 * on disk but NEVER mounted in routes/api/index.js. Every page load of
 * /provider/audits/[id]/inspect therefore 404'd silently. The mount is
 * now `router.use('/audit/onsite', require('./audit/onsite'))` in the
 * canonical index — do not forget to keep it.
 *
 * The service layer (audit-onsite-service.js) owns validation,
 * transitions, hashing, and notification fan-out. The route is a thin
 * adapter that maps multipart input to the service contract.
 */

'use strict';

const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const { authenticateProvider, requireRole } = require('../../../middleware/auth-middleware');
const { ROLE_GROUPS, CANONICAL_ROLES, normalizeRole } = require('../../../shared/canonical-rbac');
const onsiteService = require('../../../services/audit-onsite-service');
const prismaModule = require('../../../services/prisma-database');
const logger = require('../../../shared/logger');
const { resolveCurrentOnsiteAuditId } = require('../../../services/onsite-audit-resolver');
// F-G4-08, third door. See guardOnsitePhoto below.
const uploadContentGuard = require('../../../services/upload-content-guard');

const multer = (() => {
    try { return require('multer'); } catch (_e) { return null; }
})();
const { multipartLimits } = require('../../../shared/multipart-limits');

// 10 MB cap per photo (GACP-PRD §6.5 — farm photos typically 2-5 MB raw). The
// number lives in upload-content-guard so the limit multer aborts on and the
// limit the Thai refusal quotes cannot say different things.
//
// INPUT-VALIDATION-001: also whitelist the MIME type at the API boundary — a client
// can spoof the multipart Content-Type to store an executable/HTML blob otherwise
// (compensating nosniff/attachment headers exist downstream, but validate here too).
// This check is the cheap one and it is NOT the one that counts: a sender writes
// its own Content-Type, so `curl -F 'photo=@pixel.png;type=image/jpeg'` satisfies
// it. What the file actually is gets decided from the bytes, in guardOnsitePhoto.
const ALLOWED_PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const photoUpload = multer
    ? multer({
        storage: multer.memoryStorage(),
        // One photo. Each web client sends at most four text fields with it
        // (itemId, caption, gps, or gpsLat, gpsLng, capturedAt, caption). SECU-02.
        limits: multipartLimits({ fileSize: uploadContentGuard.MAX_ONSITE_PHOTO_BYTES, files: 1, fields: 20 }),
        fileFilter: (_req, file, cb) => {
            if (ALLOWED_PHOTO_MIME.has(file.mimetype)) { cb(null, true); return; }
            const e = new Error('Only JPEG/PNG/WebP image uploads are allowed');
            e.code = 'INVALID_FILE_TYPE';
            e.statusCode = 400;
            cb(e);
        },
    })
    : { single: () => (req, res, next) => next() };

const { setNoteDisclosure } = require('../../../services/audit-notes-disclosure');

const router = express.Router();

router.use(authenticateProvider, requireRole(ROLE_GROUPS.AUDIT_STAFF));

/**
 * Lazy prisma resolver (matches the audit-onsite-service.js pattern so
 * tests can inject a stub via jest.mock).
 */
function _resolvePrisma() {
    return prismaModule && prismaModule.prisma ? prismaModule.prisma : null;
}

/**
 * The inspection's REAL start marker, or null when the auditor has not
 * checked in yet.
 *
 * F-ONSITE-GPS-CHECKIN-UNREACHABLE (2026-08-19, Phase 0 C12 real walk): this
 * used to be `audit.createdAt` — but that row is created by the SCHEDULER
 * ASSIGN (audit-scheduling-service.js:565-583), not by the auditor starting,
 * so the field app treated every fresh audit as already started
 * (inspect/client-view.tsx:128 `setStage(startedAt ? 'checklist' : 'start')`),
 * skipped the GPS check-in, and then every photo upload was rejected for the
 * missing coordinates (uploadPhoto requires finite gpsLat/gpsLng) — leaving
 * the ≥5-photo evidence gate unsatisfiable through the UI.
 *
 * The only marker startInspection persists is the AUDIT_INSPECTION_START
 * GpsVerificationLog row (audit-onsite-service.js:473-487), and that model is
 * behind the same pilot-descope guard used there: when it is not provisioned,
 * nothing records a start, so the honest answer is null and the field app
 * (correctly) opens on its start screen every load.
 */
async function _resolveStartedAt(prisma, auditId) {
    if (typeof prisma?.gpsVerificationLog?.findFirst !== 'function') { return null; }
    const started = await prisma.gpsVerificationLog.findFirst({
        where: { entityType: 'AUDIT_INSPECTION_START', entityId: auditId },
        orderBy: { verifiedAt: 'asc' },
        select: { verifiedAt: true },
    });
    if (!started || !started.verifiedAt) { return null; }
    return started.verifiedAt instanceof Date ? started.verifiedAt.toISOString() : String(started.verifiedAt);
}

/**
 * Compose an applicant display name from the parent application's
 * formData. The two shapes that show up in production are:
 *   (a) formData.applicantName              (legacy single-string)
 *   (b) formData.applicantData.{firstName,lastName} (newer wizard)
 * The fallback "-" preserves the contract that the response always
 * includes a string for this field.
 */
function _composeApplicantName(formData) {
    if (!formData || typeof formData !== 'object') {return '-';}
    if (typeof formData.applicantName === 'string' && formData.applicantName.trim()) {
        return formData.applicantName.trim();
    }
    const applicant = formData.applicantData || formData.applicant || null;
    if (applicant && typeof applicant === 'object') {
        const first = (applicant.firstName || '').trim();
        const last = (applicant.lastName || '').trim();
        const combined = `${first} ${last}`.trim();
        if (combined) {return combined;}
    }
    return '-';
}

/**
 * Load an audit's saved checklist answers for resume. photoIds are derived
 * from the real FarmAuditPhoto.checklistItemId linkage — FarmAuditChecklistItem
 * has NO photoIds column (the pre-fix code read a non-existent scalar, which is
 * exactly what let B5 ship invisibly; see spec B10). Shared by both /context
 * routes so they can never diverge on this join.
 */
async function loadSavedAnswers(prisma, auditId) {
    if (!prisma?.farmAuditChecklistItem || typeof prisma.farmAuditChecklistItem.findMany !== 'function') {
        return [];
    }
    let rows = [];
    try {
        rows = await prisma.farmAuditChecklistItem.findMany({
            where: { auditId },
            orderBy: { recordedAt: 'asc' },
        });
    } catch (err) {
        logger.warn(`[onsite] loadSavedAnswers: item lookup failed for ${auditId}: ${err?.message}`);
        return [];
    }
    const photosByItem = new Map();
    if (prisma.farmAuditPhoto && typeof prisma.farmAuditPhoto.findMany === 'function') {
        try {
            const photos = await prisma.farmAuditPhoto.findMany({
                where: { auditId },
                select: { id: true, checklistItemId: true },
            });
            for (const p of photos) {
                if (!p.checklistItemId) { continue; }
                const list = photosByItem.get(p.checklistItemId) || [];
                list.push(p.id);
                photosByItem.set(p.checklistItemId, list);
            }
        } catch (err) {
            logger.warn(`[onsite] loadSavedAnswers: photo lookup failed for ${auditId}: ${err?.message}`);
        }
    }
    return (Array.isArray(rows) ? rows : []).map((row) => ({
        itemId: row.itemCode,
        response: row.response,
        notes: row.notes || null,
        photoIds: photosByItem.get(row.id) || [],
    }));
}

/**
 * GET /api/audit/onsite/:auditId/context
 *
 * Initial-state endpoint for the inspect page. The frontend
 * (InspectClient → AuditService.getOnsiteContext) calls this on page
 * load to render the StartScreen. Returns the audit metadata, the
 * canonical checklist template, and any previously-saved checklist
 * answers (so the auditor can resume an in-progress inspection).
 *
 * Permission: file-level AUDIT_STAFF gate is enough — preview is fine
 * for document reviewers; mutations are narrowed elsewhere.
 *
 * Scope correctness: auditor.auditorId must match req.user.id unless
 * the caller is ADMIN. Mirrors _ensureAuditorMatches() inside the
 * service so the GET path is as strict as the mutation paths.
 */
router.get('/:auditId/context', async (req, res) => {
    try {
        const { auditId } = req.params;
        const prisma = _resolvePrisma();

        // Defensive: tests + cold-start failures may yield a null client.
        // Surface that as 503 so the frontend retries rather than
        // pretending the audit doesn't exist.
        if (!prisma || !prisma.auditChecklist || typeof prisma.auditChecklist.findFirst !== 'function') {
            logger.warn(`[onsite] /context: prisma client unavailable for audit ${auditId}`);
            return res.status(503).json({
                success: false,
                error: 'Database unavailable',
                code: 'PRISMA_UNAVAILABLE',
            });
        }

        // IDOR-001: scope the lookup to the caller's tenant at the QUERY layer (not
        // post-fetch). Defense-in-depth — the tenant-prisma-extension already org-scopes
        // reads when TENANT_READ_ORG_SCOPE is on, but the gate belongs here too so it
        // doesn't depend on the flag. A cross-tenant auditId resolves to null → 404.
        const orgId = req.user?.organizationId || req.tenantContext?.organizationId || null;
        const audit = await prisma.auditChecklist.findFirst({
            where: orgId ? { id: auditId, organizationId: orgId } : { id: auditId },
            include: {
                application: {
                    select: {
                        id: true,
                        applicationNumber: true,
                        formData: true,
                    },
                },
            },
        });

        if (!audit) {
            return res.status(404).json({
                success: false,
                error: 'Audit not found',
                code: 'AUDIT_NOT_FOUND',
            });
        }

        // Scope check: AUDITOR may only see audits assigned to them.
        // ADMIN bypasses. Other AUDIT_STAFF roles (document_reviewer,
        // scheduler) reach this route via the file-level gate but are
        // not assigned auditors; we accept them here so they can preview.
        const callerCanonical = normalizeRole(req.user?.canonicalRole || req.user?.role);
        const isAdmin = callerCanonical === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM;
        const isAuditor = callerCanonical === CANONICAL_ROLES.FIELD_INSPECTOR;
        if (isAuditor && audit.auditorId && audit.auditorId !== req.user.id && !isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Audit is assigned to a different auditor',
                code: 'AUDIT_AUDITOR_MISMATCH',
            });
        }

        const formData = (audit.application && audit.application.formData && typeof audit.application.formData === 'object')
            ? audit.application.formData
            : {};
        const locationData = (formData.locationData && typeof formData.locationData === 'object')
            ? formData.locationData
            : (formData.location && typeof formData.location === 'object' ? formData.location : {});

        const farmAddress = typeof locationData.farmAddress === 'string'
            ? locationData.farmAddress
            : (typeof locationData.address === 'string' ? locationData.address : '');
        const farmLat = typeof locationData.latitude === 'number' ? locationData.latitude : undefined;
        const farmLng = typeof locationData.longitude === 'number' ? locationData.longitude : undefined;

        // Saved checklist answers — best-effort; the table may not exist
        // in the schema yet (audit-onsite-service.js references it as a
        // future model), so loadSavedAnswers guards each call internally.
        const savedAnswers = await loadSavedAnswers(prisma, auditId);

        // Map the canonical CHECKLIST_TEMPLATE_2026 into the field-app
        // shape the frontend expects (itemId/title/description/category/
        // required), so the inspect-page checklist screen can render
        // directly without an extra transform.
        const checklist = onsiteService.CHECKLIST_TEMPLATE_2026.map((item) => ({
            itemId: item.itemCode,
            title: item.prompt,
            description: item.prompt,
            category: item.section,
            required: item.isCritical === true,
        }));

        const startedAt = await _resolveStartedAt(prisma, auditId);

        return res.json({
            success: true,
            data: {
                audit: {
                    id: audit.id,
                    applicationId: audit.applicationId,
                    applicationNumber: audit.application?.applicationNumber || '-',
                    // PDPA-001 (§24/§27 need-to-know): only the assigned auditor (gated
                    // above) and admin need the applicant's name for the on-site visit.
                    // document_reviewer / scheduler reach this preview via the file-level
                    // gate but have no need-to-know → redact.
                    applicantName: (isAdmin || isAuditor) ? _composeApplicantName(formData) : null,
                    farmAddress: farmAddress || '',
                    farmLat,
                    farmLng,
                    scope: typeof formData.scope === 'string' ? formData.scope : undefined,
                },
                checklist,
                startedAt,
                savedAnswers,
            },
        });
    } catch (err) {
        logger.warn(`[onsite] /context failed: ${err?.message}`);
        return res.status(500).json({
            success: false,
            error: safeErrorMessage(err),
            code: err.code || 'ONSITE_CONTEXT_FAILED',
        });
    }
});

/**
 * GET /api/audit/onsite/application/:applicationId/context
 *
 * Explicit applicationId entry-point for the inspect page (the route param
 * [id] is the applicationId, NOT an auditId — do NOT overload /:auditId,
 * an applicationId landing in that slot is exactly the DI-class bug this
 * route exists to close). Resolves the current AuditChecklist via the
 * shared resolver (services/onsite-audit-resolver.js) and returns the
 * SAME shape as /:auditId/context, including the real audit.id the FE
 * uses for every subsequent write (spec Task 4/5).
 */
router.get('/application/:applicationId/context', async (req, res) => {
    try {
        const { applicationId } = req.params;
        const prisma = _resolvePrisma();
        if (!prisma || !prisma.auditChecklist || typeof prisma.auditChecklist.findFirst !== 'function') {
            logger.warn(`[onsite] /application/:id/context: prisma unavailable for app ${applicationId}`);
            return res.status(503).json({ success: false, error: 'Database unavailable', code: 'PRISMA_UNAVAILABLE' });
        }

        // Authorization here is BOTH checks together, not one primary + one backup:
        // (1) org match — passed into the resolver below as a hard WHERE filter
        // (services/onsite-audit-resolver.js), so a cross-org applicationId simply
        // resolves to no audit, for every role including ADMIN; and (2) the
        // auditorId-match check further down (ADMIN bypasses only THAT check).
        // Safe together because assignAuditor only ever assigns an auditor from the
        // scheduler's own org (audit-scheduling-service.js:458-472), so a validly
        // scheduled audit's auditorId is always inside the audit's own org already.
        const orgId = req.user?.organizationId || req.tenantContext?.organizationId || null;
        const auditId = await resolveCurrentOnsiteAuditId(prisma, applicationId, orgId ? { organizationId: orgId } : {});
        if (!auditId) {
            return res.status(404).json({ success: false, error: 'Audit not found', code: 'AUDIT_NOT_FOUND' });
        }

        const audit = await prisma.auditChecklist.findFirst({
            where: { id: auditId },
            include: { application: { select: { id: true, applicationNumber: true, formData: true } } },
        });
        if (!audit) {
            return res.status(404).json({ success: false, error: 'Audit not found', code: 'AUDIT_NOT_FOUND' });
        }

        const callerCanonical = normalizeRole(req.user?.canonicalRole || req.user?.role);
        const isAdmin = callerCanonical === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM;
        const isAuditor = callerCanonical === CANONICAL_ROLES.FIELD_INSPECTOR;
        if (isAuditor && audit.auditorId && audit.auditorId !== req.user.id && !isAdmin) {
            return res.status(403).json({ success: false, error: 'Audit is assigned to a different auditor', code: 'AUDIT_AUDITOR_MISMATCH' });
        }

        const formData = (audit.application && audit.application.formData && typeof audit.application.formData === 'object')
            ? audit.application.formData : {};
        const locationData = (formData.locationData && typeof formData.locationData === 'object')
            ? formData.locationData
            : (formData.location && typeof formData.location === 'object' ? formData.location : {});
        const farmAddress = typeof locationData.farmAddress === 'string'
            ? locationData.farmAddress
            : (typeof locationData.address === 'string' ? locationData.address : '');
        const farmLat = typeof locationData.latitude === 'number' ? locationData.latitude : undefined;
        const farmLng = typeof locationData.longitude === 'number' ? locationData.longitude : undefined;

        const checklist = onsiteService.CHECKLIST_TEMPLATE_2026.map((item) => ({
            itemId: item.itemCode,
            title: item.prompt,
            description: item.prompt,
            category: item.section,
            required: item.isCritical === true,
        }));
        const startedAt = await _resolveStartedAt(prisma, auditId); // real check-in marker, not the assign time (see _resolveStartedAt)
        const savedAnswers = await loadSavedAnswers(prisma, auditId);

        return res.json({
            success: true,
            data: {
                audit: {
                    id: audit.id,
                    applicationId: audit.applicationId,
                    applicationNumber: audit.application?.applicationNumber || '-',
                    applicantName: (isAdmin || isAuditor) ? _composeApplicantName(formData) : null,
                    farmAddress: farmAddress || '',
                    farmLat,
                    farmLng,
                    scope: typeof formData.scope === 'string' ? formData.scope : undefined,
                },
                checklist,
                startedAt,
                savedAnswers,
            },
        });
    } catch (err) {
        logger.warn(`[onsite] /application/:id/context failed: ${err?.message}`);
        return res.status(500).json({ success: false, error: safeErrorMessage(err), code: err.code || 'ONSITE_CONTEXT_FAILED' });
    }
});

/**
 * POST /api/audit/onsite/:auditId/start
 * Body: { gps: { latitude, longitude, accuracy?, capturedAt? } }
 * Returns the checklist template + the persisted gpsVerificationLog row.
 *
 * @swagger
 * /api/audit/onsite/{auditId}/start:
 *   post:
 *     tags: [Audits]
 *     summary: Begin an on-site audit inspection (AUDITOR role)
 *     description: Records the auditor's GPS at start time and returns the canonical checklist template. AUDITOR-scoped — only the assigned auditor (or ADMIN) may start.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: auditId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [gps]
 *             properties:
 *               gps:
 *                 type: object
 *                 required: [latitude, longitude]
 *                 properties:
 *                   latitude:
 *                     type: number
 *                   longitude:
 *                     type: number
 *                   accuracy:
 *                     type: number
 *                     nullable: true
 *                     description: Optional accuracy in metres
 *                   capturedAt:
 *                     type: string
 *                     nullable: true
 *                     description: Optional ISO-8601 timestamp when the device captured the fix
 *     responses:
 *       200:
 *         description: Inspection started; returns checklist + gpsVerificationLog row
 *       400:
 *         description: ONSITE_START_FAILED — validation rejection
 *       403:
 *         description: AUDIT_AUDITOR_MISMATCH — assigned auditor does not match caller
 *       404:
 *         description: AUDIT_NOT_FOUND
 *       409:
 *         description: AUDIT_STATUS_INVALID — audit not in startable state
 */
router.post('/:auditId/start', requireRole(ROLE_GROUPS.AUDITORS), async (req, res) => {
    try {
        const { auditId } = req.params;
        const gps = (req.body && typeof req.body.gps === 'object' && req.body.gps) ? req.body.gps : {};
        const gpsAccuracyRaw = gps.accuracy;

        const out = await onsiteService.startInspection({
            auditId,
            auditorId: req.user.id,
            gpsLat: Number(gps.latitude),
            gpsLng: Number(gps.longitude),
            gpsAccuracy: gpsAccuracyRaw !== undefined && gpsAccuracyRaw !== null ? Number(gpsAccuracyRaw) : null,
        });

        res.json({
            success: true,
            data: out,
        });
    } catch (err) {
        logger.warn(`[onsite] start failed: ${err.message}`);
        const status = err.code === 'AUDIT_NOT_FOUND' ? 404
            : err.code === 'AUDIT_STATUS_INVALID' ? 409
            : err.code === 'AUDIT_AUDITOR_MISMATCH' ? 403
            : 400;
        res.status(status).json({
            success: false,
            error: safeErrorMessage(err),
            code: err.code || 'ONSITE_START_FAILED',
        });
    }
});

/**
 * POST /api/audit/onsite/:auditId/checklist
 * Body: { items: [{ itemCode, response, notes?, photoIds? }, ...] }
 * Batch endpoint — each item is persisted via submitChecklistItem.
 */
router.post('/:auditId/checklist', requireRole(ROLE_GROUPS.AUDITORS), async (req, res) => {
    try {
        const { auditId } = req.params;
        const items = Array.isArray(req.body?.items) ? req.body.items : [];

        if (items.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'items array required',
                code: 'CHECKLIST_ITEMS_REQUIRED',
            });
        }

        const persisted = [];
        for (const item of items) {
            const row = await onsiteService.submitChecklistItem({
                auditId,
                itemCode: item.itemCode,
                response: item.response,
                notes: item.notes || null,
                photoIds: Array.isArray(item.photoIds) ? item.photoIds : [],
                actorId: req.user.id,
            });
            persisted.push(row);
        }

        res.json({
            success: true,
            data: persisted,
            count: persisted.length,
        });
    } catch (err) {
        logger.warn(`[onsite] checklist failed: ${err.message}`);
        const status = err.code === 'CHECKLIST_ITEM_UNKNOWN' ? 400
            : err.code === 'AUDIT_NOT_FOUND' ? 404
            : err.code === 'AUDIT_STATUS_INVALID' ? 409
            : 500;
        res.status(status).json({
            success: false,
            error: safeErrorMessage(err),
            code: err.code || 'ONSITE_CHECKLIST_FAILED',
        });
    }
});

/**
 * Receive the multipart body, and answer multer's own refusals properly.
 *
 * Both of multer's refusals used to reach Express's default error handler: an
 * oversize photo became an HTTP 500 carrying the English words "File too large",
 * and the fileFilter's own error became a 500 too despite carrying
 * statusCode 400. An auditor standing in a field reading "Internal Server Error"
 * cannot tell a broken server from a photo their phone shot too large. Both are
 * rules the auditor can act on, so both are answered in Thai, naming the cause
 * and the next action: the wrong type with 400 like every other refusal on this
 * door, the oversize photo with 413 FILE_TOO_LARGE like every multer size
 * refusal (middleware/request-limit-errors.js, which also answers the other
 * LIMIT_* refusals passed on below).
 *
 * Multer reports neither the original filename nor the real size for an aborted
 * write, which is why the guard module has a builder that needs neither.
 */
function receiveOnsitePhoto(req, res, next) {
    photoUpload.single('photo')(req, res, (err) => {
        if (!err) {
            return next();
        }
        const tooLarge = err.code === 'LIMIT_FILE_SIZE';
        const refusal = tooLarge
            ? uploadContentGuard.onsitePhotoTooLargeRefusal()
            : err.code === 'INVALID_FILE_TYPE'
                ? uploadContentGuard.onsitePhotoWrongDeclaredTypeRefusal()
                : null;
        if (!refusal) {
            return next(err);
        }
        return res.status(tooLarge ? 413 : 400).json({
            success: false,
            error: refusal.message,
            code: refusal.code,
            message: refusal.message,
        });
    });
}

/**
 * Read what is actually in the photo, before it becomes certificate evidence.
 *
 * F-G4-08, third door. The document slots accepted a 70-byte 1x1 PNG because
 * nothing looked at the file; this door was worse, because it checked only that
 * `req.file` existed at all. And what it feeds is not a reviewer's inbox but the
 * photo COUNT that assertOnsiteEvidenceSufficient uses to decide whether a
 * certificate may be minted (services/onsite-evidence-gate.js). Five pixels
 * satisfied a gate whose whole purpose is to prove an auditor stood on the farm.
 *
 * Same layers, same order, same fail-closed behaviour as the two document doors,
 * from the same shared module — see upload-content-guard's onsite photo section
 * for what this door accepts and where its size floor came from. The one
 * difference is plumbing: memoryStorage means there is no stored file, so there
 * is nothing to unlink after a refusal.
 *
 * Plus a FOURTH layer the document doors do not run (2026-08-26): the file has
 * to DECODE. The byte layers only read what a file's first bytes CLAIM, and five
 * buffers of FFD8FFE0 followed by random bytes claimed to be photographs
 * convincingly enough to answer MINT ALLOWED with photoCount=5. A decode failure
 * is a 400 in Thai like every other refusal here, not a 500 and not a pass:
 * inspectOnsitePhotoUpload catches the decoder's own errors and turns them into
 * a verdict, so the catch below stays what it always was, the last resort for an
 * unexpected throw.
 *
 * The Thai sentence goes in BOTH `error` and `message`: api-client reads `error`
 * for what it shows the user, so a caller must be told the cause and the next
 * action there too, not a bare code.
 */
async function guardOnsitePhoto(req, res, next) {
    if (!req.file) {
        // "No file at all" is the handler's own 400 (PHOTO_FILE_REQUIRED).
        return next();
    }
    try {
        const verdict = await uploadContentGuard.inspectOnsitePhotoUpload(req.file);
        if (!verdict.ok) {
            return res.status(400).json({
                success: false,
                error: verdict.message,
                code: verdict.code,
                message: verdict.message,
            });
        }
        return next();
    } catch (error) {
        // A guard that throws must not become a guard that passes: drop the
        // bytes and let the error handler answer, so no photo row is ever
        // created for a file nobody vouched for.
        req.file = null;
        return next(error);
    }
}

/**
 * POST /api/audit/onsite/:auditId/photo
 * multipart/form-data: photo=<file>, gps=<JSON string of
 *   {latitude,longitude,accuracy?,capturedAt?}>, itemId=<checklist itemCode>?,
 *   caption?
 * Returns: { photoId, url, fileHash }
 *
 * (Task 9 / fixes B7: previously read raw gpsLat/gpsLng fields the FE never
 * sent — Number(undefined) = NaN sailed past the old `typeof` guard — dropped
 * itemId entirely, and returned no viewable url, so every captured photo
 * rendered as a broken-image icon. See audit-service.uploadPhoto (FE) for the
 * matching gps/itemId contract this now implements — no FE change needed.)
 */
router.post('/:auditId/photo', requireRole(ROLE_GROUPS.AUDITORS), receiveOnsitePhoto, guardOnsitePhoto, async (req, res) => {
    try {
        const { auditId } = req.params;
        const rawGps = req.body?.gps;
        let gps = {};
        if (rawGps && typeof rawGps === 'object') { gps = rawGps; }
        else if (typeof rawGps === 'string') { try { gps = JSON.parse(rawGps) || {}; } catch (_e) { gps = {}; } }
        const { caption } = req.body || {};
        const itemId = req.body?.itemId || null;

        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                error: 'photo file required',
                code: 'PHOTO_FILE_REQUIRED',
            });
        }

        const out = await onsiteService.uploadPhoto({
            auditId,
            fileBuffer: req.file.buffer,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            gpsLat: Number(gps.latitude),
            gpsLng: Number(gps.longitude),
            capturedAt: gps.capturedAt || new Date(),
            caption: caption || null,
            checklistItemCode: itemId,
            uploadedBy: req.user.id,
            organizationId: req.user.organizationId,
        });

        res.json({
            success: true,
            data: {
                photoId: out.photoId,
                url: out.url,
                fileHash: out.fileHash,
            },
        });
    } catch (err) {
        logger.warn(`[onsite] photo upload failed: ${err.message}`);
        // Ruling 6b (Task 9): uploadPhoto throws NO_ONSITE_AUDIT with
        // statusCode 404 when the audit row doesn't exist — honor a thrown
        // 4xx statusCode the same way the /decision route already does
        // (below), instead of masking it as a blanket 500.
        const status = (err?.statusCode && err.statusCode < 500) ? err.statusCode : 500;
        res.status(status).json({
            success: false,
            error: safeErrorMessage(err),
            code: err.code || 'ONSITE_PHOTO_FAILED',
        });
    }
});

/**
 * GET /api/audit/onsite/:auditId/gps-verify?lat=&lng=
 * Returns: { withinTolerance, distanceMeters, farmLatitude, farmLongitude }
 */
/**
 * GET /:auditId/photo-provenance — what the platform already measured about each
 * audit photo, read back for the human who has to decide.
 *
 * Every onsite photo is stored with the haversine distance from the farm, the
 * capture-time window and a perceptual hash (capturePhotoProvenance). The service
 * that turns those columns into verdicts — reviewPhotoProvenance — was written,
 * tested in eight cases, exported… and called by nothing. Measured 2026-09-07:
 * zero call sites in routes/ or services/, so no person using this platform could
 * ever see the measurement. The evidence existed; the protection did not.
 *
 * Read-only, and it does NOT decide. Whether a photo taken beyond tolerance should
 * REFUSE the audit is the operator's call: a farm with no coordinates on file
 * measures as unknown, and turning unknown into a refusal would block honest
 * inspections of farms whose record is merely incomplete. What this door fixes is
 * narrower and certain — the numbers reach the people who certify.
 */
router.get('/:auditId/photo-provenance', requireRole(ROLE_GROUPS.AUDITORS), async (req, res) => {
    try {
        const { auditId } = req.params;
        const { tolerance } = req.query || {};

        const out = await onsiteService.reviewPhotoProvenance({
            auditId,
            ...(tolerance ? { toleranceMeters: Number(tolerance) } : {}),
        });

        res.json({ success: true, data: out });
    } catch (err) {
        logger.warn(`[onsite] photo-provenance failed: ${err.message}`);
        const status = err.code === 'ONSITE_NOT_AVAILABLE' ? 501
            : (err instanceof TypeError) ? 400
                : 500;
        res.status(status).json({
            success: false,
            error: safeErrorMessage(err),
            code: err.code || 'ONSITE_PHOTO_PROVENANCE_FAILED',
        });
    }
});

router.get('/:auditId/gps-verify', requireRole(ROLE_GROUPS.AUDITORS), async (req, res) => {
    try {
        const { auditId } = req.params;
        const { lat, lng, tolerance } = req.query || {};

        const out = await onsiteService.verifyGpsAgainstFarm({
            auditId,
            gpsLat: Number(lat),
            gpsLng: Number(lng),
            toleranceMeters: tolerance ? Number(tolerance) : undefined,
        });

        res.json({
            success: true,
            data: out,
        });
    } catch (err) {
        logger.warn(`[onsite] gps-verify failed: ${err.message}`);
        const status = err.code === 'AUDIT_NOT_FOUND' ? 404 : 500;
        res.status(status).json({
            success: false,
            error: safeErrorMessage(err),
            code: err.code || 'ONSITE_GPS_VERIFY_FAILED',
        });
    }
});

/**
 * POST /api/audit/onsite/:auditId/decision
 * Body: { decision: 'PASS'|'FAIL'|'NEEDS_REVIEW', summary?, criticalFindings? }
 *
 * @swagger
 * /api/audit/onsite/{auditId}/decision:
 *   post:
 *     tags: [Audits]
 *     summary: File the final on-site audit decision (AUDITOR role)
 *     description: Finalises the audit with PASS / FAIL / NEEDS_REVIEW and writes the workflow transition. Service-level guards enforce required-photo and complete-checklist preconditions.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: auditId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [PASS, FAIL, NEEDS_REVIEW]
 *               summary:
 *                 type: string
 *                 nullable: true
 *               criticalFindings:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Decision recorded; returns the persisted decision row + transition
 *       400:
 *         description: ONSITE_DECISION_FAILED — validation rejection
 *       404:
 *         description: AUDIT_NOT_FOUND
 *       409:
 *         description: AUDIT_STATUS_INVALID — audit not in decidable state
 *       422:
 *         description: INSUFFICIENT_PHOTOS or INCOMPLETE_CHECKLIST
 */
router.post('/:auditId/decision', requireRole(ROLE_GROUPS.AUDITORS), async (req, res) => {
    try {
        const { auditId } = req.params;
        const { decision, summary, criticalFindings } = req.body || {};

        const out = await onsiteService.submitDecision({
            auditId,
            decision,
            summary: summary || null,
            criticalFindings: Array.isArray(criticalFindings) ? criticalFindings : [],
            actorId: req.user.id,
            actorRole: req.user.canonicalRole || req.user.role || 'AUDITOR',
        });

        res.json({
            success: true,
            data: out,
        });
    } catch (err) {
        logger.warn(`[onsite] decision failed: ${err.message}`);
        // Bug 6.1: an illegal parent-application edge (from writeApplicationStatus'
        // assertTransition) means the app is already past the audit gate (e.g.
        // AUDIT_PASSED/APPROVED/CERTIFIED), so a re-PASS/FAIL would corrupt a
        // certified record — surface it as 422 INVALID_TRANSITION (mirror
        // /audits/:id/result), not the generic 400.
        const isIllegalTransition = /illegal transition/i.test(err?.message || '');
        const status = isIllegalTransition ? 422
            : err.code === 'INSUFFICIENT_PHOTOS' || err.code === 'INCOMPLETE_CHECKLIST' ? 422
            : err.code === 'AUDIT_NOT_FOUND' ? 404
            : err.code === 'AUDIT_STATUS_INVALID' ? 409
            // Carpet-bomb 2026-07-08: honor writer-thrown 4xx (EXPIRED-exit
            // fence = 409 WAIVER_REOPEN_REQUIRED) — mirror /audits/:id/result.
            : (err?.statusCode && err.statusCode < 500) ? err.statusCode
            : 400;
        res.status(status).json({
            success: false,
            error: safeErrorMessage(err),
            code: isIllegalTransition ? 'INVALID_TRANSITION' : (err.code || 'ONSITE_DECISION_FAILED'),
            ...(err.messageTh ? { messageTh: err.messageTh } : {}),
        });
    }
});

/**
 * PATCH /:auditId/checklist-items/:itemId/disclosure — PDPA ม.30 วรรคสอง.
 *
 * The applicant may read what was written about them (ม.30 วรรคหนึ่า, and the operator
 * ruled so on 2026-09-05). This is the exception the same section allows: a note that
 * would affect ANOTHER person's rights — a neighbour, an employee, a complainant — may be
 * withheld, and the controller has to be able to justify it. So the reason is required and
 * stored, and it is shown to the applicant beside the withheld row.
 *
 * Sits on this router, which already carries authenticateProvider + AUDIT_STAFF: the
 * people who may write these notes are the people who may judge whether one may be shown.
 */
router.patch('/:auditId/checklist-items/:itemId/disclosure', async (req, res) => {
    try {
        const { withheld, reason } = req.body || {};
        if (typeof withheld !== 'boolean') {
            return res.status(422).json({
                success: false,
                error: 'DISCLOSURE_STATE_REQUIRED',
                code: 'DISCLOSURE_STATE_REQUIRED',
                messageTh: 'ต้องระบุว่าจะไม่เปิดเผย (true) หรือเปิดเผย (false) — ไม่ใช่การสลับสถานะ',
            });
        }
        const updated = await setNoteDisclosure({
            prisma: _resolvePrisma(),
            itemId: req.params.itemId,
            auditId: req.params.auditId,
            withheld,
            reason,
            actorId: req.user?.id || null,
            actor: req.user,
        });
        return res.json({
            success: true,
            data: {
                id: updated.id,
                disclosureWithheld: updated.disclosureWithheld,
                withholdReason: updated.withholdReason || null,
            },
        });
    } catch (err) {
        const status = err?.statusCode && err.statusCode < 500 ? err.statusCode : 500;
        logger.warn(`[onsite] disclosure change failed: ${err.message}`);
        return res.status(status).json({
            success: false,
            error: err.code || 'DISCLOSURE_UPDATE_FAILED',
            code: err.code || 'DISCLOSURE_UPDATE_FAILED',
            messageTh: err.messageTh || null,
        });
    }
});

module.exports = router;
