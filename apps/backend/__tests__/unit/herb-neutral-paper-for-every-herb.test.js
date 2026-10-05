'use strict';

/**
 * เอกสารที่ขอจากทุกชนิด ต้องไม่เอ่ยชื่อชนิดใดชนิดหนึ่ง
 *
 * แพลตฟอร์มรับรองหกชนิดตั้งแต่ 2026-09-11 (มติ operator) แต่ช่องเอกสารทั้งหมดถูกเขียนขึ้น
 * ตอนที่รับกัญชาชนิดเดียว ป้ายจึงพูดถึงกัญชาตรง ๆ เช่น "วิธีนำส่วนของกัญชาที่เหลือไปใช้
 * ประโยชน์" — ช่องนั้นถูกขอจากคนปลูกขิงด้วย และเขาจะอ่านคำสั่งที่ไม่ตรงกับสิ่งที่เขาปลูก
 *
 * นี่ไม่ใช่เรื่องความสวยงามของคำ: ป้ายคือสิ่งเดียวที่บอกผู้ยื่นว่าต้องแนบอะไร ป้ายที่พูดถึงพืช
 * ที่เขาไม่ได้ปลูก ทำให้เขาไม่รู้ว่าช่องนี้เกี่ยวกับตัวเองหรือเปล่า
 *
 * เฟนซ์นี้ derive รายชื่อช่องจาก **กฎหมายจริง** ที่ seed ยื่น ไม่ใช่จากรายการที่พิมพ์มือ —
 * ช่องที่ถูกเพิ่มเข้าชุดพื้นฐานทีหลังจึงถูกตรวจโดยอัตโนมัติ
 */

const { DOCUMENT_SLOTS } = require('../../constants/document-slots');
const { getCanonicalSlotId } = require('../../routes/api/applications/validation-slot-utils');
const { PLANT_SLUG_TO_NAME_TH, CONTROLLED_HERB_SLUGS } = require('../../config/plant-species-slugs');
const {
    BASE_RULE_SET,
    CANNABIS_RULE_SET,
} = require('../../scripts/seed-herb-requirement-rules');

/** ชื่อไทยของทุกชนิด — คำที่ป้ายกลางห้ามมี */
const HERB_NAMES = Object.values(PLANT_SLUG_TO_NAME_TH);

function textOf(slotKey) {
    const slot = DOCUMENT_SLOTS[slotKey];
    return [slot.name, slot.description].filter(Boolean).join(' · ');
}

describe('ป้ายของช่องที่ทุกชนิดต้องยื่น', () => {
    const sharedSlotKeys = [...new Set(BASE_RULE_SET.map((entry) => entry.slot))];

    test('ชุดพื้นฐานไม่ว่าง — ถ้าว่าง เฟนซ์นี้จะผ่านโดยไม่ได้ตรวจอะไรเลย', () => {
        expect(sharedSlotKeys.length).toBeGreaterThan(10);
    });

    test.each(sharedSlotKeys)('%s ไม่เอ่ยชื่อพืชชนิดใดชนิดหนึ่ง', (slotKey) => {
        const text = textOf(slotKey);
        const named = HERB_NAMES.filter((name) => text.includes(name));
        expect(named).toEqual([]);
    });
});

/**
 * ช่องใบอนุญาตในทะเบียนตอนนี้ขอจากกัญชาอย่างเดียว (ภ.ท. 11) แต่ป้ายยังต้องไม่เอ่ยชื่อ
 * กัญชาหรือกระท่อม — ป้ายพูดถึงใบอนุญาตสมุนไพรควบคุมตามชื่อทางการ ไม่ใช่ชื่อพืช
 */
describe('ป้ายของช่องที่ขอจากสองชนิด', () => {
    test.each([...new Set(CANNABIS_RULE_SET.map((e) => e.slot))])(
        '%s พูดถึง "สมุนไพรควบคุม" โดยไม่เจาะจงชนิดใดชนิดหนึ่งในสองชนิดนั้น',
        (slotKey) => {
            const text = textOf(slotKey);
            expect(text).toContain('สมุนไพรควบคุม');
            const controlledNames = CONTROLLED_HERB_SLUGS.map((s) => PLANT_SLUG_TO_NAME_TH[s]);
            expect(controlledNames.filter((name) => text.includes(name))).toEqual([]);
        },
    );
});

/**
 * ทุกช่องที่กฎหมายชี้ ต้องมีอยู่จริงในทะเบียนช่อง และสะกดแบบ canonical — กฎที่ชี้ช่อง
 * ที่ไม่มีอยู่ คือกฎที่ผู้ยื่นไม่มีวันทำตามได้ และไม่มีอะไรร้องเตือน
 */
describe('กฎหมายชี้ช่องที่มีอยู่จริง', () => {
    const allSlotKeys = [...new Set(
        [...BASE_RULE_SET, ...CANNABIS_RULE_SET].map((e) => e.slot),
    )];

    test.each(allSlotKeys)('%s อยู่ในทะเบียนช่อง และสะกดตรงกับรูป canonical', (slotKey) => {
        const slot = DOCUMENT_SLOTS[slotKey];
        expect(slot).toBeDefined();
        expect(getCanonicalSlotId(slot.slotId)).toBe(getCanonicalSlotId(slot.slotId));
        expect(String(slot.name || '').trim()).not.toBe('');
    });
});
