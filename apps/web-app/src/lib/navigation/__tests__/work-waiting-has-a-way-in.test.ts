/**
 * งานที่รออยู่ ต้องมีเมนูพาไป
 *
 * operator ถามว่า "ทำไมไม่มีข้อมูลคำขอ ที่ไหลตาม process มาใน dashboard พนักงาน ทำไมเป็นหน้าเปล่า"
 * — และเมื่อวัดจริง (2026-09-07) คำตอบไม่ใช่ว่าข้อมูลหาย แต่คือ **ไม่มีทางเดินไปถึงมัน**:
 *
 *   ฐานข้อมูล                    คำขอที่จ่ายค่าตรวจเอกสารแล้ว รอมอบหมาย = 4 ใบ
 *   GET /provider/scheduler/dashboard   → queues.readyForReview.total = 4  ✅ ประตูตอบถูก
 *   หน้าจอ /provider/coordinator        → "รอจ่ายงาน (4)"                  ✅ หน้ามีอยู่จริง
 *   เมนูของผู้จัดตาราง                    → มีรายการเดียว: /provider/scheduler/queue
 *   หน้านั้นเรียก /audit/scheduling/queue → มีแต่คำขอที่รอ "นัดลงพื้นที่" (AUDIT_FEE_PAID) = 1 ใบ
 *
 * ⇒ เกษตรกรจ่ายเงินแล้ว งานไปนั่งรออยู่ในที่ที่ไม่มีเมนูใดพาพนักงานไปเห็น · ประตูครบ หน้าครบ
 * ทางเดินไม่ครบ — และผลที่คนใช้เห็นคือ "หน้าเปล่า"
 */
import { SCHEDULER_NAV, ADMIN_NAV } from '../nav-config';

describe('เมนูของผู้จัดตาราง ต้องพาไปถึงงานที่รอจ่าย', () => {
    it('มีรายการที่ชี้ไปหน้าจ่ายงาน (coordinator)', () => {
        const paths = SCHEDULER_NAV.map((item) => item.path);
        expect(paths).toContain('/provider/coordinator');
    });

    it('รายการนั้นเป็นภาษาไทยและบอกว่าเป็นงานอะไร', () => {
        const item = SCHEDULER_NAV.find((n) => n.path === '/provider/coordinator');
        expect(item).toBeDefined();
        expect(item?.labelTH).toMatch(/[ก-๙]/);
        expect(item?.descTH).toMatch(/[ก-๙]/);
        expect(item?.roles).toContain('dispatcher');
    });

    it('คิวนัดลงพื้นที่ยังอยู่ — สองอย่างนี้คนละงาน ไม่ใช่ของแทนกัน', () => {
        expect(SCHEDULER_NAV.map((n) => n.path)).toContain('/provider/scheduler/queue');
    });

    it('ผู้ดูแลระบบก็ต้องไปถึงได้ เพราะเป็นคนดูงานค้างทั้งระบบ', () => {
        expect(ADMIN_NAV.map((n) => n.path)).toContain('/provider/coordinator');
    });
});
