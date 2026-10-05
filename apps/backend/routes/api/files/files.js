/**
 * Signed download URLs for the private `/uploads` mount (W1-2, 2026-08-21).
 *
 * THE BUG THIS CLOSES — operator report "อัปโหลดไฟล์ หรือรูปไม่ได้":
 * an upload succeeds and the bytes really land on disk, but a browser
 * `<img src="/uploads/x.png">` cannot send an Authorization header (it sends
 * cookies only), so the correctly-hardened `/uploads` gate answered 401 for
 * every private file, even for the file's own owner.
 *
 * THE MECHANISM: prove entitlement ONCE here, over an authenticated request,
 * then hand back a URL that carries a short-lived signature and nothing secret
 * in the path. `middleware/uploads-access.js` accepts EITHER that signature OR a
 * session; no signature and no session still means 401.
 *
 * Nothing about the gate's sensitivity classification is relaxed. The
 * entitlement check below is the SAME `authorizeUploadsObject` the gate's object
 * ACLs use, so a mint can never grant more than the caller's own session could
 * already fetch.
 */
'use strict';

const express = require('express');

const router = express.Router();

const { authenticateAny } = require('../../../middleware/auth-middleware');
const {
    decodeUploadsRel,
    authorizeUploadsObject,
} = require('../../../middleware/uploads-access');
const storageService = require('../../../services/storage-service');
const logger = require('../../../shared/logger');

const UPLOADS_PREFIX = '/uploads/';

/**
 * POST /api/files/signed-url
 * body: { fileUrl: "/uploads/<path>" }  (alias: { path })
 * 200 → { success: true, data: { url, expiresAt } }
 *
 * A denial answers 404, never 403: the JSON APIs for slips and documents
 * already answer 404-on-deny so an attacker cannot enumerate which uuid
 * filenames exist. Keeping the same shape here means the mint endpoint leaks
 * nothing the rest of the surface protects.
 */
router.post('/signed-url', authenticateAny, async (req, res) => {
    const requested = String(req.body?.fileUrl || req.body?.path || '').trim();

    if (!requested || !requested.startsWith(UPLOADS_PREFIX)) {
        return res.status(400).json({
            success: false,
            error: 'Bad Request',
            code: 'INVALID_PATH',
            message: 'ที่อยู่ไฟล์ไม่ถูกต้อง คุณกลับไปที่หน้ารายการแล้วเปิดไฟล์อีกครั้งได้',
        });
    }

    // Decode + normalize through the SAME helper the static gate uses, so the
    // path this endpoint authorizes is byte-for-byte the path `send` will later
    // resolve (that mismatch is the RD-UPLOADS traversal class of bug).
    const info = decodeUploadsRel(requested);
    if (info.malformed || info.traversal || !info.normalized) {
        return res.status(400).json({
            success: false,
            error: 'Bad Request',
            code: 'INVALID_PATH',
            message: 'ที่อยู่ไฟล์ไม่ถูกต้อง คุณกลับไปที่หน้ารายการแล้วเปิดไฟล์อีกครั้งได้',
        });
    }

    const rel = info.normalized;

    let decision;
    try {
        decision = await authorizeUploadsObject(req.user, rel);
    } catch (err) {
        logger.error('[files] signed-url authorization failed:', err?.message);
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            code: 'SIGNED_URL_FAILED',
            message: 'ระบบสร้างลิงก์เปิดไฟล์ไม่สำเร็จ คุณลองใหม่อีกครั้งในอีกสักครู่',
        });
    }

    if (!decision.allowed) {
        return res.status(404).json({
            success: false,
            error: 'NOT_FOUND',
            code: 'NOT_FOUND',
            message: 'ไม่พบไฟล์นี้ หรือบัญชีของคุณไม่มีสิทธิ์เปิดดู คุณติดต่อผู้ดูแลระบบได้หากคิดว่าเป็นความผิดพลาด',
        });
    }

    try {
        const minted = await storageService.createSignedObjectUrl(rel, {
            // The signature binds the entitled subject as an opaque digest — the
            // raw user id never travels in the URL.
            subject: String(req.user?.id || req.user?.userId || ''),
        });
        // NEVER log `minted.url` — it carries the signature. Log the object and
        // the decision only.
        logger.info(`[files] signed-url minted for ${rel} (${decision.reason})`);
        return res.json({
            success: true,
            data: { url: minted.url, expiresAt: minted.expiresAt },
        });
    } catch (err) {
        logger.error('[files] signed-url minting failed:', err?.code || err?.message);
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            code: 'SIGNED_URL_FAILED',
            message: 'ระบบสร้างลิงก์เปิดไฟล์ไม่สำเร็จ คุณลองใหม่อีกครั้งในอีกสักครู่',
        });
    }
});

module.exports = router;
