'use strict';
/**
 * ช่องที่เจ้าหน้าที่กด "ผ่าน" แล้ว อัปทับไม่ได้
 *
 * operator 2026-09-11: *"ถ้าเจ้าหน้าที่ผ่านไปแล้ว ไม่สามารถกลับมาแก้เอกสารได้"* และ
 * *"คือเคสผ่านแล้วจะกลับมาแก้ทำไม ที่แก้ต้องเป็นเพราะยังไม่ผ่าน"*
 *
 * ═══ ช่องโหว่ที่วัดได้ก่อนเขียนใบนี้ ═══
 * คำขอที่ถูกตีกลับอยู่ในสถานะ `REVISION_REQUESTED` ซึ่ง `EDITABLE_STATUSES` เปิดให้แก้
 * **ทั้งใบ** · แต่เจ้าหน้าที่ตัดสิน **รายช่อง**: บางช่อง ACCEPTED บางช่อง MORE_REQUESTED
 * ⇒ ผู้ยื่นอัปทับช่องที่ผ่านไปแล้วได้ และประตูอัปโหลดไม่เคยถามตารางผลตรวจเลยสักครั้ง
 *
 * ผลที่ตามมาไม่ใช่แค่ "ผิดกติกา": `ApplicationDocumentReview` ผูกคำตัดสินกับ
 * `(applicationId, slotId, round)` — **กับช่อง ไม่ใช่กับใบเอกสาร** ⇒ เปลี่ยนกระดาษแล้ว
 * แถว ACCEPTED เดิมยังอยู่ กลายเป็นคำตัดสินของกระดาษที่ไม่ได้อยู่ตรงนั้นแล้ว
 * และ **ไม่มีอะไรในฐานข้อมูลบอกได้ว่าเกิดขึ้น**
 *
 * ═══ กติกาที่ปักไว้ ═══
 * ดูคำตัดสิน **รอบล่าสุดของช่องนั้น** เป็นตัวชี้ขาด — เจ้าหน้าที่กลับคำได้ในรอบถัดไป
 * (ACCEPTED รอบ 1 → MORE_REQUESTED รอบ 2 แปลว่าเปิดให้แก้อีกครั้ง) · ไม่มีคำตัดสินเลย
 * = ยังไม่เคยถูกตรวจ = แก้ได้ตามปกติ ⇒ ด่านนี้เงียบสนิทตลอดช่วงร่างและการยื่นครั้งแรก
 */

const {
    assertSlotNotAlreadyAccepted,
    DOCUMENT_SLOT_ALREADY_ACCEPTED,
} = require('../../services/application-document-review-service');

const row = (slotId, verdict, round) => ({ slotId, verdict, round });

const expectRefusal = (fn) => {
    let err = null;
    try { fn(); } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(err.code).toBe(DOCUMENT_SLOT_ALREADY_ACCEPTED);
    return err;
};

describe('ช่องที่ผ่านแล้ว — ปฏิเสธการอัปทับ', () => {
    it('ช่องที่ ACCEPTED อัปทับไม่ได้', () => {
        const err = expectRefusal(() => assertSlotNotAlreadyAccepted({
            slotId: 'land_title',
            reviews: [row('land_title', 'ACCEPTED', 1)],
        }));
        // ผู้ยื่นต้องรู้ว่าต้องทำอะไรต่อ ไม่ใช่แค่ว่าไม่ได้
        expect(err.messageTh).toMatch(/ผ่าน/);
        expect(err.statusCode).toBe(409);
        expect(err.slotId).toBe('land_title');
    });

    it('ช่องที่ถูกขอแก้ ยังอัปทับได้ — นั่นคือทั้งหมดที่การตีกลับมีไว้เพื่อ', () => {
        expect(assertSlotNotAlreadyAccepted({
            slotId: 'water_test',
            reviews: [row('land_title', 'ACCEPTED', 1), row('water_test', 'MORE_REQUESTED', 1)],
        })).toBe(true);
    });

    it('ช่องที่ยังไม่เคยถูกตรวจ อัปทับได้', () => {
        expect(assertSlotNotAlreadyAccepted({
            slotId: 'photos_exterior',
            reviews: [row('land_title', 'ACCEPTED', 1)],
        })).toBe(true);
    });

    it('ไม่มีผลตรวจเลย (ช่วงร่าง / ยื่นครั้งแรก) — ด่านเงียบสนิท', () => {
        expect(assertSlotNotAlreadyAccepted({ slotId: 'land_title', reviews: [] })).toBe(true);
        expect(assertSlotNotAlreadyAccepted({ slotId: 'land_title' })).toBe(true);
    });

    it('รอบล่าสุดชนะ — เจ้าหน้าที่กลับคำเป็นขอแก้ในรอบถัดไป จึงเปิดให้แก้', () => {
        expect(assertSlotNotAlreadyAccepted({
            slotId: 'land_title',
            reviews: [row('land_title', 'ACCEPTED', 1), row('land_title', 'MORE_REQUESTED', 2)],
        })).toBe(true);
    });

    it('รอบล่าสุดชนะอีกทาง — ขอแก้รอบ 1 แล้วผ่านรอบ 2 ⇒ ล็อก', () => {
        expectRefusal(() => assertSlotNotAlreadyAccepted({
            slotId: 'land_title',
            reviews: [row('land_title', 'MORE_REQUESTED', 1), row('land_title', 'ACCEPTED', 2)],
        }));
    });

    it('ลำดับของแถวที่ส่งเข้ามาไม่มีผล — ตัดสินด้วยเลขรอบ ไม่ใช่ลำดับในอาเรย์', () => {
        expectRefusal(() => assertSlotNotAlreadyAccepted({
            slotId: 'land_title',
            reviews: [row('land_title', 'ACCEPTED', 2), row('land_title', 'MORE_REQUESTED', 1)],
        }));
    });

    it('ช่องที่ไม่ได้ระบุ (อัปโหลดที่ไม่สังกัดช่อง) ไม่ถูกล็อก', () => {
        expect(assertSlotNotAlreadyAccepted({
            slotId: null,
            reviews: [row('land_title', 'ACCEPTED', 1)],
        })).toBe(true);
    });
});
