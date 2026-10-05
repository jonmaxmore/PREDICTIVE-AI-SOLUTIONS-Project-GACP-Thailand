/**
 * error-state.test.tsx — V1-B D5 acceptance test for the CAR page's
 * fetch / upload error surface.
 *
 * What changed in V1-B: the page used `notifications.show({ color: 'red' })`
 * (Sonner toast, ~4s auto-dismiss) for the
 * "ไม่สามารถโหลดข้อมูลได้" / "ไม่สามารถส่งเอกสารได้" errors. We replaced
 * BOTH with persistent inline `<Alert color="red">` panels that mirror
 * the pattern used in `/health/payments` (client-view.tsx:300-302) so
 * the rest of the farmer-facing site stays consistent.
 *
 * Three explicit state assertions, paired with the three asserted on
 * the payments page for 6 total per the RFC §V1-B acceptance:
 *   1. Loading skeleton renders BEFORE the fetch resolves.
 *   2. Inline error Alert (NOT toast) renders when apiClient.get fails.
 *   3. Empty-state "ไม่พบคำขอที่ระบุ" renders when the API resolves null.
 *
 * Mocking strategy: createRoot + act so useEffect fires; apiClient is
 * mocked at the module boundary so no network IO happens.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import CARUploadPage from '../client-view';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockNotifyShow = jest.fn();

jest.mock('@/lib/api/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

jest.mock('@/lib/notifications', () => ({
  notifications: {
    show: (...args: unknown[]) => mockNotifyShow(...args),
  },
}));

// next/navigation is mocked globally in jest.setup.tsx but does NOT
// export useParams — re-mock here so we can return our test param.
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'app-test-1' }),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
    pathname: '/',
    query: {},
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

describe('CARUploadPage states (V1-B / D5)', () => {
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
      root.render(<CARUploadPage />);
    });
  }

  it('renders the loading container while the fetch is pending', () => {
    // Leave the promise pending so we observe the loading branch.
    mockGet.mockReturnValue(new Promise(() => undefined));
    mount();
    expect(container!.querySelector('[data-testid="car-loading"]')).not.toBeNull();
  });

  it('renders a persistent inline <Alert color="red"> when the fetch fails (D5 fix)', async () => {
    mockGet.mockResolvedValueOnce({ success: false, error: 'boom' });

    mount();
    await act(async () => {
      await Promise.resolve();
    });

    // The inline Alert must be present — not a toast call.
    const alert = container!.querySelector('[data-testid="car-fetch-error"]');
    expect(alert).not.toBeNull();
    // Persistent alert uses role="alert" (set by the Alert component).
    expect(alert?.getAttribute('role')).toBe('alert');
    // Thai copy retained.
    expect(alert?.textContent).toContain('ไม่สามารถโหลดข้อมูลคำขอได้');
    // Critically: notifications.show MUST NOT have been called for the
    // fetch-error path (D5 fix replaced the toast with the inline Alert).
    expect(mockNotifyShow).not.toHaveBeenCalled();
  });

  it('renders the "ไม่พบคำขอที่ระบุ" empty-state when the API resolves with null data', async () => {
    // apiClient unwraps one envelope level (api-client.ts:410); the backend
    // returns single-level `{ success, data: app }` (so a missing app is
    // `{ success: true, data: null }`, not a nested `{ data: { data: null } }`).
    mockGet.mockResolvedValueOnce({ success: true, data: null });

    mount();
    await act(async () => {
      await Promise.resolve();
    });

    const notFound = container!.querySelector('[data-testid="car-not-found"]');
    expect(notFound).not.toBeNull();
    expect(notFound?.textContent).toContain('ไม่พบคำขอที่ระบุ');
  });
});
