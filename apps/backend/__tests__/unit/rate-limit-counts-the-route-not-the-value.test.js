/**
 * ตัวจำกัดอัตราต้องนับที่ "เส้นทาง" ไม่ใช่ที่ "ค่าในเส้นทาง"
 *
 * บั๊กเดิม: กุญแจนับคือ `ratelimit:${ip}:${req.path}` ซึ่งรวมค่าพารามิเตอร์เข้าไปด้วย
 * ทุกค่าที่ต่างกันจึงได้ถังนับของตัวเอง และ limiter ถูกข้ามด้วยการเปลี่ยนพารามิเตอร์ —
 * ซึ่งคือสิ่งที่การไล่เดา (enumeration) ทำพอดี
 *
 * วัดจริง 2026-09-09 บน /api/public/verify/:certificateNumber (ตั้ง 30 ครั้ง/นาที):
 *
 *   ยิงเลขเดิม 45 ครั้ง     ->  30 ผ่าน · 15 ถูกบล็อก   (limiter ทำงาน)
 *   ยิงเลขต่างกัน 45 ครั้ง  ->  45 ผ่านทั้งหมด          (limiter ถูกข้าม)
 *   หลังแก้ เลขต่างกัน 45   ->  30 ผ่าน · 15 ถูกบล็อก
 *
 * เทสนี้ยิงผ่าน express จริง ไม่ได้เรียกฟังก์ชันย่อพาธตรง ๆ เพราะสิ่งที่ต้องพิสูจน์คือ
 * พฤติกรรมของ middleware ทั้งชั้น ไม่ใช่ตัวช่วยข้างใน
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { createRateLimiter } = require('../../middleware/rate-limiter');

function appWithLimit(max) {
    const app = express();
    const limiter = createRateLimiter({ windowMs: 60_000, max, message: 'too many' });
    app.get('/thing/:id', limiter, (_req, res) => res.json({ ok: true }));
    app.get('/other', limiter, (_req, res) => res.json({ ok: true }));
    return app;
}

/** ยิง n ครั้ง คืนจำนวนที่ถูกบล็อก */
async function burst(app, urls) {
    let blocked = 0;
    for (const u of urls) {
        // eslint-disable-next-line no-await-in-loop
        const res = await request(app).get(u);
        if (res.status === 429) { blocked += 1; }
    }
    return blocked;
}

describe('เปลี่ยนค่าพารามิเตอร์แล้วข้าม limiter ไม่ได้', () => {
    it('ยิงค่าต่างกันเกินเพดาน ยังถูกบล็อก', async () => {
        const app = appWithLimit(5);
        const urls = Array.from({ length: 12 }, (_, i) => `/thing/value-${i}`);
        expect(await burst(app, urls)).toBeGreaterThan(0);
    });

    it('ยิงค่าเดิมเกินเพดาน ก็ถูกบล็อกเหมือนกัน (ไม่ได้ทำให้พฤติกรรมเดิมเสีย)', async () => {
        const app = appWithLimit(5);
        const urls = Array.from({ length: 12 }, () => '/thing/same');
        expect(await burst(app, urls)).toBeGreaterThan(0);
    });
});

describe('เส้นทางคนละเส้นยังมีถังของตัวเอง', () => {
    it('ใช้โควตาของ /thing จนเต็ม แล้ว /other ยังผ่าน', async () => {
        const app = appWithLimit(3);
        await burst(app, Array.from({ length: 8 }, (_, i) => `/thing/x${i}`));
        const res = await request(app).get('/other');
        expect(res.status).toBe(200);
    });
});
