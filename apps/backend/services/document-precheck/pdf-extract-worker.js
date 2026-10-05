'use strict';

/**
 * PDF-parsing child process, forked by `extract.js` for every PDF.
 *
 * Fix round 1 (task-4-report.md): pdf-parse v2 / pdfjs-dist 5.x sets up its
 * Node "fake worker" (no real worker thread in Node) via a genuine dynamic
 * `import()` of `pdf.worker.mjs` on the FIRST call to `getInfo()`/
 * `getText()`/`getScreenshot()` — not at `require('pdf-parse')` time. Read
 * before writing this file: `pdf-parse`'s own `LoadParameters` has no
 * `disableWorker` flag; `PDFParse.setWorker(workerSrc)` only replaces the
 * URL that same `import()` call target — it does not remove the import();
 * `GlobalWorkerOptions.workerPort`'s setter throws unless given a real
 * `Worker` instance, which would need this exact import() to construct in
 * the first place. None of pdf-parse's public surface avoids the dynamic
 * import (checked in `dist/pdf-parse/cjs/index.cjs`, not guessed).
 *
 * Jest's own module sandbox (jest-runtime — not Node itself) throws on that
 * dynamic import() unless the whole gate is run with
 * `--experimental-vm-modules`, which the shared `jest.config.cjs` gate does
 * not set (and Fix round 1's brief: do not add it there without asking,
 * since that flag changes every suite). A forked child process is a fresh
 * `node <this file>` invocation — the same runtime production already
 * calls pdf-parse from — so the import() that Jest's VM blocks never runs
 * inside Jest's VM at all; it runs in this ordinary process, where plain
 * Node's dynamic import always worked (verified with a throwaway
 * `node -e` reproduction before this file was written).
 *
 * Fix round 2 (task-4-review.md):
 *  - I3: `getScreenshot()`'s `scale` is no longer a fixed 2 — it is chosen
 *    per page from that page's own MediaBox (`getInfo({parsePageInfo:true})`)
 *    so the rasterised long side never exceeds `MAX_RASTER_LONG_SIDE_PX`. A
 *    PDF that declares an enormous page (the review's example: 14400×14400
 *    pt) no longer asks pdf-parse's Node canvas backend for a
 *    proportionally enormous bitmap.
 *  - I3: pages are sent to the parent one IPC message at a time (`type:
 *    'page'`) as they finish, not batched into one giant final message; a
 *    defensive per-page byte cap (`MAX_PAGE_IMAGE_BYTES`) also exists in
 *    case the scale cap above is ever bypassed (e.g. a future change).
 *  - Minor 1: exits immediately on `disconnect` (parent died/was killed)
 *    instead of continuing to parse an orphaned job.
 *  - Minor 4: encrypted-PDF detection prefers `instanceof PasswordException`
 *    (pdf-parse exports the real class), falling back to the `err.name`
 *    string match only if that export is ever absent.
 *
 * Protocol: parent sends exactly one `{type:'extract', absPath, maxPages}`
 * over `child_process.fork()`'s IPC channel; this replies with zero or more
 * `{type:'page', index, kind, ...}` messages (one per page that needed
 * text-layer-or-OCR extraction), then exactly one `{type:'done', ...}`
 * message, then the parent kills this process (see extract.js's
 * `runPdfWorkerChild`). No network; the only file this reads is `absPath`.
 *
 * @module services/document-precheck/pdf-extract-worker
 */

const fs = require('fs');
const { PDFParse, PasswordException } = require('pdf-parse');
const { scaleForPage } = require('./pdf-raster-scale');

/**
 * I3 defensive backstop: `pdf-raster-scale.js`'s `MAX_RASTER_LONG_SIDE_PX`
 * should always keep a single page's raster well under this. If it somehow
 * does not (a future change to the scale math, or pdf-parse changing what
 * `scale` means), the extraction fails cleanly instead of sending an
 * unbounded IPC message.
 */
const MAX_PAGE_IMAGE_BYTES = 12 * 1024 * 1024;

function isPasswordException(err) {
    if (PasswordException) {
        return err instanceof PasswordException;
    }
    // Minor 4 fallback only: reached if a future pdf-parse version ever
    // stops exporting PasswordException from its package root.
    return Boolean(err) && err.name === 'PasswordException';
}

function send(msg) {
    if (process.connected) {
        process.send(msg);
    }
}

async function run(absPath, maxPages) {
    const buffer = await fs.promises.readFile(absPath);
    const parser = new PDFParse({ data: buffer });
    try {
        let info;
        try {
            info = await parser.getInfo({ parsePageInfo: true });
        } catch (err) {
            if (isPasswordException(err)) {
                send({ type: 'done', ok: true, encrypted: true });
                return;
            }
            throw err;
        }

        const pageCount = info.total || 0;
        const truncated = pageCount > maxPages;
        const pagesToRead = Math.min(pageCount, maxPages);
        if (pagesToRead === 0) {
            send({ type: 'done', ok: true, pageCount, truncated });
            return;
        }

        let textResult;
        try {
            textResult = await parser.getText({ first: pagesToRead });
        } catch (err) {
            if (isPasswordException(err)) {
                send({ type: 'done', ok: true, encrypted: true });
                return;
            }
            throw err;
        }

        for (const pageText of textResult.pages) {
            const text = (pageText.text || '').trim();
            if (text.length > 0) {
                send({ type: 'page', index: pageText.num, kind: 'TEXT', text });
                continue;
            }

            const pageInfo = (info.pages || []).find((p) => p.pageNumber === pageText.num);
            const scale = scaleForPage(pageInfo);
            const screenshot = await parser.getScreenshot({ partial: [pageText.num], scale });
            const image = screenshot.pages[0];
            const pngBase64 = Buffer.from(image.data).toString('base64');
            if (Buffer.byteLength(pngBase64, 'utf8') > MAX_PAGE_IMAGE_BYTES) {
                throw new Error(`pdf-extract-worker: page ${pageText.num}'s raster exceeded the size cap even after scale-capping (scale=${scale})`);
            }
            send({ type: 'page', index: pageText.num, kind: 'IMAGE', pngBase64 });
        }

        send({ type: 'done', ok: true, pageCount, truncated });
    } finally {
        await parser.destroy();
    }
}

// Minor 1: if the parent is killed (or otherwise disconnects) while a job
// is in flight, exit immediately rather than keep parsing an orphaned
// extraction nobody will ever read the result of.
process.on('disconnect', () => {
    process.exit(0);
});

process.on('message', (msg) => {
    if (!msg || msg.type !== 'extract') {
        return;
    }
    run(msg.absPath, msg.maxPages).catch((err) => {
        send({ type: 'done', ok: false, error: (err && err.message) || String(err) });
    });
});
