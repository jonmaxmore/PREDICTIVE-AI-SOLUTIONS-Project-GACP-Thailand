/**
 * Bug #23 (carpet-bomb-inversion audit 2026-07-06) — the draft uploader must not
 * accept/store a dangerous file extension.
 *
 * The old fileFilter accepted a file purely on `allowedMimeTypes.includes(mimetype)`,
 * but the multipart mimetype is client-supplied/spoofable and the stored filename
 * kept the attacker's original extension (path.extname(originalname)). So a request
 * with {Content-Type: image/png, filename: evil.html} passed the filter and was
 * stored as <uuid>.html — a latent stored-XSS vector (direct-container hop / a future
 * direct-serve edge / an SVG opened directly bypasses the Batch-1 Content-Disposition
 * neutralisation).
 *
 * Fix (defense-in-depth):
 *  1) fileFilter also validates the EXTENSION against a safe allow-list derived from
 *     the accepted mimetypes → a mimetype/extension mismatch is rejected.
 *  2) the stored extension is sanitised to a canonical safe one mapped from the
 *     ACCEPTED mimetype (never trusts originalname's extension) → an accepted file
 *     can never be persisted as .html/.svg.
 *
 * These are real end-to-end drives of the multer uploader via supertest. The reject
 * path writes nothing; the accept path writes into a gitignored temp folder that is
 * removed in afterAll.
 */
'use strict';

const express = require('express');
const request = require('supertest');
const fs = require('fs');

const storageService = require('../../services/storage-service');

const FOLDER = 'test-uploads-bug23';
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const writtenDirs = new Set();

function buildApp() {
    const upload = storageService.createUploader(FOLDER, ALLOWED, 20);
    const app = express();
    // Real-route mounting: uploader as inline middleware, then a null-checking
    // handler. The fileFilter now rejects via cb(null,false) + a stashed reason
    // (NOT a throw), so a reject leaves req.file undefined and this returns a clean
    // 400 with the Thai reason — mirroring the applications/wizard/payment-slips
    // routes (drill fast-follow 2026-07-06).
    app.post('/upload', upload.single('file'), (req, res) => {
        if (req.file?.destination) {
            writtenDirs.add(req.file.destination);
        }
        if (!req.file) {
            return res.status(400).json({
                ok: false,
                error: req.uploadRejectionCode || 'FILE_REQUIRED',
                message: req.uploadRejectionReason || null,
            });
        }
        return res.status(200).json({
            ok: true,
            filename: req.file?.filename || null,
            originalname: req.file?.originalname || null,
        });
    });
    return app;
}

afterAll(() => {
    for (const dir of writtenDirs) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            /* best-effort cleanup */
        }
    }
});

describe('Bug #23 — createUploader rejects/sanitises dangerous extensions', () => {
    test('rejects evil.html even with a spoofed image/png mimetype', async () => {
        const res = await request(buildApp())
            .post('/upload')
            .attach('file', Buffer.from('<script>alert(1)</script>'), {
                filename: 'evil.html',
                contentType: 'image/png',
            });
        expect(res.status).toBe(400);
        expect(res.body.ok).toBe(false);
    });

    test('rejects evil.svg even with a spoofed image/png mimetype', async () => {
        const res = await request(buildApp())
            .post('/upload')
            .attach('file', Buffer.from('<svg onload=alert(1)>'), {
                filename: 'evil.svg',
                contentType: 'image/png',
            });
        expect(res.status).toBe(400);
        expect(res.body.ok).toBe(false);
    });

    test('rejects a mimetype/extension mismatch (evil.php as application/pdf)', async () => {
        const res = await request(buildApp())
            .post('/upload')
            .attach('file', Buffer.from('<?php ?>'), {
                filename: 'evil.php',
                contentType: 'application/pdf',
            });
        expect(res.status).toBe(400);
        expect(res.body.ok).toBe(false);
    });

    test('rejects a disallowed real mimetype (image/svg+xml)', async () => {
        const res = await request(buildApp())
            .post('/upload')
            .attach('file', Buffer.from('<svg/>'), {
                filename: 'x.svg',
                contentType: 'image/svg+xml',
            });
        expect(res.status).toBe(400);
        expect(res.body.ok).toBe(false);
    });

    test('accepts a real image.png and stores it with a .png extension (never .html/.svg)', async () => {
        const res = await request(buildApp())
            .post('/upload')
            .attach('file', Buffer.from('\x89PNG\r\n'), {
                filename: 'image.png',
                contentType: 'image/png',
            });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.filename).toMatch(/\.png$/);
        expect(res.body.filename).not.toMatch(/\.(html|svg)$/i);
    });

    test('accepts a real doc.pdf and stores it with a .pdf extension', async () => {
        const res = await request(buildApp())
            .post('/upload')
            .attach('file', Buffer.from('%PDF-1.7'), {
                filename: 'doc.pdf',
                contentType: 'application/pdf',
            });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.filename).toMatch(/\.pdf$/);
    });

    test('accepts photo.jpeg and stores it with the canonical .jpg extension', async () => {
        const res = await request(buildApp())
            .post('/upload')
            .attach('file', Buffer.from('\xFF\xD8\xFF'), {
                filename: 'photo.jpeg',
                contentType: 'image/jpeg',
            });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.filename).toMatch(/\.jpg$/);
    });

    test('a double-extension attack (evil.pdf.html, pdf mimetype) is rejected', async () => {
        const res = await request(buildApp())
            .post('/upload')
            .attach('file', Buffer.from('x'), {
                filename: 'evil.pdf.html',
                contentType: 'application/pdf',
            });
        expect(res.status).toBe(400);
        expect(res.body.ok).toBe(false);
    });
});
