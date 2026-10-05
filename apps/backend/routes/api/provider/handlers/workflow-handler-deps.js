const {
    prisma,
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    obj, arr,
    resolveUserIdFromHealthId,
} = require('./shared');
const workflowTransitionService = require('../../../../services/workflow-transition-service');
const certificateService = require('../../../../services/certificate-service');
const invoiceService = require('../../../../services/invoice-service');
const applicationService = require('../../../../services/application-service');
const { getRequestIp } = require('../../../../utils/client-ip');
const { getRevisionDueAt } = require('./queue-utils');
const {
    computePhaseSettlement,
} = require('../../../../services/phase-billing-service');
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
} = require('../../../../middleware/audit-logger');
// Blocker F (full-system audit 2026-07-07): this barrel previously exported
// services/working-days-service's addWorkingDays plus its holiday loader —
// holiday-CAPABLE but holiday-BLIND in practice (that loader's two inputs, an
// env var and a systemConfig row, were never seeded) and evaluated in
// server-local time. The 5-working-day reject deadline it stamped was too
// short whenever the window spanned a Thai public holiday → early auto-EXPIRE
// → the farmer forfeits งวดที่ 1 and must re-file. Export the canonical
// Asia/Bangkok + Thai-calendar engine instead — the SAME one the sibling
// paths already use (services/car-deadline-service.js,
// application-review-revision-methods.js). Its Thai calendar is built in, so
// no holiday-set argument is threaded through this barrel; the canonical
// signature is addWorkingDays(start, days[, timeZone]), and passing a holiday
// Set as the 3rd arg would be read as a timezone.
// L-001 follow-through: that loader no longer exists at all — the calendar it
// duplicated now lives in exactly one file (utils/working-days.js), pinned by
// probe `holiday-single-source`.
const { addWorkingDays } = require('../../../../utils/working-days');
// R2 M3 (Law 3.5/3.6 — SSOT เลข 5): read the canonical 5-working-day window
// from config/business-rules.js instead of re-spelling the literal here.
// Same value, one defining source (grep-pinned by
// __tests__/unit/correction-round.test.js).
const { PAYMENT } = require('../../../../config/business-rules');
const REVISION_SLA_DAYS = PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS;
// Re-exported from shared/phase2-schedule-gate rather than defined here — see
// the note in scheduler-handler-deps.js. Three copies of the round-2 payment
// predicate existed; the write path that skipped it entirely is what let an
// unpaid application be scheduled for a field inspection.
const { isPhase2PaymentConfirmed } = require('../../../../shared/phase2-schedule-gate');
// Replaces inline prisma.invoice.findMany at workflow-handler-deps.js:52
// — same invoice-service.listSettlementsForApplication call site.
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
    // `prisma` is exported only as the transaction handle threaded into
    // `writeApplicationStatus` by downstream workflow handlers
    // (workflow-revision-expirations-handler.js, etc.) — same exception
    // pattern as `applications/applications-car.js` (batch 9).
    prisma,
    applicationService,
    invoiceService,
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    safeObject: obj,
    safeArray: arr,
    obj,
    arr,
    resolveUserIdFromHealthId,
    workflowTransitionService,
    getRequestIp,
    getRevisionDueAt,
    computePhaseSettlement,
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
    REVISION_SLA_DAYS,
    addWorkingDays,
    isPhase2PaymentConfirmed,
    isPhase2ReceiptIssued,
    ensureCertificateIssuedForApplication,
};
