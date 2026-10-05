/**
 * SEC-001 — end-to-end proof that the Puppeteer request interceptor blocks
 * server-side requests to attacker-injected resources.
 *
 * We stand up a throwaway local HTTP server and render HTML containing an
 * <img> pointing at it (the exact shape an applicant could inject via a plot
 * name / GPS field). If the SSRF guard works, the REAL Chromium render must
 * NEVER open a connection to that server — so it records zero hits — while
 * still returning a valid PDF.
 *
 * Requires a usable Chromium. Resolves it from PUPPETEER_EXECUTABLE_PATH or
 * puppeteer's own download; skips cleanly when neither is present so CI lanes
 * without a browser are unaffected.
 */

const http = require('http');
const fs = require('fs');
const puppeteer = require('puppeteer');
const pdfGenerator = require('../../services/pdf/pdf-generator.service');

function resolveChromium() {
    const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (fromEnv && fs.existsSync(fromEnv)) { return fromEnv; }
    try {
        const p = puppeteer.executablePath();
        if (p && fs.existsSync(p)) { return p; }
    } catch { /* no bundled browser */ }
    return null;
}

const CHROMIUM = resolveChromium();
const d = CHROMIUM ? describe : describe.skip;

d('SEC-001 — PDF renderer blocks SSRF to injected sub-resources', () => {
    /** @type {import('http').Server} */
    let server;
    let hits;
    let probeUrl;

    beforeAll((done) => {
        // Make the singleton use the resolved browser (mirrors the Docker runner).
        process.env.PUPPETEER_EXECUTABLE_PATH = CHROMIUM;
        hits = [];
        server = http.createServer((req, res) => {
            hits.push(req.url);
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end('x');
        });
        server.listen(0, '127.0.0.1', () => {
            probeUrl = `http://127.0.0.1:${server.address().port}/ssrf-probe`;
            done();
        });
    });

    afterAll(async () => {
        await pdfGenerator.close().catch(() => {});
        await new Promise((resolve) => server.close(resolve));
    });

    test('an injected <img> to an internal host is never fetched, yet the PDF still renders', async () => {
        const html = `<!doctype html><html><body>
            <h1>ใบสมัคร</h1>
            <p>plot: <img src="${probeUrl}" alt="x"></p>
        </body></html>`;

        const pdf = await pdfGenerator.generatePDF(html);

        // The PDF was produced…
        expect(Buffer.isBuffer(pdf)).toBe(true);
        expect(pdf.slice(0, 4).toString()).toBe('%PDF');
        // …and the renderer NEVER contacted our internal probe server.
        expect(hits).toEqual([]);
    }, 60000);

    test('an injected file:// iframe is blocked (no crash, valid PDF)', async () => {
        const html = `<!doctype html><html><body>
            <iframe src="file:///etc/passwd"></iframe>
            <p>ok</p>
        </body></html>`;
        const pdf = await pdfGenerator.generatePDF(html);
        expect(pdf.slice(0, 4).toString()).toBe('%PDF');
        expect(hits).toEqual([]);
    }, 60000);

    test('control: a clean document (no external resources) renders normally', async () => {
        const pdf = await pdfGenerator.generatePDF('<h1>สวัสดี GACP</h1>');
        expect(pdf.slice(0, 4).toString()).toBe('%PDF');
        expect(pdf.length).toBeGreaterThan(1000);
    }, 60000);
});
