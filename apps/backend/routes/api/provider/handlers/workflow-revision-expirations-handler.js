const {
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    obj,
    arr,
    // `prisma` is retained as the transaction handle threaded into
    // `writeApplicationStatus` — same exception pattern as
    // `applications/applications-car.js` (batch 9).
    prisma,
    applicationService,
    workflowTransitionService,
    getRevisionDueAt,
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
    getRequestIp,
} = require('./workflow-handler-deps');
const adminApplicationService = require('../../../../services/admin-application-service');
const { writeApplicationStatus } = require('../../../../services/application-status-writer');
// Closing-review NEW-2 (2026-05-15): mask the raw 13-digit identifier before
// writing it into the hash-chained audit row (PDPA Section 27).
const { maskThaiId } = require('../../../../utils/field-encryption');

const applicationsRevisionExpirations = [
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_WORKFLOW_TRANSITION),
    async (req, res) => {
        try {
            const idOrNumber = String(req.params.id || '').trim();
            if (!idOrNumber) {
                return res.status(400).json({
                    success: false,
                    error: 'Application id is required',
                });
            }

            const application = await applicationService.findApplicationByIdOrNumberWorkflowSlice(idOrNumber);

            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }

            const currentState = workflowTransitionService.resolveStateFromApplication(application);
            if (currentState !== 'REVISION_REQUESTED') {
                return res.status(400).json({
                    success: false,
                    error: `Application is not in REVISION_REQUESTED state (current: ${currentState})`,
                });
            }

            const dueAt = getRevisionDueAt(application.formData);
            if (!dueAt) {
                return res.status(400).json({
                    success: false,
                    error: 'Revision due date is not set',
                });
            }

            const forceNowInput = String(req.body?.forceNow || '').trim();
            const forceNow = forceNowInput ? new Date(forceNowInput) : null;
            // Allow time override only in non-production, or when explicit E2E rehearsal routes are enabled.
            const allowTestTimeOverride = process.env.ENABLE_E2E_ROUTES === 'true';
            const canUseForceNow = (process.env.NODE_ENV !== 'production' || allowTestTimeOverride)
                && forceNow
                && Number.isFinite(forceNow.getTime());
            const now = canUseForceNow ? forceNow : new Date();

            if (now <= dueAt) {
                return res.status(400).json({
                    success: false,
                    error: 'Revision deadline is not overdue yet',
                    data: { revisionDueAt: dueAt.toISOString() },
                });
            }

            const ts = now.toISOString();
            const currentFormData = obj(application.formData);
            await writeApplicationStatus({
                prisma,
                applicationId: application.id,
                fromStatus: application.status,
                toStatus: 'EXPIRED',
                actorId: req.user.id,
                actorRole: req.user.canonicalRole || req.user.role || null,
                reason: 'REVISION_DEADLINE_EXPIRED',
                additionalData: {
                    updatedBy: req.user.id,
                    formData: {
                        ...currentFormData,
                        workflowState: 'EXPIRED',
                        workflowStateUpdatedAt: ts,
                        canceledExpiredAt: ts,
                        cancelReason: 'REVISION_OVERDUE',
                    },
                    workflowHistory: [
                        ...arr(application.workflowHistory),
                        {
                            timestamp: ts,
                            action: 'REVISION_DEADLINE_EXPIRED',
                            fromState: 'REVISION_REQUESTED',
                            toState: 'EXPIRED',
                            actorId: req.user.id,
                            actorRole: req.user.canonicalRole || req.user.role || null,
                        },
                    ],
                },
            });
            // Re-fetch with select shape (canonical writer doesn't expose select option).
            const updated = await applicationService.getApplicationExpirationSlice(application.id);

            await adminApplicationService.bulkUpdateRevisionDeadlineStatus({
                applicationId: application.id,
                fromStatuses: ['PENDING', 'EXTENDED'],
                data: { status: 'FAILED', updatedBy: req.user.id },
            });

            try {
                await auditLogger.log({
                    category: AuditCategory.APPLICATION,
                    action: 'REVISION_DEADLINE_EXPIRED',
                    severity: AuditSeverity.WARNING,
                    actorId: req.user.id || 'SYSTEM',
                    actorRole: req.user.canonicalRole || req.user.role || 'UNKNOWN',
                    actorType: 'PROVIDER',
                    resourceType: ResourceType.APPLICATION,
                    resourceId: application.id,
                    ipAddress: getRequestIp(req),
                    userAgent: req.get('user-agent'),
                    metadata: {
                        applicationNumber: application.applicationNumber,
                        previousWorkflowState: currentState,
                        nextWorkflowState: 'EXPIRED',
                        previousStatus: application.status,
                        nextStatus: 'EXPIRED',
                        expiredReason: 'REVISION_OVERDUE',
                        actorIdentity: maskThaiId(req.user.providerId) || maskThaiId(req.user.healthId) || null,
                    },
                });
            } catch (auditError) {
                logger.warn('[provider] expire-overdue-revision audit failed', {
                    message: auditError.message,
                    applicationId: application.id,
                });
            }

            return res.json({
                success: true,
                data: updated,
                message: 'Application marked as EXPIRED due to overdue revision',
            });
        } catch (error) {
            logger.error('[provider] expire-overdue-revision failed', { message: error.message });
            return res.status(500).json({
                success: false,
                error: 'Failed to expire overdue revision',
            });
        }
    },
];

module.exports = {
    applicationsRevisionExpirations,
};
