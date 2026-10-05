/**
 * Audit Re-assignment Routes
 * Allows schedulers to reassign audits to different auditors
 */

const { assignedOfficerName } = require('../../../shared/assigned-officer-name');
const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { providerOnly } = require('../../../middleware/role-middleware');
// `prisma` is retained ONLY as a transaction handle for tracked-writer,
// which requires the client by contract (same exception called out in
// applications/applications-car.js). All direct prisma.X.find/update
// calls in this file have been replaced with service-layer methods as
// part of the Batch 11 audit-cluster cleanup.
const { prisma } = require('../../../services/prisma-database');
const { sendNotification, NotifyType } = require('../../../services/notification-service');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { trackedUpdate } = require('../../../services/tracked-writer');
const {
  auditLogger,
  AuditCategory,
  AuditSeverity,
  ResourceType,
} = require('../../../middleware/audit-logger');
const applicationService = require('../../../services/application-service');
const providerUserService = require('../../../services/provider-user-service');
const { recordAssignment } = require('../../../services/assignment-ledger-service');
const logger = require('../../../shared/logger');
const { runSlotBooking } = require('../../../services/audit-scheduling-service');
const { lookup: lookupErrorCode } = require('../../../shared/error-codes');
const { rebindEvidenceAuditor } = require('../../../services/audit/arm-onsite-evidence');
// A reviewer may not also inspect the same application (operator ruling 2026-10-05).
const { assertInspectorIsNotReviewer, answerSeparation } = require('../../../shared/reviewer-inspector-separation');

// Only scheduler and admin roles may reassign audits
const REASSIGN_ROLES = [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, CANONICAL_ROLES.DISPATCHER];

// Auditor reassignment is only valid once an auditor has been assigned (the
// auditor-workflow states). Mirrors the reviewer-reassign gate and MUST match
// the states `listReassignableAudits` surfaces (application-provider-query-
// methods.js) — otherwise the POST accepts an app the LIST never offered. The
// reviewer mirror had this gate; the auditor route did not, so an auditor could
// be reassigned on a pre-payment app (e.g. PENDING_DOC_FEE) — provider-E2E
// carpet 2026-07-09, MEDIUM.
const REASSIGNABLE_AUDIT_STATES = new Set([
  'AUDIT_CONFIRMED', 'CAR_PENDING', 'CAR_REVIEWING', 'EXPIRED',
]);

router.get('/reassignable', authenticateProvider, providerOnly, async (req, res) => {
  try {
    // Batch 11: service-layer indirection. The service enforces
    // `isDeleted: false` and the canonical status set at one boundary
    // so the route cannot drift to a wider audit-row surface.
    const applications = await applicationService.listReassignableAudits();

    const now = new Date();
    const formatted = applications.map(app => {
      // `typeof null === 'object'` — guard null explicitly or formData.* below NPEs.
      const formData = typeof app.formData === 'object' && app.formData ? app.formData : {};
      const workflowState = String(formData.workflowState || app.status || '').toUpperCase();
      const daysOverdue = app.scheduledDate
        ? Math.floor((now - new Date(app.scheduledDate)) / (1000 * 60 * 60 * 24))
        : 0;

      return {
        id: app.id,
        applicationNumber: app.applicationNumber,
        applicantName: app.applicant ? `${app.applicant.firstName} ${app.applicant.lastName}` : 'ไม่ระบุ',
        plantType: formData.plantName || 'ไม่ระบุ',
        status: workflowState || app.status,
        currentAuditorId: app.auditorId,
        currentAuditor: assignedOfficerName({
          officerId: app.auditorId,
          officer: app.auditor,
          storedName: formData.auditorName,
        }),
        scheduledDate: app.scheduledDate,
        daysOverdue: daysOverdue > 0 ? daysOverdue : 0,
      };
    });

    res.json({ success: true, data: { applications: formatted } });
  } catch (error) {
    logger.error('[Reassignable Audits] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch applications' });
  }
});

router.post('/:id/reassign', authenticateProvider, providerOnly, async (req, res) => {
  // AUDIT-FB01: Only scheduler/admin can reassign
  const callerRole = normalizeRole(req.user?.role);
  if (!callerRole || !REASSIGN_ROLES.includes(callerRole)) {
    return res.status(403).json({
      success: false,
      error: 'Only schedulers and admins can reassign audits',
    });
  }
  try {
    const { id } = req.params;
    const { newAuditorId, reason } = req.body;

    if (!newAuditorId || !reason) {
      return res.status(400).json({
        success: false,
        error: 'newAuditorId and reason are required',
      });
    }

    // PR-1.6 follow-up: tenant-scope BOTH lookups. The application lookup
    // is the IDOR vector — without org filter, any provider in tenant A
    // could reassign an audit in tenant B. The newAuditor lookup is also
    // scoped because reassignment must stay within the same tenant; you
    // can't assign tenant A's audit to a tenant B auditor.
    //
    // Batch 11: both lookups now route through service-layer helpers so
    // the canonical tenant + soft-delete predicates can't be sidestepped
    // by an in-route prisma call.
    const orgId = req.user?.organizationId || req.tenantContext?.organizationId || null;
    const application = await applicationService.findAuditApplication({
      where: orgId ? { id, organizationId: orgId } : { id },
      include: {
        applicant: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (!application) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    // State gate (mirrors scheduler-reviewer-reassign-handler): only reassign an
    // auditor while the app is actually in an auditor-workflow state.
    if (!REASSIGNABLE_AUDIT_STATES.has(application.status)) {
      return res.status(409).json({
        success: false,
        error: `Application is in ${application.status}, expected one of: ${[...REASSIGNABLE_AUDIT_STATES].join(', ')}`,
      });
    }

    const newAuditor = await providerUserService.findReassignmentTargetUser({
      id: newAuditorId,
      organizationId: orgId,
    });

    if (!newAuditor || newAuditor.isDeleted || String(newAuditor.status).toUpperCase() !== 'ACTIVE' || !newAuditor.providerId) {
      return res.status(404).json({ success: false, error: 'Auditor not found' });
    }

    // provider-UAT-round2 2026-07-09 (LOW): reassign target must be a strict
    // AUDITOR — the assign gate (scheduler-audit-schedules-post-handler) and the
    // audit-decision handler both require canonicalRole==='auditor', so accepting
    // a document_reviewer here dead-ends the audit (the new auditor-of-record can
    // never record a decision). Match the strict assign eligibility.
    const canonicalRole = normalizeRole(newAuditor.role);
    if (canonicalRole !== CANONICAL_ROLES.FIELD_INSPECTOR) {
      return res.status(400).json({ success: false, error: 'Selected provider is not eligible for auditor assignment (must be an AUDITOR)' });
    }

    try {
      assertInspectorIsNotReviewer({ reviewerId: application.reviewerId, auditorId: newAuditorId });
    } catch (sodError) {
      if (answerSeparation(res, sodError)) { return undefined; }
      throw sodError;
    }

    const oldAuditorId = application.auditorId;
    // `typeof null === 'object'` — guard null explicitly, else the
    // `currentFormData._reassignmentHistory` spread below NPEs when formData is null.
    const currentFormData = typeof application.formData === 'object' && application.formData ? application.formData : {};

    // Wave A Phase 47 (G3 consumer #1) — route the auditor reassignment
    // through tracked-writer.trackedUpdate so the auditorId change is
    // recorded in the audit log via a canonical writer instead of an
    // ad-hoc emission. trackedFields=['auditorId'] scopes the audit
    // entry to the meaningful change; the formData update piggybacks
    // in the same atomic Prisma update without participating in
    // change tracking.
    // One transaction: Application.auditorId AND the live AuditChecklist row move together.
    // Writing only the application left the new inspector locked out of the field app
    // (403 AUDIT_AUDITOR_MISMATCH: onsite.js and audit-onsite-service compare the checklist row).
    // Same Serializable slot rule as the booking doors: the new inspector must be free on the
    // visit date. An application with no visit date yet has nothing to check.
    const visitAt = application.scheduledDate ? new Date(application.scheduledDate) : null;
    await runSlotBooking(prisma, {
      auditorId: newAuditorId,
      scheduledAt: visitAt && !Number.isNaN(visitAt.getTime()) ? visitAt : null,
      excludeApplicationId: application.id,
      durationMinutes: currentFormData.auditSchedule?.estimatedDuration || 120,
    }, async (tx) => {
      await trackedUpdate({
        prisma: tx,
        model: 'application',
        where: { id },
        data: {
          auditorId: newAuditorId,
          formData: {
            ...currentFormData,
            auditorName: `${newAuditor.firstName} ${newAuditor.lastName}`,
            _reassignmentHistory: [
              ...(currentFormData._reassignmentHistory || []),
              {
                from: oldAuditorId,
                to: newAuditorId,
                reason,
                reassignedBy: req.user?.id,
                reassignedAt: new Date().toISOString(),
              },
            ],
          },
        },
        trackedFields: ['auditorId'],
        beforeState: { auditorId: oldAuditorId },
        actorId: req.user?.id || null,
        actorRole: req.user?.canonicalRole || req.user?.role || null,
        reason: `AUDITOR_REASSIGNED: ${reason || ''}`.trim(),
        onAudit: async ({ recordId, changes, actorId, actorRole, reason: auditReason }) => {
          for (const c of changes) {
            await auditLogger.log({
              category: AuditCategory.APPLICATION,
              severity: AuditSeverity.HIGH,
              action: `application.${c.field}.changed`,
              resourceType: ResourceType.APPLICATION,
              resourceId: recordId,
              actorId,
              actorRole,
              metadata: {
                field: c.field,
                before: c.before,
                after: c.after,
                reason: auditReason,
              },
            });
          }
        },
      });
      await rebindEvidenceAuditor(tx, {
        applicationId: application.id,
        auditorId: newAuditorId,
        actorId: req.user?.id || null,
      });
    });

    await sendNotification(newAuditorId, NotifyType.AUDIT_ASSIGNED, {
      applicationNumber: application.applicationNumber,
      applicationId: application.id,
      applicantName: `${application.applicant.firstName} ${application.applicant.lastName}`,
    });

    if (oldAuditorId) {
      await sendNotification(oldAuditorId, NotifyType.AUDIT_REASSIGNED, {
        applicationNumber: application.applicationNumber,
        reason,
      });
    }

    if (application.applicant?.id) {
      await sendNotification(application.applicant.id, NotifyType.AUDITOR_CHANGED, {
        applicationNumber: application.applicationNumber,
        newAuditorName: `${newAuditor.firstName} ${newAuditor.lastName}`,
      });
    }

    // Work-distribution ledger (best-effort; never blocks the reassignment):
    // records who moved the audit off `oldAuditorId` onto the new assignee.
    await recordAssignment({
      prisma,
      entityType: 'APPLICATION',
      entityId: application.id,
      action: 'REASSIGN',
      assigneeUserId: newAuditorId,
      assignedByUserId: req.user?.id || null,
      // The WORK role, not the assignee's personal role: this route always
      // reassigns AUDITOR work (it sets application.auditorId), even when the
      // target happens to hold document_reviewer. Logging the work role keeps
      // the fairness `?role=auditor` filter accurate + matches every other emit
      // site (which hardcodes/derives the work role).
      role: 'auditor',
      previousAssigneeUserId: oldAuditorId || null,
      // source = the channel (this scheduler/admin reassign route), NOT the actor
      // role — the actor is already captured in assignedByUserId. 'ADMIN_BATCH' is
      // reserved for the admin bulk-actions endpoint. Mirrors the reviewer-reassign
      // handler so both reassign routes label their channel consistently.
      source: 'SCHEDULER',
      reason,
      organizationId: application.organizationId || orgId,
    });

    logger.info(`[Reassign] Application ${application.applicationNumber} reassigned to ${newAuditor.firstName} ${newAuditor.lastName}`);

    res.json({
      success: true,
      message: 'Audit reassigned successfully',
      data: {
        applicationId: application.id,
        newAuditor: {
          id: newAuditor.id,
          name: `${newAuditor.firstName} ${newAuditor.lastName}`,
        },
      },
    });
  } catch (error) {
    if (error && error.statusCode === 409 && error.code) {
      const row = lookupErrorCode(error.code);
      return res.status(409).json({ success: false, code: error.code, error: error.message, messageTh: row ? row.messageTh : undefined, data: error.data });
    }
    logger.error('[Reassign] Error:', error);
    res.status(500).json({ success: false, error: safeErrorMessage(error) });
  }
});

module.exports = router;
