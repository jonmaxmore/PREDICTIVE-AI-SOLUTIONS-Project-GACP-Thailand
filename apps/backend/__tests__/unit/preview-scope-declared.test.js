'use strict';
/**
 * ราคาที่ยังไม่จริง แย่กว่าไม่มีราคา
 *
 * operator 2026-09-10: ร่างที่ยังไม่เลือกลักษณะพื้นที่ แสดงยอด 5,885 ให้ผู้ยื่นเห็น
 * ซึ่งเป็นราคาของ 1 รูปแบบที่ระบบ fallback เอาเอง · ผู้ยื่นเข้าใจว่านั่นคือราคาจริง
 * แล้วตกใจตอนยอดขึ้นเป็น 17,655 ที่ขั้นยื่นจริง (วัดจริงบน demo: 3 ใบ DRAFT มี
 * farmData.areaTypes = null และแสดงราคา 1 รูปแบบ)
 *
 * `scopeCount` ตอบคำถามนี้ไม่ได้: ค่า 1 แปลได้ทั้ง "ขอมา 1 รูปแบบ" และ "ยังไม่ได้เลือก
 * เลย ระบบจึงคิดให้ 1 ไปก่อน" · ธง `scopeDeclared` แยกสองอย่างนี้ออกจากกัน
 *
 * เทสนี้ตรึง **แหล่งความจริง** ไม่ใช่ตัวเลข: preview ต้องอ่านจาก
 * collectUniqueCultivationMethods ตัวเดียวกับที่คิดราคา ไม่ใช่ตีความ "ลักษณะพื้นที่"
 * ซ้ำเป็นครั้งที่ห้า
 */

const { collectUniqueCultivationMethods } = require('../../modules/billing');

const filing = (farmData, extra = {}) => ({ formData: { farmData, ...extra } });

describe('scopeDeclared — ผู้ยื่นบอกลักษณะพื้นที่แล้วหรือยัง', () => {
    test('ยังไม่เลือกเลย → ลิสต์ว่าง ⇒ ยังคิดราคาไม่ได้', () => {
        expect(collectUniqueCultivationMethods(filing({}))).toEqual([]);
    });

    test('farmData ไม่มีเลย → ลิสต์ว่าง', () => {
        expect(collectUniqueCultivationMethods({ formData: {} })).toEqual([]);
        expect(collectUniqueCultivationMethods({})).toEqual([]);
    });

    test('เลือก 1 รูปแบบ → มีคำตอบ ⇒ คิดราคาได้', () => {
        expect(collectUniqueCultivationMethods(filing({ areaTypes: ['INDOOR'] }))).toEqual(['INDOOR']);
    });

    test('เลือก 3 รูปแบบ → ได้ครบสาม (ราคาคือผลบวก ไม่ใช่ตัวคูณของตัวแรก)', () => {
        const got = collectUniqueCultivationMethods(filing({ areaTypes: ['OUTDOOR', 'GREENHOUSE', 'INDOOR'] }));
        expect(got).toHaveLength(3);
        expect(got).toEqual(expect.arrayContaining(['OUTDOOR', 'GREENHOUSE', 'INDOOR']));
    });

    test('areaTypes ชนะ legacy cultivationMethods — คำวินิจฉัย operator 2026-09-06', () => {
        // เคสจริงที่ทำให้เกิดคำวินิจฉัย: "เลือก 1 รูปแบบการปลูก ทำไมจ่ายของ 3"
        const got = collectUniqueCultivationMethods(
            filing({ areaTypes: ['INDOOR'] }, { cultivationMethods: ['outdoor', 'greenhouse', 'indoor'] }),
        );
        expect(got).toEqual(['INDOOR']);
    });

    test('ใบเก่าที่ไม่เคยมี areaTypes ยังใช้ legacy ได้ — ไม่ทำให้ของเดิมพัง', () => {
        const got = collectUniqueCultivationMethods(filing({}, { cultivationMethods: ['outdoor'] }));
        expect(got).toEqual(['OUTDOOR']);
    });

    test('ลิสต์ว่างต่างจากลิสต์ที่มีของ — นี่คือสิ่งที่ scopeCount แยกไม่ออก', () => {
        const undeclared = collectUniqueCultivationMethods(filing({}));
        const one = collectUniqueCultivationMethods(filing({ areaTypes: ['OUTDOOR'] }));
        expect(undeclared.length > 0).toBe(false);
        expect(one.length > 0).toBe(true);
        // ทั้งสองเคสจบที่ scopeCount = 1 เหมือนกัน — จึงต้องมีธงแยก
    });
});
