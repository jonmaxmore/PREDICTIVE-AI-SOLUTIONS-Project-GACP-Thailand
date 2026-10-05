/**
 * ลักษณะพื้นที่ปลูกมีสามคำ และราคาต้องมาจากสามคำนั้นเท่านั้น
 *
 * operator 2026-09-11: *"เรามีแค่ 3 อย่างนะ ... แล้วเราไม่มีอะไรติ๊กมาเลย ที่ไม่ติ๊กกับเกิน 3
 * มันไม่ถูกต้อง"* — และเลือกทางที่ให้ถอด "อื่น ๆ" ออกจากจอและจากทะเบียน
 *
 * ทำไมไฟล์นี้ต้องมี: ค่าธรรมเนียมถูกคูณด้วย **จำนวนลักษณะพื้นที่ที่คำขอประกาศ** และประตูยื่น
 * ตรวจแค่ `z.array(z.any()).min(1)` ⇒ ตรวจว่า "มีไหม" แต่ไม่ตรวจว่า "เป็นคำอะไร"
 * วัดกับตัวคิดเงินจริงบน main 2026-09-11 ก่อนแก้:
 *
 *   ส่งค่าอะไรก็ได้มาห้าค่า        → คิดห้าลักษณะ = 176,550 บาท
 *   พิมพ์ 'OUTDOOR' + 'OUTDOORS'  → คิดสองลักษณะ = 70,620 บาท
 *   ไม่ติ๊กอะไรเลย                → ตกไปใช้คอลัมน์ที่ประตูร่างเติม 'OUTDOOR' ให้ = 35,310
 *
 * ⇒ ราคาถูกขับด้วยข้อความอิสระ ไม่ใช่ด้วยคำที่ระบบรู้จัก · แบบเดียวกับ `plantId` ที่เคยเป็น
 * free text แล้วเอกสารบังคับเก้าใบกลายเป็นศูนย์ (requiredPlant ปิดไปแล้ว — นี่คือช่องที่สอง)
 *
 * **เพดานสามไม่ได้เขียนเป็นเลข**: เมื่อคำที่ไม่รู้จักถูกปฏิเสธ และคำซ้ำถูกปฏิเสธ จำนวนสูงสุด
 * ที่ผ่านได้คือจำนวนคำในทะเบียน = สาม · เลขเพดานที่พิมพ์มือจะเป็นความจริงซ้อนที่ต้องคอยแก้ตาม
 */

'use strict';

const {
    validateCanonicalSubmission,
    AREA_TYPES,
} = require('../../validation/canonical-application-validator');
const feeService = require('../../modules/billing/internal/fee-service');
const { RULE_DIMENSIONS } = require('../../services/requirement-rule-service');

/** คำขอที่สมบูรณ์ทุกอย่าง ยกเว้นลักษณะพื้นที่ที่เทสแต่ละข้อป้อนเอง */
function filingWithAreaTypes(areaTypes) {
    return {
        plantId: 'cannabis',
        serviceType: 'NEW',
        certificationPurposes: ['EXPORT'],
        farmData: { areaTypes },
    };
}

/**
 * คำขอในเทสนี้กรอกไม่ครบทุกขั้นโดยตั้งใจ — ที่สนใจคือ **ขั้นที่ 2 บ่นเรื่องลักษณะพื้นที่
 * หรือไม่** เท่านั้น ไม่ใช่ว่าคำขอทั้งใบผ่าน · การเทียบ `isValid` จะทำให้ทุกข้อเขียว
 * ด้วยเหตุผลที่ไม่เกี่ยวกัน (ชื่อฟาร์ม ที่อยู่ ฯลฯ) ซึ่งคือด่านที่ไม่ตรวจอะไรเลย
 */
const step2AreaTypeRefusals = (areaTypes) => {
    const result = validateCanonicalSubmission(filingWithAreaTypes(areaTypes), []);
    const step2 = (result?.errorsByStep || {})[2] || [];
    return step2.filter((issue) => issue.path === 'cultivation_methods');
};

const accepted = (areaTypes) => step2AreaTypeRefusals(areaTypes).length === 0;

const refusalText = (areaTypes) =>
    step2AreaTypeRefusals(areaTypes).map((issue) => issue.message).join(' · ');

describe('ทะเบียนคำมีสามคำ', () => {
    it('ประตูยื่นประกาศคำไว้สามคำ และไม่มี OTHER', () => {
        expect([...AREA_TYPES].sort()).toEqual(['GREENHOUSE', 'INDOOR', 'OUTDOOR']);
    });

    it('ทะเบียนกฎถือสามคำเดียวกัน — ประตูกับทะเบียนต้องไม่คนละชุด', () => {
        expect([...RULE_DIMENSIONS.areaType].sort()).toEqual([...AREA_TYPES].sort());
    });
});

describe('สามสถานการณ์จริง — ผ่านทั้งสาม', () => {
    it.each([
        [['OUTDOOR']],
        [['OUTDOOR', 'GREENHOUSE']],
        [['OUTDOOR', 'GREENHOUSE', 'INDOOR']],
    ])('%s ผ่านประตู', (areaTypes) => {
        expect(accepted(areaTypes)).toBe(true);
    });

    it('ราคาขึ้นกับจำนวน ไม่ใช่ว่าเป็นแบบไหน — อัตราต่อลักษณะเท่ากันทั้งสาม', () => {
        const total = (areaTypes) => {
            const p = filingWithAreaTypes(areaTypes);
            return feeService.calculatePhase1Fee({ formData: p }).phaseTotal
                + feeService.calculatePhase2Fee({ formData: p }).phaseTotal;
        };
        expect(total(['OUTDOOR'])).toBe(total(['INDOOR']));
        expect(total(['OUTDOOR'])).toBe(total(['GREENHOUSE']));
        expect(total(['OUTDOOR', 'INDOOR'])).toBe(2 * total(['OUTDOOR']));
        expect(total(['OUTDOOR', 'GREENHOUSE', 'INDOOR'])).toBe(3 * total(['OUTDOOR']));
    });

    it('ตัวพิมพ์และช่องว่างไม่ทำให้ราคาเปลี่ยน — wizard ส่งคำตัวใหญ่ ของเก่าส่งตัวเล็ก', () => {
        expect(accepted(['outdoor'])).toBe(true);
        expect(accepted([' Outdoor '])).toBe(true);
    });
});

describe('สิ่งที่ต้องถูกปฏิเสธ — ไม่ใช่คิดเงินให้', () => {
    it('ไม่ติ๊กอะไรเลย', () => {
        expect(accepted([])).toBe(false);
    });

    it('"อื่น ๆ" — operator ถอดออกจากจอและทะเบียนแล้ว 2026-09-11', () => {
        expect(accepted(['OTHER'])).toBe(false);
        expect(accepted(['OUTDOOR', 'OTHER'])).toBe(false);
    });

    it('คำที่ไม่อยู่ในทะเบียน — ห้าค่าที่เคยกลายเป็น 176,550 บาท', () => {
        expect(accepted(['A', 'B', 'C', 'D', 'E'])).toBe(false);
    });

    it('คำที่พิมพ์ผิดหนึ่งตัวอักษร — เคยกลายเป็นลักษณะที่สอง', () => {
        expect(accepted(['OUTDOOR', 'OUTDOORS'])).toBe(false);
    });

    it('คำซ้ำ — ผู้ยื่นติ๊กสองครั้งไม่ได้ ประตูจึงไม่ควรรับ', () => {
        expect(accepted(['OUTDOOR', 'OUTDOOR'])).toBe(false);
        expect(accepted(['OUTDOOR', 'outdoor'])).toBe(false);
    });

    it('เกินสามเป็นไปไม่ได้เอง เพราะคำซ้ำและคำแปลกถูกปฏิเสธไปแล้ว', () => {
        expect(accepted(['OUTDOOR', 'GREENHOUSE', 'INDOOR', 'OUTDOOR'])).toBe(false);
    });

    it('ข้อความปฏิเสธบอกเป็นภาษาไทยว่าเลือกได้จากอะไร ไม่ใช่แค่บอกว่าผิด', () => {
        const text = refusalText(['อะไรก็ไม่รู้']);
        expect(text).toContain('ลักษณะพื้นที่ปลูก');
        expect(text).toContain('กลางแจ้ง');
        expect(text).toContain('โรงเรือน');
        expect(text).toContain('อาคารระบบปิด');
        // และไม่เอ่ยคำอังกฤษที่ผู้ยื่นหาไม่เจอบนหน้าจอ
        expect(text).not.toMatch(/OUTDOOR|areaTypes|cultivation/i);
    });

    it('คำซ้ำกับคำแปลกให้เหตุผลต่างกัน — ผู้ยื่นต้องรู้ว่าต้องแก้อะไร', () => {
        expect(refusalText(['OUTDOOR', 'OUTDOOR'])).toContain('ซ้ำกัน');
        expect(refusalText(['XYZ'])).toContain('เลือกได้จาก');
    });
});

describe('ตัวคิดเงินไม่ตั้งชื่อลักษณะที่ผู้ยื่นไม่ได้เลือก', () => {
    /**
     * ความต่างที่สำคัญ และเป็นเหตุผลที่ข้อนี้ไม่ได้บังคับให้ throw:
     *
     *   คิดหนึ่งลักษณะ **แบบไม่มีชื่อ** (`SCOPE_1`) → เอกสารพิมพ์ "รูปแบบการปลูกที่ 1"
     *     ยอดเท่าเดิม และไม่มีบรรทัดใดอ้างว่าผู้ยื่นเลือกอะไร
     *   คิดหนึ่งลักษณะ **แล้วตั้งชื่อให้** ('OUTDOOR') → เอกสารพิมพ์ "แบบกลางแจ้ง"
     *     ซึ่งเป็นคำประกาศที่ผู้ยื่นไม่เคยพูด และคำนั้นไหลต่อไปถึงขอบเขตบนใบรับรอง
     *     (certified-scope.js ใช้ areaTypes เป็นขอบเขตที่รับรอง และล็อกการเพิ่มแปลง)
     *
     * ทางถอยที่อ่านคอลัมน์ค่าเดียว (`locationType || areaType`) เป็นแบบที่สอง และประตูร่าง
     * เป็นคนเติมคำว่า 'OUTDOOR' ลงคอลัมน์นั้นเอง เพื่อให้ NOT NULL มีค่า ⇒ ตัดทางถอยนั้นออก
     */
    const names = (payload) =>
        feeService.calculatePhase2Fee(payload).scopeBreakdown.map((line) => line.method);

    it('คำขอที่ไม่ประกาศอะไรเลย ยังคิดหนึ่งลักษณะ แต่ไม่มีบรรทัดใดชื่อ OUTDOOR', () => {
        const fee = feeService.calculatePhase1Fee({ areaType: 'OUTDOOR' });
        expect(fee.scopeCount).toBe(1);
        expect(JSON.stringify(names({ areaType: 'OUTDOOR' }))).not.toMatch(/OUTDOOR/);
    });

    it('คำเดียวใน locationType ก็ตั้งชื่อให้ไม่ได้ด้วยเหตุผลเดียวกัน', () => {
        expect(JSON.stringify(names({ locationType: 'GREENHOUSE' }))).not.toMatch(/GREENHOUSE/);
    });

    it('มี areaTypes ก็คิดตามนั้นและตั้งชื่อได้ เพราะผู้ยื่นเลือกเอง', () => {
        const p = { formData: { farmData: { areaTypes: ['OUTDOOR', 'INDOOR'] } } };
        expect(feeService.calculatePhase1Fee(p).scopeCount).toBe(2);
        expect(JSON.stringify(names(p))).toMatch(/OUTDOOR/);
    });

    it('คำขอยุคก่อนที่ประกาศด้วย cultivationMethods ยังตั้งชื่อได้ — เขาเลือกเอง', () => {
        const p = { formData: { cultivationMethods: ['GREENHOUSE'] } };
        expect(feeService.calculatePhase1Fee(p).scopeCount).toBe(1);
        expect(JSON.stringify(names(p))).toMatch(/GREENHOUSE/);
    });
});
