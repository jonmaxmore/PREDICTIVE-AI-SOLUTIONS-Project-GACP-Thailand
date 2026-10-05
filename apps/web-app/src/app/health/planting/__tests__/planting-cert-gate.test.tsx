/**
 * PlantingCertGate — the /health/planting layout-level honesty gate
 * (B-PLANTING item 1, backlog #81 / B4 / W2-2).
 *
 * `layout.tsx` used to be a 5-line pass-through: a farmer with no usable
 * certificate could open /health/planting/new (or any /health/planting/*
 * URL) directly and land on a page that looks broken, instead of an honest
 * explanation. The tile-home lock (app/health/home/client-view.tsx) already
 * hides the "การปลูก" tile using useNavChips()'s hasActiveCert/certsLoaded
 * (getCertBadgeKind(...) !== 'expired' — see cert-status.ts) — this test
 * pins that the LAYOUT gate reuses the exact same rule via the exact same
 * hook, rather than inventing a second cert-lock computation.
 *
 * Real enforcement stays server-side (planting-service re-validates before
 * createCycle) — this gate is presentation/honesty only, so it must fail
 * OPEN (render children) while cert state is unknown or errored, and only
 * show the lock explanation once certsLoaded is true AND hasActiveCert is
 * false. Mirrors isTileLocked() in health/home/client-view.tsx and the
 * bottom-nav lock in dashboard-layout.tsx.
 *
 * Test pattern matches health/home/__tests__/client-view.test.tsx and
 * components/layout/__tests__/bottom-nav.test.tsx (no @testing-library/react
 * dependency in this repo): react-dom/client createRoot + act, manual DOM
 * queries, mock '@/lib/api/api-client' (useNavChips' fetch) by URL.
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

import { PlantingCertGate } from '../planting-cert-gate';

function pending(): Promise<unknown> {
  return new Promise(() => undefined);
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

const PAGE_CONTENT = 'PLANTING-PAGE-CONTENT-MARKER';

describe('/health/planting layout — certificate honesty gate', () => {
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
      root!.render(
        <PlantingCertGate>
          <div>{PAGE_CONTENT}</div>
        </PlantingCertGate>,
      );
    });
  }

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it('renders children (fails OPEN) while the certificates fetch is still pending', () => {
    mockApiGet.mockImplementation(() => pending());
    mount();
    expect(container!.textContent).toContain(PAGE_CONTENT);
  });

  it('renders children when the farmer has a usable (non-expired) certificate', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({
          success: true,
          data: [{ status: 'active', expiryDate: daysFromNow(200) }],
        });
      }
      return pending();
    });
    mount();
    await flush();
    expect(container!.textContent).toContain(PAGE_CONTENT);
  });

  it('does NOT render children and shows an honest explanation once certsLoaded resolves with no usable certificate', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({ success: true, data: [] });
      }
      return pending();
    });
    mount();
    await flush();
    expect(container!.textContent).not.toContain(PAGE_CONTENT);
    // States the cause (no usable GACP certificate) using the SAME reason
    // text nav-config.ts's planting lock item already carries.
    expect(container!.textContent).toContain('ใบรับรอง GACP');
    // States the next action and links to the status page (สถานะ), not a
    // dead end.
    const statusLink = Array.from(container!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/health/status',
    );
    expect(statusLink).toBeDefined();
  });

  it('also locks for an expired-status certificate (getCertBadgeKind, not a bare status compare)', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({
          success: true,
          data: [{ status: 'active', expiryDate: daysFromNow(-5) }],
        });
      }
      return pending();
    });
    mount();
    await flush();
    expect(container!.textContent).not.toContain(PAGE_CONTENT);
  });

  it('fails OPEN (renders children) on a certificates-fetch error — unknown must never render as a confirmed lock', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.reject(new Error('network down'));
      }
      return pending();
    });
    mount();
    await flush();
    expect(container!.textContent).toContain(PAGE_CONTENT);
  });
});
