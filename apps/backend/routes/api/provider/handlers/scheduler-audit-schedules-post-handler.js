const {
    authenticateProvider,
    logger,
    PERMISSIONS,
    normalizeRole,
    requireCanonicalPermission,
    toInt,
    obj,
    arr,
    dt,
    prisma,
    CANONICAL_ROLES,
    workflowTransitionService,
    getRequestIp,
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
    normalizeInspectionModeInput,
    isValidHttpUrl,
    resolveAuditSchedule,
    hasScheduleCollision,
    getApplicantName,
    resolveUserIdFromHealthId,
    isPhase2PaymentConfirmed,
    isWorkingDay,
} = require('./scheduler-handler-deps');
const { buildWorkflowEvent } = require('../../../../shared/workflow-event-builder');
const { writeApplicationStatus } = require('../../../../services/application-status-writer');
// One Thai builder for the farmer's and the inspector's notice, shared with the queue door
// (audit-scheduling-service.assignAuditor) so the two cannot word it differently again.
const { notifyAuditScheduled } = require('../../../../services/audit/audit-schedule-notices');
// One place decides whether a confirmed audit arms the evidence chain — the other
// scheduling door calls the same function, so the rule cannot drift between them.
const { armOnsiteEvidence, rebindEvidenceAuditor } = require('../../../../services/audit/arm-onsite-evidence');
// The per-inspector-per-day cap and the overlap rule live in the queue door's service. The
// calendar used to check overlap only, so the cap held on one door and not the other.
const schedulingService = require('../../../../services/audit-scheduling-service');
const schedulingInternals = schedulingService._internals;
const { lookup: lookupErrorCode } = require('../../../../shared/error-codes');
// A reviewer may not also inspect the same application (operator ruling 2026-10-05).
const { assertInspectorIsNotReviewer, answerSeparation } = require('../../../../shared/reviewer-inspector-separation');
// Batch 10 — Prisma bypass cleanup. Scheduler-side application/user reads
// route through application-service + provider-user-service so the projection
// and the ACTIVE/non-deleted filters live at the service boundary. `prisma`
// stays as the transaction handle for writeApplicationStatus only.
const applicationService = require('../../../../services/application-service');
const providerUserService = require('../../../../services/provider-user-service');
// Closing-review NEW-2 (2026-05-15): mask the raw 13-digit identifier before
// writing it into the hash-chained audit row (PDPA Section 27).
const { maskThaiId } = require('../../../../utils/field-encryption');

/** Answer a slot refusal (AUDITOR_BUSY / AUDITOR_OVER_CAP / AUDITOR_SLOT_CONFLICT); true when it did. */
function answerSlotError(res, slotError) {
    if (!(slotError && slotError.statusCode === 409 && slotError.code)) { return false; }
    const row = lookupErrorCode(slotError.code);
    res.status(409).json({
        success: false,
        code: slotError.code,
        error: slotError.message,
        messageTh: row ? row.messageTh : undefined,
        data: slotError.data,
    });
    return true;
}

const schedulerAuditSchedulesPost = [
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_SCHEDULE),
    async (req, res) => {
        try {
            const applicationIdInput = String(req.body?.applicationId || '').trim();
            const auditorId = String(req.body?.auditorId || '').trim();
            const scheduledDate = dt(req.body?.scheduledDate);
            const inspectionMode = normalizeInspectionModeInput(req.body?.inspectionMode || req.body?.auditMode);
            const meetingLink = req.body?.meetingLink || req.body?.meetingUrl || null;
            const mapLink = req.body?.mapLink || null;
            const location = req.body?.location || null;
            const notes = req.body?.notes || null;
            const estimatedDuration = toInt(req.body?.estimatedDuration, 120, 15, 600);

            if (!applicationIdInput || !auditorId || !scheduledDate) {
                return res.status(400).json({ success: false, error: 'applicationId, auditorId, scheduledDate are required' });
            }
            if (!inspectionMode) {
                return res.status(400).json({ success: false, error: 'inspectionMode must be ONSITE or ONLINE_MEET' });
            }
            if (scheduledDate.getTime() <= Date.now()) {
                return res.status(400).json({ success: false, error: 'scheduledDate must be in the future' });
            }
            if (!isWorkingDay(scheduledDate)) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot schedule on weekends or Thai public holidays (ไม่สามารถนัดหมายในวันหยุดราชการหรือวันเสาร์-อาทิตย์ได้)',
                });
            }
            if (inspectionMode === 'ONLINE_MEET' && !meetingLink) {
                return res.status(400).json({ success: false, error: 'meetingLink is required for ONLINE_MEET mode' });
            }
            if (inspectionMode === 'ONLINE_MEET' && !isValidHttpUrl(meetingLink)) {
                return res.status(400).json({ success: false, error: 'meetingLink must be a valid URL' });
            }
            if (inspectionMode === 'ONSITE' && !mapLink && !location) {
                return res.status(400).json({ success: false, error: 'mapLink or location is required for ONSITE mode' });
            }
            if (mapLink && !isValidHttpUrl(mapLink)) {
                return res.status(400).json({ success: false, error: 'mapLink must be a valid URL' });
            }

            // applicationService.findFirstWithWhere — replaces
            // prisma.application.findFirst with the OR(id, applicationNumber)
            // predicate (no visibility filter at this stage — scheduler sees
            // every application in the tenant).
            const app = await applicationService.findFirstWithWhere({
                where: {
                    OR: [{ id: applicationIdInput }, { applicationNumber: applicationIdInput }],
                    isDeleted: false,
                },
                select: {
                    id: true,
                    applicationNumber: true,
                    healthId: true,
                    status: true,
                    phase2Status: true,
                    auditorId: true,
                    reviewerId: true,
                    scheduledDate: true,
                    formData: true,
                    workflowHistory: true,
                    // Needed by armOnsiteEvidence below: AuditChecklist.organizationId is
                    // required, and this projection did not carry it.
                    organizationId: true,
                },
            });
            if (!app) { return res.status(404).json({ success: false, error: 'Application not found' }); }

            // One door books a first visit (AUDIT_FEE_PAID) and moves one already booked
            // (AUDIT_CONFIRMED). The calendar's "เลื่อนนัด" button posts here, and this used
            // to accept AUDIT_FEE_PAID only, so a reschedule from the screen was a 400.
            const currentState = workflowTransitionService.resolveStateFromApplication(app);
            if (currentState !== 'AUDIT_FEE_PAID' && currentState !== 'AUDIT_CONFIRMED') {
                return res.status(400).json({
                    success: false,
                    error: `Application must be in AUDIT_FEE_PAID (to schedule) or AUDIT_CONFIRMED (to reschedule) (current: ${currentState})`,
                });
            }
            const isReschedule = currentState === 'AUDIT_CONFIRMED';

            const paymentConfirmed = await isPhase2PaymentConfirmed(app);
            if (!paymentConfirmed) {
                return res.status(400).json({
                    success: false,
                    error: 'Phase 2 payment must be confirmed before scheduling',
                });
            }

            // providerUserService.findActiveProviderById — replaces
            // prisma.user.findFirst for the active-provider lookup.
            //
            // X3-FIX-D / SC-TEN-1 (2026-05-18) — pass `organizationId` so the
            // auditor lookup is tenant-scoped. Before this fix a SCHEDULER in
            // tenant A could assign tenant B's auditor (defense-in-depth gap;
            // single-tenant deployment so no live exploit). Mirrors the
            // audits-reassign.js:97-105 pattern that already tenant-scopes
            // BOTH the application and auditor lookups via the same
            // req.user.organizationId resolution. When `organizationId` is
            // unresolvable (legacy actor row), the lookup falls back to the
            // global filter so we don't break existing valid assignments.
            const orgId = req.user?.organizationId || req.tenantContext?.organizationId || null;
            const auditor = await providerUserService.findActiveProviderById(
                orgId ? { id: auditorId, organizationId: orgId } : auditorId,
            );
            if (!auditor) {
                // X3-FIX-D / SC-TEN-1 — return 404 (not 400) when the auditor
                // is invisible because of the tenant filter. 404 is the
                // canonical "anti-enumeration" response that does not leak
                // whether the auditor exists in another tenant.
                return res.status(404).json({ success: false, error: 'Auditor account not found or inactive' });
            }
            if (normalizeRole(auditor.role) !== CANONICAL_ROLES.FIELD_INSPECTOR) {
                return res.status(400).json({ success: false, error: 'auditorId must belong to auditor role' });
            }
            try {
                assertInspectorIsNotReviewer({ reviewerId: app.reviewerId, auditorId });
            } catch (sodError) {
                if (answerSeparation(res, sodError)) { return undefined; }
                throw sodError;
            }

            const searchWindowStart = new Date(scheduledDate.getTime() - (12 * 60 * 60 * 1000));
            const searchWindowEnd = new Date(scheduledDate.getTime() + (12 * 60 * 60 * 1000));
            // applicationService.findAuditorScheduleCandidates — replaces
            // prisma.application.findMany for the auditor-collision window.
            const candidateSchedules = await applicationService.findAuditorScheduleCandidates({
                auditorId,
                excludeApplicationId: app.id,
                windowStart: searchWindowStart,
                windowEnd: searchWindowEnd,
            });

            const conflicting = candidateSchedules.find((candidate) => {
                const candidateSchedule = resolveAuditSchedule(candidate);
                return hasScheduleCollision(
                    {
                        start: candidateSchedule.scheduledDate,
                        durationMinutes: candidateSchedule.estimatedDuration,
                    },
                    {
                        start: scheduledDate,
                        durationMinutes: estimatedDuration,
                    },
                );
            });
            if (conflicting) {
                const candidateSchedule = resolveAuditSchedule(conflicting);
                return res.status(409).json({
                    success: false,
                    error: 'Auditor schedule collision detected',
                    data: {
                        conflictingApplicationId: conflicting.id,
                        conflictingApplicationNumber: conflicting.applicationNumber,
                        conflictingScheduledDate: candidateSchedule.scheduledDateISO,
                    },
                });
            }

            // Same cap and overlap rule as the queue door (AUDITOR_MAX_PER_DAY per Bangkok day).
            try {
                await schedulingInternals._assertSlotAvailable(prisma, {
                    auditorId,
                    scheduledAt: scheduledDate,
                    excludeApplicationId: app.id,
                    durationMinutes: estimatedDuration,
                });
            } catch (slotError) {
                if (answerSlotError(res, slotError)) { return undefined; }
                throw slotError;
            }

            const ts = new Date().toISOString();
            const fd = obj(app.formData);
            const wh = arr(app.workflowHistory);
            const previousSchedule = resolveAuditSchedule(app);
            const scheduleAction = (isReschedule || previousSchedule.scheduledDate) ? 'AUDIT_RESCHEDULED' : 'AUDIT_SCHEDULED';
            const healthUserId = await resolveUserIdFromHealthId(app.healthId);

            const auditScheduleRecord = {
                ...obj(fd.auditSchedule),
                scheduledDate: scheduledDate.toISOString(),
                auditorId,
                // The queue door stores the inspector's name beside the id; this door did not,
                // so a reader without the user join (the farmer's detail page fallback) had none.
                auditorName: getApplicantName(auditor) || null,
                inspectionMode,
                meetingLink: inspectionMode === 'ONLINE_MEET' ? meetingLink : null,
                mapLink: inspectionMode === 'ONSITE' ? (mapLink || null) : null,
                location: inspectionMode === 'ONSITE' ? (location || null) : null,
                notes,
                estimatedDuration,
                scheduledBy: req.user.id,
                scheduledAt: ts,
                ...(isReschedule ? { rescheduledAt: ts, rescheduledBy: req.user.id } : {}),
            };
            const scheduleEvent = buildWorkflowEvent({
                action: scheduleAction,
                fromState: currentState,
                toState: 'AUDIT_CONFIRMED',
                actorId: req.user.id,
                actorRole: req.user.canonicalRole || req.user.role || null,
                metadata: {
                    auditorId,
                    inspectionMode,
                    meetingLink: inspectionMode === 'ONLINE_MEET' ? meetingLink : null,
                    mapLink: inspectionMode === 'ONSITE' ? (mapLink || null) : null,
                    location: inspectionMode === 'ONSITE' ? (location || null) : null,
                    previousScheduledDate: previousSchedule.scheduledDateISO,
                    previousAuditorId: app.auditorId || null,
                },
            });
            const scheduledFormData = {
                ...fd,
                workflowState: 'AUDIT_CONFIRMED',
                workflowStateUpdatedAt: ts,
                auditSchedule: auditScheduleRecord,
            };

            // Availability check + write in ONE Serializable transaction (bounded P2034 retry, shared
            // with the queue door): the probe above is only a fast-fail, two dispatchers racing for
            // the last slot are decided here.
            const slot = {
                auditorId,
                scheduledAt: scheduledDate,
                excludeApplicationId: app.id,
                durationMinutes: estimatedDuration,
            };
            let evidence;
            try {
            if (isReschedule) {
                // AUDIT_CONFIRMED -> AUDIT_CONFIRMED is not an edge the status writer
                // allows, and nothing about the status changes: the date (and maybe the
                // inspector) does. The row, the evidence row and the inspector's name on it
                // move in ONE transaction so the application never says "inspector B" while
                // the evidence row still says "inspector A" (B would be locked out of the
                // field app with AUDIT_AUDITOR_MISMATCH).
                evidence = await schedulingService.runSlotBooking(prisma, slot, async (tx) => {
                    await tx.application.update({
                        where: { id: app.id },
                        data: {
                            auditorId,
                            scheduledDate,
                            updatedBy: req.user.id,
                            formData: scheduledFormData,
                            workflowHistory: [...wh, scheduleEvent],
                        },
                    });
                    const armed = await armOnsiteEvidence(tx, {
                        applicationId: app.id,
                        auditorId,
                        organizationId: app.organizationId,
                        createdBy: req.user.id,
                        inspectionMode,
                    });
                    await rebindEvidenceAuditor(tx, { applicationId: app.id, auditorId, actorId: req.user.id });
                    return armed;
                });
            } else {
                evidence = await schedulingService.runSlotBooking(prisma, slot, async (tx) => {
                await writeApplicationStatus({
                    prisma: tx,
                    applicationId: app.id,
                    fromStatus: app.status,
                    toStatus: 'AUDIT_CONFIRMED',
                    actorId: req.user.id,
                    actorRole: req.user.canonicalRole || req.user.role || null,
                    reason: scheduleAction,
                    additionalData: {
                        auditorId,
                        scheduledDate,
                        updatedBy: req.user.id,
                        formData: scheduledFormData,
                        workflowHistory: [...wh, scheduleEvent],
                    },
                });
                // Arm the evidence chain. This door reached AUDIT_CONFIRMED without it until
                // 2026-08-25: the onsite evidence gate counts photos and checklist items keyed
                // to an AuditChecklist row, so a scheduler booking through the calendar produced
                // an audit that could be carried out in full and still never issue a
                // certificate, failing at the last state with NO_ONSITE_AUDIT and no earlier
                // sign that anything was wrong.
                //
                // Shared with the /api/audit/scheduling/assign door rather than duplicated —
                // two copies of an evidence rule drift, and this is what drift cost.
                return armOnsiteEvidence(tx, {
                    applicationId: app.id,
                    auditorId,
                    organizationId: app.organizationId,
                    createdBy: req.user.id,
                    inspectionMode,
                });
                });
            }
            } catch (slotError) {
                if (answerSlotError(res, slotError)) { return undefined; }
                throw slotError;
            }

            // Re-fetch with select shape (canonical writer doesn't expose select option).
            // applicationService.getById — replaces prisma.application.findUnique
            // for the post-write projection (canonical writer doesn't expose select).
            const updated = await applicationService.getById(app.id, {
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    auditorId: true,
                    scheduledDate: true,
                    formData: true,
                },
            });

            // Farmer and inspector, same Thai text and Bangkok date as the queue door.
            await notifyAuditScheduled({
                farmerUserId: healthUserId,
                auditorId,
                applicationId: app.id,
                applicationNumber: app.applicationNumber,
                scheduledAt: scheduledDate,
                auditorName: getApplicantName(auditor),
                inspectionMode,
                location,
                mapLink,
                meetingLink,
                rescheduled: scheduleAction === 'AUDIT_RESCHEDULED',
                previousScheduledAt: previousSchedule.scheduledDate,
            });

            try {
                await auditLogger.log({
                    category: AuditCategory.APPLICATION,
                    action: scheduleAction,
                    severity: scheduleAction === 'AUDIT_RESCHEDULED' ? AuditSeverity.WARNING : AuditSeverity.INFO,
                    actorId: req.user.id || 'SYSTEM',
                    actorRole: req.user.canonicalRole || req.user.role || 'UNKNOWN',
                    actorType: 'PROVIDER',
                    resourceType: ResourceType.APPLICATION,
                    resourceId: app.id,
                    ipAddress: getRequestIp(req),
                    userAgent: req.get('user-agent'),
                    metadata: {
                        applicationNumber: app.applicationNumber,
                        scheduledDate: scheduledDate.toISOString(),
                        inspectionMode,
                        meetingLink: inspectionMode === 'ONLINE_MEET' ? meetingLink : null,
                        mapLink: inspectionMode === 'ONSITE' ? (mapLink || null) : null,
                        location: inspectionMode === 'ONSITE' ? (location || null) : null,
                        estimatedDuration,
                        auditorId,
                        auditorName: getApplicantName(auditor),
                        previousScheduledDate: previousSchedule.scheduledDateISO,
                        previousAuditorId: app.auditorId || null,
                        actorIdentity: maskThaiId(req.user.providerId) || maskThaiId(req.user.healthId) || null,
                    },
                });
            } catch (auditError) {
                logger.warn('[provider] schedule audit log failed:', { message: auditError.message, applicationId: app.id });
            }

            // A third-party calendar export used to run here (removed 2026-07-25
            // PDPA audit). It sent the applicant's name, the farm name,
            // the farm's map link/address, both parties' e-mail addresses and the
            // inspection date out of the country, and asked the vendor to e-mail the
            // citizen and the DTAM officer directly. It has been removed for good.
            //
            // Nothing is lost: the schedule itself is the `formData.auditSchedule`
            // record written to Postgres by writeApplicationStatus() above, the
            // hash-chained audit row is written above, and both parties are told
            // in-app (createNotification above) with e-mail/SMS fan-out handled by
            // the notification service. No third party is involved in inspection
            // scheduling — please do not re-add one. If calendar interop is ever
            // requested, attach a locally generated .ics to the existing
            // notification e-mail instead.

            return res.status(201).json({
                success: true,
                data: {
                    ...updated,
                    workflowState: 'AUDIT_CONFIRMED',
                    inspectionMode,
                    // Told at scheduling time, not discovered at issuance: an ONLINE_MEET
                    // audit arms no evidence chain and cannot lead to a certificate.
                    evidenceArmed: evidence.armed,
                    canLeadToCertificate: evidence.canLeadToCertificate,
                    evidenceNote: evidence.reason,
                    meetingLink: inspectionMode === 'ONLINE_MEET' ? meetingLink : null,
                    mapLink: inspectionMode === 'ONSITE' ? (mapLink || null) : null,
                    location: inspectionMode === 'ONSITE' ? (location || null) : null,
                    estimatedDuration,
                    // Retained as constant nulls so the response shape is unchanged
                    // for existing clients — they only ever saw nulls here, because
                    // the export was never configured in any environment.
                    calendarEventId: null,
                    calendarHtmlLink: null,
                },
                message: scheduleAction === 'AUDIT_RESCHEDULED'
                    ? 'Audit rescheduled successfully'
                    : 'Audit scheduled successfully',
            });
        } catch (error) {
            logger.error('[provider] create audit schedule failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to schedule audit',
            });
        }
    },
];

module.exports = {
    schedulerAuditSchedulesPost,
};
