/**
 * /provider/home client-view — thrown /auth/provider/me must not blank the
 * page (final-review F-3 fix).
 *
 * Before this fix: `.catch(() => { if (!cancelled) setResolved(true); })`
 * set `resolved` without setting `role`. `getNavForRole(null)` returns `[]`,
 * so the officer saw the "หน้าหลัก / เลือกเมนูที่คุณต้องการใช้งาน" heading
 * over an empty grid — no error, no retry, no redirect. Mirrors provider/
 * dashboard's dashboard-fetch-error.test.tsx pattern (X2-FIX-C/H-6): rose
 * error Card + retry CTA, dict.common.fetchError copy.
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
  apiClient: { get: (url: string) => mockApiGet(url) },
  api: { get: (url: string) => mockApiGet(url) },
}));

// CRITICAL: useRouter MUST return a STABLE reference — the client-view's
// useEffect depends on `router`; the default jest.setup.tsx mock returns a
// fresh object per render, which would re-fire the effect forever. See
// provider/dashboard/__tests__/dashboard-fetch-error.test.tsx for the same
// note.
jest.mock('next/navigation', () => {
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
    pathname: '/',
    query: {},
  };
  return {
    useRouter: () => router,
    usePathname: () => '/provider/home',
    useSearchParams: () => new URLSearchParams(),
  };
});

// Passthrough ProviderLayout — the error card lives in THIS file's own
// JSX, not the layout, and ProviderLayout has its own /auth/provider/me
// fetch that would otherwise interfere.
jest.mock('../../components/provider-layout', () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Passthrough.displayName = 'MockProviderLayout';
  return { __esModule: true, default: Passthrough };
});

import ProviderHomeClientView from '../client-view';
import { LanguageProvider } from '@/lib/i18n/language-context';

describe('/provider/home client-view — /auth/provider/me failure (F-3 fix)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
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
      root.render(
        <LanguageProvider>
          <ProviderHomeClientView />
        </LanguageProvider>,
      );
    });
  }

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it('renders an honest error state with a retry action when /auth/provider/me throws — not a blank home', async () => {
    mockApiGet.mockRejectedValue(new Error('network outage'));
    mount();
    await flush();

    const errCard = container!.querySelector('[data-testid="provider-home-fetch-error"]');
    expect(errCard).not.toBeNull();
    expect(errCard!.textContent).toContain('ลองอีกครั้ง');

    // The bug: the blank ProviderHome subtitle rendered with zero tiles and
    // no error at all. Both must never be true together.
    expect(container!.textContent).not.toContain('เลือกเมนูที่คุณต้องการใช้งาน');
  });

  it('retry re-fetches /auth/provider/me and renders the tile grid on success', async () => {
    let callCount = 0;
    mockApiGet.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return Promise.reject(new Error('network outage'));
      return Promise.resolve({
        success: true,
        data: { role: 'field_inspector', canonicalRole: 'field_inspector' },
      });
    });
    mount();
    await flush();

    const errCard = container!.querySelector('[data-testid="provider-home-fetch-error"]');
    expect(errCard).not.toBeNull();

    const retryBtn = errCard!.querySelector('button');
    expect(retryBtn).not.toBeNull();
    await act(async () => {
      retryBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(container!.querySelector('[data-testid="provider-home-fetch-error"]')).toBeNull();
    expect(container!.textContent).toContain('งานตรวจแปลง');
  });
});
