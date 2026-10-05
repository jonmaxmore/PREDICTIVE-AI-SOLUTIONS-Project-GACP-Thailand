'use strict';
/**
 * ผลวิเคราะห์ (COA) ไม่บังคับ แต่ต้องไม่เงียบ
 *
 * operator 2026-09-11: "ไม่ได้บังคับว่าต้องมี แต่มีเพื่อประโยชน์ของเกษตรกรเอง
 * จะอัพหรือไม่อัพก็ได้" — ยืนยันสเปกเดิม (lab optional farmer-uploaded)
 *
 * เทสนี้ตรึงสองอย่างที่ต้องอยู่ด้วยกัน และง่ายที่จะเผลอทำให้ขัดกัน:
 *   1. ไม่มีด่านไหนห้ามสร้างล็อตเพราะยังไม่มี COA
 *   2. แต่ระบบต้อง "รู้" ว่ามีหรือไม่มี ไม่งั้นหน้าจอบอกเกษตรกรไม่ได้
 *      และหน้าสแกนบอกผู้ซื้อไม่ได้
 *
 * ข้อ 2 คือสิ่งที่หายไปก่อนหน้านี้: harvestService.list()/getById() ไม่เคยดึงผลแล็บ
 * มาเลย ⇒ หน้าจอเกษตรกรไม่มีทางรู้ว่ารุ่นของตัวเองมีผลหรือยัง
 */

const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const HARVEST_SERVICE = read('services/harvest-service.js');
const TRACE_SERVICE = read('services/traceability-service.js');

describe('COA ไม่บังคับ — ไม่มีด่านไหนห้ามบรรจุเพราะยังไม่มีผล', () => {
    test('createLotWithQuotaCheck คุมน้ำหนัก ไม่ได้คุมผลแล็บ', () => {
        const fn = TRACE_SERVICE.slice(TRACE_SERVICE.indexOf('async function createLotWithQuotaCheck'));
        const body = fn.slice(0, fn.indexOf('\nasync function', 10));
        // น้ำหนักเกินโควตาของรุ่น = ปฏิเสธ (กฎ GACP จริง)
        expect(body).toMatch(/LOT_WEIGHT_QUOTA_EXCEEDED/);
        // แต่ต้องไม่มีการปฏิเสธเพราะไม่มีผลแล็บ
        expect(body).not.toMatch(/LAB_RESULT_REQUIRED|COA_REQUIRED|labResultRequired/);
    });
});

describe('แต่ระบบต้องรู้ว่ามีผลหรือยัง — ไม่งั้นบอกใครไม่ได้', () => {
    test('รายการรุ่น นับผลวิเคราะห์ที่ยังไม่ถูกลบ', () => {
        const list = HARVEST_SERVICE.slice(HARVEST_SERVICE.indexOf('findMany'));
        expect(list).toMatch(/_count:\s*\{\s*select:\s*\{\s*labResults/);
        expect(list).toMatch(/isDeleted:\s*false/);
    });

    test('รายละเอียดรุ่น นับเหมือนกัน — สองหน้าต้องไม่ตอบคนละอย่าง', () => {
        const byId = HARVEST_SERVICE.slice(HARVEST_SERVICE.indexOf('findUnique'));
        expect(byId).toMatch(/_count:\s*\{\s*select:\s*\{\s*labResults/);
    });

    test('นับ ไม่ใช่ดึงทั้งแถว — ตัวผลจริงมีประตูที่มีด่านของตัวเอง', () => {
        // ถ้าดึงทั้งแถวมาในรายการ ไฟล์และค่าผลตรวจจะหลุดไปกับ payload ที่ไม่มีด่าน
        expect(HARVEST_SERVICE).not.toMatch(/include:\s*\{[^}]*labResults:\s*true/s);
    });
});

describe('ค่าผลตรวจยังพิมพ์เองไม่ได้ — ด่านเดิมต้องไม่ถูกผ่อนไปพร้อมกัน', () => {
    const GUARD = read('services/lot-lab-claim-guard.js');

    test('ห้าช่องที่เคยพิมพ์เองได้ ยังถูกปฏิเสธ', () => {
        for (const f of ['thcContent', 'cbdContent', 'moistureContent', 'labTestReportUrl', 'testStatus']) {
            expect(GUARD).toContain(f);
        }
    });

    test('คำปฏิเสธชี้ประตูที่ถูก — ที่รุ่น ไม่ใช่ที่ล็อต', () => {
        expect(GUARD).toMatch(/harvest-batches\/:id\/lab-results/);
    });
});
