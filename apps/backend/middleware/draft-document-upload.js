'use strict';

/**
 * The draft-document storage pipeline, shared by the two doors that take an
 * applicant's file: POST /api/applications/draft-documents and the planting
 * attachment door (POST /api/planting-cycles/:id/attachments, operator ruling C4
 * 2026-09-30). One uploader, one set of multer refusals, one served-URL rule and
 * one byte removal, so the two doors cannot drift apart. Moved here unchanged
 * from routes/api/applications/applications.js.
 *
 * The content check that follows the write (services/upload-content-guard.js
 * inspectStoredUpload / discardRejectedUpload) is called by each door itself,
 * because what a slot accepts is the door's decision.
 */

const path = require('path');
// B3 — a delete removes the uploaded bytes, not just the rows.
const fsPromises = require('fs/promises');
const storageService = require('../services/storage-service');
const { MAX_UPLOAD_BYTES, tooLargeRefusal } = require('@gacp/validation/upload-rules');
const logger = require('../shared/logger');

const DRAFT_UPLOAD_FOLDER = 'application-drafts';

const draftDocumentUpload = storageService.createUploader(
    DRAFT_UPLOAD_FOLDER,
    ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    // The ceiling is one number shared with the browser (F-G4-08 layer 3) —
    // multer aborts the write here, upload-content-guard refuses the same size
    // afterwards, and the wizard tells the farmer before either happens.
    MAX_UPLOAD_BYTES / (1024 * 1024),
);

/**
 * Receive the multipart body, and answer multer's own refusals properly.
 *
 * Multer aborts an oversize upload mid-write and calls next(err). This route
 * mounts the uploader as inline middleware with no 4-arg error handler between
 * it and Express's default one, so a farmer who picked a 25 MB scan of a land
 * title got HTTP 500 and the English words "File too large" (measured
 * 2026-08-26). That is layer 3 of F-G4-08 announcing itself as a server crash.
 *
 * The size limit is a rule a farmer can act on, so it is answered in Thai,
 * naming the cause and the next action — with 413 FILE_TOO_LARGE, the status and
 * code every multer size refusal gets (middleware/request-limit-errors.js, which
 * also answers the other LIMIT_* refusals passed on below). Multer reports
 * neither the original filename nor the real size for an aborted write, which is
 * why the shared module has a builder that needs neither.
 */
function receiveDraftDocument(req, res, next) {
    draftDocumentUpload.single('file')(req, res, (err) => {
        if (!err) {
            return next();
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
            const refusal = tooLargeRefusal();
            return res.status(413).json({
                success: false,
                error: refusal.message,
                code: refusal.code,
                message: refusal.message,
            });
        }
        return next(err);
    });
}

/**
 * The served URL of a file the uploader above stored.
 * @param {object|undefined} file multer file object
 * @returns {string|null}
 */
function toUploadedFileUrl(file) {
    if (!file) { return null; }
    const fullPath = String(file.path || '').trim();
    if (!fullPath) { return null; }
    return `/uploads/${DRAFT_UPLOAD_FOLDER}/${path.basename(fullPath)}`;
}

/**
 * B3 — delete the bytes behind one stored upload.
 *
 * A record only stores the served `fileUrl` (`/uploads/<...>`), so the disk
 * path is derived from it and then handed to storage-service's ONE containment
 * check, which is what refuses a `..`-poisoned record. Nothing outside the
 * uploads root is ever unlinked; a refusal is logged, not silently swallowed.
 *
 * Never throws: the records are already gone by the time this runs, so a missing
 * or already-unlinked file must not turn a successful delete into a 500.
 *
 * @param {string|undefined|null} fileUrlInput the stored `/uploads/...` URL
 * @param {{ logPrefix: string, context: string }} where the caller's log prefix and ids
 */
async function unlinkStoredUpload(fileUrlInput, { logPrefix, context }) {
    const fileUrl = String(fileUrlInput || '').trim();
    if (!fileUrl.startsWith('/uploads/')) {
        if (fileUrl) {
            logger.warn(`${logPrefix} Not an /uploads path — refusing to unlink (${context}).`);
        }
        return;
    }
    const candidate = path.join(storageService.BASE_UPLOAD_DIR, fileUrl.slice('/uploads/'.length));
    const safePath = storageService.resolveWithinUploads(candidate);
    if (!safePath) {
        logger.warn(`${logPrefix} Refusing to unlink a path outside the uploads root (${context}).`);
        return;
    }
    try {
        await fsPromises.unlink(safePath);
    } catch (err) {
        if (err?.code !== 'ENOENT') {
            logger.warn(`${logPrefix} unlink failed (non-fatal): ${err?.message}`);
        }
    }
}

module.exports = {
    receiveDraftDocument,
    toUploadedFileUrl,
    unlinkStoredUpload,
};
