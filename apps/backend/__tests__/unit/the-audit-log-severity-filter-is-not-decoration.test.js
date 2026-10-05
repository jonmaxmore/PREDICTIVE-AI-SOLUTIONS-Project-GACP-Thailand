'use strict';

/**
 * ตัวกรอง "ระดับความสำคัญ" ในบันทึกผู้ดูแล — หน้าจอบอกว่ากรองแล้ว แต่ไม่มีใครกรอง
 *
 * วัดจริง 2026-09-07 ด้วยโทเคนผู้ดูแล:
 *   GET /api/admin/audit-log?severity=ERROR&limit=200 → 200 · 200 แถว
 *     แจกแจงระดับที่ได้กลับมา: { INFO: 163, WARNING: 37 } — ไม่มี ERROR สักแถว
 *   ควบคุม ?category=SECURITY → 73 แถว SECURITY ล้วน ⇒ ตัวสร้างเงื่อนไขทำงาน
 *     แค่ไม่เคยอ่านคำว่า severity เลย (audit-log.js:66-77 คืนหกคีย์ ไม่มีอันนี้)
 *   GET /export.csv?severity=ERROR → 1205 แถว = ทั้งตาราง { INFO 997, WARNING 186, ERROR 22 }
 *
 * และหน้าจอ **ยืนยันกับผู้ดูแลว่ากรองแล้ว** — ขึ้นชิป "ระดับ: ข้อผิดพลาด (ERROR)" ค้างอยู่
 * ⇒ คนอ่านบันทึกความปลอดภัยเชื่อว่ากำลังดูเฉพาะข้อผิดพลาด ทั้งที่กำลังดูทุกอย่าง
 * นี่คือคลาสเดียวกับที่ users.js:176-183 เคยแก้ไปแล้ว ("FE status filter was silently ignored")
 * และไฟล์ฝั่งหน้าจอเขียนกำกับไว้เองว่าพารามิเตอร์นี้ "harmlessly ignored" — ไม่ harmless
 * ตราบใดที่ชิปยังบอกตรงข้าม
 */

const { buildAdminFilterWhere } = require('../../services/audit-trail');

describe('เงื่อนไขค้นบันทึกผู้ดูแล — ระดับความสำคัญ', () => {
    it('ระดับที่ส่งมา กลายเป็นเงื่อนไขจริง', () => {
        expect(buildAdminFilterWhere({ severity: 'ERROR' }).severity).toBe('ERROR');
    });

    it('รับทุกระดับที่ระบบใช้จริง', () => {
        for (const level of ['INFO', 'WARNING', 'ERROR', 'CRITICAL']) {
            expect(buildAdminFilterWhere({ severity: level }).severity).toBe(level);
        }
    });

    it('พิมพ์เล็ก/มีช่องว่าง ก็ยังตรงกับที่เก็บไว้', () => {
        expect(buildAdminFilterWhere({ severity: '  error ' }).severity).toBe('ERROR');
    });

    it('คำที่ไม่ใช่ระดับ ถูกทิ้ง ไม่ใช่ยัดลงเงื่อนไขให้ค้นไม่เจออะไรเลย', () => {
        expect(buildAdminFilterWhere({ severity: 'DROP TABLE' }).severity).toBeUndefined();
        expect(buildAdminFilterWhere({ severity: '' }).severity).toBeUndefined();
        expect(buildAdminFilterWhere({}).severity).toBeUndefined();
    });

    it('ไม่ไปรบกวนเงื่อนไขอื่นที่เคยทำงานอยู่แล้ว', () => {
        const where = buildAdminFilterWhere({ severity: 'ERROR', category: 'SECURITY', action: 'login' });
        expect(where.category).toBe('SECURITY');
        expect(where.action).toBe('LOGIN');
        expect(where.severity).toBe('ERROR');
    });

    it('ประตูอ่านค่านี้จาก query จริง — ทั้งหน้ารายการและไฟล์ส่งออก', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'routes', 'api', 'admin', 'audit-log.js'), 'utf8',
        );
        expect(src).toMatch(/severity:\s*q\.severity/);
    });
});
