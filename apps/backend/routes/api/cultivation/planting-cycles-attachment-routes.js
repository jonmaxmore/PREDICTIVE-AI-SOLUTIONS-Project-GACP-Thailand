'use strict';

/**
 * Planting-activity attachments — their own door (operator ruling C4,
 * 2026-09-30 "ทำทางแยก").
 *
 *   POST   /api/planting-cycles/:id/attachments?activityType=<TYPE>   (multipart `file`)
 *   DELETE /api/planting-cycles/:id/attachments/:attachmentId
 *
 * The planting-activity page used to upload through /applications/draft-documents,
 * which found or created an Application draft to hang the file on. This door
 * takes the cycle id, never an applicationId, and creates no Application row.
 *
 * Gates (the ones POST /:id/activities uses):
 *   - ensureCycleReachable: the cycle's farm is one the caller can reach, else 404;
 *   - requireCycleFarmPermission(ACTIVITY_<TYPE>): the per-type activity
 *     capability on that farm, else 403 ENTITY_PERMISSION_DENIED. The upload
 *     names the type in the query string, so the gate runs BEFORE multer and a
 *     refused caller writes no bytes.
 *   - DELETE (operator 2026-10-03 "แก้ได้"): the farm's OWNER, or the uploader
 *     while they still hold the capability the upload was authorised under
 *     (stored on the row); anyone else 403 ATTACHMENT_OWNERSHIP_DENIED. An
 *     attachment a saved activity carries is refused with 409
 *     PLANTING_ATTACHMENT_IN_USE, for everyone.
 *
 * Storage and scan are the draft-document pipeline (middleware/draft-document-upload.js
 * + services/upload-content-guard.js); the record is an Attachment row
 * (services/planting/planting-attachment-service.js). The response carries
 * documentId / fileName / fileUrl — the shape the page reads.
 */

const uploadContentGuard = require('../../../services/upload-content-guard');
const storageService = require('../../../services/storage-service');
const plantingAttachments = require('../../../services/planting/planting-attachment-service');
const {
  receiveDraftDocument,
  toUploadedFileUrl,
  unlinkStoredUpload,
} = require('../../../middleware/draft-document-upload');

const { ERROR_CODES } = require('../../../shared/error-codes');

const LOG_PREFIX = '[Planting Attachments]';

function registerAttachmentRoutes(router, deps) {
  const {
    ensureCycleReachable,
    requireCycleFarmPermission,
    resolveActivityPermission,
    getAuthenticatedUserId,
    logger,
  } = deps;

  // The activity type travels in the query string: the body is multipart and is
  // not parsed until multer runs, and the permission must be decided first.
  const uploadPermission = (req) => resolveActivityPermission({ body: { activityType: req.query?.activityType } });

  router.post(
    '/:id/attachments',
    ensureCycleReachable,
    requireCycleFarmPermission(uploadPermission),
    receiveDraftDocument,
    async (req, res) => {
      const uploadedFile = req.file;
      try {
        if (!uploadedFile) {
          if (req.uploadRejectionReason) {
            return res.status(400).json({ success: false, error: req.uploadRejectionCode || 'UPLOAD_REJECTED', message: req.uploadRejectionReason });
          }
          return res.status(400).json({ success: false, error: 'FILE_REQUIRED' });
        }

        // F-G4-08 — judge what is in the file, not what the sender says it is.
        // No slot: the default slot type applies, as it did for the
        // `planting_activity_<ts>` slot ids the page used to send.
        const contentVerdict = await uploadContentGuard.inspectStoredUpload(uploadedFile, null);
        if (!contentVerdict.ok) {
          await uploadContentGuard.discardRejectedUpload(uploadedFile);
          return res.status(400).json({
            success: false,
            error: contentVerdict.message,
            code: contentVerdict.code,
            message: contentVerdict.message,
          });
        }

        const cycleId = String(req.params.id);
        const organizationId = await plantingAttachments.cycleOrganizationId(cycleId);
        if (!organizationId) {
          await uploadContentGuard.discardRejectedUpload(uploadedFile);
          return res.status(404).json({ success: false, message: 'Planting cycle not found' });
        }

        const fileUrl = toUploadedFileUrl(uploadedFile);
        const fileName = storageService.decodeMultipartFilename(uploadedFile.originalname);
        const row = await plantingAttachments.recordCycleAttachment({
          cycleId,
          permission: uploadPermission(req),
          fileName,
          fileUrl,
          fileSize: uploadedFile.size,
          mimeType: uploadedFile.mimetype,
          absolutePath: uploadedFile.path,
          uploadedBy: getAuthenticatedUserId(req),
          organizationId,
        });

        return res.status(201).json({
          success: true,
          data: { documentId: row.id, fileName, fileUrl, mimeType: uploadedFile.mimetype, size: uploadedFile.size },
        });
      } catch (error) {
        logger.error(`${LOG_PREFIX} upload failed:`, error);
        if (uploadedFile) { await uploadContentGuard.discardRejectedUpload(uploadedFile); }
        return res.status(500).json({ success: false, error: 'Failed to upload planting attachment' });
      }
    },
  );

  // Loads the attachment of THIS cycle so the gate can re-check the capability
  // it was uploaded under. Not on this cycle (or already removed) → 404.
  async function loadCycleAttachment(req, res, next) {
    try {
      const row = await plantingAttachments.findLiveCycleAttachment(req.params.id, req.params.attachmentId);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Attachment not found' });
      }
      req.plantingAttachment = row;
      return next();
    } catch (error) {
      logger.error(`${LOG_PREFIX} attachment lookup failed:`, error);
      return res.status(500).json({ success: false, error: 'Failed to load planting attachment' });
    }
  }

  // Operator 2026-10-03 "แก้ได้": who may delete. The farm's OWNER may delete any
  // attachment on the farm; the uploader may delete their own while they still
  // hold the capability it was uploaded under (the gate below); anyone else 403.
  async function authorizeAttachmentDelete(req, res, next) {
    try {
      const userId = getAuthenticatedUserId(req);
      if (await plantingAttachments.isCycleFarmOwner(req.params.id, userId)) {
        req.plantingAttachmentDeleteAs = 'FARM_OWNER';
        return next();
      }
      if (req.plantingAttachment.uploadedBy && req.plantingAttachment.uploadedBy === userId) {
        req.plantingAttachmentDeleteAs = 'UPLOADER';
        return next();
      }
      const refusal = ERROR_CODES.ATTACHMENT_OWNERSHIP_DENIED;
      return res.status(403).json({ success: false, code: refusal.code, error: refusal.messageTh, message: refusal.messageTh });
    } catch (error) {
      logger.error(`${LOG_PREFIX} delete authorization failed:`, error);
      return res.status(500).json({ success: false, error: 'Failed to authorize planting attachment delete' });
    }
  }
  const uploaderCapabilityGate = requireCycleFarmPermission((req) => req.plantingAttachment?.field || null);
  const capabilityUnlessFarmOwner = (req, res, next) => (req.plantingAttachmentDeleteAs === 'FARM_OWNER'
    ? next()
    : uploaderCapabilityGate(req, res, next));

  router.delete(
    '/:id/attachments/:attachmentId',
    ensureCycleReachable,
    loadCycleAttachment,
    authorizeAttachmentDelete,
    capabilityUnlessFarmOwner,
    async (req, res) => {
      try {
        const row = req.plantingAttachment;
        // A saved activity carries this file: deleting it would leave the record
        // pointing at nothing. Refused for everyone, the OWNER included.
        if (await plantingAttachments.isAttachmentCarriedByActivity(req.params.id, row.id)) {
          const inUse = ERROR_CODES.PLANTING_ATTACHMENT_IN_USE;
          return res.status(409).json({ success: false, code: inUse.code, error: inUse.messageTh, message: inUse.messageTh });
        }
        await plantingAttachments.removeCycleAttachment(row.id, getAuthenticatedUserId(req));
        await unlinkStoredUpload(row.fileUrl, {
          logPrefix: LOG_PREFIX,
          context: `cycle=${req.params.id}, attachment=${row.id}`,
        });
        return res.json({ success: true, data: { documentId: row.id, deleted: true } });
      } catch (error) {
        logger.error(`${LOG_PREFIX} delete failed:`, error);
        return res.status(500).json({ success: false, error: 'Failed to delete planting attachment' });
      }
    },
  );
}

module.exports = { registerAttachmentRoutes };
