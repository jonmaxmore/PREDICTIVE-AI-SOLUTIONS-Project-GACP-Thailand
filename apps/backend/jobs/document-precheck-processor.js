'use strict';

/**
 * Bull sandboxed processor for the `document-precheck` queue
 * (services/queue-service.js runs it with `process(1, <this file>)`, so it
 * executes in its own child process, off the API server's event loop).
 *
 * The job carries `{ precheckId, absPath, mimeType }` — the file is not on
 * the row. Whether this is the last attempt is Bull's own bookkeeping
 * (`attemptsMade` failed attempts so far, `opts.attempts` in total);
 * `runPrecheck` uses it to decide between "rethrow so the queue retries"
 * and "write FAILED" (see the RETRY note in services/document-precheck/service.js).
 *
 * @param {{data: {precheckId: string, absPath: string, mimeType: string}, attemptsMade?: number, opts?: {attempts?: number}}} job
 * @returns {Promise<void>}
 */
async function processDocumentPrecheckJob(job) {
    const { runPrecheck } = require('../services/document-precheck/service');
    const data = (job && job.data) || {};
    const totalAttempts = (job && job.opts && job.opts.attempts) || 1;
    const thisAttempt = ((job && job.attemptsMade) || 0) + 1;
    await runPrecheck(data.precheckId, {
        absPath: data.absPath,
        mimeType: data.mimeType,
        isFinalAttempt: thisAttempt >= totalAttempts,
    });
}

module.exports = processDocumentPrecheckJob;
module.exports.processDocumentPrecheckJob = processDocumentPrecheckJob;
