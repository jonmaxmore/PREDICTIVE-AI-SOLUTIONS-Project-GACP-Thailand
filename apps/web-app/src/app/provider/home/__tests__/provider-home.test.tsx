/**
 * /provider/home — role-scoped tile grid for provider-side staff roles
 * (auditor / document_reviewer / scheduler / account / admin), officer
 * theme (N5, N7 — task-4 tile-home-redesign).
 *
 * Mirrors health/home/__tests__/client-view.test.tsx's pattern (createRoot
 * + act, manual DOM queries — `@testing-library/react` is not a repo
 * dependency) but targets `ProviderHome`, the presentational component
 * that takes an already-resolved `role` prop directly (brief's own test
 * code renders `<ProviderHome role="field_inspector" />`), not the client-view
 * default export that resolves the role via `/auth/provider/me`.
 */
import * as React from 'react';
import { describe, expect, it, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { ProviderHome } from '../client-view';

describe('/provider/home — role-scoped tile grid', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  function mount(ui: React.ReactElement): HTMLDivElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(ui);
    });
    return container;
  }

  // `role` here is ProviderHomeProps.role (a session-role string), not the
  // ARIA `role` attribute — same domain-prop-not-ARIA-role case as
  // `role="provider"` in provider-layout.tsx (see its W5-C comment). Passing
  // it as a variable (not a JSX string literal) also sidesteps the
  // jsx-a11y/aria-role lint rule, which only flags literal role values.
  function renderHome(role: string): HTMLDivElement {
    return mount(<ProviderHome role={role} />);
  }

  it('auditor เห็นเฉพาะเมนูที่มีปลายทางจริง (Task 7 nav-integrity fix)', () => {
    // นัดหมายลงพื้นที่ / ประวัติผลตรวจ removed from AUDITOR_NAV (Task 7):
    // /provider/appointments and /provider/audit-history never existed —
    // the Step 1 integrity probe failed RED on both. See nav-config.ts's
    // AUDITOR_NAV comment.
    const el = renderHome('field_inspector');
    expect(el.textContent).toContain('งานตรวจแปลง');
    expect(el.textContent).not.toContain('นัดหมายลงพื้นที่');
    expect(el.textContent).not.toContain('ประวัติผลตรวจ');
    expect(el.textContent).not.toContain('ตรวจเอกสาร');
    expect(el.textContent).not.toContain('ภาพรวม');
  });

  it('document_reviewer เห็นตรวจเอกสาร ไม่เห็นงานตรวจแปลง', () => {
    const el = renderHome('document_reviewer');
    expect(el.textContent).toContain('ตรวจเอกสาร');
    expect(el.textContent).not.toContain('งานตรวจแปลง');
  });

  it('scheduler เห็นทั้งจ่ายงานและจัดคิวแบ่งงาน — สองงานคนละเรื่อง (10815246)', () => {
    // มติ "งานที่รออยู่ต้องมีเมนูพาไป": ผู้จัดตารางได้การ์ดจ่ายงาน (/provider/coordinator)
    // เพิ่ม — คำบรรยายของมัน ("คำขอที่ชำระค่าตรวจเอกสารแล้ว รอมอบหมายผู้ตรวจเอกสาร")
    // มีคำว่า ตรวจเอกสาร โดยชอบ เทสเดิมที่ห้าม substring นั้นจึงล้าสมัยกว่ามติ
    const el = renderHome('dispatcher');
    expect(el.textContent).toContain('จัดคิวแบ่งงาน');
    expect(el.textContent).toContain('จ่ายงาน');
    // สิ่งที่ยังห้ามจริง: การ์ดงานตรวจของ role อื่น
    expect(el.textContent).not.toContain('งานตรวจแปลง');
  });

  it('account_dtam เห็นเฉพาะธุรกรรมการเงิน', () => {
    const el = renderHome('finance_officer_dtam');
    expect(el.textContent).toContain('ธุรกรรมการเงิน');
    expect(el.textContent).not.toContain('งานตรวจแปลง');
  });

  it('admin เห็นจัดการผู้ใช้/รายงาน/ตั้งค่าระบบ', () => {
    const el = renderHome('system_admin_dtam');
    for (const label of ['จัดการผู้ใช้', 'รายงาน', 'ตั้งค่าระบบ']) {
      expect(el.textContent).toContain(label);
    }
  });

  it('หัวข้อหน้า + คำอธิบาย ตรงตาม design of record', () => {
    const el = renderHome('field_inspector');
    expect(el.textContent).toContain('หน้าหลัก');
    expect(el.textContent).toContain('เลือกเมนูที่คุณต้องการใช้งาน');
  });

  it('เมนูของ role render เป็นลิงก์จริงไปที่ path ที่ถูกต้อง', () => {
    const el = renderHome('field_inspector');
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/provider/audits');
    expect(hrefs).not.toContain('/provider/appointments');
    expect(hrefs).not.toContain('/provider/audit-history');
  });

  it('document_reviewer link points at the real /provider/reviewer launchpad (Task 7 nav-integrity fix)', () => {
    const el = renderHome('document_reviewer');
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/provider/reviewer');
    expect(hrefs).not.toContain('/provider/review');
  });

  it('account_dtam link points at the real /provider/accounting hub (Task 7 nav-integrity fix)', () => {
    const el = renderHome('finance_officer_dtam');
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/provider/accounting');
    expect(hrefs).not.toContain('/provider/transactions');
  });

  it('admin รายงาน link points at the real /admin/dashboard page (Task 7 nav-integrity fix)', () => {
    const el = renderHome('system_admin_dtam');
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/admin/dashboard');
    expect(hrefs).not.toContain('/admin/reports');
  });

  it('การ์ดใช้ officer theme (officer-soft icon box) ไม่ใช่ leaf theme ของฝั่ง farmer', () => {
    const el = renderHome('field_inspector');
    const iconBox = el.querySelector('[class*="officer-soft"]');
    expect(iconBox).not.toBeNull();
    expect(el.querySelector('[class*="leaf-soft"]')).toBeNull();
  });

  it('role ที่ไม่รู้จัก / ไม่มีสิทธิ์ ไม่แสดงเมนูใดเลย (getNavForRole คืนค่าว่าง)', () => {
    const el = renderHome('unknown_role');
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([]);
  });

  it('platform_admin เห็นเฉพาะ "จัดการหน่วยงาน" ไม่เห็น /admin/users, /admin/reports, /admin/settings ของ admin (fix-round 1 finding)', () => {
    // provider-role-config.ts:74-76 gates platform_admin to ONLY
    // /admin/organizations (the sibling bare '/admin' prefix right after it
    // is admin-only). Before this fix getNavForRole('system_admin_platform')
    // returned the shared ADMIN_NAV, so /provider/home rendered
    // จัดการผู้ใช้/รายงาน/ตั้งค่าระบบ tiles for platform_admin — all three
    // dead ends. Mirrors the auditor/document_reviewer isolation tests above.
    const el = renderHome('system_admin_platform');
    expect(el.textContent).toContain('จัดการหน่วยงาน');
    for (const adminOnlyLabel of ['จัดการผู้ใช้', 'รายงาน', 'ตั้งค่าระบบ']) {
      expect(el.textContent).not.toContain(adminOnlyLabel);
    }
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/admin/organizations');
    // /admin/reports never existed (Task 7 repointed the 'reports' tile to
    // /admin/dashboard); check the CURRENT admin-only paths instead.
    for (const adminOnlyPath of ['/admin/users', '/admin/dashboard', '/admin/settings']) {
      expect(hrefs).not.toContain(adminOnlyPath);
    }
  });
});
