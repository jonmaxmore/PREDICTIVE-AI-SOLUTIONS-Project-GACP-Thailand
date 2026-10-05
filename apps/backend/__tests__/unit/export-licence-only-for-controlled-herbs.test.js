'use strict';

/**
 * เงื่อนไข "วัตถุประสงค์ ⇒ ขอใบอนุญาต ภ.ท. ของวัตถุประสงค์นั้น" ต้องดูชนิดพืชด้วย
 * (เดิมเป็นเงื่อนไข "ส่งออก ⇒ controlled_herb_license" · มติ operator 2026-10-05 แยกเป็นหนึ่งใบอนุญาต
 * ต่อหนึ่งวัตถุประสงค์ — licence_pt09/10/11 — แต่ต้องดูชนิดพืชเหมือนเดิม)
 *
 * เจอตอนเดินประตูจริงบน demo 2026-09-12 หลังเปิดหกชนิด: ร่างของเกษตรกรที่เลือก **ขิง**
 * และติ๊กวัตถุประสงค์ "เพื่อการส่งออก" ถูกขอ `controlled_herb_license` — เอกสารที่ไม่มีอยู่
 * สำหรับขิง เพราะขิงไม่ใช่สมุนไพรควบคุม เขาจะค้างอยู่ตรงนั้นตลอดกาลโดยหาไฟล์มาแนบไม่ได้
 * และหน้าจอบอกแค่ "ยังไม่ได้แนบ" ไม่ได้บอกว่าเอกสารนี้ไม่มีวันมีอยู่
 *
 * ที่สำคัญกว่าตัวบั๊ก คือ **ทำไมเทสชุดเดิมมองไม่เห็น**
 *
 * ชุดกฎในทะเบียนถูกต้องอยู่แล้ว — ขิงไม่มีแถว controlled_herb_license และ
 * herb-rule-rows.test.js ตรึงข้อนั้นไว้และเขียว · แต่เงื่อนไขส่งออกอยู่ **นอกทะเบียน**
 * เป็นโค้ดใน application-requirements-service ที่คอมเมนต์ของมันเองเรียกว่า
 * "the two conditions no single row can express"
 *
 * บทเรียน: เทสที่ตรึง *ข้อมูล* ไม่เห็นกติกาที่อยู่ใน *โค้ด* · ใบนี้จึงตรึงที่ผลลัพธ์
 * ของเลนส์ ไม่ใช่ที่ชุดกฎ
 */

const { asPlantSlug, isControlledHerb, PLANT_SLUG_TO_CODE } = require('../../config/plant-species-slugs');

describe('isControlledHerb — คำตอบเดียวที่ทั้งเลนส์และ seed ใช้', () => {
    test('กัญชากับกระท่อมถูกควบคุม', () => {
        expect(isControlledHerb('cannabis')).toBe(true);
        expect(isControlledHerb('kratom')).toBe(true);
    });

    test('อีกสี่ชนิดไม่ถูกควบคุม', () => {
        for (const slug of ['turmeric', 'ginger', 'plai', 'black_galangal']) {
            expect(isControlledHerb(slug)).toBe(false);
        }
    });

    test('normalise เหมือน asPlantSlug — ตัวพิมพ์ใหญ่และช่องว่างไม่เปลี่ยนคำตอบ', () => {
        expect(isControlledHerb(' Cannabis ')).toBe(true);
        expect(isControlledHerb('GINGER')).toBe(false);
        expect(asPlantSlug(' Cannabis ')).toBe('cannabis');
    });

    /**
     * เดาผิดทางนี้แค่ขอเอกสารเกิน · เดาผิดอีกทางคือปล่อยพืชควบคุมผ่านโดยไม่ขอใบอนุญาต
     */
    test('ชนิดที่เรียกชื่อไม่ได้ ถือว่าควบคุมไว้ก่อน', () => {
        expect(isControlledHerb('lavender')).toBe(true);
        expect(isControlledHerb(null)).toBe(true);
        expect(isControlledHerb('')).toBe(true);
        expect(isControlledHerb(undefined)).toBe(true);
    });

    test('ทุกชนิดในทะเบียนตอบได้ ไม่มีชนิดไหนตกสำรวจ', () => {
        for (const slug of Object.keys(PLANT_SLUG_TO_CODE)) {
            expect(typeof isControlledHerb(slug)).toBe('boolean');
        }
    });
});

/**
 * ตรึงที่ตัวโค้ดของเลนส์ อ่านเป็นข้อความ — เพราะเรียกฟังก์ชันจริงต้องมีฐานข้อมูล
 * (resolveApplicationRequirements อ่านทะเบียนกฎ) และเทสที่ต้องใช้ Postgres จะไม่ถูกรัน
 * ทุก commit ซึ่งคือเหตุผลเดียวกับที่ herb-rule-rows.test.js เลือกตรึง builder ที่บริสุทธิ์
 */
describe('เงื่อนไขวัตถุประสงค์ในเลนส์ ผูกกับชนิดพืช', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../services/application-requirements-service.js'),
        'utf8',
    );

    test('ช่องใบอนุญาตของวัตถุประสงค์ถูกเติมผ่าน purposeLicenceSlotId(dims.plantCode, code) ทางเดียว', () => {
        const at = source.indexOf('purposeLicenceSlotId(dims.plantCode, code)');
        expect(at).toBeGreaterThan(-1);
        // ชนิดพืชตัดสินที่ฟังก์ชันนั้น (กัญชา ภ.ท. · กระท่อม ส่งออก · อื่น ๆ ไม่มี) — ไม่ใช่ isControlledHerb ที่รวมกระท่อม
        expect(source).not.toContain('isControlledHerb');
        expect(source.slice(Math.max(0, at - 400), at + 200)).toContain('dims.purposes.includes(code)');
        expect(source.match(/REASON_PURPOSE\)/g)).toHaveLength(1);
    });

    test('เลนส์ไม่ประกาศรายชื่อชนิดควบคุมเอง', () => {
        expect(source).not.toMatch(/\['cannabis',\s*'kratom'\]/);
    });
});
