/**
 * What to answer when a request goes past a limit on what the server will read
 * (BACK-16, audit 2026-09-17, and the wave-1 review of SECU-02 / BACK-01).
 *
 * Two libraries refuse a request before any route sees it, and both hand the
 * refusal to the global error handler in server.js:
 *   - multer, for a multipart body past a door's `limits`
 *     (shared/multipart-limits.js). A MulterError carries `code` but no status,
 *     so the handler answered 500 INTERNAL_SERVER_ERROR and logged a stack;
 *   - body-parser, for a JSON or form body past middleware/body-parsers.js.
 *     Its error carries status 413 and `type`, but no `code`, so the handler
 *     answered 413 REQUEST_FAILED with body-parser's English words, and logged a
 *     stack for every oversize request.
 *
 * Both are the sender's doing, so they are answered as client errors:
 *   413  too big or too many (a file, the files, the form fields, the body);
 *   400  malformed or unexpected (a bracketed field name, a file in a field the
 *        door does not take).
 * Each code has a catalogue row in shared/error-codes.js; the Thai sentence
 * comes from that row. It is sent as `message` too, because the web client
 * shows `error` (= `message`) to the user — the same convention as the three
 * routes that answer LIMIT_FILE_SIZE themselves (applications.js, onsite.js,
 * harvest-batches.js), which answer 413 FILE_TOO_LARGE with their door's own
 * ceiling in the sentence.
 *
 * Pinned by __tests__/unit/request-limit-refusals-reach-the-client-honestly.test.js,
 * which drives the handler cut out of server.js with real multer and body-parser
 * refusals.
 */
'use strict';

const { lookup } = require('../shared/error-codes');

// multer's own codes (multer/lib/multer-error.js). The test reads multer's
// source and fails if multer can raise a code that is not listed here.
const MULTER_REFUSALS = Object.freeze({
    LIMIT_FILE_SIZE: { status: 413, code: 'FILE_TOO_LARGE' },
    LIMIT_FILE_COUNT: { status: 413, code: 'TOO_MANY_FILES' },
    LIMIT_FIELD_KEY: { status: 413, code: 'FORM_LIMIT_EXCEEDED' },
    LIMIT_FIELD_VALUE: { status: 413, code: 'FORM_LIMIT_EXCEEDED' },
    LIMIT_FIELD_COUNT: { status: 413, code: 'FORM_LIMIT_EXCEEDED' },
    LIMIT_PART_COUNT: { status: 413, code: 'FORM_LIMIT_EXCEEDED' },
    LIMIT_UNEXPECTED_FILE: { status: 400, code: 'UNEXPECTED_FILE_FIELD' },
    LIMIT_FIELD_NESTING: { status: 400, code: 'MALFORMED_FORM_DATA' },
    LIMIT_FIELD_ARRAY_INDEX: { status: 400, code: 'MALFORMED_FORM_DATA' },
    MISSING_FIELD_NAME: { status: 400, code: 'MALFORMED_FORM_DATA' },
    INVALID_FIELD_NAME: { status: 400, code: 'MALFORMED_FORM_DATA' },
});

// body-parser's size and count refusals (`err.type`), both answered 413 by it.
const BODY_PARSER_REFUSALS = Object.freeze({
    'entity.too.large': { status: 413, code: 'REQUEST_BODY_TOO_LARGE' },
    'parameters.too.many': { status: 413, code: 'REQUEST_BODY_TOO_LARGE' },
});

const MAX_LOGGED_PATH = 200;
const MAX_LOGGED_FIELD = 100;

function own(table, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}

/** The path without its query string: tokens travel in query strings. */
function loggedPath(req) {
    return String(req?.originalUrl || req?.url || '').split('?', 1)[0].slice(0, MAX_LOGGED_PATH);
}

/**
 * @param {unknown} err  what reached the error handler
 * @param {import('express').Request} req
 * @returns {null | { response: object, logMessage: string, logMeta: object }}
 *   null when `err` is not a request-limit refusal. Otherwise the payload for
 *   sendErrorResponse, and a warn line that carries no stack.
 */
function requestLimitRefusal(err, req) {
    if (!err || typeof err !== 'object') { return null; }

    // MulterError sets name 'MulterError'. The three route-level handlers match
    // on the code alone; here the name is required as well, so an unrelated
    // error that happens to carry a LIMIT_* code keeps its own handling.
    const fromMulter = err.name === 'MulterError' ? own(MULTER_REFUSALS, err.code) : null;
    const fromBodyParser = fromMulter ? null : own(BODY_PARSER_REFUSALS, err.type);
    const mapping = fromMulter || fromBodyParser;
    if (!mapping) { return null; }

    const row = lookup(mapping.code);
    const limitBytes = fromBodyParser && Number.isFinite(err.limit) ? err.limit : null;

    return {
        response: {
            status: mapping.status,
            code: mapping.code,
            message: row.messageTh,
            messageTh: row.messageTh,
            details: limitBytes !== null ? { limitBytes } : null,
        },
        logMessage: `[request-limit] ${mapping.status} ${mapping.code}`,
        logMeta: {
            cause: fromMulter ? err.code : err.type,
            method: req?.method,
            path: loggedPath(req),
            ...(fromMulter && typeof err.field === 'string' ? { field: err.field.slice(0, MAX_LOGGED_FIELD) } : {}),
            ...(limitBytes !== null ? { limitBytes } : {}),
            ...(fromBodyParser && Number.isFinite(err.length) ? { lengthBytes: err.length } : {}),
        },
    };
}

module.exports = { requestLimitRefusal, MULTER_REFUSALS, BODY_PARSER_REFUSALS };
