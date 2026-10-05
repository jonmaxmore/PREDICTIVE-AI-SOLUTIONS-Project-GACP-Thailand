/**
 * Report Submission Routes
 * Monthly reports required by certificate holders (ภ.ท.27, ภ.ท.28, etc.)
 *
 * GET    /api/report-submissions              - List user's report submissions
 * GET    /api/report-submissions/schedule      - Get report schedule for active certificates
 * GET    /api/report-submissions/:id           - Get single report
 * POST   /api/report-submissions               - Create/submit a report
 * PUT    /api/report-submissions/:id           - Update draft report
 * DELETE /api/report-submissions/:id           - Soft delete draft report
 *
 * Batch 15 prisma-bypass cleanup (2026-05-16): all direct prisma reads
 * of `ReportSubmission`, `Certificate` for owner-side endpoints moved
 * into `document-service`. The `prisma` import is retained ONLY as the
 * transaction handle threaded into `attachmentService.attach/detach/
 * listForResource` — same exception pattern as
 * `applications/applications-car.js` (batch 9) and
 * `audit/post-audit.js` (batch 13).
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../../../services/prisma-database');
const documentService = require('../../../services/document-service');
// Required lazily: holder-access loads the permission engine, which suites that
// stub entity-service cannot load.
const holderScopeOf = (req) => require('../../../services/holder-access').holderScope(req);
const authModule = require('../../../middleware/auth-middleware');
const attachmentService = require('../../../services/attachment-service');
const logger = require('../../../shared/logger');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { getZonedParts } = require('../../../utils/working-days');

// PENTEST B2 (Low) — reviewing a certificate holder's compliance report is a
// staff decision; restrict PUT /:id/review to the reviewer/auditor/admin set
// rather than any authenticated provider (least-privilege / API5:2023).
const REPORT_REVIEWER_ROLES = new Set([
    CANONICAL_ROLES.DOCUMENT_REVIEWER,
    CANONICAL_ROLES.FIELD_INSPECTOR,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
]);

/**
 * Wave A Phase 34 — derive a display name for an Attachment row from a
 * stored URL/path. Same helper shape as payment-slip-service.
 */
function extractFileName(fileUrl) {
    if (!fileUrl) {
        return 'unknown';
    }
    const parts = String(fileUrl).split(/[\\/]/);
    return parts[parts.length - 1] || 'unknown';
}

const authenticateHealth = (req, res, next) => {
    if (typeof authModule.authenticateHealth === 'function') {
        return authModule.authenticateHealth(req, res, next);
    }
    return res.status(500).json({ error: 'Auth middleware not loaded' });
};

const authenticatePROVIDER = (req, res, next) => {
    if (typeof authModule.authenticateProvider === 'function') {
        return authModule.authenticateProvider(req, res, next);
    }
    return res.status(500).json({ error: 'Auth middleware not loaded' });
};

// ── Report Type Definitions ───────────────────────────────────────────────────
const REPORT_TYPES = {
    PT27: {
        code: 'PT27',
        nameTH: 'รายงานข้อมูลแหล่งที่มาและจำนวนที่เก็บไว้ (ภ.ท.27)',
        nameEN: 'Source and Storage Report',
        requiredFields: ['sourceData', 'storageQuantity', 'storageLocation'],
    },
    PT28: {
        code: 'PT28',
        nameTH: 'รายงานข้อมูลการนำไปใช้ (ภ.ท.28)',
        nameEN: 'Usage Report',
        requiredFields: ['usageData', 'usageQuantity', 'usagePurpose'],
    },
    PT29: {
        code: 'PT29',
        nameTH: 'รายงานแปรรูป/จำหน่าย (ภ.ท.29)',
        nameEN: 'Processing/Sales Report',
        requiredFields: ['processedQuantity', 'salesData'],
    },
    PT30: {
        code: 'PT30',
        nameTH: 'รายงานศึกษาวิจัย (ภ.ท.30)',
        nameEN: 'Research Report',
        requiredFields: ['researchObjective', 'researchFindings'],
    },
    PT31: {
        code: 'PT31',
        nameTH: 'รายงานการส่งออก (ภ.ท.31)',
        nameEN: 'Export Report (Part 1)',
        requiredFields: ['exportDestination', 'exportQuantity'],
    },
    PT32: {
        code: 'PT32',
        nameTH: 'รายงานการส่งออก (ภ.ท.32)',
        nameEN: 'Export Report (Part 2)',
        requiredFields: ['exportCertificate', 'exportValue'],
    },
};

/**
 * GET /api/report-submissions/types
 * List available report types with descriptions
 */
router.get('/types', authenticateHealth, (req, res) => {
    res.json({
        success: true,
        data: Object.values(REPORT_TYPES),
    });
});

/**
 * GET /api/report-submissions/schedule
 * Get report schedule for user's active certificates
 * Returns: which reports are due, which are submitted, which are late
 */
router.get('/schedule', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        // Get active certificates
        // Spec 2026-09-30 §3.1: the certificates of the caller's holders.
        const certificates = await documentService.listActiveCertificatesForUser(
            await holderScopeOf(req),
        );

        if (certificates.length === 0) {
            return res.json({
                success: true,
                data: {
                    certificates: [],
                    schedule: [],
                    summary: { total: 0, submitted: 0, pending: 0, overdue: 0 },
                },
            });
        }

        // Get current month info (Thai Buddhist Era)
        // The current Bangkok month and year (operator 2026-09-26).
        const nowBkk = getZonedParts(new Date());
        const currentMonth = nowBkk.month;
        const currentYear = nowBkk.year + 543; // พ.ศ.

        // Get existing submissions for current year
        const submissions = await documentService.listReportSubmissionsForUserYear(userId, currentYear);

        // Build schedule for each certificate
        const schedule = [];
        for (const cert of certificates) {
            // Standard GACP requires PT27 + PT28 monthly
            const requiredReports = ['PT27', 'PT28'];

            for (const reportType of requiredReports) {
                // Check each month from certificate issuedDate to now
                const issuedBkk = getZonedParts(new Date(cert.issuedDate));
                const startMonth = issuedBkk.year === nowBkk.year
                    ? issuedBkk.month
                    : 1;

                for (let month = startMonth; month <= currentMonth; month++) {
                    const existing = submissions.find(
                        s => s.certificateId === cert.id
                            && s.reportType === reportType
                            && s.reportMonth === month,
                    );

                    schedule.push({
                        certificateId: cert.id,
                        certificateNumber: cert.certificateNumber,
                        farmName: cert.farmName,
                        reportType,
                        reportTypeName: REPORT_TYPES[reportType]?.nameTH || reportType,
                        month,
                        year: currentYear,
                        status: existing?.status || 'NOT_SUBMITTED',
                        submissionId: existing?.id || null,
                        submittedAt: existing?.submittedAt || null,
                        isOverdue: !existing && month < currentMonth,
                    });
                }
            }
        }

        const submitted = schedule.filter(s => s.status !== 'NOT_SUBMITTED').length;
        const overdue = schedule.filter(s => s.isOverdue).length;

        res.json({
            success: true,
            data: {
                certificates,
                schedule,
                summary: {
                    total: schedule.length,
                    submitted,
                    pending: schedule.length - submitted,
                    overdue,
                },
            },
        });
    } catch (error) {
        logger.error('[ReportSubmissions] schedule error:', error);
        res.status(500).json({ success: false, error: 'Failed to get report schedule' });
    }
});

/**
 * GET /api/report-submissions
 * List user's report submissions
 */
router.get('/', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        const { certificateId, reportType, year, status, page = 1, limit = 20 } = req.query;

        const { items: submissions, total } = await documentService.listReportSubmissionsForUser({
            userId,
            certificateId,
            reportType,
            year,
            status,
            page,
            limit,
        });

        res.json({
            success: true,
            count: submissions.length,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit)),
            data: submissions,
        });
    } catch (error) {
        logger.error('[ReportSubmissions] list error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch reports' });
    }
});

/**
 * GET /api/report-submissions/:id
 * Get single report submission
 */
router.get('/:id', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        const report = await documentService.findReportSubmissionForUser(req.params.id, userId);

        if (!report) {
            return res.status(404).json({ success: false, error: 'Report not found' });
        }

        res.json({ success: true, data: report });
    } catch (error) {
        logger.error('[ReportSubmissions] get error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch report' });
    }
});

/**
 * POST /api/report-submissions
 * Create a new report submission
 */
router.post('/', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        const {
            certificateId,
            reportType,
            reportMonth,
            reportYear,
            formData,
            attachmentUrl,
            submitNow,
        } = req.body;

        // Validate required fields
        if (!certificateId || !reportType || !reportMonth || !reportYear) {
            return res.status(400).json({
                success: false,
                error: 'certificateId, reportType, reportMonth, reportYear are required',
            });
        }

        // Validate report type
        if (!REPORT_TYPES[reportType]) {
            return res.status(400).json({
                success: false,
                error: `Invalid report type: ${reportType}`,
            });
        }

        // The certificate is one of the caller's holders' (spec 2026-09-30 §3.1).
        const certificate = await documentService.findCertificateForUser(
            certificateId,
            await holderScopeOf(req),
        );

        if (!certificate) {
            return res.status(404).json({ success: false, error: 'Certificate not found' });
        }

        // Filing a report writes a record for the holder: RECORDS_MANAGE on it
        // (the farm-records permission; MANAGER and OWNER hold it by role, a VIEWER
        // does not). R2 Task 12: the filer pin that used to keep co-members out of
        // this door is gone, so who may write is asked here.
        try {
            await require('../../../services/holder-access')
                .assertHolderCapability(req.user?.id, certificate.application?.entityId, 'RECORDS_MANAGE');
        } catch (gateErr) {
            if (gateErr?.code === 'ENTITY_PERMISSION_DENIED') {
                const { entityPermissionDeniedBody } = require('../../../shared/entity-permission-denied');
                return res.status(403).json(entityPermissionDeniedBody(gateErr.permission || 'RECORDS_MANAGE'));
            }
            throw gateErr;
        }

        // Check for duplicate
        const existing = await documentService.findReportSubmissionByPeriod({
            certificateId,
            reportType,
            reportMonth,
            reportYear,
        });

        if (existing && !existing.isDeleted) {
            return res.status(409).json({
                success: false,
                error: 'Report already exists for this period',
                existingId: existing.id,
            });
        }

        const status = submitNow ? 'SUBMITTED' : 'DRAFT';

        const report = await documentService.createReportSubmission({
            certificateId,
            userId,
            reportType,
            reportMonth: parseInt(reportMonth),
            reportYear: parseInt(reportYear),
            formData: formData || {},
            attachmentUrl: attachmentUrl || null,
            status,
            submittedAt: submitNow ? new Date() : null,
            createdBy: userId,
        });

        // Wave A Phase 34 (G1 consumer #2) — dual-write the file pointer
        // into Attachment if one was supplied. ReportSubmission.attachmentUrl
        // stays populated for backward compat. Best-effort here (not in a
        // transaction) — a failure leaves an orphan report without its
        // Attachment companion, matching the route's existing failure mode.
        if (report.attachmentUrl) {
            try {
                await attachmentService.attach({
                    prisma,
                    resModel: 'ReportSubmission',
                    resId: report.id,
                    field: 'attachmentUrl',
                    fileName: extractFileName(report.attachmentUrl),
                    fileUrl: report.attachmentUrl,
                    fileSize: 0,
                    uploadedBy: userId,
                    organizationId: report.organizationId,
                });
            } catch (attErr) {
                logger.warn(`[ReportSubmissions] dual-write Attachment failed (non-fatal): ${attErr.message}`);
            }
        }

        logger.info(`[ReportSubmissions] Created ${reportType} ${reportMonth}/${reportYear} for cert ${certificate.certificateNumber}`);
        res.status(201).json({ success: true, data: report });
    } catch (error) {
        logger.error('[ReportSubmissions] create error:', error);
        res.status(500).json({ success: false, error: 'Failed to create report' });
    }
});

/**
 * PUT /api/report-submissions/:id
 * Update a draft report (can't update submitted reports)
 */
router.put('/:id', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        const existing = await documentService.findOwnedReportSubmissionDraft(req.params.id, userId);

        if (!existing) {
            return res.status(404).json({ success: false, error: 'Report not found' });
        }

        if (existing.status !== 'DRAFT') {
            return res.status(400).json({
                success: false,
                error: 'Only DRAFT reports can be edited',
            });
        }

        const { formData, attachmentUrl, submitNow } = req.body;

        const updateData = { updatedBy: userId };
        if (formData !== undefined) {updateData.formData = formData;}
        if (attachmentUrl !== undefined) {updateData.attachmentUrl = attachmentUrl;}
        if (submitNow) {
            updateData.status = 'SUBMITTED';
            updateData.submittedAt = new Date();
        }

        const report = await documentService.updateReportSubmission(req.params.id, updateData);

        // Wave A Phase 34 — keep the Attachment table in sync when the
        // applicant replaces or removes the report's attachment. Soft-detach
        // any prior Attachment for this report, then attach the new one if
        // a URL was supplied. Same best-effort policy as the create path.
        if (attachmentUrl !== undefined) {
            try {
                const oldAtts = await attachmentService.listForResource({
                    prisma,
                    resModel: 'ReportSubmission',
                    resId: report.id,
                    field: 'attachmentUrl',
                });
                for (const att of oldAtts) {
                    if (att.fileUrl !== attachmentUrl) {
                        await attachmentService.detach({
                            prisma,
                            attachmentId: att.id,
                            deletedBy: userId,
                            reason: 'Replaced via PUT /api/report-submissions/:id',
                        });
                    }
                }
                if (attachmentUrl) {
                    const stillThere = oldAtts.find((a) => a.fileUrl === attachmentUrl);
                    if (!stillThere) {
                        await attachmentService.attach({
                            prisma,
                            resModel: 'ReportSubmission',
                            resId: report.id,
                            field: 'attachmentUrl',
                            fileName: extractFileName(attachmentUrl),
                            fileUrl: attachmentUrl,
                            fileSize: 0,
                            uploadedBy: userId,
                            organizationId: report.organizationId,
                        });
                    }
                }
            } catch (attErr) {
                logger.warn(`[ReportSubmissions] dual-write Attachment update failed (non-fatal): ${attErr.message}`);
            }
        }

        res.json({ success: true, data: report });
    } catch (error) {
        logger.error('[ReportSubmissions] update error:', error);
        res.status(500).json({ success: false, error: 'Failed to update report' });
    }
});

/**
 * PUT /api/report-submissions/:id/review  (Provider only)
 * Review a submitted report
 */
router.put('/:id/review', authenticatePROVIDER, async (req, res) => {
    try {
        const actorRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
        if (!actorRole || !REPORT_REVIEWER_ROLES.has(actorRole)) {
            return res.status(403).json({ success: false, error: 'Forbidden', message: 'ไม่มีสิทธิ์ตรวจรายงาน' });
        }

        const { status, reviewNote } = req.body;

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Status must be APPROVED or REJECTED',
            });
        }

        const report = await documentService.reviewReportSubmission(req.params.id, {
            status,
            reviewedBy: req.user?.id || 'system',
            reviewNote,
        });

        res.json({ success: true, data: report });
    } catch (error) {
        logger.error('[ReportSubmissions] review error:', error);
        res.status(500).json({ success: false, error: 'Failed to review report' });
    }
});

/**
 * DELETE /api/report-submissions/:id
 * Soft delete a draft report
 */
router.delete('/:id', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        const existing = await documentService.findOwnedReportSubmissionDraft(req.params.id, userId);

        if (!existing) {
            return res.status(404).json({ success: false, error: 'Report not found' });
        }

        if (existing.status !== 'DRAFT') {
            return res.status(400).json({
                success: false,
                error: 'Only DRAFT reports can be deleted',
            });
        }

        await documentService.softDeleteReportSubmission(req.params.id);

        res.json({ success: true, message: 'Report deleted' });
    } catch (error) {
        logger.error('[ReportSubmissions] delete error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete report' });
    }
});

module.exports = router;
