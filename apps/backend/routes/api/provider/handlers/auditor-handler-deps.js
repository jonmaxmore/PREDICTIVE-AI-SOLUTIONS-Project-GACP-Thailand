const {
    prisma,
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    normalizeRole,
    safeInt, safeObject, safeArray, safeDate,
    toInt, obj, arr, dt,
    resolveUserIdFromHealthId,
} = require('./shared');
const {
    CANONICAL_ROLES,
} = require('../../../../shared/canonical-rbac');
const workflowTransitionService = require('../../../../services/workflow-transition-service');
const traceabilityService = require('../../../../services/traceability-service');
const certificateService = require('../../../../services/certificate-service');
// Batch 14 (2026-05-16): invoice reads for the auditor handlers now go
// through invoice-service so this deps file does not reach into Prisma
// directly. The applicationService import follows the same pattern so
// downstream handlers can get the application-side helpers without
// re-importing themselves.
const invoiceService = require('../../../../services/invoice-service');
const applicationService = require('../../../../services/application-service');
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
    buildAuditorQueueItem,
} = require('./queue-utils');

async function isPhase2ReceiptIssued(applicationId) {
    const invoices = await invoiceService.listSettlementsForApplication(applicationId);
    const phase2Settlement = computePhaseSettlement(invoices, 'PHASE_2');
    return phase2Settlement.phaseReceiptIssued;
}

async function ensureCertificateIssuedForApplication(applicationId, actorIdentity) {
    return certificateService.generateCertificate(
        applicationId,
        actorIdentity || 'SYSTEM',
        { skipInitialAssets: true },
    );
}

module.exports = {
    prisma,
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    normalizeRole,
    safeInt, safeObject, safeArray, safeDate,
    toInt, obj, arr, dt,
    resolveUserIdFromHealthId,
    CANONICAL_ROLES,
    workflowTransitionService,
    traceabilityService,
    invoiceService,
    applicationService,
    getRequestIp,
    computePhaseSettlement,
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
    buildAuditorQueueItem,
    isPhase2ReceiptIssued,
    ensureCertificateIssuedForApplication,
};
