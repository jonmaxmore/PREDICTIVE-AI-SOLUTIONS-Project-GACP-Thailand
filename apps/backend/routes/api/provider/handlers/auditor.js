const { auditorDashboard } = require('./auditor-dashboard-handler');
const { auditorInspectionStarts } = require('./auditor-inspection-start-handler');
const { auditorAuditDecisions } = require('./auditor-audit-decision-handler');

module.exports = {
    auditorDashboard,
    auditorInspectionStarts,
    auditorAuditDecisions,
};
