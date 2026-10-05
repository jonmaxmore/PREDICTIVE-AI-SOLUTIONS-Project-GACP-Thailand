const { applicationsWorkflowTransitions } = require('./workflow-transitions-handler');
const { applicationsRevisionExpirations } = require('./workflow-revision-expirations-handler');
const { applicationsAuditTimelines } = require('./workflow-audit-timelines-handler');

module.exports = {
    applicationsWorkflowTransitions,
    applicationsRevisionExpirations,
    applicationsAuditTimelines,
};
