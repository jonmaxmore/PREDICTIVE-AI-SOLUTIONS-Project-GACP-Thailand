/**
 * DashboardLayout — shell-level BackHomeCrumb (B-NAV item 1, W10).
 *
 * D1/D2/W2-3 (reports/design-cleanup-2026-08-21/05-BACKLOG.md §2 item 89):
 * before this fix, exactly one production caller
 * (app/health/status/client-view.tsx) rendered BackHomeCrumb directly — no
 * other inner page under /health/* or /provider/* had a "← หน้าหลัก"
 * affordance. This moves the crumb into the shell (DashboardLayout) so
 * every inner page gets it automatically, with three escape hatches:
 *   1. the role's own home page never shows a link back to itself,
 *   2. an explicit `hideBackHomeCrumb` prop for pages with their own back
 *      control (e.g. /health/more's "ย้อนกลับ" button in the same slot),
 *   3. the application wizard bypasses DashboardLayout entirely already
 *      (health/layout.tsx's `isWizardFlow` branch) — untouched by this fix.
 *
 * `current` is auto-filled from nav-config (`findNavLabelForPath`) so
 * individual pages don't each pass their own label.
 *
 * Mock setup mirrors bottom-nav.test.tsx (same repo pattern: no
 * @testing-library/react — react-dom/client createRoot + act, manual DOM
 * queries; mock @/lib/api for the bell fetch and @/lib/api/api-client for
 * useNavChips separately, since they're different import specifiers).
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

let mockPathname = '/health/status';
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => mockRouter,
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
  AuthService: {
    getUser: jest.fn(() => null),
    logout: jest.fn(),
  },
}));

jest.mock('@/components/layout/Footer', () => ({ Footer: () => null }));

import { DashboardLayout } from '../dashboard-layout';

function pending(): Promise<unknown> {
  return new Promise(() => undefined);
}

describe('DashboardLayout — shell-level BackHomeCrumb (task 1, W10)', () => {
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

  function mount(props: Partial<React.ComponentProps<typeof DashboardLayout>> = {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(
        <DashboardLayout
          navItems={[]}
          // eslint-disable-next-line jsx-a11y/aria-role
          role="health"
          brandName="GACP Platform"
          brandIcon={Home}
          {...props}
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

  function crumbHomeLink(): HTMLAnchorElement | undefined {
    return Array.from(container!.querySelectorAll('a')).find(
      (a) => (a.textContent ?? '').includes('หน้าหลัก') && a.getAttribute('href') !== null && a.closest('main'),
    ) as HTMLAnchorElement | undefined;
  }

  it('renders a "← หน้าหลัก" crumb on an inner health page, auto-labelled from nav-config', async () => {
    mockPathname = '/health/status';
    mount({ role: 'health' });
    await flush();

    const link = crumbHomeLink();
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/health/home');
    expect(container!.textContent).toContain('ตรวจสอบสถานะ');
  });

  it('does NOT render the crumb on the health home page itself', async () => {
    mockPathname = '/health/home';
    mount({ role: 'health' });
    await flush();

    expect(crumbHomeLink()).toBeUndefined();
  });

  it('does NOT render the crumb when hideBackHomeCrumb is passed (page with its own back control)', async () => {
    mockPathname = '/health/more';
    mount({ role: 'health', hideBackHomeCrumb: true });
    await flush();

    expect(crumbHomeLink()).toBeUndefined();
  });

  it('renders on an inner provider page, pointing at /provider/home', async () => {
    mockPathname = '/provider/audits';
    mount({ role: 'provider', canonicalRole: 'field_inspector' });
    await flush();

    const link = crumbHomeLink();
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/provider/home');
    expect(container!.textContent).toContain('งานตรวจแปลง');
  });

  it('does NOT render the crumb on the provider home page itself', async () => {
    mockPathname = '/provider/home';
    mount({ role: 'provider', canonicalRole: 'field_inspector' });
    await flush();

    expect(crumbHomeLink()).toBeUndefined();
  });

  it('renders the crumb with no trailing label when the path matches no nav item', async () => {
    mockPathname = '/health/some-unmapped-page';
    mount({ role: 'health' });
    await flush();

    const link = crumbHomeLink();
    expect(link).toBeTruthy();
  });
});
