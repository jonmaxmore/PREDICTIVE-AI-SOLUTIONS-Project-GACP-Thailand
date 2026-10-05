/**
 * ทุกสถานะที่ seed เขียนลงไป ต้องเป็นสถานะที่ระบบไปถึงได้เอง และมีคนทำงานต่อได้
 *
 * เจอจากการเดินฝั่งพนักงานจริง 2026-09-05: `APP-68-001` ถูก seed เขียนเป็น
 * `ASSIGNED_FOR_REVIEW` **โดยไม่มีผู้ตรวจ** ⇒ ไปต่อไม่ได้ทั้งสองทาง
 *
 *   ผู้ตรวจเอกสาร  มองไม่เห็น — การมองเห็นของบทบาทนี้ผูกกับ "ถูกมอบหมายให้ฉัน"
 *                  (shared/application-visibility.js) ซึ่งถูกต้องแล้ว
 *   ผู้จัดตาราง     มอบหมายไม่ได้ — ประตูมอบหมายต้องการสถานะ DOC_FEE_PAID
 *                  แล้วคำขอนี้เลยจุดนั้นไปแล้ว (409)
 *
 * ⇒ คำขอค้างอยู่ในที่ที่ไม่มีพนักงานคนไหนแตะได้ · เครื่องจริงสร้างสภาพนี้ไม่ได้ (state machine
 * มีทางเข้าทางเดียวคือ DOC_FEE_PAID → ASSIGNED_FOR_REVIEW และตัวเดินคือ
 * schedulerAssignReviewer ซึ่งตั้งผู้ตรวจในจังหวะเดียวกัน) — **มีแต่ seed ที่เขียนข้ามหน้างาน**
 *
 * ต้นทุนจริงคือทุกสภาพแวดล้อมที่ตั้งใหม่ได้คำขอผีมาหนึ่งใบ และการเดินสายฝั่งพนักงานทำไม่ได้
 * ถ้าไม่แก้ข้อมูลด้วยมือก่อน
 *
 * ทางแก้ที่เลือก: ให้ seed หยุดที่ `DOC_FEE_PAID` แล้วปล่อยให้ **ผู้จัดตารางเป็นคนมอบหมายจริง** —
 * สภาพแวดล้อมที่ตั้งใหม่จึงสาธิตโซ่การทำงานของพนักงานได้ แทนที่จะข้ามมันไป
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SEED = fs.readFileSync(path.join(__dirname, '../../prisma/seed-gacp.js'), 'utf8');
const { TRANSITIONS } = (() => {
    // The state machine is the arbiter of what is reachable; read it, do not restate it.
    const src = fs.readFileSync(path.join(__dirname, '../../services/workflow-transition-service.js'), 'utf8');
    return { TRANSITIONS: src };
})();

/** สถานะที่ seed เขียนลงบนคำขอตัวอย่าง */
function seededStatuses() {
    const block = SEED.slice(SEED.indexOf('const SAMPLE_APPLICATIONS'), SEED.indexOf('// ─── Onsite audit evidence'));
    return [...block.matchAll(/status:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
}

describe('สถานะที่ seed เขียน', () => {
    test('ไม่มีใบไหนถูกวางไว้ที่ ASSIGNED_FOR_REVIEW โดยไม่มีผู้ตรวจ', () => {
        const statuses = seededStatuses();
        expect(statuses.length).toBeGreaterThan(0);
        // ถ้าจะใช้สถานะนี้ ต้องเขียนผู้ตรวจลงไปด้วยในบล็อกเดียวกัน
        if (statuses.includes('ASSIGNED_FOR_REVIEW')) {
            expect(SEED).toMatch(/reviewerId/);
        }
    });

    test('DOC_FEE_PAID ยังเป็นสถานะที่ผู้จัดตารางหยิบไปมอบหมายได้จริง', () => {
        // ปักไว้กับ state machine เอง ไม่ใช่กับความจำของผม
        expect(TRANSITIONS).toMatch(/DOC_FEE_PAID:\s*new Set\(\['ASSIGNED_FOR_REVIEW'\]\)/);
    });

    test('ทุกสถานะที่ seed ใช้ เป็นสถานะที่ state machine รู้จัก', () => {
        for (const s of seededStatuses()) {
            expect(TRANSITIONS).toContain(`'${s}'`);
        }
    });
});
