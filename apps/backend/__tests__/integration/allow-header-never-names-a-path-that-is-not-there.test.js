/**
 * ถ้า API ตอบว่า "วิธีนี้ไม่ได้ ใช้ POST สิ" แล้ว POST ได้ 404 — คำตอบนั้นแย่กว่าไม่ตอบ
 *
 * middleware/api-not-found.js แยก 405 ออกจาก 404 ด้วยการเดินสแตกของ router แล้วถาม
 * ว่าพาธนี้มีวิธีไหนลงทะเบียนไว้บ้าง · Express ไม่เก็บสตริงที่ใช้ mount ไว้ ต้องกู้จาก
 * regexp เอา และตัวกู้รุ่นแรกหยุดที่ตัวคั่นแรก:
 *
 *     use('/audit/scheduling', r)  ->  '/audit'
 *     use('/auth/health', r)       ->  '/auth'
 *
 * วัดจริงบนระบบที่รันอยู่ 2026-09-09 พังทั้งสองทิศพร้อมกัน:
 *
 *   DELETE /api/audit/scheduling/queue   404   (GET มีอยู่จริง ควรเป็น 405)
 *   DELETE /api/auth/login               405 Allow: POST
 *   POST   /api/auth/login               404   <- เดินตาม Allow ของเราเอง
 *
 * คู่หลังคือข้อหนัก · `/api/auth/login` ไม่ใช่เส้นทางเลย ประตูล็อกอินจริงคือ
 * /api/auth/health/login กับ /api/auth/provider/login แต่พาธที่ถูกตัดทำให้
 * '/auth' + '/login' ดูเหมือนเส้นทางที่ลงทะเบียนไว้ · ระบบจึงโฆษณาประตูล็อกอินที่ไม่มีอยู่
 * พร้อมบอกวิธีที่ต้องใช้ · SDK หรือหน่วยงานที่เชื่อ header Allow จะเดินเข้า 404 ตรง ๆ
 */

'use strict';

const express = require('express');
const request = require('supertest');

const { apiNotFoundHandler, methodsRegisteredFor } = require('../../middleware/api-not-found');

/** ย่อส่วนของ server.js: mount จริงบางตัว แล้วปิดท้ายด้วยตัวจับที่เหลือ */
function buildApp() {
    const app = express();

    const scheduling = express.Router();
    scheduling.get('/queue', (_req, res) => res.json({ success: true, data: [] }));

    const healthAuth = express.Router();
    healthAuth.post('/login', (_req, res) => res.json({ success: true }));

    const applications = express.Router();
    applications.get('/my', (_req, res) => res.json({ success: true, data: [] }));

    // ซ้อนแบบเดียวกับ routes/api/index.js: router หนึ่งใบ mount ที่ '/api' แล้ว
    // ข้างในค่อย use ต่อ · รูปนี้สำคัญ — พาธผีเกิดจากการที่ base สะสม '/api' มาแล้ว
    // แล้ว mount ที่เหลือถูกตัดเหลือเซ็กเมนต์แรก ('/audit') ทำให้ '/api/audit/queue'
    // ดูเหมือนเส้นทางจริง · แอปจำลองที่ mount เต็มพาธตรงกับ app จะไม่เห็นข้อบกพร่องนี้
    const api = express.Router();
    api.use('/audit/scheduling', scheduling);   // mount สองเซ็กเมนต์
    api.use('/auth/health', healthAuth);        // mount สองเซ็กเมนต์
    api.use('/applications', applications);     // mount เซ็กเมนต์เดียว — ต้องไม่พังจากการแก้
    app.use('/api', api);

    app.use('/api', apiNotFoundHandler);
    return app;
}

describe('พาธใต้ mount ที่มีหลายเซ็กเมนต์ ถูกอ่านครบ', () => {
    it('รู้ว่ามี GET ที่ /api/audit/scheduling/queue', () => {
        expect(methodsRegisteredFor(buildApp(), '/api/audit/scheduling/queue'))
            .toEqual(expect.arrayContaining(['GET']));
    });

    it('วิธีที่ไม่รองรับได้ 405 พร้อม Allow ไม่ใช่ 404', async () => {
        const res = await request(buildApp()).delete('/api/audit/scheduling/queue');
        expect(res.status).toBe(405);
        expect(res.headers.allow.split(/,\s*/)).toEqual(expect.arrayContaining(['GET']));
    });

    it('ประตูล็อกอินจริงก็เช่นกัน', async () => {
        const res = await request(buildApp()).delete('/api/auth/health/login');
        expect(res.status).toBe(405);
        expect(res.headers.allow.split(/,\s*/)).toEqual(expect.arrayContaining(['POST']));
    });
});

describe('พาธที่ไม่มีอยู่จริง ต้องไม่ถูกโฆษณาว่ามี', () => {
    // '/audit' + '/queue' และ '/auth' + '/login' คือพาธที่เกิดจากการตัด mount
    // ไม่ใช่เส้นทางที่ใครลงทะเบียนไว้
    const GHOSTS = ['/api/audit/queue', '/api/auth/login'];

    it.each(GHOSTS)('%s ไม่มีวิธีใดลงทะเบียนไว้', (p) => {
        expect(methodsRegisteredFor(buildApp(), p)).toEqual([]);
    });

    it.each(GHOSTS)('%s ตอบ 404 ทุกวิธี และไม่มี Allow', async (ghost) => {
        for (const method of ['delete', 'post', 'put', 'get']) {
            const res = await request(buildApp())[method](ghost);
            expect({ method, status: res.status, allow: res.headers.allow })
                .toEqual({ method, status: 404, allow: undefined });
        }
    });

    it('คำตอบต้องไม่ขัดกันเอง: ถ้าตอบ 405 วิธีที่ Allow บอกต้องใช้ได้จริง', async () => {
        const app = buildApp();
        const probed = ['/api/audit/scheduling/queue', '/api/auth/health/login',
            '/api/applications/my', '/api/audit/queue', '/api/auth/login'];
        for (const p of probed) {
            const refused = await request(app).patch(p); // ไม่มีที่ไหนรองรับ PATCH
            if (refused.status !== 405) { continue; }
            const allowed = refused.headers.allow.split(/,\s*/).filter((m) => m !== 'OPTIONS');
            for (const m of allowed) {
                const res = await request(app)[m.toLowerCase()](p);
                expect({ p, m, status: res.status }).not.toEqual({ p, m, status: 404 });
            }
        }
    });
});

describe('mount เซ็กเมนต์เดียวยังทำงานเหมือนเดิม', () => {
    it('/api/applications/my ตอบ 405 พร้อม Allow: GET', async () => {
        const res = await request(buildApp()).delete('/api/applications/my');
        expect(res.status).toBe(405);
        expect(res.headers.allow.split(/,\s*/)).toEqual(expect.arrayContaining(['GET']));
    });

    it('GET ที่ตรงกันยังได้ผลของตัวเอง', async () => {
        const res = await request(buildApp()).get('/api/applications/my');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: [] });
    });
});
