/**
 * ประตูเข้าเมนูของจอติดตามการปลูก
 *
 * จอที่ไม่มีเมนู คือจอที่มีอยู่แต่ไม่มีใครหาเจอ · เทสนี้ยึดสามอย่าง:
 *   1. เมนูมีจริงและชี้ไปที่ /provider/tracking
 *   2. role ที่ทำงานตรวจติดตาม (ADMIN · AUDITOR · DOCUMENT_REVIEWER) เห็นเมนู
 *      ส่วนสายการเงินไม่เห็น เพราะมติเขียนว่าเรื่องเงิน "คนละหน้าที่"
 *   3. การซ่อนเมนูไม่ได้แปลว่าตัดสิทธิ์ — SCHEDULER ยังเปิด URL ได้ ตรงกับหลังบ้าน
 *      ที่ให้ APPLICATION_VIEW_ALL กับ provider role ทุกตัว (shared/canonical-rbac.js)
 *      กฎ FE ที่แคบกว่า BE จะทำให้สองฝั่งพูดคนละอย่าง
 */
import { describe, expect, it } from '@jest/globals';

import { providerNavigation, visibleProviderNavItems } from '@/lib/constants';
import { CANONICAL_ROLES } from '@/lib/constants/canonical-roles';
import { providerRoleCanOpen } from '@/lib/provider-role-config';
import { AUDITOR_NAV, REVIEWER_NAV } from '@/lib/navigation/nav-config';

const TRACKING_PATH = '/provider/tracking';

describe('เมนู "ติดตามการปลูก" ของพนักงานติดตาม', () => {
  it('อยู่ใน providerNavigation และชี้ไปที่หน้าจริง', () => {
    const item = providerNavigation.find((entry) => entry.key === 'tracking');
    expect(item).toBeDefined();
    expect(item?.href).toBe(TRACKING_PATH);
    expect(item?.label).toBe('ติดตามการปลูก');
  });

  it.each([
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FIELD_INSPECTOR,
    CANONICAL_ROLES.DOCUMENT_REVIEWER,
  ])('%s เห็นเมนูนี้', (role) => {
    const keys = visibleProviderNavItems(role).map((item) => item.key);
    expect(keys).toContain('tracking');
  });

  it.each([
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
  ])('สายการเงิน (%s) ไม่เห็นเมนูนี้ เพราะการติดตามไม่ใช่หน้าที่ของสายนี้', (role) => {
    const keys = visibleProviderNavItems(role).map((item) => item.key);
    expect(keys).not.toContain('tracking');
  });

  it('ซ่อนเมนูจาก SCHEDULER แต่ไม่ตัดสิทธิ์ URL — หลังบ้านยังรับ role นี้', () => {
    const keys = visibleProviderNavItems(CANONICAL_ROLES.DISPATCHER).map((item) => item.key);
    expect(keys).not.toContain('tracking');
    expect(providerRoleCanOpen(CANONICAL_ROLES.DISPATCHER, TRACKING_PATH)).toBe(true);
  });

  it('role ที่เห็นเมนู ต้องเปิด URL ได้จริงด้วย (เมนูที่พาไปชนกำแพงคือบั๊ก)', () => {
    for (const role of [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, CANONICAL_ROLES.FIELD_INSPECTOR, CANONICAL_ROLES.DOCUMENT_REVIEWER]) {
      expect(providerRoleCanOpen(role, TRACKING_PATH)).toBe(true);
    }
  });

  it('ไทล์บนหน้าหลักของผู้ตรวจแปลงและผู้ตรวจเอกสาร ชี้ไปที่เส้นทางเดียวกัน', () => {
    for (const nav of [AUDITOR_NAV, REVIEWER_NAV]) {
      const tile = nav.find((item) => item.key === 'tracking');
      expect(tile).toBeDefined();
      expect(tile?.path).toBe(TRACKING_PATH);
      expect(tile?.tier).toBe('secondary');
      expect(tile?.roles).toEqual(['field_inspector', 'document_reviewer']);
    }
  });

  it('คำอธิบายไทล์บอกขอบเขตตามมติ: ฟาร์มทุกแห่งทั่วประเทศ', () => {
    const tile = AUDITOR_NAV.find((item) => item.key === 'tracking');
    expect(tile?.descTH).toContain('ทั่วประเทศ');
  });
});
