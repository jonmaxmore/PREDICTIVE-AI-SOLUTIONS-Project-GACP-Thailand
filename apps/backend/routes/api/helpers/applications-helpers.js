const { normalizeHealthDashboardStage } = require('../../../shared/health-dashboard-stage');
const { isRenewalFiling } = require('../../../shared/instalment-service-names');

function mapHealthApplication(app) {
    const certificateCount = Array.isArray(app?.certificates) ? app.certificates.length : 0;
    const hasCertificate = certificateCount > 0;
    const dashboardStage = normalizeHealthDashboardStage({
        status: app?.status,
        phase1Status: app?.phase1Status,
        phase2Status: app?.phase2Status,
        workflowState: app?.formData?.workflowState || null,
        formData: app?.formData,
        hasCertificate,
        certificateCount,
    }, { hasCertificate, certificateCount });

    return {
        id: app.id,
        applicationNumber: app.applicationNumber,
        plantName: app.plantName || (app.formData?.plantName),
        serviceType: app.serviceType,
        status: app.status,
        workflowState: app.formData?.workflowState || null,
        phase1Status: app.phase1Status || null,
        phase2Status: app.phase2Status || null,
        // `estimatedFee` was sent here: a stored column no screen read, and for a renewal
        // not its price (round 4, operator 2026-10-03). Removed rather than kept wrong.
        createdAt: app.createdAt,
        submittedAt: app.submittedAt,
        dashboardStage,
        hasCertificate,
        // fix/fee-line-descriptions round 3: a renewal shares PENDING_AUDIT_FEE with a new
        // filing's second instalment; the list names the charge from this, not the status.
        isRenewal: isRenewalFiling(app),
        // 2026-04-30 — surface the revision deadline so the list view can
        // show a countdown badge for REVISION_REQUESTED without an extra
        // round-trip per row. ISO string or null.
        revisionDueAt: app.formData?.revisionDueAt || null,
        // CAR deadline (Corrective Action Report) — same purpose, different
        // formData key. Camel + snake-case fallback because both shapes
        // exist in the DB depending on which provider handler wrote it.
        carDueAt: app.formData?.carDueAt || app.formData?.car_due_at || null,
    };
}

/**
 * One item of GET /applications/my. It used to add `fees: { phase1, phase2 }` priced as
 * a new filing for EVERY application — a renewal was sent the phase-2 figure. No web or
 * mobile screen reads it (round 4 grep), so it is not sent; the amount a screen shows
 * comes from the application's invoice / quotation / the detail payload.
 */
function mapMyApplication(app) {
    return {
        ...mapHealthApplication(app),
        scheduledDate: app.scheduledDate,
        audit: { mode: app.formData?.auditMode, meetingUrl: app.formData?.meetingUrl, location: app.formData?.auditLocation, auditorId: app.auditorId },
    };
}

function getHealthScopeOptions(user) {
    const healthId = String(user?.healthId || '').trim();
    if (healthId) {
        return { healthId, strictHealthId: true };
    }
    return { strictHealthId: true };
}

function getActorIdentity(user) {
    const providerId = String(user?.providerId || '').trim();
    if (providerId) {
        return providerId;
    }

    const healthId = String(user?.healthId || '').trim();
    if (healthId) {
        return healthId;
    }

    return String(user?.id || '').trim() || null;
}

module.exports = {
    mapHealthApplication,
    mapMyApplication,
    getHealthScopeOptions,
    getActorIdentity,
};
