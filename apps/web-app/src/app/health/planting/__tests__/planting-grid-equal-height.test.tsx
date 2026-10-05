/**
 * A1 (design-cleanup-2026-08-21) — /health/planting grid cards must stretch
 * to equal height.
 *
 * Same defect class as the tile-home-nav equal-height fix (nav-tile.tsx):
 * a Link-wrapped Card in a multi-column grid needs `h-full` at every level
 * between the grid item and the visible card surface. Here the planting
 * cycle grid is `motion.div > Link > Card`; the grid item (motion.div)
 * is stretched by CSS Grid's default `align-items: stretch`, but before
 * this fix neither the Link nor the Card propagated that height down to
 * the visible card surface, so short cycle cards did not match tall ones
 * in the same row.
 */
import * as React from 'react';
import { describe, expect, it, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// CRITICAL: useRouter MUST return a STABLE reference. The default
// jest.setup.tsx mock returns a fresh object on every render, and this
// page's `useEffect(..., [router])` would refire on every render — an
// infinite loop act() cannot drain (the mocked getMyCycles Once-value is
// consumed on the first call, so later calls resolve undefined and
// `.then()` on it throws). Defining the router object inside the
// factory (not inline in the returned arrow) keeps it stable, matching
// health/dashboard/__tests__/dashboard-fetch-error.test.tsx.
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

describe('[A1] /health/planting — grid cards stretch to equal height', () => {
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

  function mount() {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(<HealthPlantingDashboardPage />);
    });
  }

  it('Link wrapper carries h-full, and the Card inside it carries h-full', async () => {
    mockGetMyCycles.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'cycle-1',
          cycleName: 'รอบ 1',
          status: 'GROWING',
          startDate: '2026-01-01',
          expectedHarvestDate: '2026-06-01',
          totalAreaSqm: 100,
          plotCount: 2,
          plannedPlantCount: 50,
          cultivationMethods: [],
          plantSpecies: { id: 'sp-1', nameTH: 'ขมิ้นชัน' },
        },
        {
          id: 'cycle-2',
          cycleName: 'รอบ 2',
          status: 'PLANNING',
          startDate: '2026-02-01',
          expectedHarvestDate: null,
          totalAreaSqm: 50,
          plotCount: 1,
          plannedPlantCount: 10,
          cultivationMethods: [],
          plantSpecies: { id: 'sp-2', nameTH: 'กระชายดำ' },
        },
      ],
    });
    mount();
    await act(async () => {
      await Promise.resolve();
    });

    const link = container!.querySelector('a[href="/health/planting/cycle-1"]');
    expect(link).not.toBeNull();
    expect(link!.className).toContain('h-full');

    const card = container!.querySelector('a[href="/health/planting/cycle-1"] > div');
    expect(card).not.toBeNull();
    expect(card!.className).toContain('h-full');
  });
});
