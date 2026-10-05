/**
 * planting-team-affordance.test.tsx — W8 personal-workspace-team, item 1.
 *
 * The only route to workspace/team management today is a secondary-tier
 * nav tile ("ผู้ยื่นคำขอ / ทีมงาน", see U1 in nav-config.ts). Someone
 * standing in the planting flow thinking "let my worker record this
 * instead of me" will not go browsing nav tiles for it. This pins a
 * direct affordance from /health/planting to /health/workspaces, worded
 * for the operator's case (hiring help to record planting/harvest).
 *
 * Mock setup copied from planting-grid-equal-height.test.tsx (same file,
 * same page) — useRouter MUST return a stable reference or the page's
 * useEffect(..., [router]) infinite-loops under act().
 */
import * as React from 'react';
import { describe, expect, it, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('next/navigation', () => {
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
    pathname: '/health/planting',
    query: {},
  };
  const searchParams = new URLSearchParams();
  return {
    useRouter: () => router,
    usePathname: () => '/health/planting',
    useSearchParams: () => searchParams,
  };
});

const mockGetMyCycles = jest.fn<(status?: string) => Promise<unknown>>();
jest.mock('@/lib/services/planting-service', () => ({
  plantingService: { getMyCycles: (status?: string) => mockGetMyCycles(status) },
}));

import HealthPlantingDashboardPage from '../client-view';

describe('[W8] /health/planting — affordance to hand off recording to a team member', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => { root?.unmount(); });
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
      root!.render(<HealthPlantingDashboardPage />);
    });
  }

  it('renders a link to /health/workspaces even with zero cycles (empty-state farmer still needs to find it)', async () => {
    mockGetMyCycles.mockResolvedValueOnce({ success: true, data: [] });
    mount();
    await act(async () => { await Promise.resolve(); });

    const link = container!.querySelector('a[href="/health/workspaces"]');
    expect(link).not.toBeNull();
  });

  it('the affordance text speaks to hiring/delegating recording, not generic "team" jargon', async () => {
    mockGetMyCycles.mockResolvedValueOnce({ success: true, data: [] });
    mount();
    await act(async () => { await Promise.resolve(); });

    const link = container!.querySelector('a[href="/health/workspaces"]');
    expect(link).not.toBeNull();
    const text = link!.textContent || '';
    // must reference recording-on-your-behalf (the operator's exact case),
    // not just the bare word "ทีมงาน" with no context.
    expect(text).toMatch(/บันทึก.*แทน|ให้คนอื่น/);
  });

  it('also renders when cycles exist (not just the empty state)', async () => {
    mockGetMyCycles.mockResolvedValueOnce({
      success: true,
      data: [{
        id: 'cycle-1', cycleName: 'รอบ 1', status: 'GROWING',
        startDate: '2026-01-01', expectedHarvestDate: '2026-06-01',
        totalAreaSqm: 100, plotCount: 2, plannedPlantCount: 50,
        cultivationMethods: [], plantSpecies: { id: 'sp-1', nameTH: 'ขมิ้นชัน' },
      }],
    });
    mount();
    await act(async () => { await Promise.resolve(); });

    const link = container!.querySelector('a[href="/health/workspaces"]');
    expect(link).not.toBeNull();
  });
});
