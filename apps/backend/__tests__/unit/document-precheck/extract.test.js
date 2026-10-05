/**
 * Task 4 (document pre-check): `extract.js` — file → per-page text, fully
 * local (pdf-parse v2 text layer first, then OCR through
 * services/ocr/tesseract-service.js). No network anywhere in this file:
 * every fixture is generated in-process from files already in the repo
 * (pdfkit, sharp + the bundled Sarabun font, and a hand-built minimal
 * encrypted PDF — see the "encrypted" describe block for why it is
 * hand-built rather than qpdf/pdf-lib generated).
 *
 * @see apps/backend/services/document-precheck/extract.js
 * @see design note 2026-09-27-document-precheck-design §2, §4, §8
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');

const { extractDocument } = require('../../../services/document-precheck/extract');
const { scaleForPage, MAX_RASTER_LONG_SIDE_PX } = require('../../../services/document-precheck/pdf-raster-scale');

const FONT_PATH = path.join(__dirname, '..', '..', '..', '..', 'mobile-app', 'assets', 'fonts', 'Sarabun-Regular.ttf');
const LAND_DEED_PHRASE = 'โฉนดที่ดิน';

// Wall-time-per-case ledger (task-4-brief.md Step 4: "Record the wall-time
// per case in the test log summary"). Printed once in the top-level afterAll
// below, not per-test, so it reads as one summary table in the log.
const timings = [];

function timed(label, fn) {
    return async (...args) => {
        const start = Date.now();
        try {
            return await fn(...args);
        } finally {
            timings.push({ label, ms: Date.now() - start });
        }
    };
}

let tmpDir;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'precheck-extract-'));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('\n--- extract.test.js wall-time per case ---');
    for (const t of timings) {
        console.log(`  ${t.label}: ${t.ms}ms`);
    }
});

/** Renders one line of text to a PNG buffer with the real bundled Sarabun font. */
async function renderTextPng(text, { width = 1800, height = 200, fontSize = 48 } = {}) {
    const fontBase64 = fs.readFileSync(FONT_PATH).toString('base64');
    const svg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <style>
                @font-face {
                    font-family: 'PrecheckTestFont';
                    src: url(data:font/ttf;base64,${fontBase64}) format('truetype');
                }
                text { font-family: 'PrecheckTestFont'; font-size: ${fontSize}px; fill: #000000; }
            </style>
            <rect width="100%" height="100%" fill="#ffffff"/>
            <text x="20" y="${Math.round(height * 0.6)}">${text}</text>
        </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Builds a PDF with a real text layer (pdfkit + the bundled Sarabun font) and returns its path. */
function writeTextLayerPdf(filePath, text) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);
        doc.font(FONT_PATH).fontSize(24).text(text);
        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

/** Builds a single-page PDF containing only an embedded image (no text objects) and returns its path. */
async function writeImageOnlyPdf(filePath, phrase) {
    const png = await renderTextPng(phrase);
    const { width, height } = await sharp(png).metadata();
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: [width, height], margin: 0 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);
        doc.image(png, 0, 0, { width, height });
        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

/** Builds an N-page PDF (plain text pages, no Thai needed) and returns its path. */
function writeMultiPagePdf(filePath, pageCount) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);
        for (let i = 1; i <= pageCount; i += 1) {
            if (i > 1) {
                doc.addPage();
            }
            doc.font(FONT_PATH).fontSize(18).text(`page ${i} of ${pageCount}`);
        }
        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

/**
 * A minimal, hand-built PDF whose trailer names an /Encrypt dictionary
 * (Standard security handler, V1/R2, 40-bit RC4) — under 5 KB.
 *
 * task-4-brief.md's decision: generate the encrypted fixture with pdf-lib or
 * qpdf if available, else hand-build one. Neither is available in this
 * worktree (`qpdf` is not on PATH; `pdf-lib` is not an installed dependency
 * — checked before writing this), so this hand-builds the PDF bytes.
 *
 * The /O and /U string values do not need to be cryptographically correct
 * RC4/MD5 output: pdf.js (via pdf-parse) computes its own candidate
 * decryption key from an *empty* password (since we never supply one) and
 * compares it against /U before ever touching /O; because we always call
 * `new PDFParse({ data })` with no password, that comparison fails
 * regardless of what bytes /O and /U hold, and pdf.js throws
 * `PasswordException("No password given", NEED_PASSWORD)` — verified
 * against this exact fixture (node -e reproduction) before writing this
 * test. Real RC4/MD5-correct /O and /U would only matter for a fixture that
 * also exercises the "correct password succeeds" path, which is out of
 * scope for extract.js (method: 'NONE' either way).
 */
function buildMinimalEncryptedPdf() {
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    function addObject(num, body) {
        offsets[num] = Buffer.byteLength(pdf, 'latin1');
        pdf += `${num} 0 obj\n${body}\nendobj\n`;
    }
    const zeros32 = '00'.repeat(32);
    addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
    addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    addObject(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>');
    addObject(4, `<< /Filter /Standard /V 1 /R 2 /O <${zeros32}> /U <${zeros32}> /P -44 >>`);
    const xrefOffset = Buffer.byteLength(pdf, 'latin1');
    pdf += 'xref\n0 5\n';
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= 4; i += 1) {
        pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += 'trailer\n';
    pdf += '<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<0102030405060708090a0b0c0d0e0f10> <0102030405060708090a0b0c0d0e0f10>] >>\n';
    pdf += `startxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
}

/**
 * A 1-page PDF with no text layer (an embedded image only — `.text()` would
 * add a real text object, which would make this fixture take the
 * TEXT_LAYER path and never exercise I3's raster-scale cap at all) whose
 * MediaBox is the review's exact I3 example: 14400x14400pt.
 */
async function writeHugeMediaBoxPdf(filePath) {
    const png = await renderTextPng('TEST', { width: 400, height: 200, fontSize: 96 });
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: [14400, 14400], margin: 0 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);
        doc.rect(0, 0, 14400, 14400).fill('#ffffff');
        doc.image(png, 200, 200, { width: 4000, height: 2000 });
        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Minor 5: same technique the reviewer used manually (`pgrep -af`) — lists PIDs of any live pdf-extract-worker.js process. */
function pgrepPdfExtractWorker() {
    try {
        const out = execFileSync('pgrep', ['-f', 'pdf-extract-worker.js'], { encoding: 'utf8' });
        return out.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
        // pgrep exits 1 (non-zero) when nothing matches — that is the "no leftover process" case, not an error.
        return [];
    }
}

describe('extractDocument (services/document-precheck/extract.js)', () => {
    test('a text-layer PDF returns TEXT_LAYER and the page text contains the Thai phrase', timed('text-layer PDF', async () => {
        const filePath = path.join(tmpDir, 'text-layer.pdf');
        await writeTextLayerPdf(filePath, LAND_DEED_PHRASE);

        const result = await extractDocument(filePath, 'application/pdf');

        expect(result.method).toBe('TEXT_LAYER');
        expect(result.pageCount).toBe(1);
        expect(result.truncated).toBe(false);
        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].confidence).toBe(100);
        expect(result.pages[0].text).toContain(LAND_DEED_PHRASE);
    }), 30000);

    test('an image-only PDF (scanned Thai page) returns OCR and reads the Thai phrase', timed('image-only PDF (scanned Thai)', async () => {
        const filePath = path.join(tmpDir, 'image-only.pdf');
        await writeImageOnlyPdf(filePath, LAND_DEED_PHRASE);

        const result = await extractDocument(filePath, 'application/pdf');

        expect(result.method).toBe('OCR');
        expect(result.pageCount).toBe(1);
        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].confidence).toBeGreaterThan(0);
        expect(result.pages[0].text).toContain(LAND_DEED_PHRASE);
    }), 60000);

    test('a PNG image returns OCR', timed('PNG image', async () => {
        const filePath = path.join(tmpDir, 'standalone.png');
        const png = await renderTextPng(LAND_DEED_PHRASE);
        fs.writeFileSync(filePath, png);

        const result = await extractDocument(filePath, 'image/png');

        expect(result.method).toBe('OCR');
        expect(result.pageCount).toBe(1);
        expect(result.truncated).toBe(false);
        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].confidence).toBeGreaterThan(0);
        expect(result.pages[0].text.length).toBeGreaterThan(0);
    }), 60000);

    test('extract-limits: a 60-page PDF reports pageCount 60, returns 10 pages, truncated true', timed('extract-limits (60-page PDF)', async () => {
        const filePath = path.join(tmpDir, 'sixty-pages.pdf');
        await writeMultiPagePdf(filePath, 60);

        const result = await extractDocument(filePath, 'application/pdf', { maxPages: 10 });

        expect(result.method).toBe('TEXT_LAYER');
        expect(result.pageCount).toBe(60);
        expect(result.pages).toHaveLength(10);
        expect(result.truncated).toBe(true);
    }), 30000);

    test('a 0-byte file returns NONE with no pages', timed('0-byte file', async () => {
        const filePath = path.join(tmpDir, 'empty.pdf');
        fs.writeFileSync(filePath, Buffer.alloc(0));

        const result = await extractDocument(filePath, 'application/pdf');

        expect(result).toEqual({ method: 'NONE', pageCount: 0, pages: [], truncated: false });
    }));

    test('an encrypted PDF returns NONE with no pages', timed('encrypted PDF', async () => {
        const filePath = path.join(tmpDir, 'encrypted.pdf');
        const encryptedBuffer = buildMinimalEncryptedPdf();
        expect(encryptedBuffer.length).toBeLessThan(5 * 1024);
        fs.writeFileSync(filePath, encryptedBuffer);

        const result = await extractDocument(filePath, 'application/pdf');

        expect(result).toEqual({ method: 'NONE', pageCount: 0, pages: [], truncated: false });
    }));

    test('an unsupported mime type returns NONE with no pages', timed('unsupported mime type', async () => {
        const filePath = path.join(tmpDir, 'not-a-document.bin');
        fs.writeFileSync(filePath, Buffer.from('not a document'));

        const result = await extractDocument(filePath, 'application/octet-stream');

        expect(result).toEqual({ method: 'NONE', pageCount: 0, pages: [], truncated: false });
    }));

    // Placed near the end on purpose: this forces a real OCR call to time
    // out. Fix round 2 (I1) gives every extractDocument() call its own OCR
    // worker instance rather than a shared singleton, so a losing branch
    // here can no longer corrupt a later test's OCR call the way it could
    // before that fix — this ordering is now defence in depth, not a
    // correctness requirement.
    test('extraction that exceeds timeoutMs rejects with code PRECHECK_TIMEOUT', timed('timeout', async () => {
        const filePath = path.join(tmpDir, 'image-only.pdf'); // reuse the fixture from an earlier test
        expect(fs.existsSync(filePath)).toBe(true);

        await expect(extractDocument(filePath, 'application/pdf', { timeoutMs: 1 }))
            .rejects.toMatchObject({ code: 'PRECHECK_TIMEOUT' });
    }), 30000);

    // Fix round 2 / Minor 5 (task-4-review.md): the 1ms timeout above almost
    // never lands while the forked pdf-extract-worker child is actually
    // running (the timer usually fires before `fork()` even returns). This
    // test uses a timeoutMs large enough that the child is definitely alive
    // and mid-parse when the timer fires, and asserts no such process
    // survives the call.
    test('a timeout that lands while the pdf-extract-worker child is running leaves no child process behind', timed('timeout mid-flight (Minor 5)', async () => {
        const filePath = path.join(tmpDir, 'image-only.pdf'); // reuse the fixture from an earlier test
        expect(fs.existsSync(filePath)).toBe(true);

        let sawChildRunning = false;
        const poller = setInterval(() => {
            if (pgrepPdfExtractWorker().length > 0) {
                sawChildRunning = true;
            }
        }, 5);

        try {
            await expect(extractDocument(filePath, 'application/pdf', { timeoutMs: 50 }))
                .rejects.toMatchObject({ code: 'PRECHECK_TIMEOUT' });
        } finally {
            clearInterval(poller);
        }

        // Proves this test actually exercised the mid-flight-kill path,
        // not a trivial pass because no child was ever spawned.
        expect(sawChildRunning).toBe(true);

        // child.kill('SIGKILL') is near-instant, but the OS needs a moment
        // to finish reaping the process — poll briefly rather than assert
        // immediately.
        let stillAlive = pgrepPdfExtractWorker();
        for (let i = 0; i < 20 && stillAlive.length > 0; i += 1) {
            await sleep(50);
            stillAlive = pgrepPdfExtractWorker();
        }
        expect(stillAlive).toEqual([]);
    }), 30000);

    // Fix round 2 / I1 (task-4-review.md): "Each `runOcr` re-creates the
    // shared singleton worker, and its `finally terminate()` ... can tear
    // down a worker that another extraction is using." Runs a call that
    // will time out concurrently with a normal call on the same fixture —
    // before the fix both shared one module-level tesseract worker, so the
    // timing-out call's terminate() could kill the legitimate call's
    // in-flight OCR too. Each call now owns its own worker instance
    // (extract.js's `inFlight.ocrSession`), so the legitimate call must
    // finish with a correct result regardless of what the other call does.
    test('I1: a timed-out call does not corrupt a concurrent call\'s own OCR worker', timed('concurrent timeout does not corrupt sibling OCR (I1)', async () => {
        const filePath = path.join(tmpDir, 'image-only.pdf'); // reuse the fixture from an earlier test
        expect(fs.existsSync(filePath)).toBe(true);

        const timingOut = extractDocument(filePath, 'application/pdf', { timeoutMs: 50 }).catch((err) => err);
        const legit = extractDocument(filePath, 'application/pdf');

        const [timingOutResult, legitResult] = await Promise.all([timingOut, legit]);

        expect(timingOutResult).toBeInstanceOf(Error);
        expect(timingOutResult.code).toBe('PRECHECK_TIMEOUT');

        expect(legitResult.method).toBe('OCR');
        expect(legitResult.pages).toHaveLength(1);
        expect(legitResult.pages[0].text).toContain(LAND_DEED_PHRASE);
    }), 30000);

    // Fix round 2 / I2 (task-4-review.md): a real OCR failure — a
    // misconfigured TESSDATA_PATH is the concrete example the review names
    // — must reject extractDocument(), not come back as a page that merely
    // looks unreadable to the applicant. jest.isolateModules() re-requires
    // extract.js's whole require chain (down through tessdata.js) with
    // TESSDATA_PATH pointed at an empty directory, so only this one call
    // sees the broken path; every other test in this file keeps using the
    // real, already-cached module with the real bundled tessdata.
    test('I2: a missing tessdata directory makes OCR reject, not silently return an unreadable page', timed('OCR failure -> rejects (I2)', async () => {
        const emptyTessdataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-tessdata-'));
        const previousTessdataPath = process.env.TESSDATA_PATH;
        let isolatedExtractDocument;
        jest.isolateModules(() => {
            process.env.TESSDATA_PATH = emptyTessdataDir;
            isolatedExtractDocument = require('../../../services/document-precheck/extract').extractDocument;
        });
        if (previousTessdataPath === undefined) {
            delete process.env.TESSDATA_PATH;
        } else {
            process.env.TESSDATA_PATH = previousTessdataPath;
        }

        const filePath = path.join(tmpDir, 'standalone.png'); // reuse the fixture from an earlier test
        expect(fs.existsSync(filePath)).toBe(true);

        await expect(isolatedExtractDocument(filePath, 'image/png'))
            .rejects.toThrow(/tesseract|traineddata/i);
    }), 30000);

    // Fix round 2 / I3 (task-4-review.md): a page that declares an enormous
    // MediaBox must not ask pdf-parse's Node canvas backend for a
    // proportionally enormous raster. Two levels: the pure scale formula
    // (instant, deterministic) and the full pipeline against a real PDF
    // with exactly the review's example dimensions (proves the formula is
    // actually wired in, not just correct in isolation).
    describe('I3: raster size cap', () => {
        test('scaleForPage keeps a 14400x14400pt page\'s long side within MAX_RASTER_LONG_SIDE_PX', () => {
            const scale = scaleForPage({ width: 14400, height: 14400 });
            expect(scale).toBeGreaterThan(0);
            expect(14400 * scale).toBeLessThanOrEqual(MAX_RASTER_LONG_SIDE_PX + 1e-6);
        });

        test('a 1-page PDF declaring a 14400x14400pt MediaBox extracts successfully', timed('huge MediaBox (I3)', async () => {
            const filePath = path.join(tmpDir, 'huge-mediabox.pdf');
            await writeHugeMediaBoxPdf(filePath);

            const result = await extractDocument(filePath, 'application/pdf', { timeoutMs: 40000 });

            expect(result.method).toBe('OCR');
            expect(result.pageCount).toBe(1);
            expect(result.pages).toHaveLength(1);
        }), 50000);
    });
});
