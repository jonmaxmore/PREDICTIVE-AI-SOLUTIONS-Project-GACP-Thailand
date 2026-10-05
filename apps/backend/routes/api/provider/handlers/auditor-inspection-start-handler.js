const {
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    workflowTransitionService,
    getRequestIp,
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
    isPhase2ReceiptIssued,
    applicationService,
} = require('./auditor-handler-deps');
// Closing-review NEW-2 (2026-05-15): mask the raw 13-digit identifier before
// writing it into the hash-chained audit row (PDPA Section 27).
const { maskThaiId } = require('../../../../utils/field-encryption');
// provider-E2E carpet 2026-07-09 (LOW): inspection-start is an auditor-only
// surface but was gated ONLY on APPLICATION_AUDIT_RECORD (which ADMIN holds) +
// an ADMIN ownership-bypass — a SoD sibling the AUDIT-001/#539 sweep missed.
// Gate it to AUDITORS (excludes ADMIN) like auditor-audit-decision-handler /
// onsite.js, and drop the ADMIN carve-out in the ownership check below.
const { requireRole } = require('../../../../middleware/auth-middleware');
const { ROLE_GROUPS } = require('../../../../shared/canonical-rbac');

const auditorInspectionStarts = [
    authenticateProvider,
    requireRole(ROLE_GROUPS.AUDITORS),
    requireCanonicalPermission(PERMISSIONS.APPLICATION_AUDIT_RECORD),
    async (req, res) => {
        try {
            const idOrNumber = String(req.params.id || '').trim();
            if (!idOrNumber) {
                return res.status(400).json({ success: false, error: 'Application id is required' });
            }

            const application = await applicationService.findAuditDecisionApplication(idOrNumber);
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }

            // REV-11/ownership: the assigned auditor only. No ADMIN carve-out —
            // requireRole(AUDITORS) already excludes ADMIN, and admin recovery is
            // the workflow `force` path, never this route (SoD, matches the
            // audit-decision + onsite siblings).
            if (application.auditorId !== req.user.id) {
                return res.status(403).json({ success: false, error: 'Application is not assigned to this auditor' });
            }

            const currentState = workflowTransitionService.resolveStateFromApplication(application);
            if (currentState !== 'AUDIT_CONFIRMED') {
                return res.status(400).json({
                    success: false,
                    error: `Application must be AUDIT_CONFIRMED before start (current: ${currentState})`,
                });
            }

            const receiptIssued = await isPhase2ReceiptIssued(application.id);
            if (!receiptIssued) {
                return res.status(400).json({
                    success: false,
                    error: 'Receipt must be issued before inspection can start',
                });
            }

            const ts = new Date().toISOString();
            const formData = application.formData && typeof application.formData === 'object' ? application.formData : {};
            const workflowHistory = Array.isArray(application.workflowHistory) ? application.workflowHistory : [];

            // Note: this transition does not change `status` (AUDIT_CONFIRMED → AUDIT_CONFIRMED).
            // We update only formData + workflowHistory here, so we deliberately leave the
            // status field out of the prisma.application.update payload — that keeps us off
            // the gacp/no-direct-application-status-write radar without inventing a no-op
            // canonical writeApplicationStatus call.
            const updated = await applicationService.writeInspectionStart(application.id, {
                data: {
                    updatedBy: req.user.id,
                    formData: {
                        ...formData,
                        auditExecution: {
                            ...(formData.auditExecution && typeof formData.auditExecution === 'object' ? formData.auditExecution : {}),
                            startedAt: ts,
                            startedBy: req.user.providerId || req.user.id,
                        },
                    },
                    workflowHistory: [
                        ...workflowHistory,
                        {
                            timestamp: ts,
                            action: 'INSPECTION_STARTED',
                            fromState: currentState,
                            toState: currentState,
                            actorId: req.user.id,
                            actorRole: req.user.canonicalRole || req.user.role || null,
                        },
                    ],
                },
            });

            await auditLogger.log({
                category: AuditCategory.APPLICATION,
                action: 'INSPECTION_STARTED',
                severity: AuditSeverity.INFO,
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
                    nextWorkflowState: currentState,
                    actorIdentity: maskThaiId(req.user.providerId) || maskThaiId(req.user.healthId) || null,
                },
            }).catch((auditError) => logger.warn('[provider] INSPECTION_STARTED audit failed', { message: auditError.message }));

            return res.json({
                success: true,
                data: updated,
                message: 'Inspection started successfully',
            });
        } catch (error) {
            logger.error('[provider] start-inspection failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to start inspection',
            });
        }
    },
];

module.exports = {
    auditorInspectionStarts,
};
