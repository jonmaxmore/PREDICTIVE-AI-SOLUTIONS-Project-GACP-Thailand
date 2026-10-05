/**
 * ความลึกของซองต้องตรงกับที่ apiClient แกะให้
 *
 * ประตู `GET /applications/:id/katorlor1` ตอบ `{success:true, data:{html}}` และ apiClient
 * แกะให้หนึ่งชั้น ⇒ ผู้เรียกได้ `{success:true, data:{html}}` · หน้าตรวจทานอ่าน
 * `data.data.html` ซึ่งลึกเกินไปหนึ่งชั้น จึงได้ null ทุกครั้ง และแสดงข้อความว่าประกอบแบบ
 * ไม่ได้ ทั้งที่เซิร์ฟเวอร์ประกอบสำเร็จและตอบ 200
 */
import { describe, expect, it } from '@jest/globals';
import { readKatorlor1Html } from '../step6-review-state';

describe('อ่าน HTML ของแบบ กทล.1 จากคำตอบของประตู', () => {
    it('รูปร่างที่ apiClient ส่งมาจริง อ่านได้', () => {
        expect(readKatorlor1Html({ success: true, data: { html: '<h1>กทล ๑</h1>' } }))
            .toBe('<h1>กทล ๑</h1>');
    });

    it('ซ้อนสองชั้นไม่ใช่รูปร่างจริง และต้องไม่ถูกอ่านว่าใช้ได้', () => {
        expect(readKatorlor1Html({ success: true, data: { data: { html: '<h1>x</h1>' } } })).toBeNull();
    });

    it('คำขอที่ล้มเหลว หรือ html ว่าง = ไม่มีแบบให้แสดง', () => {
        expect(readKatorlor1Html({ success: false, data: { html: '<h1>x</h1>' } })).toBeNull();
        expect(readKatorlor1Html({ success: true, data: { html: '   ' } })).toBeNull();
        expect(readKatorlor1Html(null)).toBeNull();
    });
});
