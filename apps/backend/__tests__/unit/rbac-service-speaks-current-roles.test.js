'use strict';

/**
 * `RBACService` (services/security-compliance.js) มีตารางสิทธิ์ของตัวเองแยกจาก
 * canonical-rbac และ `hasPermission()` ค้นตารางนั้นด้วย `user.role` ตรง ๆ
 *
 * เดิมตารางนั้นใช้คำศัพท์ยุคก่อน (`applicant` · `super_admin` · `officer` · `scheduler`)
 * จึงต้องมี alias `{ health: 'applicant' }` คาไว้ข้างใน ไม่งั้นผู้ใช้ HEALTH ทุกคนโดน 403
 * บนประตูที่คุมด้วย dashboard.view (regression #5/#12)
 *
 * ตั้งแต่ 2026-09-10 ตารางนั้นถูก key ด้วยคำปัจจุบันแล้ว alias จึงถูกถอดออก
 * เทสนี้จึงเปลี่ยนหน้าที่: จากเดิม "พิสูจน์ว่า alias ทำงาน" เป็น **"พิสูจน์ว่าตารางพูดคำ
 * เดียวกับที่ระบบเขียนลงฐาน"** — ซึ่งเป็นข้อที่ทำให้ alias ไม่จำเป็นตั้งแต่แรก
 *
 * ถ้าใครเพิ่มบทบาทใน canonical-rbac แล้วลืมเพิ่มในตารางนี้ เทสตัวสุดท้ายจะแดง —
 * อาการจริงของการลืมคือ 403 เงียบ ๆ ทั้งบทบาท ไม่มี error ให้เห็น
 */

jest.mock('../../services/prisma-database', () => ({ prisma: {} }), { virtual: true });

const { RBACService } = require('../../services/security-compliance');
const { CANONICAL_ROLES } = require('../../shared/canonical-rbac');

describe('RBACService พูดคำบทบาทชุดปัจจุบัน', () => {
  const rbac = new RBACService();

  it("ผู้ใช้ role 'health' ได้ dashboard.view (อาการเดิมคือ 403 ทั้งกลุ่ม)", async () => {
    await expect(rbac.hasPermission({ role: CANONICAL_ROLES.HEALTH, id: 'u1' }, 'dashboard.view'))
      .resolves.toBe(true);
  });

  it("คำที่ปลดระวางแล้วต้อง fail-closed — 'applicant' ไม่ใช่คำของระบบนี้", async () => {
    await expect(rbac.hasPermission({ role: 'applicant', id: 'u1' }, 'dashboard.view'))
      .resolves.toBe(false);
  });

  it('บทบาทที่ไม่รู้จักยัง fail-closed (ตัวควบคุม)', async () => {
    await expect(rbac.hasPermission({ role: 'no_such_role', id: 'u1' }, 'dashboard.view'))
      .resolves.toBe(false);
  });

  it("ผู้ใช้ 'health' ยังถูกปฏิเสธสิทธิ์ที่ไม่ใช่ของตัวเอง", async () => {
    await expect(rbac.hasPermission({ role: CANONICAL_ROLES.HEALTH, id: 'u1' }, 'inspection.conduct'))
      .resolves.toBe(false);
  });

  it('ทุกบทบาทที่เป็นคนใน canonical-rbac มีที่นั่งในตารางนี้', async () => {
    const humans = Object.values(CANONICAL_ROLES).filter((r) => r !== CANONICAL_ROLES.SYSTEM);
    const missing = [];
    for (const role of humans) {
      // dashboard.view เป็นสิทธิ์ที่ทุกบทบาทที่เป็นคนต้องมี — ใช้เป็นตัวตรวจว่ามีแถวอยู่จริง
      if (!(await rbac.hasPermission({ role, id: 'u1' }, 'dashboard.view'))) { missing.push(role); }
    }
    expect(missing).toEqual([]);
  });
});
