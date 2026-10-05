const {
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    obj,
    arr,
    applicationService,
    workflowTransitionService,
} = require('./workflow-handler-deps');
const auditTrailService = require('../../../../services/audit-trail');
const { withVisibility } = require('../../../../shared/application-visibility');

// Column whitelist for the timeline response — matches the keys the handler
// previously serialised back to the client. Kept here so the JSON envelope
// the frontend consumes stays bit-identical after the service-layer
// migration.
const TIMELINE_COLUMNS = [
    'id',
    'logId',
    'sequenceNumber',
    'action',
    'actorId',
    'actorRole',
    'createdAt',
    'metadata',
];

const applicationsAuditTimelines = [
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.AUDIT_TIMELINE_READ),
    async (req, res) => {
        try {
            const idOrNumber = String(req.params.id || '').trim();
            if (!idOrNumber) {
                return res.status(400).json({ success: false, error: 'Application id is required' });
            }

            // VIS-1: scope the lookup to applications the caller may see (mirror
            // applications.js workflow-transitions / get-by-id). AUDIT_TIMELINE_READ
            // is a FUNCTION permission held by document_reviewer/auditor/admin; without
            // this data-scope a document_reviewer could read ANY same-tenant peer's
            // workflowHistory + hash-chained AuditLog by id. withVisibility narrows a
            // reviewer to their own reviewerId assignments (and an auditor to theirs);
            // non-visible → null → 404, identical to the detail endpoint.
            const application = await applicationService.findFirstWithWhere({
                where: withVisibility(
                    { OR: [{ id: idOrNumber }, { applicationNumber: idOrNumber }], isDeleted: false },
                    req.user,
                ),
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    formData: true,
                    workflowHistory: true,
                },
            });

            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }

            const auditLogs = await auditTrailService.getTimelineForApplication(
                application.id,
                { limit: 500, allowedColumns: TIMELINE_COLUMNS },
            );

            return res.json({
                success: true,
                data: {
                    application: {
                        id: application.id,
                        applicationNumber: application.applicationNumber,
                        status: application.status,
                        workflowState: obj(application.formData).workflowState
                            || workflowTransitionService.resolveStateFromApplication(application),
                    },
                    workflowHistory: arr(application.workflowHistory),
                    auditLogs: auditLogs.map((entry) => ({
                        id: entry.id,
                        logId: entry.logId,
                        sequenceNumber: entry.sequenceNumber,
                        action: entry.action,
                        actorId: entry.actorId,
                        actorRole: entry.actorRole,
                        createdAt: entry.createdAt,
                        metadata: (() => {
                            if (typeof entry.metadata !== 'string') {
                                return entry.metadata;
                            }
                            try {
                                return JSON.parse(entry.metadata);
                            } catch (_error) {
                                return entry.metadata;
                            }
                        })(),
                    })),
                },
            });
        } catch (error) {
            logger.error('[provider] audit timeline failed', { message: error.message });
            return res.status(500).json({
                success: false,
                error: 'Failed to load audit timeline',
            });
        }
    },
];

module.exports = {
    applicationsAuditTimelines,
};
