'use strict';

/**
 * `extractDocument(absPath, mimeType, opts)` — file → per-page text, fully
 * local. The only unit in the document-precheck feature that touches a
 * file (see design note 2026-09-27-document-precheck-design
 * §2's "หน่วยงานแยกความรับผิดชอบ" list).
 *
 * Order of attempts (task-4-brief.md):
 *  1. A PDF page with a text layer is read via pdf-parse v2's
 *     `PDFParse#getText()`. Its pages get `confidence: 100`.
 *  2. A PDF page with no text (scanned/image) is rasterised with
 *     `PDFParse#getScreenshot()` (for pages within `maxPages`), then OCR'd
 *     through `services/ocr/tesseract-service.js`.
 *  3. A JPEG or PNG image goes straight to that same OCR path.
 *  4. Anything else, a 0-byte file, or an encrypted PDF (pdf-parse throws
 *     its password exception) returns `method: 'NONE'`, `pages: []`.
 *
 * `pdf-parse` here is v2 (`const { PDFParse } = require('pdf-parse')`), not
 * the v1 function API the old `services/ocr-service.js` called — see this
 * feature's spec §8. That file was deleted in Task 10 (2026-09-28).
 *
 * Fix round 1: every PDFParse call (getInfo/getText/getScreenshot) runs
 * inside a forked child process (`pdf-extract-worker.js`), not here. See
 * that file's header for why — short version: pdf-parse's Node fake-worker
 * setup does a real dynamic `import()` that Jest's module sandbox rejects
 * without a flag the shared gate does not set; a forked `node` process is
 * unaffected by that sandbox. This module itself no longer requires
 * `pdf-parse` at all — only the child does.
 *
 * Fix round 2 (task-4-review.md):
 *  - I1: a timeout now sets `inFlight.aborted`, checked (synchronously,
 *    before any further I/O) right after `readFile`, right before `fork`,
 *    and at the top of every `runOcr` call — so no new child or OCR work
 *    ever starts once the caller has given up, not only "whatever was
 *    already running gets killed". Each `extractDocument` call also gets
 *    its own OCR worker (`inFlight.ocrSession`, a fresh `TesseractService`
 *    instance — see that file's Fix round 2 note) instead of sharing the
 *    module-level singleton, so terminating it can never affect a
 *    different, concurrent `extractDocument` call.
 *  - I2: `runOcr` now throws when tesseract reports `success:false`,
 *    instead of returning a fake `{text:'', confidence:0}` page. A real OCR
 *    failure (including a misconfigured TESSDATA_PATH — see
 *    tesseract-service.js's `initialize()`) must reject this call so the
 *    caller retries then marks the job FAILED (spec line 68), not look like
 *    an ordinary unreadable scan.
 *  - Minor 2: the forked child gets a minimal, explicit `env` and
 *    `execArgv` (a heap cap, I3) rather than inheriting this process's full
 *    environment and V8 flags.
 *
 * @module services/document-precheck/extract
 */

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { TesseractService, TesseractTerminatedError } = require('../ocr/tesseract-service');
const { minimalChildEnv } = require('../../config/child-process-env');

const PDF_MIME_TYPE = 'application/pdf';
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

const EMPTY_RESULT = Object.freeze({ method: 'NONE', pageCount: 0, pages: [], truncated: false });

const PDF_WORKER_SCRIPT = path.join(__dirname, 'pdf-extract-worker.js');

/** I3 / Minor 2: the forked child's own heap cap, independent of this process's. */
const CHILD_EXEC_ARGV = ['--max-old-space-size=512'];

class PrecheckTimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PrecheckTimeoutError';
        this.code = 'PRECHECK_TIMEOUT';
    }
}

class PrecheckAbortedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PrecheckAbortedError';
        this.code = 'PRECHECK_ABORTED';
    }
}

/**
 * @param {string} absPath
 * @param {string} mimeType
 * @param {{maxPages?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<{method: 'TEXT_LAYER'|'OCR'|'NONE', pageCount: number, pages: {text: string, confidence: number}[], truncated: boolean}>}
 */
async function extractDocument(absPath, mimeType, { maxPages = 10, timeoutMs = 60000 } = {}) {
    // Fix round 1+2: shared with the timeout handler below so a timeout can
    // (a) flip `aborted` so no NEW child/OCR work starts anywhere in the
    // call chain, and (b) kill whichever resource (forked pdf-extract-worker
    // child, this call's own OCR worker) is already in flight right when it
    // fires — not only after the losing branch of the race notices on its
    // own. `ocrSession` belongs exclusively to this one call (I1) — see
    // `runOcr` below.
    const inFlight = { child: null, ocrSession: null, aborted: false };

    let timer;
    const timeoutPromise = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            inFlight.aborted = true;
            if (inFlight.child) {
                inFlight.child.kill('SIGKILL');
            }
            if (inFlight.ocrSession) {
                inFlight.ocrSession.terminate().catch(() => {});
            }
            reject(new PrecheckTimeoutError(`document-precheck extraction exceeded ${timeoutMs}ms`));
        }, timeoutMs);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    });

    try {
        return await Promise.race([runExtraction(absPath, mimeType, maxPages, inFlight), timeoutPromise]);
    } finally {
        clearTimeout(timer);
        if (inFlight.ocrSession) {
            await inFlight.ocrSession.terminate().catch(() => {});
        }
    }
}

/** I1: throws once a timeout has fired, so no further I/O (fork/OCR) starts on the losing branch. */
function assertNotAborted(inFlight) {
    if (inFlight.aborted) {
        throw new PrecheckAbortedError('document-precheck extraction aborted after timeout');
    }
}

async function runExtraction(absPath, mimeType, maxPages, inFlight) {
    const buffer = await fs.promises.readFile(absPath);
    assertNotAborted(inFlight); // I1 checkpoint 1: right after readFile

    if (buffer.length === 0) {
        return EMPTY_RESULT;
    }

    if (mimeType === PDF_MIME_TYPE) {
        return extractFromPdf(absPath, maxPages, inFlight);
    }

    if (IMAGE_MIME_TYPES.has(mimeType)) {
        const page = await runOcr(buffer, inFlight);
        return { method: 'OCR', pageCount: 1, pages: [page], truncated: false };
    }

    return EMPTY_RESULT;
}

async function extractFromPdf(absPath, maxPages, inFlight) {
    const childResult = await runPdfWorkerChild(absPath, maxPages, inFlight);

    if (childResult.encrypted) {
        return EMPTY_RESULT;
    }

    const pageCount = childResult.pageCount || 0;
    const truncated = Boolean(childResult.truncated);
    const rawPages = childResult.pages || [];
    if (rawPages.length === 0) {
        return { method: 'NONE', pageCount, pages: [], truncated };
    }

    const pages = [];
    let usedOcr = false;
    for (const raw of rawPages) {
        if (raw.kind === 'TEXT') {
            pages.push({ text: raw.text, confidence: 100 });
            continue;
        }
        usedOcr = true;
        const ocrPage = await runOcr(Buffer.from(raw.pngBase64, 'base64'), inFlight);
        pages.push(ocrPage);
    }

    return {
        method: usedOcr ? 'OCR' : 'TEXT_LAYER',
        pageCount,
        pages,
        truncated,
    };
}

/**
 * Runs `pdf-extract-worker.js` in a forked child process and returns its
 * accumulated per-page messages plus the final `{type:'done', ...}` fields.
 * See that file's header for why this exists and for the per-page IPC
 * protocol (I3: one message per page, not one giant final message). The
 * child is killed on every settle path — success, worker-reported error,
 * early exit, or IPC error — and `inFlight.child` is cleared right after,
 * so `extractDocument`'s timeout handler never kills a process that already
 * finished.
 *
 * @param {string} absPath
 * @param {number} maxPages
 * @param {{child: import('child_process').ChildProcess|null, aborted: boolean}} inFlight
 * @returns {Promise<{pageCount?: number, truncated?: boolean, encrypted?: boolean, pages: Array<{kind: 'TEXT', text: string}|{kind: 'IMAGE', pngBase64: string}>}>}
 */
function runPdfWorkerChild(absPath, maxPages, inFlight) {
    assertNotAborted(inFlight); // I1 checkpoint 2: right before fork
    return new Promise((resolve, reject) => {
        const child = fork(PDF_WORKER_SCRIPT, [], {
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            env: minimalChildEnv(),
            execArgv: CHILD_EXEC_ARGV,
        });
        inFlight.child = child;
        let settled = false;
        const pagesByIndex = [];

        function settle(fn, arg) {
            if (settled) {
                return;
            }
            settled = true;
            inFlight.child = null;
            child.kill('SIGKILL');
            fn(arg);
        }

        child.on('message', (msg) => {
            if (!msg) {
                return;
            }
            if (msg.type === 'page') {
                pagesByIndex.push(msg);
                return;
            }
            if (msg.type !== 'done') {
                return;
            }
            if (msg.ok) {
                pagesByIndex.sort((a, b) => a.index - b.index);
                settle(resolve, {
                    pageCount: msg.pageCount,
                    truncated: msg.truncated,
                    encrypted: msg.encrypted,
                    pages: pagesByIndex,
                });
            } else {
                settle(reject, new Error(msg.error || 'pdf-extract-worker: unknown error'));
            }
        });
        child.on('error', (err) => settle(reject, err));
        child.on('exit', (code, signal) => {
            settle(reject, new Error(`pdf-extract-worker exited before replying (code=${code}, signal=${signal})`));
        });

        child.send({ type: 'extract', absPath, maxPages });
    });
}

/**
 * Runs one OCR pass on this call's own worker (`inFlight.ocrSession`,
 * created here on first use and reused for the rest of this call's pages —
 * I1: never the shared module-level singleton, so terminating it — from
 * here, from `extractDocument`'s top-level cleanup, or from its timeout
 * handler — can never affect a different, concurrent `extractDocument`
 * call). Throws when tesseract itself reports failure (I2) instead of
 * returning a fake unreadable page.
 *
 * @param {Buffer} buffer
 * @param {{ocrSession: InstanceType<typeof TesseractService>|null, aborted: boolean}} inFlight
 * @returns {Promise<{text: string, confidence: number}>}
 */
async function runOcr(buffer, inFlight) {
    assertNotAborted(inFlight); // I1 checkpoint 3: right before each OCR call
    if (!inFlight.ocrSession) {
        inFlight.ocrSession = new TesseractService();
    }
    let result;
    try {
        result = await inFlight.ocrSession.extractText(buffer);
    } catch (error) {
        // Fix round 4: the timeout terminated this call's OCR session while
        // its worker was starting. That is the same abort every other
        // checkpoint reports, not a separate OCR failure.
        if (error instanceof TesseractTerminatedError) {
            throw new PrecheckAbortedError('document-precheck extraction aborted after timeout');
        }
        throw error;
    }
    if (!result.success) {
        throw new Error(`document-precheck OCR failed: ${result.error || 'unknown tesseract error'}`);
    }
    return { text: (result.text || '').trim(), confidence: result.confidence };
}

module.exports = { extractDocument, PrecheckTimeoutError, PrecheckAbortedError };
