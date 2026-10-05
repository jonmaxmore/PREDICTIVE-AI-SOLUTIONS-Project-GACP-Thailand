/**
 * A5 (design-cleanup-2026-08-21) — admin planting detail page, "summary" tab.
 *
 * Two defects in the same block (lines ~201-211):
 *   1. Invalid nested markup: every summary row was `<p>label: <p
 *      className="font-bold">value</p></p>` — a <p> inside a <p>, which
 *      causes a hydration warning (the browser's HTML parser auto-closes
 *      the outer <p> before the nested one, so SSR and CSR trees differ).
 *      Fix: the inner element becomes a <span>.
 *   2. Retired per-plant metrics: R8 (design notes
 *      2026-08-20-planting-tnt-design.md) retired per-PLANT tracking
 *      permanently — "จำนวนต้น" is just a number on the cycle, not a
 *      per-unit trace. Six rows reporting per-plant counts (จำนวนต้น,
 *      ต้นตามแผน, ต้นที่ใช้งาน, ต้นที่ถูกถอน, เกินแผน, ยังไม่จัดสรร) left
 *      this display.
 *
 * Fixture updated 2026-08-25, when the removal reached the backend. The
 * original fixture fed `_count.plantUnits` and a full `integrity` object
 * because the admin detail endpoint still produced them. It does not any
 * more: routes/api/admin/planting.js dropped the integrity object and the
 * plantUnits count with the PlantUnit reads that computed them. Feeding
 * them here would have made this suite green against a response shape the
 * server can no longer return — the six labels would have been absent
 * because the page dropped them, not because the data is gone, and the
 * next regression would have slipped through. The mock below is now the
 * real post-removal shape.
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
jest.mock('@/lib/api/api-client', () => ({
  apiClient: { get: (url: string) => mockApiGet(url) },
  api: { get: (url: string) => mockApiGet(url) },
}));

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'cycle-1' }),
}));

import AdminPlantingDetailPage from '../page';

describe('[A5] /admin/planting/[id] — summary tab markup + retired per-plant metrics', () => {
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
      root!.render(<AdminPlantingDetailPage />);
    });
  }

  function clickSummaryTab() {
    const trigger = Array.from(container!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('สรุป'),
    );
    expect(trigger).toBeTruthy();
    act(() => {
      // Radix Tabs' Trigger activates on mousedown (button===0, ctrlKey
      // false), not click — see @radix-ui/react-tabs dist/index.js.
      trigger!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    });
  }

  async function mountOnSummaryTab() {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/plot-qrs')) {
        return Promise.resolve({ success: true, data: [] });
      }
      return Promise.resolve({
        success: true,
        data: {
          id: 'cycle-1',
          cycleName: 'รอบทดสอบ',
          status: 'GROWING',
          startDate: '2026-01-01',
          expectedHarvestDate: '2026-06-01',
          farm: { id: 'farm-1', farmName: 'ฟาร์มทดสอบ', ownerId: 'owner-1' },
          // No plantUnits key and no integrity object: this is what the admin
          // detail endpoint actually returns after the 2026-08-25 removal.
          _count: { batches: 3, cultivationLogs: 8 },
        },
      });
    });
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    clickSummaryTab();
  }

  it('no <p> element contains a nested <p> descendant (invalid markup / hydration warning)', async () => {
    await mountOnSummaryTab();
    const paragraphs = Array.from(container!.querySelectorAll('p'));
    const withNestedP = paragraphs.filter((p) => p.querySelector('p') !== null);
    expect(withNestedP).toEqual([]);
  });

  it('drops all six retired per-plant metric rows from the summary tab', async () => {
    await mountOnSummaryTab();
    const summaryText = container!.textContent || '';
    for (const label of ['จำนวนต้น', 'ต้นตามแผน', 'ต้นที่ใช้งาน', 'ต้นที่ถูกถอน', 'เกินแผน', 'ยังไม่จัดสรร']) {
      expect(`${label}:${summaryText.includes(label)}`).toBe(`${label}:false`);
    }
  });

  it('shows no per-plant integrity banner — the numbers behind it are no longer computed', async () => {
    await mountOnSummaryTab();
    const pageText = container!.textContent || '';
    // "เกินแผน / ยังไม่จัดสรร" counted PlantUnit rows against the declared plan.
    // With nothing minting those rows the warning has no input, so the banner is
    // gone rather than permanently reporting 0 · 0 to every admin.
    expect(pageText).not.toContain('ต้องทบทวนข้อมูลตรวจสอบย้อนกลับ');
    expect(pageText).not.toContain('ข้อมูลเก่าไม่ตรงกัน');
    expect(pageText).not.toContain('ยังไม่จัดสรร');
  });

  it('keeps the five non-per-plant summary rows', async () => {
    await mountOnSummaryTab();
    const summaryText = container!.textContent || '';
    for (const label of ['สถานะรอบปลูก', 'วันเริ่มปลูก', 'กำหนดเก็บเกี่ยว', 'ชุดเก็บเกี่ยว', 'กิจกรรม']) {
      expect(`${label}:${summaryText.includes(label)}`).toBe(`${label}:true`);
    }
  });
});
