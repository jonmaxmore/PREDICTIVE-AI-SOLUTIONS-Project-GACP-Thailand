/**
 * FIX (drill fast-follow, 2026-07-06) — a rejected upload must return a clean 400
 * with the Thai reason, NOT a 500.
 *
 * The real routes mount the uploader as INLINE route middleware and let a plain
 * `if (!req.file) return 400` handler run after it:
 *   applications.js:856  router.post('/draft-documents', ..., upload.single('file'), handler)
 *   wizard.js:85         router.post('/draft-documents', ..., upload.single('file'), controller)
 *   payment-slips.js:201 router.post('/upload', ..., upload.single('file'), handler)
 * There is NO 4-arg error handler between the uploader and Express's default one,
 * so a fileFilter that `throw`s (cb(new Error(...))) propagated as next(err) →
 * HTTP 500 ("Internal server error") for a spoofed/dangerous file. Confirmed live
 * on staging: `[Upload] Rejected: ... ไม่รองรับ (evil.html)` → 500.
 *
 * The existing guard test (storage-service-extension-guard.test.js) hid this
 * because it wraps the uploader in a manual `(err) => res.status(400)` callback
 * the real routes do not have — a mock-vs-reality false-green.
 *
 * This test reproduces the REAL mounting: uploader as inline middleware, a
 * null-checking handler, and a fall-through error handler that returns 500 (what
 * a real Express app does). RED before the fix (reject → 500); GREEN after
 * (reject → 400 + Thai reason; a legit png still 200).
 */
'use strict';

const express = require('express');
const request = require('supertest');
const fs = require('fs');

const storageService = require('../../services/storage-service');

const FOLDER = 'test-uploads-reject-status';
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const writtenDirs = new Set();

// Mirrors the production draft-documents route: inline uploader middleware, then a
// handler that only null-checks req.file (surfacing the stashed rejection reason),
// then a fall-through error handler that returns 500 like Express's default.
function buildRealRouteApp() {
    const upload = storageService.createUploader(FOLDER, ALLOWED, 20);
    const app = express();
    app.post('/draft-documents', upload.single('file'), (req, res) => {
        if (req.file?.destination) { writtenDirs.add(req.file.destination); }
        if (!req.file) {
            if (req.uploadRejectionReason) {
                return res.status(400).json({
                    success: false,
                    error: req.uploadRejectionCode || 'UPLOAD_REJECTED',
                    message: req.uploadRejectionReason,
                });
            }
            return res.status(400).json({ success: false, error: 'FILE_REQUIRED' });
        }
        return res.status(200).json({ success: true, filename: req.file.filename });
    });
    // A fileFilter throw reaching here becomes a 500 (the pre-fix behavior).
    app.use((err, req, res, _next) => res.status(500).json({ success: false, error: 'INTERNAL', message: err.message }));
    return app;
}

afterAll(() => {
    for (const dir of writtenDirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
});

describe('upload reject → clean 400 (not 500) on the REAL inline-middleware route', () => {
    test('evil.html spoofed as image/png → 400 with the Thai reason (NOT 500)', async () => {
        const res = await request(buildRealRouteApp())
            .post('/draft-documents')
            .attach('file', Buffer.from('<script>alert(1)</script>'), {
                filename: 'evil.html',
                contentType: 'image/png',
            });
        expect(res.status).toBe(400);
        expect(res.status).not.toBe(500);
        expect(res.body.error).toBe('UPLOAD_REJECTED');
        // The specific Thai reason must survive (not a generic message).
        expect(res.body.message).toMatch(/ไม่รองรับ/);
        expect(res.body.message).toMatch(/evil\.html/);
    });

    test('disallowed real mimetype (image/svg+xml) → 400 (NOT 500)', async () => {
        const res = await request(buildRealRouteApp())
            .post('/draft-documents')
            .attach('file', Buffer.from('<svg/>'), {
                filename: 'x.svg',
                contentType: 'image/svg+xml',
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('UPLOAD_REJECTED');
    });

    test('a legit image.png is still accepted (200) and stored as .png', async () => {
        const res = await request(buildRealRouteApp())
            .post('/draft-documents')
            .attach('file', Buffer.from('\x89PNG\r\n'), {
                filename: 'image.png',
                contentType: 'image/png',
            });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.filename).toMatch(/\.png$/);
    });

    test('no file at all → 400 FILE_REQUIRED (unchanged), never 500', async () => {
        const res = await request(buildRealRouteApp())
            .post('/draft-documents')
            .field('slotId', 'x');
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('FILE_REQUIRED');
    });
});
