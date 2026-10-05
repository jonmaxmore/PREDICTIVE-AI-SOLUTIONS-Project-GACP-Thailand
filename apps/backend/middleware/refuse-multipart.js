/**
 * Answer a multipart body with 415 before anything reads it.
 *
 * SECU-02 (audit 2026-09-17): POST /auth/health/register ran
 * `upload.single('idCardImage')` before authentication and before validation,
 * so anyone who could reach the door could make multer parse any multipart body.
 * multer 2.2.0 can be crashed by one such request (GHSA-wc9g-mqfw-jrwm). The door
 * never needed multipart:
 *   - the web register page and the routed mobile screen (RegistrationScreen)
 *     both post JSON;
 *   - the uploaded ID-card image was never linked to the account.
 *     prisma-auth-service `_sanitizeInput` drops the key and nothing refers to the
 *     file, so every upload left an orphaned copy of a national ID card on disk;
 *   - a multipart registration could not pass the schema anyway: the consent
 *     flags are z.boolean(), and multipart carries only strings.
 *
 * Without multer on the route, a multipart body would reach validate() with an
 * empty req.body and get a confusing "field required" answer. This middleware
 * says what is actually wrong instead, and leaves the body unread. Node discards
 * the unread body once the response has been sent.
 */
'use strict';

const { sendErrorResponse } = require('../shared/api-response');

// Anchored and fixed-length, so a hostile header costs a constant amount of work.
const MULTIPART = /^\s*multipart\//i;

function refuseMultipart(req, res, next) {
    if (MULTIPART.test(String(req.headers['content-type'] || ''))) {
        return sendErrorResponse(res, req, {
            status: 415,
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'This endpoint accepts application/json only; multipart/form-data is not accepted',
        });
    }
    return next();
}

module.exports = refuseMultipart;
module.exports.refuseMultipart = refuseMultipart;
