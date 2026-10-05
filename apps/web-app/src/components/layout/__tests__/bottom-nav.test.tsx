/**
 * bottom-nav.test.tsx — Task 5 (tile-home-redesign, N3): mobile bottom nav
 * generated from nav-config.
 *
 * Replaces the prior hardcoded HEALTH_MOBILE_KEYS href-matching against the
 * legacy `healthNavigation` list with a direct read of `FARMER_NAV` (via
 * `getNavForRole('health')`), filtered on `bottomNav === true`. Order and
 * labels come straight from nav-config.ts:
 *   home(หน้าหลัก) -> status(สถานะ) -> payments(ชำระเงิน) ->
 *   certificates(ใบรับรอง) -> planting(การปลูก)
 * — each label is `item.shortTH ?? item.labelTH`.
 *
 * planting carries `lock: { condition: 'ACTIVE_CERT_REQUIRED' }` in
 * nav-config — mirrors the tile-home grid's lock treatment (task 2,
 * app/health/home/client-view.tsx + use-nav-chips.ts): a lock icon renders
 * and the item is NOT a navigable link (no <a>, aria-disabled) whenever the
 * certs fetch has resolved with no usable (non-expired) certificate. Reuses
 * useNavChips (extended, not forked) for the /api/certificates/my fetch —
 * same `getCertBadgeKind(...) !== 'expired'` gate as client-view.tsx.
 *
 * Test pattern mirrors slim-bar.test.tsx / client-view.test.tsx (this repo
 * has no @testing-library/react dependency): react-dom/client createRoot +
 * act, manual DOM queries, mock `@/lib/api` (DashboardLayout's own bell
 * fetch) AND `@/lib/api/api-client` (useNavChips' fetch — a different
 * import path, see use-nav-chips.ts) separately, matching client-view.test.tsx.
 *
 * Fix round 1 (reviewer finding): DashboardLayout now calls
 * `useNavChips({ chips: false, certLock: role === 'health' })` — it only
 * reads hasActiveCert/certsLoaded (never pendingActions/unpaid), so it must
 * never fire /api/applications/my. The last test below pins that directly
 * by asserting on the mock's call list, not just absence of a crash.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Home } from 'lucide-react';

import { DashboardLayout } from '../dashboard-layout';
import { LanguageProvider } from '@/lib/i18n/language-context';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// DashboardLayout's own notification-bell fetch goes through '@/lib/api'.
const mockLibApiGet = jest.fn();
jest.mock('@/lib/api', () => ({
  apiClient: { get: (...args: unknown[]) => mockLibApiGet(...args) },
  api: { get: (...args: unknown[]) => mockLibApiGet(...args) },
}));

// useNavChips (use-nav-chips.ts) fetches through '@/lib/api/api-client'
// directly — a different module path, routed by URL like client-view.test.tsx.
const mockApiClientGet = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
  apiClient: { get: (url: string) => mockApiClientGet(url) },
  api: { get: (url: string) => mockApiClientGet(url) },
}));

jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: jest.fn(() => null),
    logout: jest.fn(),
  },
}));

jest.mock('@/components/layout/Footer', () => ({ Footer: () => null }));
jest.mock('@/components/layout/entity-switcher', () => ({ EntitySwitcher: () => null }));

// The health navItems prop (from legacy healthNavigation) is no longer the
// source for the bottom nav — passed here to prove that's true (this list
// carries none of the new items, yet the bottom nav still renders them).
const LEGACY_NAV_ITEMS = [
  { href: '/health/dashboard', label: 'แดชบอร์ด', Icon: Home },
];

function pending(): Promise<unknown> {
  return new Promise(() => undefined);
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe('DashboardLayout — mobile bottom nav from nav-config (Task 5, N3)', () => {
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

  function mount() {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(
        <LanguageProvider>
          <DashboardLayout
            navItems={LEGACY_NAV_ITEMS}
            // DashboardLayout `role` is a portal selector ('health' | 'provider'),
            // not an ARIA role — same false-positive as slim-bar.test.tsx.
            // eslint-disable-next-line jsx-a11y/aria-role
            role="health"
            brandName="GACP Platform"
            brandIcon={Home}
          >
            <div>page body</div>
          </DashboardLayout>
        </LanguageProvider>,
      );
    });
  }

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  function bottomNavItems(): HTMLElement[] {
    const nav = container!.querySelector('nav[aria-label="หน้าหลัก"]');
    expect(nav).not.toBeNull();
    return Array.from(nav!.querySelectorAll('[data-testid="bottom-nav-item"]'));
  }

  it('renders exactly 5 buttons in nav-config order with shortTH labels', async () => {
    mount();
    await flush();

    const items = bottomNavItems();
    expect(items).toHaveLength(5);
    expect(items.map((el) => el.textContent?.trim())).toEqual([
      'หน้าหลัก',
      'สถานะ',
      'ชำระเงิน',
      'ใบรับรอง',
      'การปลูก',
    ]);
  });

  it('has NO trailing logout button (Task 7, N3 — exactly 5 items, logout lives in the avatar dropdown)', async () => {
    // Reviewer-noted gap (progress.md): the earlier "exactly 5" test only
    // queried [data-testid="bottom-nav-item"], which the old ออก button
    // never carried — so a 6th trailing item could survive undetected.
    // Assert directly on the <nav>'s own children instead.
    mount();
    await flush();

    const nav = container!.querySelector('nav[aria-label="หน้าหลัก"]');
    expect(nav).not.toBeNull();
    expect(nav!.children).toHaveLength(5);
    expect(nav!.querySelector('[aria-label="ออกจากระบบ"]')).toBeNull();
    expect(nav!.textContent).not.toContain('ออก');
  });

  it('การปลูก shows a lock icon and is NOT a link when there is no usable certificate', async () => {
    mockApiClientGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({ success: true, data: [{ status: 'expired', expiryDate: '2020-01-01T00:00:00.000Z' }] });
      }
      return pending();
    });
    mount();
    await flush();

    const items = bottomNavItems();
    const plantingItem = items.find((el) => (el.textContent ?? '').includes('การปลูก'));
    expect(plantingItem).toBeTruthy();

    // Not a navigable link.
    expect(plantingItem!.tagName).not.toBe('A');
    expect(plantingItem!.getAttribute('href')).toBeNull();
    expect(plantingItem!.getAttribute('aria-disabled')).toBe('true');

    // Lock icon present (lucide Lock renders an <svg class="lucide-lock">).
    expect(plantingItem!.querySelector('svg.lucide-lock')).not.toBeNull();
  });

  it('การปลูก IS a normal link when the farmer has a usable certificate', async () => {
    mockApiClientGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({
          success: true,
          data: [{ status: 'active', expiryDate: '2099-01-01T00:00:00.000Z' }],
        });
      }
      return pending();
    });
    mount();
    await flush();

    const items = bottomNavItems();
    const plantingItem = items.find((el) => (el.textContent ?? '').includes('การปลูก'));
    expect(plantingItem).toBeTruthy();
    expect(plantingItem!.tagName).toBe('A');
    expect(plantingItem!.getAttribute('href')).toBe('/health/planting');
    expect(plantingItem!.querySelector('svg.lucide-lock')).toBeNull();
  });

  it('other 4 items (not planting) are always real links, e.g. หน้าหลัก -> /health/home', async () => {
    mount();
    await flush();

    const items = bottomNavItems();
    const home = items.find((el) => (el.textContent ?? '').trim() === 'หน้าหลัก');
    expect(home).toBeTruthy();
    expect(home!.tagName).toBe('A');
    expect(home!.getAttribute('href')).toBe('/health/home');
  });

  it('การปลูก stays a normal link when the certificate is in its renewal window (expiring, not expired — reviewer finding #2 regression class)', async () => {
    // getCertBadgeKind buckets a valid, still-usable cert with < 90 days
    // left as 'expiring' — a renewal REMINDER, distinct from 'expired'.
    // The lock gate is `!== 'expired'`, not `=== 'active'`; this is the
    // exact edge case client-view.test.tsx already pins for the tile grid
    // (task 2, reviewer finding #2) — pinned here too for the bottom nav.
    mockApiClientGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({
          success: true,
          data: [{ status: 'active', expiryDate: daysFromNow(45) }],
        });
      }
      return pending();
    });
    mount();
    await flush();

    const items = bottomNavItems();
    const plantingItem = items.find((el) => (el.textContent ?? '').includes('การปลูก'));
    expect(plantingItem).toBeTruthy();
    expect(plantingItem!.tagName).toBe('A');
    expect(plantingItem!.getAttribute('href')).toBe('/health/planting');
    expect(plantingItem!.querySelector('svg.lucide-lock')).toBeNull();
  });

  it('fix round 1 — never calls /api/applications/my: DashboardLayout only consumes the cert-lock half of useNavChips', async () => {
    mockApiClientGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({ success: true, data: [] });
      }
      return pending();
    });
    mount();
    await flush();

    const calledUrls = mockApiClientGet.mock.calls.map((call) => call[0]);
    expect(calledUrls).not.toContain('/api/applications/my');
    // Sanity: the cert-lock fetch DID fire (proves the mock/assertion
    // above isn't vacuously true because nothing was called at all).
    expect(calledUrls).toContain('/api/certificates/my');
  });
});
