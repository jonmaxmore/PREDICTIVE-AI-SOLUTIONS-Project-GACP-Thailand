const {
    prisma,
    authenticateProvider,
    requireRole,
    logger,
    PERMISSIONS,
    normalizeRole,
    PROVIDERRoles,
    requireCanonicalPermission,
    safeInt, safeObject, safeArray, safeDate,
    toInt, obj, arr, dt,
    getApplicantName,
    resolveUserIdFromHealthId,
} = require('./shared');
const {
    CANONICAL_ROLES,
} = require('../../../../shared/canonical-rbac');
const workflowTransitionService = require('../../../../services/workflow-transition-service');
// Batch 14 (2026-05-16): the invoice + application reads previously issued by
// this deps file go through the service layer. The prisma symbol is retained
// only for downstream handlers that need a transaction handle for
// writeApplicationStatus or compute-here legacy paths.
const invoiceService = require('../../../../services/invoice-service');
const applicationService = require('../../../../services/application-service');
// Wave-3 P1-H: read-only SLA overdue/breached count for the scheduler's own
// work-activity queue, surfaced as a dashboard tile.
const workActivityService = require('../../../../services/work-activity-service');
const { getRequestIp } = require('../../../../utils/client-ip');
const {
    computePhaseSettlement,
} = require('../../../../services/phase-billing-service');
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
} = require('../../../../middleware/audit-logger');
const {
    normalizeInspectionModeInput,
    isValidHttpUrl,
    resolveAuditSchedule,
    buildSchedulerQueueItem,
    hasScheduleCollision,
} = require('./queue-utils');
const {
    isWorkingDay,
    countWorkingDaysBetween,
} = require('../../../../utils/working-days');

// Re-exported from shared/phase2-schedule-gate rather than defined here. This
// predicate decides whether a field inspection may be queued, and it had been
// copy-pasted into three files — one of which (routes/api/audit/audits.js
// PATCH /:id/schedule) simply never called any copy, which is how an unpaid
// application could be assigned an auditor and a site visit date. One
// definition, one place to change it.
const { isPhase2PaymentConfirmed } = require('../../../../shared/phase2-schedule-gate');

module.exports = {
    prisma,
    authenticateProvider,
    requireRole,
    logger,
    PERMISSIONS,
    normalizeRole,
    PROVIDERRoles,
    requireCanonicalPermission,
    safeInt, safeObject, safeArray, safeDate,
    toInt, obj, arr, dt,
    getApplicantName,
    resolveUserIdFromHealthId,
    CANONICAL_ROLES,
    workflowTransitionService,
    invoiceService,
    applicationService,
    workActivityService,
    getRequestIp,
    computePhaseSettlement,
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
    normalizeInspectionModeInput,
    isValidHttpUrl,
    resolveAuditSchedule,
    buildSchedulerQueueItem,
    hasScheduleCollision,
    isPhase2PaymentConfirmed,
    isWorkingDay,
    countWorkingDaysBetween,
};
