const { adminRevisionReminderRuns, adminBatchActions, adminDeadlineExtension, adminStatusOverride } = require('./handlers/admin');
const { adminMasterDashboard } = require('./handlers/admin-dashboard-handler');
const { adminBroadcast, adminCommunicationLog } = require('./handlers/communication');
const { adminAuditLogList, adminAuditLogCsv } = require('./handlers/audit-log-viewer-handler');
const { applicationsQueue, applicationsAssign } = require('./handlers/applications');
const {
    reviewerDashboard,
    reviewSaveProgress,
} = require('./handlers/reviewer');
const {
    schedulerAuditors,
    schedulerReviewers,
    schedulerAssignReviewer,
    schedulerReviewerReassign,
    schedulerReassignableReviewers,
    schedulerDashboard,
    schedulerAuditSchedulesGet,
    schedulerAuditSchedulesPost,
    auditsRouteOptimization,
} = require('./handlers/scheduler');
const {
    auditorDashboard,
    auditorInspectionStarts,
    auditorAuditDecisions,
} = require('./handlers/auditor');
const {
    applicationsWorkflowTransitions,
    applicationsRevisionExpirations,
    applicationsAuditTimelines,
} = require('./handlers/workflow');
const { certificatesDashboard, certificatesBulkNotify } = require('./handlers/certificates');
const { analyticsPerformance } = require('./handlers/analytics');

const providerRouteHandlers = Object.freeze({
    reviewerDashboard,
    reviewSaveProgress,
    adminRevisionReminderRuns,
    adminBatchActions,
    adminMasterDashboard,
    adminDeadlineExtension,
    adminStatusOverride,
    adminBroadcast,
    adminCommunicationLog,
    adminAuditLogList,
    adminAuditLogCsv,
    applicationsQueue,
    applicationsAssign,
    schedulerAuditors,
    schedulerReviewers,
    schedulerAssignReviewer,
    schedulerReviewerReassign,
    schedulerReassignableReviewers,
    schedulerDashboard,
    schedulerAuditSchedulesGet,
    schedulerAuditSchedulesPost,
    auditorDashboard,
    auditorInspectionStarts,
    auditorAuditDecisions,
    applicationsWorkflowTransitions,
    applicationsRevisionExpirations,
    applicationsAuditTimelines,
    auditsRouteOptimization,
    certificatesDashboard,
    certificatesBulkNotify,
    analyticsPerformance,
});

module.exports = {
    providerRouteHandlers,
};
