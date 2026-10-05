'use strict';

/**
 * เกษตรกรต้องส่งเอกสารแก้ไข (CAR) ได้จริง
 *
 * CAR คือประตูเดียวที่เกษตรกรใช้ "ตอบ" รายการข้อบกพร่องที่ผู้ตรวจเอกสารเปิดไว้ ถ้าประตูนี้ไม่ทำงาน
 * คำขอที่ถูกตีกลับจะค้างอยู่ตรงนั้นตลอดไป · กดจริงเมื่อ 2026-09-07 พังเรียงกันสามชั้น:
 *
 *   1) POST /api/applications/:id/car            → 404 HTML `Cannot POST`
 *      เพราะ index.js เอา router ไปแขวนใต้เซกเมนต์ '/car' อีกชั้น ทางจริงจึงเป็น
 *      /api/applications/car/:id/car ซึ่งไม่มีใครเขียนขึ้นมาตั้งใจ — และเทสทุกตัวใน repo นี้
 *      mount router เองที่ '/api/applications' คือ mount แบบที่ "ควรจะเป็น" เลยไม่มีใครเห็น
 *   2) ใส่ทางที่ถูกแล้ว → 500 MulterError: Unexpected field
 *      หน้าจอส่งชื่อฟิลด์ carDocument0..N ส่วนประตูอ่าน array ชื่อ carDocument
 *   3) ใส่ชื่อฟิลด์ที่ถูกแล้ว → 500 ENOENT
 *      ปลายทางอัปโหลดเขียนว่า path.join(__dirname, '../../public/uploads/car') ซึ่งจากไฟล์
 *      routes/api/applications/ ตกไปที่ routes/public/uploads/car — โฟลเดอร์ที่ไม่มีอยู่ และ
 *      ไม่ใช่โฟลเดอร์ที่ express.static เสิร์ฟเป็น /uploads · เป็นบั๊กคลาสเดียวกับที่
 *      storage-service.js แก้ไปแล้วเมื่อ 2026-06-25 (คอมเมนต์ที่ storage-service.js:11-16)
 *      และ handler เก็บ path ไว้เป็น `/uploads/car/<file>` ⇒ ต้องเป็นโฟลเดอร์เดียวกันเท่านั้น
 *
 * เทสนี้ใช้ multer ตัวจริง — เทส CAR ที่มีอยู่เดิมทุกตัว mock multer ทิ้ง จึงมองไม่เห็นชั้น 2 และ 3
 * (a-mocked-dependency-hides-a-dead-feature)
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
    authenticateAny: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
    authenticateProvider: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
}));

// หยุดเรื่องราวทันทีหลังผ่านชั้นอัปโหลด — สิ่งที่เทสนี้พิสูจน์คือไฟล์ขึ้นถึงเซิร์ฟเวอร์และลงดิสก์
// ที่ถูกที่ ไม่ใช่ตรรกะของ workflow ซึ่งมีเทสของตัวเองอยู่แล้ว
jest.mock('../../services/application-service', () => ({
    findOwnedApplicationForApplicant: jest.fn(async () => null),
    healDraftEntityColumns: jest.fn(async () => null),
}));

// R2 Task 12: a refused upload is removed again (no orphan file), so the test reads
// the stored path from the discard call instead of from what stays on disk.
const mockDiscarded = [];
jest.mock('../../services/upload-content-guard', () => {
    const actual = jest.requireActual('../../services/upload-content-guard');
    return {
        ...actual,
        discardRejectedUpload: async (file) => {
            mockDiscarded.push(String(file?.path || ''));
            return actual.discardRejectedUpload(file);
        },
    };
});

const BACKEND_ROOT = path.join(__dirname, '..', '..');
const CAR_UPLOAD_DIR = path.join(BACKEND_ROOT, 'public', 'uploads', 'car');

/** ทางที่ index.js แขวน router นี้ไว้จริง — อ่านจากไฟล์ที่โปรดักชันใช้ ไม่ใช่ที่เทสอยากให้เป็น */
function productionMountPath() {
    const src = fs.readFileSync(path.join(BACKEND_ROOT, 'routes', 'api', 'index.js'), 'utf8');
    const m = src.match(/appConsolidated\.use\(\s*'([^']*)'\s*,\s*require\('\.\/applications\/applications-car'\)/);
    if (!m) { throw new Error('applications-car is not mounted on appConsolidated in routes/api/index.js'); }
    return m[1];
}

function mountAsProductionDoes() {
    const app = express();
    const appConsolidated = express.Router();
    appConsolidated.use(productionMountPath(), require('../../routes/api/applications/applications-car'));
    app.use('/api/applications', appConsolidated);
    return app;
}

const A_REAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

describe('ประตูส่งเอกสารแก้ไข (CAR)', () => {
    const created = [];

    afterAll(() => {
        for (const f of created) { try { fs.unlinkSync(f); } catch { /* ไฟล์ถูกลบไปแล้ว */ } }
    });

    it('อยู่ที่ทางที่หน้าจอเรียก: POST /api/applications/:id/car', async () => {
        const res = await request(mountAsProductionDoes())
            .post('/api/applications/app-1/car')
            .attach('carDocument', A_REAL_PDF, 'car.pdf');

        // Express ตอบ 404 ที่มี body เป็น HTML `Cannot POST <path>` เมื่อ "ไม่มีเส้นทางนี้"
        // ส่วน 404 ที่เป็น JSON แปลว่าเส้นทางมีจริงแต่ handler ปฏิเสธ — สองอย่างนี้ต้องแยกกันให้ออก
        expect(String(res.text)).not.toContain('Cannot POST');
    });

    it('อ่านชื่อฟิลด์เดียวกับที่หน้าจอส่งมา — ไม่ตอบ Unexpected field', async () => {
        const res = await request(mountAsProductionDoes())
            .post('/api/applications/app-1/car')
            .attach('carDocument', A_REAL_PDF, 'car.pdf');

        expect(JSON.stringify(res.body || {})).not.toContain('LIMIT_UNEXPECTED_FILE');
        expect(String(res.text)).not.toContain('Unexpected field');
    });

    it('เขียนไฟล์ลงโฟลเดอร์เดียวกับที่ express เสิร์ฟเป็น /uploads — ไม่ ENOENT', async () => {
        const before = fs.existsSync(CAR_UPLOAD_DIR) ? new Set(fs.readdirSync(CAR_UPLOAD_DIR)) : new Set();

        const res = await request(mountAsProductionDoes())
            .post('/api/applications/app-1/car')
            .attach('carDocument', A_REAL_PDF, 'car.pdf');

        expect(String(res.text)).not.toContain('ENOENT');
        expect(fs.existsSync(CAR_UPLOAD_DIR)).toBe(true);

        // multer stored it under the served folder, and the refusal removed it again.
        const stored = mockDiscarded.filter((p) => p.startsWith(CAR_UPLOAD_DIR + path.sep));
        expect(stored.length).toBeGreaterThan(0);
        for (const f of stored) { expect(fs.existsSync(f)).toBe(false); }
        const after = fs.readdirSync(CAR_UPLOAD_DIR);
        const fresh = after.filter((f) => !before.has(f));
        expect(fresh).toEqual([]);

        // ผ่านชั้นอัปโหลดแล้วจริง จึงไปถึงคำตอบของ handler เอง (คำขอไม่มีอยู่ = 404 JSON)
        expect(res.status).toBe(404);
        expect(res.body?.error).toBe('Application not found');
    });
});
