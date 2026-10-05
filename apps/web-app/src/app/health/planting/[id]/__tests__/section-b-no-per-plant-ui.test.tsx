/**
 * PlantingCycleDetailTabsSectionB — retired per-plant UI removal
 * (B-PLANTING item 2, backlog #82 / B2, design doc R8).
 *
 * The "โซ่ตรวจย้อนกลับรายแปลง → รายต้น → ลอต" table's action cell carried a
 * second copy of the "ดูรายต้น" button (desktop table row + mobile card),
 * jumping to the retired per-plant "units" tab. This pins it's gone from
 * both, while the still-valid "Batch ล่าสุด" / "เปิด QR" / lot links stay.
 */
import * as React from 'react';
import { describe, expect, it, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { NotebookTabs } from '@/components/feature/notebook-tabs';
import { PlantingCycleDetailTabsSectionB } from '../planting-cycle-detail-tabs-section-b';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseProps = {
  activities: [],
  cycle: {
    id: 'cycle-1',
    traceSummary: { batchCount: 1, lotCount: 2, latestBatch: { batchNumber: 'B-001', trackingUrl: 'https://example.test/trace/batch/B-001' } },
  },
  harvestBlockers: [],
  canHarvest: true,
  openHarvestModal: jest.fn(),
  submittingPlotQr: false,
  handleGeneratePlotQrs: jest.fn(),
  loadingPlotTrace: false,
  traceDrillDownRows: [
    {
      cyclePlotId: 'plot-1',
      plotName: 'แปลง A',
      cultivationMethod: 'กลางแจ้ง',
      qrCode: 'QR123',
      qrTrackingUrl: 'https://example.test/trace/plot-cycle/QR123',
      latestBatchUrl: 'https://example.test/trace/batch/B-001',
      latestLots: [{ id: 'lot-1', lotNumber: 'LOT-001', trackingUrl: 'https://example.test/trace/lot/lot-1' }],
    },
  ],
  openQrPreview: jest.fn(),
};

describe('trace tab (section B) — retired "ดูรายต้น" per-plant button removed', () => {
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
      root!.render(
        <NotebookTabs value="trace">
          <PlantingCycleDetailTabsSectionB {...baseProps} />
        </NotebookTabs>,
      );
    });
  }

  it('does not render the "ดูรายต้น" button anywhere in the trace/drill-down tab (desktop + mobile)', () => {
    mount();
    expect(container!.textContent).not.toContain('ดูรายต้น');
  });

  it('still renders the "Batch ล่าสุด" and lot links (real, non-retired trace actions)', () => {
    mount();
    expect(container!.textContent).toContain('Batch ล่าสุด');
    const lotLink = Array.from(container!.querySelectorAll('a')).find((a) => a.textContent === 'LOT-001');
    expect(lotLink).toBeDefined();
  });
});
