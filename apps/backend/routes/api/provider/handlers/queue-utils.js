const workflowTransitionService = require('../../../../services/workflow-transition-service');
const { obj, arr, dt, getApplicantName } = require('./shared');

const getRevisionDueAt = (formData) => dt(obj(formData).revisionDueAt || obj(formData).revision_due_at);
const getRevisionRequestedAt = (formData) => dt(obj(formData).revisionRequestedAt || obj(formData).revision_requested_at);

const toReviewerQueueItem = (application, now = new Date()) => {
    const formData = obj(application.formData);
    const workflowState = workflowTransitionService.resolveStateFromApplication(application);
    const revisionDueAt = getRevisionDueAt(formData);
    const revisionRequestedAt = getRevisionRequestedAt(formData);
    const remainingMs = revisionDueAt ? (revisionDueAt.getTime() - now.getTime()) : null;
    const remainingHours = remainingMs === null ? null : Math.floor(remainingMs / (60 * 60 * 1000));
    const remainingDays = remainingMs === null ? null : Math.floor(remainingMs / (24 * 60 * 60 * 1000));
    // C3 ("งานนี้พาสไปที่ใคร"): expose who assigned this case so the reviewer
    // queue can show the job's origin ("มอบหมายโดย ..."). The user id resolves to
    // a display name in the dashboard handler (batched lookup); name stays null here.
    const providerAssignment = obj(formData.PROVIDERAssignment);

    return {
        id: application.id,
        applicationNumber: application.applicationNumber,
        status: application.status,
        workflowState,
        applicantName: getApplicantName(application.applicant),
        assignedById: providerAssignment.assignedBy || null,
        assignedByName: null,
        submittedAt: application.createdAt,
        updatedAt: application.updatedAt,
        revisionRequestedAt: revisionRequestedAt ? revisionRequestedAt.toISOString() : null,
        revisionDueAt: revisionDueAt ? revisionDueAt.toISOString() : null,
        sla: {
            remainingHours,
            remainingDays,
            isOverdue: !!revisionDueAt && remainingMs < 0,
            dueSoon: !!revisionDueAt && remainingMs >= 0 && remainingMs <= (48 * 60 * 60 * 1000),
        },
    };
};

const normalizeInspectionModeInput = (value) => {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) { return null; }
    if (raw === 'ONLINE') { return 'ONLINE_MEET'; }
    if (raw === 'ONLINE_MEET' || raw === 'ONSITE') { return raw; }
    return null;
};

const isValidHttpUrl = (value) => {
    if (!value) { return false; }
    try {
        const parsed = new URL(String(value));
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch (_error) {
        return false;
    }
};

const resolveAuditSchedule = (application) => {
    const formData = obj(application?.formData);
    const schedule = obj(formData.auditSchedule);
    // `dt` is new Date(v), and new Date(null) is the epoch: a VALID date. Feeding it `null`
    // made every unscheduled application read as "scheduled 1970-01-01".
    const rawScheduledDate = application?.scheduledDate || schedule.scheduledDate || null;
    const scheduledDate = rawScheduledDate ? dt(rawScheduledDate) : null;
    const inspectionMode = normalizeInspectionModeInput(
        schedule.inspectionMode
        || schedule.auditMode
        || formData.inspectionMode
        || formData.auditMode
        || (schedule.meetingLink ? 'ONLINE_MEET' : null)
        || (schedule.mapLink || schedule.location ? 'ONSITE' : null),
    ) || 'ONSITE';
    const estimatedDuration = Number.isFinite(Number(schedule.estimatedDuration))
        ? Math.min(600, Math.max(15, Number.parseInt(schedule.estimatedDuration, 10)))
        : 120;

    return {
        scheduledDate,
        scheduledDateISO: scheduledDate ? scheduledDate.toISOString() : null,
        inspectionMode,
        meetingLink: inspectionMode === 'ONLINE_MEET' ? (schedule.meetingLink || null) : null,
        mapLink: inspectionMode === 'ONSITE' ? (schedule.mapLink || null) : null,
        location: inspectionMode === 'ONSITE' ? (schedule.location || null) : null,
        notes: schedule.notes || null,
        estimatedDuration,
    };
};

// CAR-loop states — the only place where a MAJOR audit finding can sit
// awaiting a corrective-action review/reschedule. Once an application leaves
// these states (AUDIT_PASSED, APPROVED, CERTIFIED, AUDIT_FEE_PAID, etc.) it
// must NOT show up in the reschedule queue even if MAJOR appears anywhere
// in its history — that history is for the previous, already-resolved
// cycle. Without this gate, completed apps would clog the scheduler queue.
const CAR_LOOP_STATES = new Set(['CAR_PENDING', 'CAR_REVIEWING']);

const isMajorRescheduleCandidate = (application) => {
    if (!application) { return false; }
    const workflowState = workflowTransitionService.resolveStateFromApplication(application);
    if (!CAR_LOOP_STATES.has(workflowState)) {
        return false;
    }
    const workflowHistory = arr(application?.workflowHistory);
    for (let index = workflowHistory.length - 1; index >= 0; index -= 1) {
        const event = obj(workflowHistory[index]);
        // Auditor decisions land in different shapes across the codebase:
        //   - `event.decision: 'MAJOR'` (direct)
        //   - `event.metadata.decision: 'MAJOR'` (workflow-transition events)
        //   - `event.result.decision: 'MAJOR'` (audit decision events)
        // Plus a substring fallback on `reasonCode` for legacy events whose
        // shape was different again (`AUDITOR_MAJOR_FINDING`).
        const decision = String(
            event.decision
            || obj(event.metadata).decision
            || obj(event.result).decision
            || '',
        ).toUpperCase();
        const reasonCode = String(event.reasonCode || '').toUpperCase();
        if (decision === 'MAJOR' || reasonCode.includes('MAJOR')) {
            return true;
        }
    }
    return false;
};

const isMinorFollowupCandidate = (application) => {
    if (['CAR_PENDING', 'CAR_REVIEWING'].includes(String(application?.status || '').toUpperCase())) {
        return true;
    }
    const workflowHistory = arr(application?.workflowHistory);
    for (let index = workflowHistory.length - 1; index >= 0; index -= 1) {
        const event = obj(workflowHistory[index]);
        const decision = String(
            event.decision
            || obj(event.metadata).decision
            || obj(event.result).decision
            || '',
        ).toUpperCase();
        const reasonCode = String(event.reasonCode || '').toUpperCase();
        if (decision === 'MINOR' || reasonCode.includes('MINOR')) {
            return true;
        }
    }
    return false;
};

const buildSchedulerQueueItem = (application, auditorMap, paymentMap) => {
    const workflowState = workflowTransitionService.resolveStateFromApplication(application);
    const schedule = resolveAuditSchedule(application);
    const paymentState = paymentMap.get(application.id) || { phase2Paid: false, receiptIssued: false };
    const auditor = auditorMap.get(application.auditorId || '') || null;
    // C3 ("งานนี้พาสไปที่ใคร"): expose the assigned document reviewer so the
    // coordinator queue row can show who an already-assigned case was passed to.
    // Sourced from the assignment row the scheduler writes (formData.PROVIDERAssignment),
    // falling back to the canonical reviewerId column when selected. Null until assigned.
    const providerAssignment = obj(obj(application.formData).PROVIDERAssignment);
    const reviewerId = application.reviewerId || providerAssignment.reviewerId || null;
    const scheduledDate = schedule.scheduledDate;
    const now = Date.now();
    const overdueDays = scheduledDate && scheduledDate.getTime() < now
        ? Math.floor((now - scheduledDate.getTime()) / (24 * 60 * 60 * 1000))
        : 0;

    return {
        id: application.id,
        applicationId: application.id,
        applicationNumber: application.applicationNumber,
        status: application.status,
        workflowState,
        applicantName: getApplicantName(application.applicant),
        phase2Paid: paymentState.phase2Paid || String(application.phase2Status || '').toUpperCase() === 'PAID',
        receiptIssued: paymentState.receiptIssued,
        auditorId: application.auditorId || null,
        auditorName: auditor ? getApplicantName(auditor) : null,
        reviewerId,
        reviewerName: reviewerId ? (String(providerAssignment.reviewerName || '').trim() || null) : null,
        scheduledDate: schedule.scheduledDateISO,
        inspectionMode: schedule.inspectionMode,
        meetingLink: schedule.meetingLink,
        mapLink: schedule.mapLink,
        location: schedule.location,
        notes: schedule.notes,
        estimatedDuration: schedule.estimatedDuration,
        isRescheduleRequired: isMajorRescheduleCandidate(application),
        overdueDays: overdueDays > 0 ? overdueDays : 0,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
    };
};

const buildAuditorQueueItem = (application, auditorMap, paymentMap) => {
    const item = buildSchedulerQueueItem(application, auditorMap, paymentMap);
    const workflowState = item.workflowState;
    const receiptIssued = !!item.receiptIssued;
    const canStartInspection = workflowState === 'AUDIT_CONFIRMED' && receiptIssued;
    const canSubmitDecision = ['AUDIT_CONFIRMED', 'CAR_REVIEWING'].includes(workflowState);

    return {
        ...item,
        canStartInspection,
        canSubmitDecision,
        isMinorFollowup: isMinorFollowupCandidate(application),
        isMajorRescheduleRequired: isMajorRescheduleCandidate(application),
    };
};

const hasScheduleCollision = (existingSchedule, nextSchedule) => {
    const existingStart = dt(existingSchedule.start);
    const nextStart = dt(nextSchedule.start);
    if (!existingStart || !nextStart) { return false; }
    const existingEnd = new Date(existingStart.getTime() + (existingSchedule.durationMinutes * 60 * 1000));
    const nextEnd = new Date(nextStart.getTime() + (nextSchedule.durationMinutes * 60 * 1000));
    return existingStart < nextEnd && nextStart < existingEnd;
};

module.exports = {
    toReviewerQueueItem,
    getRevisionDueAt,
    normalizeInspectionModeInput,
    isValidHttpUrl,
    resolveAuditSchedule,
    isMajorRescheduleCandidate,
    buildSchedulerQueueItem,
    buildAuditorQueueItem,
    hasScheduleCollision,
};
