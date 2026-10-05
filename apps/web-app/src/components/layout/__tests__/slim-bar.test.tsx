/**
 * slim-bar.test.tsx — Task 3 (tile-home-redesign): slim top bar + BackHomeCrumb.
 *
 * Adapted from the task-3 brief's RTL starter code to the repo's actual
 * pattern (`react-dom/client` createRoot + act, manual DOM queries) —
 * `@testing-library/react` is not a dependency in this monorepo (see the
 * same note in nav-tile.test.tsx). Native <a> elements carry an implicit
 * role="link", so `.tagName === 'A'` + `getAttribute('href')` is the
 * DOM-level equivalent of RTL's `getByRole('link')`.
 *
 * What changed (N2/N7): the desktop top-bar menu-link row (+ "เพิ่มเติม"
 * overflow menu) is retired — every menu destination now lives inside the
 * role's tile-home page instead. The slim bar keeps only: logo (→ role
 * home), notification bell, language/dark-mode toggles, and an avatar
 * dropdown holding โปรไฟล์ + ออกจากระบบ. BackHomeCrumb is the new per-page
 * "← หน้าหลัก / <current>" breadcrumb every inner page renders in the
 * menu row's place.
 *
 * The MOBILE bottom tab bar is untouched by THIS task — it legitimately
 * still renders its own links, so the "no menu links" assertion scopes to
 * <header> (the slim bar itself), not the whole render tree. Task 5
 * (tile-home-redesign N3) DID since regenerate the bottom nav's item list
 * from nav-config.ts (FARMER_NAV, filtered on `bottomNav: true`) instead of
 * matching the legacy `navItems` prop by href segment — that's this pin's
 * intended update, not a regression: it now asserts the nav-config-derived
 * hrefs (/health/home, /health/status, ...) rather than the pre-task
 * /health/applications, which is no longer one of the 5 bottom-nav items.
 *
 * Avatar dropdown note (review fix): the menu is the `DropdownMenu`
 * primitive (`@/components/ui/primitives/dropdown-menu`, wrapping
 * `@radix-ui/react-dropdown-menu`), not a hand-rolled widget — so the
 * DOM this test drives is Radix's, not ours:
 *   - `DropdownMenuContent` renders via `Portal` into `document.body`,
 *     not inside the mount `container` — queries for the open menu use
 *     `document.querySelector`, not `container!.querySelector`.
 *   - The trigger's pointer-open path uses `onPointerDown`, which jsdom's
 *     plain `.click()` does not synthesize. The trigger also opens on
 *     `Enter`/`Space`/`ArrowDown` (`onKeyDown`, WAI-ARIA menu button
 *     pattern) — a real `KeyboardEvent('keydown', { key: 'Enter' })`
 *     drives it reliably here and is itself a keyboard-accessibility
 *     assertion, not just a test workaround.
 *   - `MenuItem` DOES respond to a plain `.click()` (Radix composes
 *     `onClick` with its internal `handleSelect`), so selecting an item
 *     (profile Link / logout button) still uses `.click()`.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Home } from 'lucide-react';

import { DashboardLayout } from '../dashboard-layout';
import { BackHomeCrumb } from '@/components/navigation/back-home-crumb';
import { LanguageProvider } from '@/lib/i18n/language-context';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn();

jest.mock('@/lib/api', () => ({
  apiClient: { get: (...args: unknown[]) => mockApiGet(...args) },
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: jest.fn(() => null),
    logout: jest.fn(),
  },
}));

// Footer/EntitySwitcher pull in env + entity hooks that don't matter here —
// same stub pattern as dashboard-layout-bell.test.tsx.
jest.mock('@/components/layout/Footer', () => ({ Footer: () => null }));
jest.mock('@/components/layout/entity-switcher', () => ({ EntitySwitcher: () => null }));

// Mirrors healthNavigation (constants.ts) — the real prop shape
// health/layout.tsx passes today, so this proves the menu row is gone
// even when fed real menu destinations, not an empty stub array.
const HEALTH_NAV_ITEMS = [
  { href: '/health/dashboard', label: 'แดชบอร์ด', Icon: Home },
  { href: '/health/applications', label: 'คำขอรับรอง', Icon: Home },
  { href: '/health/payments', label: 'การชำระเงิน', Icon: Home },
  { href: '/health/certificates', label: 'ใบรับรอง', Icon: Home },
  { href: '/health/planting', label: 'การปลูก', Icon: Home },
];

describe('DashboardLayout — slim bar (Task 3, N2/N7)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiGet.mockResolvedValue({ success: true, data: [] });
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

  function mount(role: 'health' | 'provider' = 'health') {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(
        <LanguageProvider>
          <DashboardLayout
            navItems={HEALTH_NAV_ITEMS}
            // DashboardLayout `role` is a portal selector ('health' | 'provider'),
            // not an ARIA role — the rule only flags string-literal values,
            // which this dynamic prop isn't.
            role={role}
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
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // Radix's DropdownMenuTrigger opens on `onPointerDown` for mouse users,
  // but also on Enter/Space/ArrowDown per the WAI-ARIA menu button pattern
  // (see @radix-ui/react-dropdown-menu's DropdownMenuTrigger onKeyDown).
  // jsdom's plain `.click()` only dispatches a `click` MouseEvent, not a
  // pointerdown, so the keyboard path is what reliably opens it here.
  function openViaKeyboard(trigger: HTMLElement) {
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  }

  it('the slim bar (header) carries no links to menu destinations (N2)', async () => {
    mount('health');
    await flush();

    const header = container!.querySelector('header');
    expect(header).not.toBeNull();
    const menuPaths = ['/health/applications', '/health/payments', '/health/certificates', '/health/planting'];
    const links = Array.from(header!.querySelectorAll('a'));
    const menuLinks = links.filter((a) => menuPaths.includes(a.getAttribute('href') ?? ''));
    expect(menuLinks).toHaveLength(0);
  });

  it('the logo links back to /health/home on the farmer side', async () => {
    mount('health');
    await flush();

    const header = container!.querySelector('header');
    const logoLink = Array.from(header!.querySelectorAll('a')).find((a) => (a.textContent ?? '').includes('GACP'));
    expect(logoLink).toBeTruthy();
    expect(logoLink?.getAttribute('href')).toBe('/health/home');
  });

  it('the logo links back to /provider/home on the provider side', async () => {
    mount('provider');
    await flush();

    const header = container!.querySelector('header');
    const logoLink = Array.from(header!.querySelectorAll('a')).find((a) => (a.textContent ?? '').includes('GACP'));
    expect(logoLink).toBeTruthy();
    expect(logoLink?.getAttribute('href')).toBe('/provider/home');
  });

  it('the mobile bottom tab bar still renders its own links — now nav-config-derived (Task 5, N3)', async () => {
    mount('health');
    await flush();
    const bottomNav = container!.querySelector('nav[aria-label="หน้าหลัก"]');
    expect(bottomNav).not.toBeNull();
    const hrefs = Array.from(bottomNav!.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    // FARMER_NAV order for bottomNav:true items — see nav-config.ts and
    // bottom-nav.test.tsx for the full order/lock-state coverage.
    expect(hrefs).toEqual(
      expect.arrayContaining(['/health/home', '/health/status', '/health/payments', '/health/certificates']),
    );
  });

  it('avatar dropdown (DropdownMenu primitive) opens via keyboard and exposes โปรไฟล์ + ออกจากระบบ', async () => {
    mount('health');
    await flush();

    // Radix sets aria-haspopup/aria-expanded itself; the trigger only needs
    // the aria-label this component adds.
    const trigger = container!.querySelector('button[aria-label="บัญชีผู้ใช้"]') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      openViaKeyboard(trigger);
    });

    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    // DropdownMenuContent renders through a Portal into document.body, not
    // inside the mount container.
    const menu = document.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu!.textContent).toContain('โปรไฟล์');
    expect(menu!.textContent).toContain('ออกจากระบบ');

    const profileLink = Array.from(menu!.querySelectorAll('a')).find((a) => a.textContent === 'โปรไฟล์');
    expect(profileLink?.getAttribute('href')).toBe('/health/profile');
    expect(profileLink?.getAttribute('role')).toBe('menuitem');
  });

  it('ออกจากระบบ in the avatar dropdown calls AuthService.logout', async () => {
    const { AuthService } = await import('@/lib/services/auth-service');
    mount('health');
    await flush();

    const trigger = container!.querySelector('button[aria-label="บัญชีผู้ใช้"]') as HTMLButtonElement;
    await act(async () => {
      openViaKeyboard(trigger);
    });

    const menu = document.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const logoutItem = Array.from(menu!.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent === 'ออกจากระบบ',
    ) as HTMLElement;
    expect(logoutItem).toBeTruthy();

    // MenuItem composes its own onClick handler with a plain .click() —
    // unlike the trigger, item selection does not require pointerdown.
    await act(async () => {
      logoutItem.click();
    });
    expect(AuthService.logout).toHaveBeenCalledTimes(1);

    // Radix closes the menu itself once an item is selected — no manual
    // pathname/outside-click bookkeeping needed on our side any more.
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

describe('BackHomeCrumb (Task 3, N7)', () => {
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

  it('renders a boxed link back to homePath carrying "หน้าหลัก" and shows the current page name', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(<BackHomeCrumb current="ตรวจสอบสถานะ" homePath="/health/home" />);
    });

    const link = Array.from(container!.querySelectorAll('a')).find((a) => (a.textContent ?? '').includes('หน้าหลัก'));
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('/health/home');
    expect(container!.textContent).toContain('ตรวจสอบสถานะ');
  });
});
