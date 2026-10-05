import { getNavForRole, FARMER_NAV, ADMIN_NAV, PLATFORM_ADMIN_NAV } from '../nav-config';
import { healthNavigation } from '../../constants';

describe('nav-config SSOT', () => {
  it('farmer primary menu ใช้ชื่อคำกริยาตาม N5 ครบและเรียงตาม spec', () => {
    const labels = FARMER_NAV.filter(i => i.tier === 'primary').map(i => i.labelTH);
    expect(labels).toEqual([
      'สมัครขอใบรับรอง', 'ตรวจสอบสถานะ', 'ชำระเงิน',
      'ใบรับรองของฉัน', 'บันทึกการปลูก', 'ช่วยเหลือ',
    ]);
  });

  it('ไม่มี path ซ้ำใน role เดียวกัน (กติกา N-SSOT: เมนูซ้ำเกิดไม่ได้)', () => {
    for (const role of ['health', 'field_inspector', 'document_reviewer', 'dispatcher', 'finance_officer_platform', 'system_admin_dtam', 'system_admin_platform'] as const) {
      const paths = getNavForRole(role).map(i => i.path);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });

  it('platform_admin ได้ PLATFORM_ADMIN_NAV ของตัวเอง ไม่ใช่ ADMIN_NAV (entitlement gap: provider-role-config.ts:74-76)', () => {
    // provider-role-config.ts's admin-area gates platform_admin to ONLY
    // /admin/organizations ({ prefix: '/admin/organizations', roles: [ADMIN,
    // PLATFORM_ADMIN] }) — the very next rule, the bare '/admin' prefix, is
    // [ADMIN]-only, and no other PROVIDER_AREAS entry lists PLATFORM_ADMIN.
    // ADMIN_NAV's /admin/users, /admin/dashboard, /admin/settings tiles are
    // dead ends for platform_admin; getNavForRole must not return ADMIN_NAV
    // for it.
    const nav = getNavForRole('system_admin_platform');
    expect(nav).toBe(PLATFORM_ADMIN_NAV);
    expect(nav).not.toBe(ADMIN_NAV);
    expect(nav.map(i => i.path)).toEqual(['/admin/organizations']);
    for (const item of nav) {
      expect(item.roles).toEqual(['system_admin_platform']);
    }
    // None of the admin-only dead-end paths leak into platform_admin's nav.
    const adminOnlyPaths = ADMIN_NAV.map(i => i.path);
    const platformAdminPaths = nav.map(i => i.path);
    for (const path of adminOnlyPaths) {
      expect(platformAdminPaths).not.toContain(path);
    }
  });

  it('บันทึกการปลูก ล็อกด้วยเงื่อนไขใบรับรอง พร้อมเหตุผลไทย', () => {
    const planting = FARMER_NAV.find(i => i.key === 'planting');
    expect(planting?.lock).toEqual({
      condition: 'ACTIVE_CERT_REQUIRED',
      reasonTH: 'เปิดใช้เมื่อคุณได้รับใบรับรอง GACP',
    });
  });

  it('FARMER_NAV contains all required item paths (inventory not lost)', () => {
    const allPaths = FARMER_NAV.map(i => i.path);
    for (const path of ['/health/applications/new', '/health/payments', '/health/certificates', '/health/planting', '/help']) {
      expect(allPaths).toContain(path);
    }
  });

  it('FARMER_NAV home item exists with tier system and bottomNav for new tile-home', () => {
    const home = FARMER_NAV.find(i => i.key === 'home');
    expect(home).toBeDefined();
    expect(home?.path).toBe('/health/home');
    expect(home?.tier).toBe('system');
    expect(home?.bottomNav).toBe(true);
    expect(home?.shortTH).toBe('หน้าหลัก');
  });

  it('bottomNav configuration is correct: exactly {home, status, payments, certificates, planting}', () => {
    const bottomNavItems = FARMER_NAV.filter(i => i.bottomNav).map(i => i.key);
    expect(bottomNavItems).toEqual(['home', 'status', 'payments', 'certificates', 'planting']);

    // Verify shortTH values
    const shortThMap: Record<string, string> = {};
    for (const item of FARMER_NAV) {
      if (item.bottomNav && item.shortTH) {
        shortThMap[item.key] = item.shortTH;
      }
    }
    expect(shortThMap).toEqual({
      home: 'หน้าหลัก',
      status: 'สถานะ',
      payments: 'ชำระเงิน',
      certificates: 'ใบรับรอง',
      planting: 'การปลูก',
    });
  });

  it('chipSource configuration on status and payments', () => {
    const status = FARMER_NAV.find(i => i.key === 'status');
    expect(status?.chipSource).toBe('pendingActions');

    const payments = FARMER_NAV.find(i => i.key === 'payments');
    expect(payments?.chipSource).toBe('unpaid');
  });

  it('legacy healthNavigation inventory unchanged (byte-identical key+href+label, all 10 entries)', () => {
    // Pin test for backward compatibility: verify the old nav export has EXACT old structure
    // (excludes new items like 'status' and 'home' which are not in pre-task nav).
    // Live sidebar in src/app/health/layout.tsx renders these labels today; drift is a breaking change.
    const inventory = healthNavigation.map(i => ({ key: i.key, href: i.href, label: i.label }));
    expect(inventory).toEqual([
      { key: 'dashboard', href: '/health/dashboard', label: 'แดชบอร์ด' },
      { key: 'applications', href: '/health/applications', label: 'คำขอรับรอง' },
      { key: 'payments', href: '/health/payments', label: 'การชำระเงิน' },
      { key: 'certificates', href: '/health/certificates', label: 'ใบรับรอง' },
      { key: 'planting', href: '/health/planting', label: 'การปลูก' },
      { key: 'profile', href: '/health/profile', label: 'โปรไฟล์' },
      { key: 'workspaces', href: '/health/workspaces', label: 'ทีมงาน' },
      { key: 'surveys', href: '/health/surveys', label: 'แบบสำรวจ' },
      { key: 'herbs', href: '/health/herbs', label: 'สมุนไพร' },
      { key: 'help', href: '/help', label: 'ช่วยเหลือ' },
    ]);
  });

  it('U1 (design-cleanup-2026-08-21): workspaces tile names the applicant-identity purpose, keeps key/href/tier unchanged', () => {
    // reports/design-cleanup-2026-08-21/01-IDENTITY-AND-VOCABULARY.md U1 —
    // "ทีมงาน" alone reads as team-management only; a farmer looking for
    // "apply as a company/community enterprise" will never guess this tile
    // is the door to that. Rename to surface the applicant/workspace
    // purpose while keeping key+href+tier stable (N7 caps primary tiles;
    // promoting tier is the operator's call, not this fix's).
    const workspaces = FARMER_NAV.find(i => i.key === 'workspaces');
    expect(workspaces).toBeDefined();
    expect(workspaces?.path).toBe('/health/workspaces');
    expect(workspaces?.tier).toBe('secondary');
    expect(workspaces?.labelTH).toBe('ผู้ยื่นคำขอ / ทีมงาน');
    expect(workspaces?.descTH).toContain('ผู้ยื่นคำขอ');
    // Old team-only copy must be gone — this is the label that hid U1's bug.
    expect(workspaces?.labelTH).not.toBe('ทีมงาน');
  });

  it('officer roles have NO dashboard items (tile-home replaces them)', () => {
    for (const role of ['field_inspector', 'document_reviewer', 'dispatcher', 'finance_officer_platform', 'system_admin_dtam', 'system_admin_platform'] as const) {
      const nav = getNavForRole(role);
      const hasDashboard = nav.some(i => i.key === 'dashboard');
      expect(hasDashboard).toBe(false);
    }
  });
});
