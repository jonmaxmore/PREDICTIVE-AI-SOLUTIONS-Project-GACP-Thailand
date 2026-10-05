/**
 * auditor-session-handler.js
 *
 * Backend API for persisting audit session data:
 * - GPS check-in (lat/lng/accuracy/distance/withinRadius)
 * - Watermarked evidence photos (metadata only — blob stored via upload endpoint)
 * - Live notes from online/onsite audit sessions
 * - Session duration tracking
 *
 * All data is saved into the application's formData.auditExecution object and
 * logged in the audit trail.
 *
 * NOTE: These handlers use Express middleware pattern (req, res, next).
 * Authentication is done via middleware in the router, not inline.
 */

const { randomUUID } = require('crypto');
const logger = require('../../../../shared/logger');
const { withVisibility } = require('../../../../shared/application-visibility');
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
} = require('../../../../middleware/audit-logger');
// Batch 10 — Prisma bypass cleanup. Direct entity reads/writes against
// prisma.application now route through application-service. No prisma client
// is imported here; all access is through the service boundary.
const applicationService = require('../../../../services/application-service');

/** Safely coerce a value to a plain object */
function safeObj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/** Strip HTML tags to prevent XSS in text fields */
function stripHtml(str) {
    return String(str || '').replace(/<[^>]*>/g, '');
}

/** Max length for live notes (10KB) */
const MAX_NOTES_LENGTH = 10_000;

/**
 * Wave A Phase 22 — load an Application by id, scoped to what the
 * authenticated user is allowed to see. Auditors get the visibility
 * filter; other roles fall through. 404 on a miss looks identical to
 * "not found" so we never leak existence to an unassigned auditor.
 */
async function findVisibleApplication(id, user) {
    // applicationService.findFirstWithWhere — replaces
    // prisma.application.findFirst with the visibility filter applied
    // by the caller.
    return applicationService.findFirstWithWhere({
        where: withVisibility({ id }, user),
    });
}

/**
 * POST /api/provider/auditor/applications/:id/session/checkin
 * Save GPS check-in data for an onsite audit.
 */
async function handleGPSCheckIn(req, res) {
    try {
        const { id } = req.params;
        const { latitude, longitude, accuracy, withinRadius, distanceMeters } = req.body;

        // Validate required fields
        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
            return res.status(400).json({ success: false, error: 'latitude and longitude are required numbers' });
        }

        // Validate GPS coordinate bounds
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return res.status(400).json({ success: false, error: 'latitude must be -90..90, longitude must be -180..180' });
        }

        const application = await findVisibleApplication(id, req.user);
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        const formData = safeObj(application.formData);
        const auditExecution = safeObj(formData.auditExecution);

        auditExecution.gpsCheckIn = {
            latitude,
            longitude,
            accuracy: typeof accuracy === 'number' ? accuracy : null,
            withinRadius: withinRadius === true,
            distanceMeters: typeof distanceMeters === 'number' ? distanceMeters : null,
            checkedInAt: new Date().toISOString(),
            checkedInBy: req.user.id,
        };

        formData.auditExecution = auditExecution;

        // applicationService.updateApplicationColumns — replaces
        // prisma.application.update for the formData stamp. Status is
        // unchanged here so a column update is the right operation.
        await applicationService.updateApplicationColumns(id, { formData });

        await auditLogger.log({
            action: 'AUDIT_GPS_CHECKIN',
            category: AuditCategory.AUDIT,
            severity: AuditSeverity.INFO,
            actorId: req.user.id,
            actorRole: req.user.role,
            resourceType: ResourceType.APPLICATION,
            resourceId: id,
            metadata: {
                latitude,
                longitude,
                accuracy,
                withinRadius,
                distanceMeters,
            },
        });

        logger.info('[auditor-session] GPS check-in saved', { applicationId: id, userId: req.user.id });
        return res.json({ success: true, data: auditExecution.gpsCheckIn });
    } catch (error) {
        logger.error('[auditor-session] GPS check-in failed:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * POST /api/provider/auditor/applications/:id/session/evidence
 * Save evidence photo metadata (watermark info, GPS data embedded in the image).
 */
async function handleSaveEvidence(req, res) {
    try {
        const { id } = req.params;
        const { photos } = req.body;

        if (!Array.isArray(photos) || photos.length === 0) {
            return res.status(400).json({ success: false, error: 'photos array is required' });
        }

        // Limit batch size to prevent abuse
        if (photos.length > 20) {
            return res.status(400).json({ success: false, error: 'Maximum 20 photos per request' });
        }

        const application = await findVisibleApplication(id, req.user);
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        const formData = safeObj(application.formData);
        const auditExecution = safeObj(formData.auditExecution);
        const existingPhotos = Array.isArray(auditExecution.evidencePhotos) ? auditExecution.evidencePhotos : [];

        const newPhotos = photos.map((photo) => ({
            id: photo.id || `photo-${randomUUID()}`,
            latitude: typeof photo.latitude === 'number' ? photo.latitude : null,
            longitude: typeof photo.longitude === 'number' ? photo.longitude : null,
            accuracy: typeof photo.accuracy === 'number' ? photo.accuracy : null,
            capturedAt: photo.capturedAt || new Date().toISOString(),
            applicationId: photo.applicationId || id,
            originalSize: typeof photo.originalSize === 'number' ? photo.originalSize : null,
            watermarkedSize: typeof photo.watermarkedSize === 'number' ? photo.watermarkedSize : null,
            uploadedBy: req.user.id,
            uploadedAt: new Date().toISOString(),
        }));

        auditExecution.evidencePhotos = [...existingPhotos, ...newPhotos];
        formData.auditExecution = auditExecution;

        // applicationService.updateApplicationColumns — replaces
        // prisma.application.update for the evidence-photo append.
        await applicationService.updateApplicationColumns(id, { formData });

        await auditLogger.log({
            action: 'AUDIT_EVIDENCE_SAVED',
            category: AuditCategory.AUDIT,
            severity: AuditSeverity.INFO,
            actorId: req.user.id,
            actorRole: req.user.role,
            resourceType: ResourceType.APPLICATION,
            resourceId: id,
            metadata: { photoCount: newPhotos.length },
        });

        logger.info('[auditor-session] Evidence saved', { applicationId: id, count: newPhotos.length });
        return res.json({ success: true, data: { savedCount: newPhotos.length, totalCount: auditExecution.evidencePhotos.length } });
    } catch (error) {
        logger.error('[auditor-session] Evidence save failed:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * POST /api/provider/auditor/applications/:id/session/notes
 * Save/update live notes and session duration from an online or onsite audit.
 */
async function handleSaveSessionNotes(req, res) {
    try {
        const { id } = req.params;
        const { liveNotes, durationSeconds, sessionType } = req.body;

        const application = await findVisibleApplication(id, req.user);
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        const formData = safeObj(application.formData);
        const auditExecution = safeObj(formData.auditExecution);

        if (typeof liveNotes === 'string') {
            const sanitized = stripHtml(liveNotes);
            auditExecution.liveNotes = sanitized.length > MAX_NOTES_LENGTH
                ? sanitized.slice(0, MAX_NOTES_LENGTH)
                : sanitized;
        }

        if (typeof durationSeconds === 'number' && durationSeconds >= 0) {
            auditExecution.durationSeconds = durationSeconds;
            const h = Math.floor(durationSeconds / 3600);
            const m = Math.floor((durationSeconds % 3600) / 60);
            const s = durationSeconds % 60;
            auditExecution.durationFormatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }

        if (typeof sessionType === 'string') {
            auditExecution.sessionType = sessionType;
        }

        auditExecution.lastSavedAt = new Date().toISOString();
        auditExecution.lastSavedBy = req.user.id;

        formData.auditExecution = auditExecution;

        // applicationService.updateApplicationColumns — replaces
        // prisma.application.update for the notes/duration stamp.
        await applicationService.updateApplicationColumns(id, { formData });

        logger.info('[auditor-session] Session notes saved', { applicationId: id, userId: req.user.id });
        return res.json({ success: true, data: { savedAt: auditExecution.lastSavedAt } });
    } catch (error) {
        logger.error('[auditor-session] Session notes save failed:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * GET /api/provider/auditor/applications/:id/session
 * Get the current audit session data.
 */
async function handleGetSession(req, res) {
    try {
        const { id } = req.params;

        const application = await findVisibleApplication(id, req.user);
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        const formData = safeObj(application.formData);
        const auditExecution = safeObj(formData.auditExecution);

        return res.json({ success: true, data: auditExecution });
    } catch (error) {
        logger.error('[auditor-session] Get session failed:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

module.exports = {
    handleGPSCheckIn,
    handleSaveEvidence,
    handleSaveSessionNotes,
    handleGetSession,
};
