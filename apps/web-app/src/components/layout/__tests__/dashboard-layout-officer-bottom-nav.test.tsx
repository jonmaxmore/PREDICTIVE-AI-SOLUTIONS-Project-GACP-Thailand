/**
 * DashboardLayout — officer (provider-portal) mobile bottom nav from
 * nav-config (B-NAV item 3, W10).
 *
 * Before this fix, DashboardLayout's provider branch derived bottom tabs
 * from the legacy `navItems` prop (visibleProviderNavItems, constants.ts)
 * filtered against a hardcoded PROVIDER_MOBILE_KEYS list — NOT nav-config,
 * so it never reflected the actual signed-in officer's real role/task tile
 * and had no notion of a role-specific bottom nav at all. This mirrors the
 * farmer bottom nav (bottom-nav.test.tsx): ONE shared code path, driven by
 * `getNavForRole(canonicalRole).filter(i => i.bottomNav)`, reusing the same
 * `<nav aria-label="หน้าหลัก">` / `data-testid="bottom-nav-item"` markup —
 * not a forked second implementation.
 *
 * `canonicalRole` is a new DashboardLayout prop: ProviderLayout
 * (app/provider/components/provider-layout.tsx) already resolves the
 * signed-in officer's canonical role via /auth/provider/me for its OWN
 * nav-items lookup, so it passes that value down instead of DashboardLayout
 * re-fetching it (same "share, don't refetch" pattern as NavCertLockContext,
 * F-7).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Home } from 'lucide-react';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('next/navigation', () => ({
  usePathname: () => '/provider/audits',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const mockLibApiGet = jest.fn();
jest.mock('@/lib/api', () => ({
  apiClient: { get: (...args: unknown[]) => mockLibApiGet(...args) },
  api: { get: (...args: unknown[]) => mockLibApiGet(...args) },
}));

const mockApiClientGet = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
  apiClient: { get: (url: string) => mockApiClientGet(url) },
  api: { get: (url: string) => mockApiClientGet(url) },
}));

jest.mock('@/lib/services/auth-service', () => ({
  AuthService: { getUser: jest.fn(() => null), logout: jest.fn() },
}));

jest.mock('@/components/layout/Footer', () => ({ Footer: () => null }));
jest.mock('@/components/layout/entity-switcher', () => ({ EntitySwitcher: () => null }));

import { DashboardLayout } from '../dashboard-layout';

function pending(): Promise<unknown> {
  return new Promise(() => undefined);
}

describe('DashboardLayout — officer bottom nav from nav-config (task 3, W10)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLibApiGet.mockResolvedValue({ success: true, data: [] });
    mockApiClientGet.mockImplementation(() => pending());
  });

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

  function mount(canonicalRole: string | null) {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(
        <DashboardLayout
          navItems={[]}
          // eslint-disable-next-line jsx-a11y/aria-role
          role="provider"
          brandName="GACP Provider"
          brandIcon={Home}
          canonicalRole={canonicalRole}
        >
          <div>page body</div>
        </DashboardLayout>,
      );
    });
  }

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  function bottomNavItems(): HTMLElement[] {
    const nav = container!.querySelector('nav[aria-label="หน้าหลัก"]');
    expect(nav).not.toBeNull();
    return Array.from(nav!.querySelectorAll('[data-testid="bottom-nav-item"]'));
  }

  it('auditor gets exactly 1 bottom-nav button (งานตรวจแปลง -> /provider/audits)', async () => {
    mount('field_inspector');
    await flush();

    const items = bottomNavItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent?.trim()).toBe('ตรวจแปลง');
    expect(items[0]!.getAttribute('href')).toBe('/provider/audits');
  });

  it('admin gets 4 bottom-nav buttons in nav-config order with shortTH labels', async () => {
    mount('system_admin_dtam');
    await flush();

    const items = bottomNavItems();
    // 'จ่ายงาน' เข้ามากับเมนู coordinator ของ admin (มติ "งานที่รออยู่ต้องมีเมนูพาไป", 10815246)
    expect(items.map((el) => el.textContent?.trim())).toEqual(['จ่ายงาน', 'ผู้ใช้', 'รายงาน', 'ตั้งค่า']);
  });

  it('renders an empty bottom nav (not a crash) while canonicalRole is still resolving (null)', async () => {
    mount(null);
    await flush();

    const nav = container!.querySelector('nav[aria-label="หน้าหลัก"]');
    expect(nav).not.toBeNull();
    expect(bottomNavItems()).toHaveLength(0);
  });

  it('reuses the SAME bottom-nav markup as the farmer implementation (one nav, same test-ids) — not a forked component', async () => {
    mount('dispatcher');
    await flush();

    // Exactly one bottom-nav <nav> in the whole tree, and its items carry
    // the identical data-testid the farmer bottom nav uses (bottom-nav.test.tsx).
    const navs = container!.querySelectorAll('nav[aria-label="หน้าหลัก"]');
    expect(navs).toHaveLength(1);
    const items = bottomNavItems();
    // ผู้จัดตารางได้สองปุ่ม: จ่ายงาน (coordinator, 10815246) + จัดคิว
    expect(items).toHaveLength(2);
    expect(items.map((el) => el.textContent?.trim())).toEqual(['จ่ายงาน', 'จัดคิว']);
  });
});
