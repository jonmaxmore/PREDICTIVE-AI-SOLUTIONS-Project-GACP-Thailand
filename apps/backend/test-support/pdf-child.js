'use strict';

/**
 * PDF reader run as a PLAIN node child process, never inside a jest worker.
 *
 * pdf-parse v2 (pdfjs-dist) sets up its worker through a dynamic `import()`.
 * Inside jest's vm sandbox that throws "A dynamic import callback was invoked
 * without --experimental-vm-modules" unless NODE_OPTIONS carries the flag — so a
 * suite that required pdf-parse directly was green only with a hand-set flag and
 * red under the gate's plain `jest --config jest.config.cjs`. Plain node handles
 * the import natively; tests call this file through `readPdf` below.
 *
 * CLI (used by the parent):
 *   node pdf-child.js text <pdfPath>              → JSON {text} on stdout
 *   node pdf-child.js png  <pdfPath> <outPngPath>  → page 1, 760 px wide, 64-colour PNG
 *
 * pdftotext/pdftoppm (poppler) are not installed on this host, so pdf-parse is
 * the renderer for both.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

async function childMain([mode, pdfPath, outPng]) {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });
    try {
        if (mode === 'text') {
            const result = await parser.getText();
            process.stdout.write(JSON.stringify({ text: result.text || '' }));
            return;
        }
        if (mode === 'png') {
            const shot = await parser.getScreenshot({
                partial: [1], desiredWidth: 760, imageBuffer: true, imageDataUrl: false,
            });
            const sharp = require('sharp');
            const png = await sharp(Buffer.from(shot.pages[0].data))
                .png({ palette: true, colors: 64, compressionLevel: 9 })
                .toBuffer();
            fs.writeFileSync(outPng, png);
            return;
        }
        throw new Error(`pdf-child: unknown mode "${mode}"`);
    } finally {
        if (typeof parser.destroy === 'function') { await parser.destroy(); }
    }
}

/**
 * Parent side: hand a PDF buffer to a plain node child.
 * @param {Buffer} buffer
 * @param {'text'|'png'} mode
 * @param {string} [outPng] required for 'png'
 * @returns {Promise<string|undefined>} the text for 'text'
 */
function readPdf(buffer, mode, outPng) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-child-'));
    const pdfPath = path.join(dir, 'doc.pdf');
    fs.writeFileSync(pdfPath, buffer);
    const args = [__filename, mode, pdfPath, ...(outPng ? [outPng] : [])];
    return new Promise((resolve, reject) => {
        execFile(process.execPath, args, { maxBuffer: 32 * 1024 * 1024, timeout: 60000 }, (err, stdout, stderr) => {
            fs.rmSync(dir, { recursive: true, force: true });
            if (err) { reject(new Error(`pdf-child ${mode} failed: ${stderr || err.message}`)); return; }
            resolve(mode === 'text' ? JSON.parse(stdout).text : undefined);
        });
    });
}

if (require.main === module) {
    childMain(process.argv.slice(2)).catch((err) => {
        process.stderr.write(String(err && err.stack || err));
        process.exit(1);
    });
}

module.exports = { readPdf };
