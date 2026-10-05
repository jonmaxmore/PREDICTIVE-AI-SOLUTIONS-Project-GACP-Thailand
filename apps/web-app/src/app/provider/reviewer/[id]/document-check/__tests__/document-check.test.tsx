
/**
 * ปุ่ม "รับเอกสารนี้" ต้องไม่เชิญให้กดในช่องที่ไม่มีเอกสาร
 *
 * เดินฝั่งเจ้าหน้าที่จริง 2026-09-06: หน้าจอแสดงปุ่มรับกับทุกช่อง รวมช่องที่ยังไม่ได้แนบ
 * และประตูก็บันทึก ACCEPTED ให้ ⇒ ฐานข้อมูลมีบันทึกว่าเจ้าหน้าที่รับกระดาษที่ไม่มีตัวตน
 * ประตูปฏิเสธแล้ว (REVIEW_SLOT_NOT_ATTACHED) และหน้าจอต้องไม่หลวมกว่าประตู ตามที่หัวไฟล์
 * ของหน้านี้เขียนไว้เอง: "LESS permissive than the door, never more"
 */
import { canAcceptSlot, ACCEPT_BLOCKED_TH } from '../document-check-state';

describe('รับได้เฉพาะช่องที่มีเอกสาร', () => {
    it('ช่องที่แนบแล้ว = กดรับได้', () => {
        expect(canAcceptSlot({ satisfied: true })).toBe(true);
    });

    it('ช่องที่ยังไม่ได้แนบ = กดรับไม่ได้', () => {
        expect(canAcceptSlot({ satisfied: false })).toBe(false);
        expect(canAcceptSlot(undefined)).toBe(false);
    });

    it('บอกทางออกด้วย ไม่ใช่แค่บอกว่าทำไม่ได้', () => {
        expect(ACCEPT_BLOCKED_TH).toContain('ขอเอกสารเพิ่ม');
    });
});
