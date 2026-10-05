const { schedulerAuditors } = require('./scheduler-auditors-handler');
const { schedulerDashboard } = require('./scheduler-dashboard-handler');
const { schedulerAuditSchedulesGet } = require('./scheduler-audit-schedules-get-handler');
const { schedulerAuditSchedulesPost } = require('./scheduler-audit-schedules-post-handler');
const { schedulerAssignReviewer, schedulerReviewers } = require('./scheduler-assign-reviewer-handler');
const { schedulerReviewerReassign, schedulerReassignableReviewers } = require('./scheduler-reviewer-reassign-handler');
const { auditsRouteOptimization } = require('./scheduler-audits-route-optimization-handler');

module.exports = {
    schedulerAuditors,
    schedulerReviewers,
    schedulerAssignReviewer,
    schedulerReviewerReassign,
    schedulerReassignableReviewers,
    schedulerDashboard,
    schedulerAuditSchedulesGet,
    schedulerAuditSchedulesPost,
    auditsRouteOptimization,
};
