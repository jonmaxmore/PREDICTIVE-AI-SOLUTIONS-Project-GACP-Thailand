/**
 * Post-Audit Task API Routes
 * For managing post-audit corrective actions and document uploads
 * Uses Prisma PostAuditTask model (Phase 7)
 * 
 * GET /api/post-audit/tasks/:applicationId - Get tasks for application
 * POST /api/post-audit/tasks - Create new task ((Provider only))
 * PUT /api/post-audit/tasks/:taskId - Update task status
 * POST /api/post-audit/tasks/:taskId/upload - Upload files for task
 */

const express = require('express');
const { respondError } = require('../../../shared/api-response');
const router = express.Router();
// `prisma` is retained only as a transaction handle for attachmentService.attach
// (the dual-write to the polymorphic Attachment table), which requires the
// client by contract. All direct prisma.X.find/update/create calls have been
// replaced with service-layer helpers as part of the Batch 11 audit-cluster
// cleanup. ISO 27799:2016 § 7.10 (audit log tamper-evidence) and Thai PDPA
// Act B.E. 2562 s.32 (restriction of processing) — keeping the postAuditTask
// reads/writes inside post-audit-task-service.js means the parent-application
// visibility predicate cannot be bypassed by a route-level prisma call.
const { prisma } = require('../../../services/prisma-database');
const authModule = require('../../../middleware/auth-middleware');
const { providerOnly } = require('../../../middleware/role-middleware');
// AUDIT-004/005: post-audit (CAR) tasks are audit-staff work. Gate the write/upload
// endpoints to AUDITOR + DOCUMENT_REVIEWER + ADMIN (REVIEWERS) — without this, any
// authenticated provider (scheduler/account) passes authenticateProvider and a null
// withVisibility filter, so they could update/upload CAR-task evidence in their tenant.
const { ROLE_GROUPS } = require('../../../shared/canonical-rbac');
const { withVisibility } = require('../../../shared/application-visibility');
const attachmentService = require('../../../services/attachment-service');
const postAuditTaskService = require('../../../services/post-audit-task-service');
const applicationService = require('../../../services/application-service');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../../../shared/logger');
const { multipartLimits } = require('../../../shared/multipart-limits');

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../storage/post-audit');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${crypto.randomInt(1_000_000_000)}`;
        cb(null, `task-${uniqueSuffix}${path.extname(file.originalname)}`);
    },
});

const upload = multer({
    storage,
    // 10MB per file, the 5 files upload.array('files', 5) takes; the handler reads no text fields
    limits: multipartLimits({ fileSize: 10 * 1024 * 1024, files: 5, fields: 10 }),
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    },
});

/**
 * Wave A Phase 27 — gate task-by-id endpoints by parent application
 * visibility. The PUT / upload / detail endpoints look up the task by
 * id; an auditor knowing a taskId could touch tasks for applications
 * they aren't assigned to. This helper checks the parent application
 * is visible to the caller before letting the operation proceed.
 *
 * Returns the task row (with parent application visibility verified)
 * or null if either the task is missing OR the parent application
 * isn't visible to the caller. Both produce a 404 — never 403 — so
 * existence isn't leaked.
 */
async function findVisibleTaskById(taskId, user) {
    const orgId = user?.organizationId || null;
    const task = await postAuditTaskService.findTaskInTenant({ id: taskId, organizationId: orgId });
    if (!task) {
        return null;
    }
    const visibleApp = await applicationService.findFirstWithWhere({
        where: withVisibility({ id: task.applicationId, isDeleted: false }, user),
        select: { id: true },
    });
    if (!visibleApp) {
        return null;
    }
    return task;
}

/**
 * GET /api/post-audit/tasks/:applicationId
 * Get all post-audit tasks for an application
 *
 * Wave A Phase 26 (G4 cont): this endpoint was missing authentication
 * entirely (the other 4 endpoints in this router were correctly gated
 * via authenticateProvider). Anyone with the URL could pull post-audit
 * task data for any application by id. Restored the auth middleware
 * to match the rest of the file, plus added a per-record visibility
 * gate so an auditor only sees tasks for applications they're assigned to.
 */
router.get('/tasks/:applicationId', authModule.authenticateProvider, async (req, res) => {
    try {
        const { applicationId } = req.params;
        const { status } = req.query;

        // Visibility gate — load the application first (filtered by who
        // can see it). 404 if the caller can't see it; only then query
        // the task list.
        const visible = await applicationService.findFirstWithWhere({
            where: withVisibility({ id: applicationId, isDeleted: false }, req.user),
            select: { id: true },
        });
        if (!visible) {
            return res.status(404).json({
                success: false,
                message: 'Application not found',
            });
        }

        // Query tasks via service-layer indirection
        const tasks = await postAuditTaskService.listTasksForApplication({ applicationId, status });

        return res.json({
            success: true,
            applicationId,
            count: tasks.length,
            data: tasks,
        });

    } catch (error) {
        logger.error('[PostAudit GET] Error:', error);
        return respondError(res, req, error, { message: 'Failed to retrieve tasks' });
    }
});

/**
 * POST /api/post-audit/tasks
 * Create new post-audit task ((Provider only))
 */
router.post('/tasks', authModule.authenticateProvider, providerOnly, async (req, res) => {
    try {
        const {
            applicationId,
            description,
            dueDate,
        } = req.body;

        // Validation
        if (!applicationId || !description || !dueDate) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: applicationId, description, dueDate',
            });
        }

        // PR-1.6 follow-up: tenant-scope the application lookup.
        // Wave A Phase 26: also gate by visibility so an auditor can't
        // create post-audit tasks on applications they aren't assigned to.
        const orgId = req.user?.organizationId || req.tenantContext?.organizationId || null;
        const tenantWhere = orgId
            ? { id: applicationId, organizationId: orgId }
            : { id: applicationId };
        const application = await applicationService.findFirstWithWhere({
            where: withVisibility(tenantWhere, req.user),
            select: { id: true, applicationNumber: true },
        });

        if (!application) {
            return res.status(404).json({
                success: false,
                message: 'Application not found',
            });
        }

        // Create task via service
        const task = await postAuditTaskService.createTask({
            applicationId: applicationId,
            description: description,
            dueDate: new Date(dueDate),
            status: 'PENDING',
            createdBy: req.user.id,
            assignedBy: req.user.id,
        });

        return res.status(201).json({
            success: true,
            message: 'Task created successfully',
            data: task,
        });

    } catch (error) {
        logger.error('[PostAudit POST] Error:', error);
        return respondError(res, req, error, { message: 'Failed to create task' });
    }
});

/**
 * PUT /api/post-audit/tasks/:taskId
 * Update task status
 */
router.put('/tasks/:taskId', authModule.authenticateProvider, authModule.requireRole(ROLE_GROUPS.REVIEWERS), async (req, res) => {
    try {
        const { taskId } = req.params;
        const { status } = req.body;

        // PR-1.6 + Wave A Phase 27: gate by parent application visibility.
        const task = await findVisibleTaskById(taskId, req.user);
        if (!task) {
            return res.status(404).json({
                success: false,
                message: 'Task not found',
            });
        }

        const validStatuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE'];
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status',
                validValues: validStatuses,
            });
        }

        // Update task via service
        const updated = await postAuditTaskService.updateTask({
            id: taskId,
            data: {
                status: status || task.status,
                completedAt: status === 'COMPLETED' ? new Date() : task.completedAt,
                updatedBy: req.user.id,
            },
        });

        return res.json({
            success: true,
            message: 'Task updated successfully',
            data: updated,
        });

    } catch (error) {
        logger.error('[PostAudit PUT] Error:', error);
        return respondError(res, req, error, { message: 'Failed to update task' });
    }
});

/**
 * POST /api/post-audit/tasks/:taskId/upload
 * Upload files for a task
 */
router.post('/tasks/:taskId/upload', authModule.authenticateProvider, authModule.requireRole(ROLE_GROUPS.REVIEWERS), upload.array('files', 5), async (req, res) => {
    try {
        const { taskId } = req.params;

        // PR-1.6 + Wave A Phase 27: gate by parent application visibility.
        const task = await findVisibleTaskById(taskId, req.user);
        if (!task) {
            return res.status(404).json({
                success: false,
                message: 'Task not found',
            });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No files uploaded',
            });
        }

        // Build documents array
        const newDocuments = req.files.map(file => ({
            fileName: file.originalname,
            fileUrl: `/storage/post-audit/${file.filename}`,
            uploadedAt: new Date().toISOString(),
            uploadedBy: req.user.id,
            size: file.size,
        }));

        // Get existing documents or create empty array
        const existingDocs = task.documents ? (typeof task.documents === 'string' ? JSON.parse(task.documents) : task.documents) : [];
        const updatedDocuments = [...existingDocs, ...newDocuments];

        // Update task via service
        const _updated = await postAuditTaskService.appendTaskDocuments({
            id: taskId,
            documents: updatedDocuments,
            updatedBy: req.user.id,
        });

        // Wave A Phase 37 (G1 consumer #5) — dual-write each newly uploaded
        // document into the polymorphic Attachment table. PostAuditTask
        // documents are append-only (no replace-by-id semantics) so we
        // don't detach prior rows — each upload creates fresh Attachment(s).
        // The JSON column on the task remains the source of truth for now.
        for (const doc of newDocuments) {
            try {
                await attachmentService.attach({
                    prisma,
                    resModel: 'PostAuditTask',
                    resId: task.id,
                    field: 'documents',
                    fileName: doc.fileName,
                    fileUrl: doc.fileUrl,
                    fileSize: Number(doc.size) || 0,
                    mimeType: null,
                    fileHash: null,
                    uploadedBy: doc.uploadedBy,
                    organizationId: task.organizationId,
                });
            } catch (attErr) {
                logger.warn(`[PostAudit Upload] dual-write Attachment failed for ${doc.fileName} (non-fatal): ${attErr.message}`);
            }
        }

        return res.json({
            success: true,
            message: 'Files uploaded successfully',
            data: {
                taskId,
                uploadedFiles: newDocuments,
                totalFiles: updatedDocuments.length,
            },
        });

    } catch (error) {
        logger.error('[PostAudit Upload] Error:', error);
        return respondError(res, req, error, { message: 'Failed to upload files' });
    }
});

/**
 * GET /api/post-audit/tasks/:taskId
 * Get single task details
 *
 * PR-1.6 follow-up: this endpoint was previously UNAUTHENTICATED — anyone
 * who knew a task id could fetch its details (and the linked application
 * number). Added authenticateProvider so only providers can read tasks,
 * and scoped the lookup by organizationId.
 */
router.get('/tasks/detail/:taskId', authModule.authenticateProvider, async (req, res) => {
    try {
        const { taskId } = req.params;

        // PR-1.6 + Wave A Phase 27: gate by parent application visibility.
        // We re-fetch with the `include` shape the response needs, after the
        // helper has already verified the caller can see this task.
        const visible = await findVisibleTaskById(taskId, req.user);
        const task = visible
            ? await postAuditTaskService.getTaskDetailWithApplication(visible.id)
            : null;

        if (!task) {
            return res.status(404).json({
                success: false,
                message: 'Task not found',
            });
        }

        return res.json({
            success: true,
            data: task,
        });

    } catch (error) {
        logger.error('[PostAudit GET Detail] Error:', error);
        return respondError(res, req, error, { message: 'Failed to retrieve task' });
    }
});

module.exports = router;
