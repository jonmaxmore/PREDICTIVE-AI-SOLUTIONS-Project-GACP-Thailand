/**
 * A2 (design-cleanup-2026-08-21) — /health/establishments/[id] "cycles" tab
 * must show the Thai planting-cycle status label, not the raw enum string.
 *
 * Before this fix, `{cycle.status}` was rendered directly (line ~296),
 * so a farmer would see "GROWING" instead of "กำลังเติบโต". The fix maps
 * the status through the SAME Thai label table the planting pages already
 * use (STATUS_META in health/planting/[id]/planting-cycle-detail-page-config.ts)
 * instead of introducing a second, divergent copy — and falls back to the
 * honest "ไม่ทราบสถานะ" string (matching components/finance/StatusBadge.tsx's
 * convention) for any status not in the table, never a blank or the raw code.
 */
import * as React from 'react';
import { describe, expect, it, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api', () => ({
  apiClient: { get: (url: string) => mockApiGet(url) },
  api: { get: (url: string) => mockApiGet(url) },
}));

// next/navigation is mocked globally in jest.setup.tsx but does NOT export
// useParams — re-mock here so the [id] route param resolves, matching the
// convention in health/applications/[id]/car/__tests__/error-state.test.tsx.
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'farm-1' }),
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

import EstablishmentDetailPage from '../client-view';

describe('[A2] /health/establishments/[id] — planting-cycle status is a Thai label, not the raw code', () => {
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
      root!.render(<EstablishmentDetailPage />);
    });
  }

  function clickCyclesTab() {
    const trigger = Array.from(container!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('รอบการปลูก'),
    );
    expect(trigger).toBeTruthy();
    act(() => {
      // Radix Tabs' Trigger activates on `mousedown` (button===0, ctrlKey
      // false), not `click` — see @radix-ui/react-tabs dist/index.js.
      trigger!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    });
  }

  it('renders the Thai label for a known status and an honest fallback for an unknown one', async () => {
    mockApiGet.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'farm-1',
        farmName: 'ฟาร์มทดสอบ',
        farmType: 'CULTIVATION',
        address: '-',
        province: '-',
        district: '-',
        subDistrict: '-',
        postalCode: '-',
        totalArea: 10,
        areaUnit: 'RAI',
        status: 'ACTIVE',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        certificates: [],
        plantingCycles: [
          { id: 'c1', cycleName: 'รอบ 1', status: 'GROWING', startDate: '2026-01-01' },
          { id: 'c2', cycleName: 'รอบ 2', status: 'SOME_UNMAPPED_STATUS', startDate: '2026-01-01' },
        ],
      },
    });
    mount();
    await act(async () => {
      await Promise.resolve();
    });

    clickCyclesTab();

    // Known status: Thai label, not the raw enum.
    expect(container!.textContent).toContain('กำลังเติบโต');
    expect(container!.textContent).not.toContain('GROWING');

    // Unknown status: honest fallback, never blank and never the raw code.
    expect(container!.textContent).toContain('ไม่ทราบสถานะ');
    expect(container!.textContent).not.toContain('SOME_UNMAPPED_STATUS');
  });
});
