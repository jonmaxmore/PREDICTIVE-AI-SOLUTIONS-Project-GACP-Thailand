/**
 * useNavChips — isolated hook tests (final-review F-2 test debt, T2-c).
 *
 * Before this file: no test isolated the hook's own gating and error-path
 * behavior from its two consumers (health/home client-view, DashboardLayout).
 * The final whole-branch review named this gap directly — an isolated test
 * here would have caught F-2 (a failed certs fetch produced the SAME state
 * — certsLoaded:true, hasActiveCert:false — as "loaded, definitely no
 * certificate", which every consumer renders as a hard lock).
 *
 * Pattern: HookHarness + createRoot/act (this repo has no
 * @testing-library/react-hooks dependency) — mirrors
 * app/health/applications/new/_steps/hooks/use-auto-save.test.tsx.
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act, useEffect } from 'react';
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

import { useNavChips, type NavChips, type UseNavChipsOptions } from '../use-nav-chips';

function pending(): Promise<unknown> {
  return new Promise(() => undefined);
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function HookHarness({
  options,
  onChange,
}: {
  options: UseNavChipsOptions;
  onChange: (value: NavChips) => void;
}) {
  const chips = useNavChips(options);
  useEffect(() => {
    onChange(chips);
  }, [chips, onChange]);
  return null;
}

describe('useNavChips — isolated hook (F-2 test debt)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest: NavChips | null = null;
  const onChange = jest.fn((value: NavChips) => {
    latest = value;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    latest = null;
    onChange.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
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

  function render(options: UseNavChipsOptions) {
    act(() => {
      root!.render(<HookHarness options={options} onChange={onChange} />);
    });
  }

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it('chips-only gating ({ certLock: false }) never fires /api/certificates/my', async () => {
    mockApiGet.mockImplementation(() => Promise.resolve({ success: true, data: [] }));
    render({ certLock: false });
    await flush();
    const urls = mockApiGet.mock.calls.map((c) => c[0]);
    expect(urls).toContain('/api/applications/my');
    expect(urls).not.toContain('/api/certificates/my');
  });

  it('cert-lock-only gating ({ chips: false }) never fires /api/applications/my', async () => {
    mockApiGet.mockImplementation(() => Promise.resolve({ success: true, data: [] }));
    render({ chips: false });
    await flush();
    const urls = mockApiGet.mock.calls.map((c) => c[0]);
    expect(urls).toContain('/api/certificates/my');
    expect(urls).not.toContain('/api/applications/my');
  });

  it('a failed certificates fetch yields the unknown/error state, NOT the "loaded, no cert" shape (F-2)', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') return Promise.reject(new Error('network outage'));
      return pending();
    });
    render({});
    await flush();
    expect(latest).not.toBeNull();
    // The bug: certsLoaded:true + hasActiveCert:false is exactly what a
    // consumer sees for "loaded, confirmed no certificate" — it must never
    // be produced by a transient fetch failure.
    expect(latest!.certsLoaded).toBe(false);
    expect(latest!.hasActiveCert).toBe(false);
    expect(latest!.certError).toBe(true);
  });

  it('a success:false envelope also yields the error state, not "loaded, no cert"', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') return Promise.resolve({ success: false, error: 'down' });
      return pending();
    });
    render({});
    await flush();
    expect(latest!.certsLoaded).toBe(false);
    expect(latest!.hasActiveCert).toBe(false);
    expect(latest!.certError).toBe(true);
  });

  it('a successful fetch with an expiring-but-valid cert yields usable-cert true', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({
          success: true,
          data: [{ status: 'active', expiryDate: daysFromNow(45) }],
        });
      }
      return pending();
    });
    render({});
    await flush();
    expect(latest!.certsLoaded).toBe(true);
    expect(latest!.hasActiveCert).toBe(true);
    expect(latest!.certError).toBe(false);
  });
});
