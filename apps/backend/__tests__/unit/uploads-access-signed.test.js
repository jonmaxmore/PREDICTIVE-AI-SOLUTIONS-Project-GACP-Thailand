/**
 * W1-2 — the `/uploads` route accepts EITHER a valid unexpired signature OR an
 * authenticated session. No signature and no session stays 401.
 *
 * This is the regression test for the operator report "อัปโหลดไฟล์ หรือรูปไม่ได้":
 * a browser <img>/download cannot send an Authorization header, so before this
 * change every private uploaded file rendered broken even for its own owner.
 *
 * The classification in middleware/uploads-access.js is NOT weakened here — the
 * same paths stay sensitive; a second, narrower credential is simply accepted.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

// ไฟล์ที่รากคือรูปประจำตัว และ authorizeUploadsObject ตัดสินจาก
// User.privacySettings.avatar · prisma ที่เป็น {} เปล่า ๆ ทำให้เทสนี้บอกได้แค่
// "เซสชันไหนก็อ่านไฟล์ที่รากได้" ซึ่งคือพฤติกรรมที่เป็นบั๊ก (วัดจริง 2026-09-09
// บน GACP Lite: /uploads/<ไฟล์ที่ราก> ผู้ยื่นคนอื่นได้ 200)
//
// mock นี้จึงผูกรูปประจำตัวไว้กับเซสชันที่ใช้ทดสอบ เพื่อให้เทสยืนยันสิ่งที่ถูก:
// เจ้าของอ่านของตัวเองได้ ส่วนไฟล์ที่ราก "ของคนอื่น" อ่านไม่ได้
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(async ({ where }) => (
                where?.id === 'session-user'
                    ? { privacySettings: { avatar: '/uploads/avatar-under-test.png' } }
                    : null
            )),
        },
        application: { findFirst: jest.fn(async () => null) },
        applicationDocument: { findFirst: jest.fn(async () => null) },
        applicationDraft: { findFirst: jest.fn(async () => null) },
        attachment: { findFirst: jest.fn(async () => null) },
    },
}));

// A stand-in session: the real authenticateAny is exercised end-to-end by
// uploads-access.test.js (anonymous → 401). Here we only need to prove the gate
// still routes to the session path when no signature is present.
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateAny: (req, res, next) => {
        if (req.headers['x-test-session'] === 'valid') {
            req.user = { id: 'session-user', organizationId: 'org-1', role: 'health' };
            return next();
        }
        return res.status(401).json({ success: false, error: 'Unauthorized', code: 'NO_TOKEN' });
    },
}));

const { gateSensitiveUploads, gateSlipObjectAccess } = require('../../middleware/uploads-access');
const storage = require('../../services/storage-service');

const AVATAR = 'avatar-under-test.png';
const OTHER = 'other-private-file.png';

let uploadsDir;
let app;

beforeAll(() => {
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gacp-uploads-signed-'));
    // A real 1×1 PNG so express.static reports a real content type + bytes.
    const png = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
        + '0000000a49444154789c636000000200010005fe02fe0000000049454e44ae426082',
        'hex',
    );
    fs.writeFileSync(path.join(uploadsDir, AVATAR), png);
    fs.writeFileSync(path.join(uploadsDir, OTHER), png);

    app = express();
    app.use(
        '/uploads',
        gateSensitiveUploads,
        gateSlipObjectAccess,
        express.static(uploadsDir),
    );
});

afterAll(() => {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
});

async function mint(key, overrides = {}) {
    const minted = await storage.createSignedObjectUrl(key, {
        subject: 'user-owner-1',
        expiresInSeconds: 300,
        ...overrides,
    });
    return minted.url;
}

describe('W1-2 — /uploads with a signed URL (no Authorization header)', () => {
    test('no session AND no signature → 401 (unchanged)', async () => {
        const res = await request(app).get(`/uploads/${AVATAR}`);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('NO_TOKEN');
    });

    test('a valid signature serves the file with the right content type — no auth header', async () => {
        const url = await mint(AVATAR);
        const res = await request(app).get(url);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('image/png');
        expect(res.body.length).toBeGreaterThan(0);
    });

    test('an EXPIRED signature → 401', async () => {
        const url = await mint(AVATAR, { expiresInSeconds: 1 });
        const realNow = Date.now;
        Date.now = () => realNow() + 5000;
        try {
            const res = await request(app).get(url);
            expect(res.status).toBe(401);
        } finally {
            Date.now = realNow;
        }
    });

    test('a TAMPERED signature → 401', async () => {
        const url = await mint(AVATAR);
        const tampered = url.replace(/sig=([^&]{4})/, (_m, g) => `sig=${g === 'AAAA' ? 'BBBB' : 'AAAA'}`);
        const res = await request(app).get(tampered);
        expect(res.status).toBe(401);
    });

    test('a signature minted for ONE object does not unlock another', async () => {
        const url = await mint(AVATAR);
        const query = url.split('?')[1];
        const res = await request(app).get(`/uploads/${OTHER}?${query}`);
        expect(res.status).toBe(401);
    });

    test('existing session-based access still works (no signature needed)', async () => {
        const res = await request(app)
            .get(`/uploads/${AVATAR}`)
            .set('x-test-session', 'valid');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('image/png');
    });

    test('ไฟล์ที่รากของคนอื่น เซสชันที่ถูกต้องก็อ่านไม่ได้', async () => {
        // OTHER ไม่ใช่รูปประจำตัวของ session-user · เดิมประตูนี้ปล่อยผ่านเพราะไฟล์ที่ราก
        // ไม่เคยถูกส่งเข้า ACL ระดับวัตถุเลย — บังคับแค่ว่า "ต้องมีเซสชัน"
        const res = await request(app)
            .get(`/uploads/${OTHER}`)
            .set('x-test-session', 'valid');
        expect(res.status).toBe(404);
    });

    test('a signature cannot smuggle a traversal past the path guard', async () => {
        const url = await mint(AVATAR);
        const query = url.split('?')[1];
        const res = await request(app).get(`/uploads/../server.js?${query}`);
        expect([400, 401, 404]).toContain(res.status);
        expect(res.text).not.toContain('express');
    });
});
