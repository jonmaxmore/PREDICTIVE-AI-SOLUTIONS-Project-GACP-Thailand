'use strict';

/**
 * ด่านที่ปฏิเสธเมื่ออ่านไม่ได้ ต้องอ่านได้ก่อน
 *
 * `certified-scope.js` ตั้งใจ fail-closed: อ่านใบรับรองไม่ได้ = ห้ามผ่าน ซึ่งถูกต้อง
 * แต่คิวรีของมันเองใช้ไม่ได้ จึงอ่านไม่ได้ **ทุกครั้ง** ⇒ ปฏิเสธทุกครั้งตลอดกาล
 *
 * วัดจริงบน staging 2026-09-07 · เกษตรกรที่เพิ่งได้ใบรับรอง `GACP-TH-2569-8DE364`
 * กดเพิ่มแปลงของตัวเอง:
 *     POST /api/farms/:id/plots → 503 CERTIFIED_SCOPE_UNVERIFIABLE
 *     "ระบบตรวจสอบขอบเขตของใบรับรองไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"
 * ซึ่งชวนให้ลองใหม่ ทั้งที่ลองกี่ครั้งก็ได้ผลเดิม
 *
 * ต้นเหตุ: `OR: [{ expiryDate: null }, { expiryDate: { gt: now } }]`
 * แต่ `Certificate.expiryDate` เป็น `DateTime` ที่ **ไม่ยอมรับ null** (certification.prisma)
 * ⇒ Prisma โยน PrismaClientValidationError ตั้งแต่ตรวจรูปคิวรี ก่อนแตะฐานข้อมูล
 * และ catch ก็แปลงเป็น 503 ตามที่ออกแบบไว้ · ใบรับรองทุกใบมีวันหมดอายุเสมอ สาขา null
 * จึงไม่เคยมีความหมาย มีแต่ทำให้คิวรีทั้งอันใช้ไม่ได้
 *
 * พิสูจน์แล้วบนฐานจริง: ตัดสาขา null ออก คิวรีเดิมคืนใบ GACP-TH-2569-8DE364 พร้อม application
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'certified-scope.js'), 'utf8');
/** โค้ดล้วน — คอมเมนต์อธิบายบั๊กเก่าย่อมเอ่ยถึงมันได้ สิ่งที่ต้องหายไปคือคิวรีจริง */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('คิวรีของด่านตรวจขอบเขตใบรับรอง', () => {
    it('ไม่ถามหา expiryDate ที่เป็น null บนคอลัมน์ที่ห้ามเป็น null', () => {
        expect(CODE).not.toMatch(/expiryDate:\s*null/);
    });

    it('ยังกรอง "ยังไม่หมดอายุ" อยู่ในคิวรี ไม่ใช่มากรองทีหลัง', () => {
        expect(CODE).toMatch(/expiryDate:\s*\{\s*gt:/);
    });

    it('ยังกันใบที่ถูกเพิกถอนหรือหมดอายุตามสถานะเหมือนเดิม', () => {
        expect(SRC).toContain("'revoked'");
        expect(SRC).toContain("'REVOKED'");
        expect(SRC).toContain("'EXPIRED'");
    });

    it('ยังเป็น fail-closed — อ่านไม่ได้ยังคงปฏิเสธ ไม่ใช่ปล่อยผ่าน', () => {
        expect(SRC).toContain('SCOPE_UNVERIFIABLE');
        expect(SRC).toMatch(/503/);
    });

    it('สคีมายังยืนยันว่า expiryDate เป็นคอลัมน์บังคับ — สาขา null จึงเป็นไปไม่ได้จริง', () => {
        const schema = fs.readFileSync(
            path.join(__dirname, '..', '..', 'prisma', 'schema', 'certification.prisma'), 'utf8',
        );
        const model = schema.slice(schema.indexOf('model Certificate {'));
        expect(model).toMatch(/expiryDate\s+DateTime\s*$/m);
    });
});
