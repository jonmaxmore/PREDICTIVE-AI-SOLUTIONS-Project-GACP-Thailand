/**
 * ปุ่มในแจ้งเตือนทุกใบของระบบกดไม่ได้ เพราะ `Notification` ไม่มีคอลัมน์ `actionUrl`
 *
 * createNotification เก็บมันไว้ใน metadata แทน:
 *   services/notification-service.js:325-326
 *     const metadata = { ...(data || {}), ...(actionUrl ? { actionUrl } : {}) }
 *
 * แต่ route อ่านคืนแถวดิบ:
 *   routes/api/system/notifications.js:28-33  prisma.notification.findMany(...) → res.json(notifications)
 *
 * และหน้าบ้านอ่านระดับบนสุด:
 *   apps/web-app/src/app/health/notifications/client-view.tsx:255,257  {n.actionUrl && <Link href={n.actionUrl}>}
 *   apps/web-app/src/app/provider/notifications/client-view.tsx:41
 *
 * ⇒ `n.actionUrl` เป็น undefined เสมอ · ทุกปุ่ม "ไปแก้เอกสาร" / "ไปชำระเงิน" หายไป
 *
 * เรื่องนี้สำคัญขึ้นมากตั้งแต่ operator ตัดสินใจ 2026-08-13 ให้ลบ email และ SMS ทิ้ง —
 * in-app กลายเป็นช่องทางเดียวที่เหลือถึงเกษตรกร
 *
 * ฟังก์ชันที่ทดสอบอยู่ในไฟล์ที่ไม่ import อะไรเลย จึงรันได้โดยไม่ต้องมี prisma หรือฐานข้อมูล
 */

const { toNotificationView } = require('../../shared/notification-view');

describe('toNotificationView — ยก actionUrl ออกจาก metadata มาไว้ระดับบนสุด', () => {
    it('ยก actionUrl ที่อยู่ใน metadata ขึ้นมา', () => {
        const row = {
            id: 'n1',
            title: 'เอกสารต้องแก้ไข',
            metadata: { actionUrl: '/health/applications/a1/revision' },
        };
        expect(toNotificationView(row).actionUrl).toBe('/health/applications/a1/revision');
    });

    it('คงฟิลด์เดิมไว้ครบ', () => {
        const row = { id: 'n1', title: 'x', message: 'y', isRead: false, metadata: { actionUrl: '/a' } };
        const out = toNotificationView(row);
        expect(out.id).toBe('n1');
        expect(out.title).toBe('x');
        expect(out.message).toBe('y');
        expect(out.isRead).toBe(false);
    });

    it('metadata ไม่มี actionUrl → ไม่มี actionUrl และไม่พัง', () => {
        const row = { id: 'n1', metadata: { applicationId: 'a1' } };
        expect(toNotificationView(row).actionUrl).toBeUndefined();
    });

    it('metadata เป็น null → ไม่พัง', () => {
        expect(() => toNotificationView({ id: 'n1', metadata: null })).not.toThrow();
        expect(toNotificationView({ id: 'n1', metadata: null }).actionUrl).toBeUndefined();
    });

    it('ไม่มีฟิลด์ metadata เลย → ไม่พัง', () => {
        expect(() => toNotificationView({ id: 'n1' })).not.toThrow();
    });

    it('metadata เป็นสตริง (แถวเก่าที่รูปไม่ตรง) → ไม่พัง', () => {
        expect(() => toNotificationView({ id: 'n1', metadata: 'legacy' })).not.toThrow();
        expect(toNotificationView({ id: 'n1', metadata: 'legacy' }).actionUrl).toBeUndefined();
    });

    it('actionUrl ที่ไม่ใช่สตริงถูกปฏิเสธ — ไม่ยกขึ้นมา', () => {
        // กัน metadata ที่ถูกเขียนมาผิดรูปไม่ให้กลายเป็น href
        expect(toNotificationView({ id: 'n1', metadata: { actionUrl: 42 } }).actionUrl).toBeUndefined();
        expect(toNotificationView({ id: 'n1', metadata: { actionUrl: {} } }).actionUrl).toBeUndefined();
    });

    it('รับ null/undefined แล้วไม่พัง', () => {
        expect(() => toNotificationView(null)).not.toThrow();
        expect(() => toNotificationView(undefined)).not.toThrow();
    });

    it('ไม่แก้ไขแถวต้นฉบับ', () => {
        const row = { id: 'n1', metadata: { actionUrl: '/a' } };
        toNotificationView(row);
        expect(row.actionUrl).toBeUndefined();
    });
});
