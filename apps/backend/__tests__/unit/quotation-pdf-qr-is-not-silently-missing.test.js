/**
 * QR บนใบเสนอราคาหายไปเงียบ ๆ เพราะฟังก์ชันที่สร้างลิงก์ไม่เคยถูก import
 *
 * `invoice-template-service.js` เรียก `appBaseUrl()` เพื่อประกอบลิงก์หน้าชำระเงินสำหรับ QR
 * แต่ไม่มีบรรทัด require ใดนำเข้ามันเลย ⇒ ทุกครั้งที่เรียกจะโยน ReferenceError · บล็อกนั้น
 * อยู่ใน try/catch ที่ตั้งใจให้ "ล้มก็ไม่เป็นไร" ⇒ ผลคือ **ใบเสนอราคาทุกใบออกมาโดยไม่มี QR
 * และไม่มีใครรู้** — เป็นความเสียหายชนิดที่ eslint จับได้ (no-undef) แต่ไม่มีใครรัน eslint
 * กับไฟล์นี้จนกระทั่งวันนี้
 *
 * เทสนี้ปักสองอย่างแยกกัน เพราะมันพังคนละแบบ:
 *   1. ตัวฟังก์ชันต้อง *มีอยู่จริง* ในขอบเขตของโมดูล — จับ ReferenceError ที่ try/catch กลืน
 *   2. ตัวจับ try/catch ต้องยังกลืน *ความล้มเหลวจริงของการสร้าง QR* ต่อไป เพราะ QR ที่สร้าง
 *      ไม่ได้ ไม่ควรทำให้เอกสารทั้งใบออกไม่ได้
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', '..', 'services', 'pdf', 'invoice-template-service.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

describe('ลิงก์ที่ QR ชี้ไป', () => {
    test('ฟังก์ชันที่ประกอบลิงก์ถูก import จริง ไม่ใช่แค่ถูกเรียก', () => {
        expect(SRC).toMatch(/appBaseUrl\(\)/);              // ยังถูกเรียกอยู่
        expect(SRC).toMatch(/require\(['"][^'"]*public-urls['"]\)/);  // และถูกนำเข้าแล้ว
    });

    test('เรียกได้จริงโดยไม่โยน ReferenceError', () => {
        // ข้อพิสูจน์ที่แข็งกว่าการ grep: โหลดโมดูล config แล้วเรียกของจริง
        const { appBaseUrl } = require('../../config/public-urls');
        expect(typeof appBaseUrl).toBe('function');
        expect(typeof appBaseUrl()).toBe('string');
    });

    test('การสร้าง QR ที่ล้มเหลว ยังต้องไม่ทำให้ทั้งเอกสารออกไม่ได้', () => {
        // QR เป็นของแถม ไม่ใช่เนื้อหาของเอกสาร ⇒ ต้องอยู่ใน try/catch ต่อไป
        // วัดจาก "ระหว่างการเรียก appBaseUrl กับ catch มีอะไรคั่นไหม" ไม่ใช่จากจำนวนอักขระ
        // (ฉบับแรกตัดหน้าต่างไว้ 800 ตัวอักษร แล้วคอมเมนต์ที่ผมเพิ่มก็ดันมันหลุดหน้าต่างไป)
        const start = SRC.indexOf('QR → in-system payment link');
        const call = SRC.indexOf('appBaseUrl()', start);
        const tryAt = SRC.lastIndexOf('try {', call);
        const catchAt = SRC.indexOf('} catch', call);
        expect(tryAt).toBeGreaterThan(start);      // try เปิดหลังคอมเมนต์ และก่อนการเรียก
        expect(catchAt).toBeGreaterThan(call);     // catch ปิดหลังการเรียก
    });
});
