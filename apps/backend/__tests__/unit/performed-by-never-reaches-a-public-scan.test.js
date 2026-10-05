/**
 * ชื่อผู้ปฏิบัติงาน ต้องไม่ขึ้นหน้าที่สแกนได้โดยไม่ต้องล็อกอิน
 *
 * operator 2026-09-07 เลือกแบบ ก.: เพิ่มช่อง "ผู้ปฏิบัติงาน" เป็นข้อความอิสระ ไม่บังคับกรอก
 * เพราะแรงงานรายวันในฟาร์มส่วนใหญ่ไม่มีบัญชีในระบบ
 *
 * แต่ค่าที่กรอกคือ **ชื่อบุคคล** — ข้อมูลส่วนบุคคลที่หน้าสาธารณะห้ามพูดถึง เป็นกติกาเดียวกับ
 * ที่ถอด "ชื่อแปลง" ออกจากหน้าสแกนเมื่อ 2026-09-05 ด้วยเหตุผลว่า "ชื่อแปลงพาชื่อคนมาได้" —
 * ที่นี่ไม่ใช่ "พาชื่อคนมาได้" แต่ **เป็นชื่อคนโดยตรง**
 *
 * เทสนี้เฝ้าประตูสาธารณะทั้งสามเส้นที่ QR พาไปได้ (resolve-generic ทั้งสามสาขา +
 * trace-batch-lot-routes) ว่าไม่มีเส้นไหนพิมพ์ performedBy ออกไป และไม่มีเส้นไหน
 * spread แถว CultivationLog ทั้งแถว ซึ่งจะพาคอลัมน์ใหม่ทุกคอลัมน์ออกไปเงียบ ๆ
 */
'use strict';

const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

const PUBLIC_DOORS = [
    'services/trace-service/resolve-generic.js',
    'routes/api/trace/trace-batch-lot-routes.js',
];

describe('ประตูสาธารณะไม่พูดถึงผู้ปฏิบัติงาน', () => {
    it.each(PUBLIC_DOORS)('%s ไม่ตีพิมพ์ performedBy', (rel) => {
        expect(read(rel)).not.toContain('performedBy');
    });

    it.each(PUBLIC_DOORS)('%s ไม่ spread แถว cultivation log ทั้งแถว', (rel) => {
        // การ spread แถวดิบคือวิธีที่คอลัมน์ใหม่หลุดออกไปโดยไม่มีใครตั้งใจ
        // (บทเรียน 7717859f: `plant: lot.batch?.plant` ยกแถวทะเบียนพืชทั้งแถวให้คนแปลกหน้า)
        const src = read(rel);
        expect(src).not.toMatch(/\.\.\.\s*(log|activity|cultivationLog)\b/);
    });

    it('คอลัมน์มีจริงในสคีมา และประกาศไว้ว่าเป็นข้อมูลภายใน', () => {
        const schema = read('prisma/schema/cultivation.prisma');
        expect(schema).toContain('performedBy String?');
        expect(schema).toContain('ห้ามขึ้นหน้าสแกนสาธารณะ');
    });

    it('ประตูบันทึกกิจกรรมรับค่านี้จริง — ไม่ใช่คอลัมน์ที่ไม่มีใครถาม', () => {
        // คลาสเดียวกับ productName/temperature/humidity ที่มีคอลัมน์มาตลอดแต่ประตูไม่รับ
        const src = read('routes/api/cultivation/planting-cycles-activity-harvest-routes.js');
        expect(src).toContain('performedBy');
    });

    it('เกษตรกรเปิดดูย้อนหลังได้ — ไม่ใช่ช่องเขียนอย่างเดียว', () => {
        // ถ้ากรอกได้แต่ projection ไม่ส่งกลับ ค่านั้นก็หายไปจากสายตาเจ้าของและผู้ตรวจ
        // (พบโดยการกวาดแบบขนาน 2026-09-07 — toActivityResponse ไม่มีทั้ง productName และ performedBy)
        const src = read('services/planting-cycle-service.js');
        expect(src).toMatch(/performedBy:\s*log\.performedBy/);
        expect(src).toMatch(/productName:\s*log\.productName/);
    });

    it('แก้ชื่อที่พิมพ์ผิดได้ — allowlist ของการแก้ไขต้องมีช่องนี้', () => {
        const src = read('services/cultivation-log-service.js');
        const block = src.slice(src.indexOf('const allowedFields'), src.indexOf('const allowedFields') + 400);
        expect(block).toContain("'performedBy'");
    });

    it('ห้ามหลุดออก Data Lake ภายนอก — อยู่ในบัญชีต้องห้ามของ PII', () => {
        // ปลายทางคือ Data Lake ของ บพข. นอกองค์กร · ชื่อบุคคลห้ามออกไปเด็ดขาด
        const guard = read('__tests__/unit/dataset-export-service.test.js');
        expect(guard).toMatch(/const banned = new Set\(\[[^\]]*'performedBy'/);
    });
});

/**
 * คำเตือน PHI ต้องไม่กลายเป็นทางลัดพาสมุดบันทึกขึ้นหน้าสาธารณะ
 *
 * ผลกวาดแบบขนาน 2026-09-07 ชี้ว่าคอมเมนต์ฉบับแรกของ pre-harvest-interval เขียนเจตนาไว้ว่า
 * ให้คำเตือนถึง "ผู้ตรวจ/ผู้ซื้อ" — และ "ผู้ซื้อ" คือหน้าสแกนสาธารณะ · คำเตือนนี้อ้างอิง
 * แถวการพ่นสาร ซึ่งมีชื่อสารและชื่อผู้ปฏิบัติงานห้อยอยู่ ⇒ คำเชิญนั้นคือช่องรั่วในอนาคต
 */
describe('phiWarning อยู่ฝั่งภายในเท่านั้น', () => {
    const read = (rel) => require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', rel), 'utf8',
    );

    it('ไม่มีประตูสาธารณะเส้นไหนส่ง phiWarning ออกไป', () => {
        for (const rel of [
            'services/trace-service/resolve-generic.js',
            'routes/api/trace/trace-batch-lot-routes.js',
        ]) {
            expect(read(rel)).not.toContain('phiWarning');
        }
    });

    it('คอมเมนต์เตือนว่าห้ามส่งก้อนนี้ให้ผู้ซื้อ แทนที่จะเชิญ', () => {
        // คอมเมนต์ยกถ้อยคำเดิมมาอ้างอิงได้ — นั่นคือสิ่งที่ทำให้คนอ่านเข้าใจว่าทำไมถึงเปลี่ยน
        // สิ่งที่ต้องมีคือ "คำเตือน" กำกับถ้อยคำนั้น ไม่ใช่ปล่อยให้มันเป็นเจตนาที่ยังยืนอยู่
        const src = read('services/planting-cycle/pre-harvest-interval.js');
        expect(src).toContain('หน้าสแกนสาธารณะ');
        expect(src).toMatch(/คำเชิญที่อันตราย|ห้าม/);
        // เจตนาที่ยืนอยู่ตอนนี้คือ "คนบันทึกและผู้ตรวจ" เท่านั้น
        expect(src).toContain('คนบันทึกและผู้ตรวจ');
    });
});
