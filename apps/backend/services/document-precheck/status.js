'use strict';

/**
 * The document pre-check's row states and the one flag a FAILED row carries.
 *
 * Their own module so that clear-text.js (the PDPA clear, which also fails a
 * still-PENDING row) and service.js (which owns the row's life and requires
 * clear-text.js) read one definition without requiring each other.
 * service.js re-exports both.
 *
 * @module services/document-precheck/status
 */

const { PRECHECK_FAILED_TH } = require('@gacp/validation/precheck-copy');

const PRECHECK_STATUS = Object.freeze({
    PENDING: 'PENDING',
    DONE: 'DONE',
    FAILED: 'FAILED',
    SUPERSEDED: 'SUPERSEDED',
});

/**
 * The one flag a FAILED row carries. Its words are the shared constant the
 * applicant card and the officer row print too (walk D5: one wording).
 */
const FAILURE_FLAG = Object.freeze({
    check: 'READABILITY',
    result: 'UNREADABLE',
    reasonTH: PRECHECK_FAILED_TH,
    confidence: 0,
});

module.exports = { PRECHECK_STATUS, FAILURE_FLAG };
