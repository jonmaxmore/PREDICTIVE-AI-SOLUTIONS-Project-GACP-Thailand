/**
 * ลิงก์ในการแจ้งเตือน ต้องพาไปหน้าที่มีอยู่จริง
 *
 * operator กดจริง 2026-09-07: การแจ้งเตือน "เอกสารผ่านการตรวจสอบ" พาไป
 * /health/applications/:id/payment → **404** — หน้านั้นไม่เคยมีในระบบ
 *
 * ไล่ทั้งไฟล์แล้วเจอลิงก์ตายสามใบ ไม่ใช่ใบเดียว (ตรวจกับ src/app จริงทีละเส้น):
 *
 *   /health/applications/:id/payment   → ไม่มี  (ของจริง: /health/payments?app=:id)
 *   /provider/review/:id               → ไม่มี  (ของจริง: /provider/reviewer — คิวof ผู้ตรวจ)
 *   /provider/audit/:id                → ไม่มี  (ของจริง: /provider/audits/:id — หน้ารับ
 *                                                params.id เป็น applicationId อยู่แล้ว)
 *
 * ลิงก์แจ้งเตือนคือปุ่มที่คนกดตอน "มีงานมาถึงมือ" — reviewer ที่เพิ่งได้รับมอบหมาย และ
 * auditor ที่เพิ่งได้คิวตรวจ กดแล้วเจอ 404 มาตลอด ทุกใบ ตั้งแต่ระบบแจ้งเตือนเกิด
 * ไม่มีเทสไหนจับ เพราะเทสของ service ตรวจว่า "ส่งการแจ้งเตือนแล้ว" ไม่เคยถามว่า
 * "ปลายทางมีจริงไหม" — เทสนี้ถามด้วยการอ่านโครง src/app ของเว็บจริง
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'services', 'notification', 'domain-helpers.js');
const APP_DIR = path.join(__dirname, '..', '..', '..', 'web-app', 'src', 'app');

/** /health/applications/:id → ตรวจว่ามี src/app/health/applications/[id]/page.tsx */
function routeExists(actionUrl) {
    const clean = actionUrl.split('?')[0];
    const segments = clean.split('/').filter(Boolean);
    let dir = APP_DIR;
    for (const seg of segments) {
        const literal = path.join(dir, seg);
        if (fs.existsSync(literal)) { dir = literal; continue; }
        // segment ที่เป็นค่าจริง (uuid ฯลฯ) จับกับโฟลเดอร์ [param] ใดก็ได้
        const dyn = fs.readdirSync(dir).find((name) => name.startsWith('['));
        if (dyn) { dir = path.join(dir, dyn); continue; }
        return false;
    }
    return fs.existsSync(path.join(dir, 'page.tsx'));
}

describe('ทุก actionUrl ในการแจ้งเตือน ลงจอดบนหน้าที่มีจริง', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    const urls = [...src.matchAll(/actionUrl:\s*(?:[a-zA-Z]+ \|\| )?`([^`]+)`/g)]
        .map((m) => m[1].replace(/\$\{[^}]+\}/g, 'x-value'));

    it('สกัดลิงก์ได้จริง (อย่างน้อย 6 ใบ)', () => {
        expect(urls.length).toBeGreaterThanOrEqual(6);
    });

    it.each(urls)('%s → มีหน้าอยู่จริง', (url) => {
        expect(routeExists(url)).toBe(true);
    });

    it('ปุ่มจ่ายเงินพาไปหน้า payments พร้อมเลือกคำขอให้ ไม่ใช่หน้าที่ไม่มี', () => {
        expect(src).toContain('/health/payments?app=');
        expect(src).not.toContain('}/payment`');
    });
});
