/**
 * Surface a rejected file upload as a 400 on OPTIONAL-file routes.
 *
 * storage-service.createUploader's fileFilter rejects a spoofed/disallowed file
 * with `cb(null, false)` (not an Error — that fell through to Express's default
 * 500 handler) and stashes `req.uploadRejectionReason` + `req.uploadRejectionCode`.
 * On REQUIRED-file routes the route's own `if (!req.file) return 400` guard then
 * fires. But on OPTIONAL-file routes (farm `evidence_photo`)
 * a missing `req.file` is legitimate ("no file"), so a rejected upload is
 * indistinguishable from no upload and gets SILENTLY swallowed — the applicant
 * uploaded a bad file, gets no error, and believes it was saved.
 *
 * Mount this AFTER the multer middleware on those optional-file routes to turn a
 * stashed rejection into an explicit 400 UPLOAD_REJECTED. A genuinely-absent file
 * leaves the reason unset, so `next()` proceeds as before (no behaviour change
 * when no file, or a valid file, is sent).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function rejectBadUpload(req, res, next) {
    if (req.uploadRejectionReason) {
        return res.status(400).json({
            success: false,
            error: req.uploadRejectionCode || 'UPLOAD_REJECTED',
            message: req.uploadRejectionReason,
        });
    }
    return next();
}

module.exports = rejectBadUpload;
module.exports.rejectBadUpload = rejectBadUpload;
