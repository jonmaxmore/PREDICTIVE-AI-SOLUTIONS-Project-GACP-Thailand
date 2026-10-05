/**
 * How much JSON and form data the server reads before it knows who sent it.
 *
 * BACK-01 (audit 2026-09-17): server.js parsed every JSON and urlencoded body up
 * to 10 MB, on every path, ahead of the rate limiter and authentication, and
 * then passed the result to the input-inspection middleware. The API needs far
 * less:
 *   - every file is sent as multipart and read by multer. These parsers skip
 *     multipart bodies, so upload routes are unaffected by the limits here;
 *   - the Stripe webhook is a single event, well under 1 MB. Its exact bytes
 *     are still kept (keepRawBody) for signature verification;
 *   - the one JSON body that can legitimately exceed 1 MB is the herb-knowledge
 *     bulk import. services/herb-knowledge-service.js accepts up to 2,000 rows.
 *     The SSRU source files average about 860 bytes a row (266 KB for 308 rows in
 *     scripts/herb-content/data), so a full import is about 1.7 MB. That path,
 *     and only that path, is allowed 5 MB.
 *
 * Pinned by __tests__/unit/body-parser-limits.test.js, which sends real request
 * streams through these parsers.
 */
'use strict';

const express = require('express');

const DEFAULT_BODY_LIMIT = '1mb';
const HERB_IMPORT_BODY_LIMIT = '5mb';

// POST /api/herbs/:code/entries/import, and its /api/v1 alias. Express matches
// routes case-insensitively and ignores a trailing slash, so this does too.
// Anchored at both ends, so the check is linear.
const HERB_IMPORT_PATH = /^\/api(?:\/v1)?\/herbs\/[^/]+\/entries\/import\/?$/i;

// Webhook signatures are computed over the exact bytes the gateway sent, and
// express.json() re-serialises the body, so keep the original bytes
// (routes/api/webhooks/stripe.js reads req.rawBody).
function keepRawBody(req, _res, buf) {
    if (buf && buf.length) { req.rawBody = buf; }
}

function isHerbImport(req) {
    return req.method === 'POST' && HERB_IMPORT_PATH.test(String(req.url || '').split('?', 1)[0]);
}

/**
 * Mount the JSON and urlencoded parsers on an app or router, at its root.
 * @param {import('express').Router} app
 */
function mountBodyParsers(app) {
    const herbImportJson = express.json({ limit: HERB_IMPORT_BODY_LIMIT, verify: keepRawBody });
    // A body-parser that has read the body marks the request, and the parsers
    // after it skip that request. So the larger allowance runs first, and only
    // on its own path.
    app.use((req, res, next) => (isHerbImport(req) ? herbImportJson(req, res, next) : next()));
    app.use(express.json({ limit: DEFAULT_BODY_LIMIT, verify: keepRawBody }));
    app.use(express.urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
}

module.exports = { mountBodyParsers, DEFAULT_BODY_LIMIT, HERB_IMPORT_BODY_LIMIT };
