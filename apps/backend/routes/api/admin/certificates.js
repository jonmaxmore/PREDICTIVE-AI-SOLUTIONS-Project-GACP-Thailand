/**
 * Admin certificate controls — the human-initiated revoke door and the
 * revision door (ฉบับแก้ไขภายใต้เลขเดิม, 2026-08-27).
 *
 * Mounted under /api/admin (routes/api/admin/index.js), so authenticateProvider
 * + requireAdmin (canonical ADMIN only) already ran before any handler here.
 *
 * ADMIN is a per-tenant role: this door always calls the service with the
 * caller's own organizationId and crossTenant:false. The service's ORG-GUARD
 * answers a cross-tenant or missing certificate with the same 404, so nothing
 * here can be used to probe another tenant's certificates. PLATFORM_ADMIN
 * cross-tenant revocation stays on the interoperability door.
 *
 * The heavy lifting (resolve by number/id, tenant wall, the already-revoked
 * refusal as an atomic conditional write, the status stamp, the
 * CERTIFICATE_REVOKED lifecycle audit) lives in
 * certificateService.revokeCertificate. This file only validates the body,
 * maps errors (404 / 400 / 409), and records the administrative act
 * (ADMIN_CERTIFICATE_REVOKED) the way admin/applications.js records its
 * overrides. It deliberately does NOT pre-check by row id: the service
 * resolves by certificateNumber first, so an id-only pre-read at the door was
 * bypassable by posting the number as :id, and a read-then-write pair here
 * could not close the concurrent double-press window anyway.
 *
 * The revision door (design note 2026-08-27-certificate-revision-design §4)
 * follows the same shape: the admin never types register values. The
 * corrected province / district / subDistrict / address come from the Farm
 * row through certificateService.previewCertificateRevision (read only) and
 * certificateService.reviseCertificateFromFarm (archive + re-sign, one
 * transaction). This file validates the free-text reason, maps the service's
 * catalogued refusals (shared/error-codes.js) to HTTP, and records the
 * administrative act (ADMIN_CERTIFICATE_REVISED). The free-text reason is
 * the archived revision's record and is never copied into the admin audit.
 */

const express = require('express');
const router = express.Router();
const logger = require('../../../shared/logger');
const { getRequestIp } = require('../../../utils/client-ip');
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
} = require('../../../middleware/audit-logger');
const certificateService = require('../../../services/certificate-service');
const { safeErrorMessage } = require('../../../shared/api-response');
const { lookup: lookupErrorCode } = require('../../../shared/error-codes');

const REVOCATION_REASON_MAX_LENGTH = 500;
const REVISION_REASON_MAX_LENGTH = 500;

const MESSAGES = Object.freeze({
    REASON_REQUIRED: 'ระบบยังไม่ได้รับเหตุผลการเพิกถอน กรุณาระบุเหตุผลก่อนที่คุณจะกดยืนยันการเพิกถอนอีกครั้ง',
    REASON_TOO_LONG: `เหตุผลการเพิกถอนยาวเกิน ${REVOCATION_REASON_MAX_LENGTH} ตัวอักษร กรุณาย่อเหตุผลให้สั้นลงแล้วกดยืนยันอีกครั้ง`,
    ALREADY_REVOKED: 'ใบรับรองนี้ถูกเพิกถอนไปแล้ว คุณไม่ต้องเพิกถอนซ้ำ กรุณาโหลดหน้านี้ใหม่เพื่อดูสถานะล่าสุด',
    NOT_FOUND: 'ไม่พบใบรับรองนี้ในหน่วยงานของคุณ กรุณาตรวจสอบเลขที่ใบรับรองแล้วลองใหม่อีกครั้ง',
    INVALID_REQUEST: 'คำขอเพิกถอนไม่ถูกต้อง กรุณาตรวจสอบข้อมูลที่คุณกรอกแล้วลองใหม่อีกครั้ง',
    SERVER_ERROR: 'ระบบไม่สามารถเพิกถอนใบรับรองได้ในขณะนี้ กรุณาลองใหม่อีกครั้งในอีกสักครู่',
    REVISE_SERVER_ERROR: 'ระบบไม่สามารถออกฉบับแก้ไขใบรับรองได้ในขณะนี้ กรุณาลองใหม่อีกครั้งในอีกสักครู่',
});

function toIso(value) {
    if (!value) { return null; }
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * POST /api/admin/certificates/:id/revoke
 * body: { reason: string }  (trimmed, 1..500 chars)
 *
 * 400 REVOCATION_REASON_REQUIRED / REVOCATION_REASON_TOO_LONG / INVALID_REVOCATION_REQUEST
 * 404 CERTIFICATE_NOT_FOUND  (missing OR another tenant's — indistinguishable by design)
 * 409 CERTIFICATE_ALREADY_REVOKED  (service statusCode 409: pre-read after the
 *     org-guard OR the conditional write matched no row — never a re-stamp)
 * 200 { success:true, data:{ id, certificateNumber, status, revokedAt, revokedBy, revokedReason } }
 */
router.post('/:id/revoke', async (req, res) => {
    const certificateId = String(req.params.id || '').trim();
    const rawReason = req.body?.reason;
    const reason = typeof rawReason === 'string' ? rawReason.trim() : '';

    if (!reason) {
        return res.status(400).json({
            success: false,
            error: 'REVOCATION_REASON_REQUIRED',
            message: MESSAGES.REASON_REQUIRED,
        });
    }
    if (reason.length > REVOCATION_REASON_MAX_LENGTH) {
        return res.status(400).json({
            success: false,
            error: 'REVOCATION_REASON_TOO_LONG',
            message: MESSAGES.REASON_TOO_LONG,
        });
    }

    const actorId = String(req.user?.id || 'SYSTEM');
    const callerOrganizationId = req.user?.organizationId || null;

    try {
        const updated = await certificateService.revokeCertificate(certificateId, {
            reason,
            actorId,
            callerOrganizationId,
            crossTenant: false,
        });

        // The administrative act, alongside the service's lifecycle row
        // (CERTIFICATE_REVOKED). Same category/severity/resource convention as
        // admin/applications.js. Metadata carries no personal data: the
        // certificate number and the reason LENGTH only. Best-effort: the
        // revocation is already committed, so a logging outage is reported in
        // the log, not turned into a misleading 500.
        try {
            await auditLogger.log({
                category: AuditCategory.ADMIN,
                action: 'ADMIN_CERTIFICATE_REVOKED',
                severity: AuditSeverity.WARNING,
                actorId,
                actorRole: req.user?.role || 'UNKNOWN',
                actorType: 'ADMIN',
                resourceType: ResourceType.CERTIFICATE,
                resourceId: updated.id,
                organizationId: updated.organizationId || callerOrganizationId,
                ipAddress: getRequestIp(req),
                userAgent: req.get('user-agent'),
                metadata: {
                    certificateNumber: updated.certificateNumber,
                    reasonLength: reason.length,
                },
            });
        } catch (auditError) {
            logger.warn('[admin/certificates] ADMIN_CERTIFICATE_REVOKED audit write failed:', auditError?.message);
        }

        return res.status(200).json({
            success: true,
            data: {
                id: updated.id,
                certificateNumber: updated.certificateNumber,
                status: updated.status,
                revokedAt: toIso(updated.revokedAt),
                revokedBy: updated.revokedBy || null,
                revokedReason: updated.revokedReason || null,
            },
        });
    } catch (error) {
        const statusCode = Number(error?.statusCode);
        if (statusCode === 404) {
            return res.status(404).json({
                success: false,
                error: 'CERTIFICATE_NOT_FOUND',
                message: safeErrorMessage(error, MESSAGES.NOT_FOUND),
            });
        }
        if (statusCode === 400) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_REVOCATION_REQUEST',
                message: safeErrorMessage(error, MESSAGES.INVALID_REQUEST),
            });
        }
        if (statusCode === 409) {
            return res.status(409).json({
                success: false,
                error: 'CERTIFICATE_ALREADY_REVOKED',
                message: MESSAGES.ALREADY_REVOKED,
            });
        }
        logger.error('[admin/certificates] revoke failed:', error?.message);
        return res.status(500).json({
            success: false,
            error: 'CERTIFICATE_REVOKE_FAILED',
            message: safeErrorMessage(error, MESSAGES.SERVER_ERROR),
        });
    }
});

// ── Revision door ──────────────────────────────────────────────────────────

/**
 * Answer with a catalogued refusal: the catalog row owns the HTTP status and
 * the Thai copy, so the door and the UI can never drift from each other.
 */
function catalogued(res, code, fallbackStatus, extra = {}) {
    const entry = lookupErrorCode(code);
    return res.status(entry?.httpStatus || fallbackStatus).json({
        success: false,
        error: code,
        message: entry?.messageTh || MESSAGES.REVISE_SERVER_ERROR,
        ...extra,
    });
}

/**
 * Map a service refusal from the revision path to HTTP.
 *   404                      → CERTIFICATE_NOT_FOUND (missing OR another tenant's)
 *   catalogued error.code    → the catalog's httpStatus + messageTh
 *                              (+ missingFields for CERTIFICATE_FARM_LOCATION_MISSING)
 *   anything else            → 500 CERTIFICATE_REVISE_FAILED through safeErrorMessage
 */
function revisionError(res, error) {
    const statusCode = Number(error?.statusCode);
    if (statusCode === 404) {
        return res.status(404).json({
            success: false,
            error: 'CERTIFICATE_NOT_FOUND',
            message: MESSAGES.NOT_FOUND,
        });
    }
    if (error?.code && lookupErrorCode(error.code)) {
        const extra = Array.isArray(error.missingFields) && error.missingFields.length
            ? { missingFields: error.missingFields }
            : {};
        return catalogued(res, error.code, statusCode || 500, extra);
    }
    logger.error('[admin/certificates] revise failed:', error?.message);
    return res.status(500).json({
        success: false,
        error: 'CERTIFICATE_REVISE_FAILED',
        message: safeErrorMessage(error, MESSAGES.REVISE_SERVER_ERROR),
    });
}

/**
 * GET /api/admin/certificates/:id/revise-location/preview
 *
 * Read only: runs the service's resolve + tenant wall + diff without writing,
 * so the UI can show the admin what the press would change.
 *
 * 200 { success:true, data:{ current:{province,district,subDistrict,address},
 *                            corrected:{...same 4 fields}, changed:string[] } }
 *     (a no-change preview is 200 with changed: [], never a 409)
 * 404 CERTIFICATE_NOT_FOUND · 409 CERTIFICATE_NOT_REVISABLE
 * 422 CERTIFICATE_FARM_LOCATION_MISSING (+ missingFields)
 */
router.get('/:id/revise-location/preview', async (req, res) => {
    const certificateId = String(req.params.id || '').trim();
    try {
        const data = await certificateService.previewCertificateRevision(certificateId, {
            callerOrganizationId: req.user?.organizationId || null,
            crossTenant: false,
        });
        return res.json({ success: true, data });
    } catch (error) {
        return revisionError(res, error);
    }
});

/**
 * POST /api/admin/certificates/:id/revise-location
 * body: { reason: string }  (trimmed, 1..500 chars)
 *
 * 400 REVISION_REASON_REQUIRED / REVISION_REASON_TOO_LONG (catalog rows)
 * 404 CERTIFICATE_NOT_FOUND
 * 409 CERTIFICATE_NOT_REVISABLE / CERTIFICATE_REVISION_NO_CHANGE / CERTIFICATE_REVISION_CONFLICT
 * 422 CERTIFICATE_FARM_LOCATION_MISSING (+ missingFields)
 * 503 CERT_SIGNING_UNAVAILABLE (nothing written)
 * 200 { success:true, data:{ id, certificateNumber, revisionNo, revisedAt, correctedFields } }
 */
router.post('/:id/revise-location', async (req, res) => {
    const certificateId = String(req.params.id || '').trim();
    const rawReason = req.body?.reason;
    const reason = typeof rawReason === 'string' ? rawReason.trim() : '';

    if (!reason) {
        return catalogued(res, 'REVISION_REASON_REQUIRED', 400);
    }
    if (reason.length > REVISION_REASON_MAX_LENGTH) {
        return catalogued(res, 'REVISION_REASON_TOO_LONG', 400);
    }

    const actorId = String(req.user?.id || 'SYSTEM');
    const callerOrganizationId = req.user?.organizationId || null;

    try {
        const { certificate, correctedFields } = await certificateService.reviseCertificateFromFarm(certificateId, {
            reason,
            actorId,
            callerOrganizationId,
            crossTenant: false,
        });

        // The administrative act, alongside the service's lifecycle row
        // (CERTIFICATE_REVISED). Metadata carries the register facts only:
        // certificate number, the new revision number, and which fields
        // moved. The free-text reason stays on the archived revision.
        // Best-effort: the revision is already committed, so a logging outage
        // is reported in the log, not turned into a misleading 500.
        try {
            await auditLogger.log({
                category: AuditCategory.ADMIN,
                action: 'ADMIN_CERTIFICATE_REVISED',
                severity: AuditSeverity.WARNING,
                actorId,
                actorRole: req.user?.role || 'UNKNOWN',
                actorType: 'ADMIN',
                resourceType: ResourceType.CERTIFICATE,
                resourceId: certificate.id,
                organizationId: certificate.organizationId || callerOrganizationId,
                ipAddress: getRequestIp(req),
                userAgent: req.get('user-agent'),
                metadata: {
                    certificateNumber: certificate.certificateNumber,
                    revisionNo: certificate.revisionNo,
                    correctedFields,
                },
            });
        } catch (auditError) {
            logger.warn('[admin/certificates] ADMIN_CERTIFICATE_REVISED audit write failed:', auditError?.message);
        }

        return res.status(200).json({
            success: true,
            data: {
                id: certificate.id,
                certificateNumber: certificate.certificateNumber,
                revisionNo: certificate.revisionNo,
                revisedAt: toIso(certificate.revisedAt),
                correctedFields,
            },
        });
    } catch (error) {
        return revisionError(res, error);
    }
});

module.exports = router;
