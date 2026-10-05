/**
 * DashboardLayout + /health/home — cert-fetch dedup (final-review F-7 minor).
 *
 * Before this fix: app/health/layout.tsx wraps every /health/* route in
 * DashboardLayout, which calls useNavChips({ chips: false, certLock: true })
 * for the bottom-nav lock. HealthHomeClientView (rendered as `children` on
 * /health/home) ALSO calls useNavChips() (both halves on) for the tile
 * grid's lock + chips. That is two separate hook instances, two effects,
 * two GETs to /api/certificates/my for one page load — the ledger's Task-5
 * line ("drop dup cert fetch") only removed the in-page duplicate, not this
 * layout-vs-page one.
 *
 * Fix: NavCertLockContext (use-nav-chips.ts) — DashboardLayout provides the
 * cert-lock half of its OWN useNavChips result to descendants; a nested
 * useNavChips() call detects the ancestor Provider and skips its own fetch,
 * merging in the shared value instead. Neither call site's hook invocation
 * changes — this is pure sharing, not a second hook.
 *
 * Test pattern mirrors bottom-nav.test.tsx (this repo has no
 * @testing-library/react dependency): createRoot + act, mock '@/lib/api'
 * (the bell fetch) and '@/lib/api/api-client' (useNavChips) separately.
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
jest.mock('@/components/layout/entity-switcher', () => ({ EntitySwitcher: () => null }));

import HealthHomeClientView from '@/app/health/home/client-view';

describe('DashboardLayout + /health/home — one /api/certificates/my load serves the page (F-7 fix)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLibApiGet.mockResolvedValue({ success: true, data: [] });
    mockApiClientGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({ success: true, data: [] });
      }
      if (url === '/api/applications/my') {
        return Promise.resolve({ success: true, data: [] });
      }
      return new Promise(() => undefined);
    });
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

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it('fires /api/certificates/my exactly once for the whole DashboardLayout + HealthHomeClientView tree', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(
        <LanguageProvider>
          <DashboardLayout
            navItems={[]}
            // DashboardLayout `role` is a portal selector, not an ARIA role.
            // eslint-disable-next-line jsx-a11y/aria-role
            role="health"
            brandName="GACP Platform"
            brandIcon={Home}
          >
            <HealthHomeClientView />
          </DashboardLayout>
        </LanguageProvider>,
      );
    });
    await flush();

    const certCalls = mockApiClientGet.mock.calls.filter((c) => c[0] === '/api/certificates/my');
    expect(certCalls).toHaveLength(1);
    // Sanity: the applications/my fetch (health/home's own chips half)
    // still fires — proves the page still renders/works, not just quiet.
    const appCalls = mockApiClientGet.mock.calls.filter((c) => c[0] === '/api/applications/my');
    expect(appCalls.length).toBeGreaterThanOrEqual(1);
  });
});
