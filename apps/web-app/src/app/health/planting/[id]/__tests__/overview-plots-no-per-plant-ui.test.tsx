/**
 * PlantingCycleDetailTabsSectionAOverviewPlots — retired per-plant UI
 * removal (B-PLANTING item 2, backlog #82 / B2, design doc R8: "ไม่ทำระดับ
 * ต้น อีกแล้ว ... จำนวนต้น เป็นแค่ตัวเลขในข้อมูลรอบปลูก ไม่ใช่การติดตาม
 * รายหน่วย").
 *
 * Each plot row's action cell used to carry a "ดูรายต้น" (view individual
 * plants) button that jumped to the retired per-plant "units" tab
 * (setSelectedCyclePlotId + setUnitsPage + setActiveTab('units')) — a
 * feature R8 permanently retired. This test pins that the button is gone
 * from both the desktop table row and the mobile card row, while the
 * still-valid "เปิด Trace" action (plot-level QR trace, NOT per-plant)
 * stays.
 */
import * as React from 'react';
import { describe, expect, it, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { NotebookTabs } from '@/components/feature/notebook-tabs';
import { PlantingCycleDetailTabsSectionAOverviewPlots } from '../planting-cycle-detail-tabs-section-a-overview-plots';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseProps = {
  cycle: {
    cultivationMethods: ['OUTDOOR'],
    certificate: { certificateNumber: 'GACP-TH-2569-000001' },
    startDate: '2026-01-01',
    expectedHarvestDate: '2026-06-01',
    seedSource: null,
    notes: null,
    plots: [{ cyclePlotId: 'plot-1', name: 'แปลง A', solarSystem: 'OUTDOOR', allocatedAreaSqm: 100 }],
  },
  hasActiveCertificate: true,
  harvestBlockers: [],
  submittingPlotQr: false,
  handleGeneratePlotQrs: jest.fn(),
  perPlotProgress: [
    { cyclePlotId: 'plot-1', plotName: 'แปลง A', plannedPlantCount: 100 },
  ],
  plotQrByCyclePlotId: new Map([
    ['plot-1', { qrCode: 'QR123', trackingUrl: 'https://example.test/trace/plot-cycle/QR123' }],
  ]),
  openQrPreview: jest.fn(),
};

describe('overview-plots tab — retired "ดูรายต้น" per-plant button removed', () => {
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
        <NotebookTabs value="plots">
          <PlantingCycleDetailTabsSectionAOverviewPlots {...baseProps} />
        </NotebookTabs>,
      );
    });
  }

  it('does not render the "ดูรายต้น" button anywhere in the plots tab (desktop table + mobile card)', () => {
    mount();
    expect(container!.textContent).not.toContain('ดูรายต้น');
  });

  it('still renders the plot-level "เปิด Trace" action (a real, non-retired feature)', () => {
    mount();
    const traceLink = Array.from(container!.querySelectorAll('a')).find(
      (a) => a.textContent === 'เปิด Trace',
    );
    expect(traceLink).toBeDefined();
    expect(traceLink!.getAttribute('href')).toBe('https://example.test/trace/plot-cycle/QR123');
  });

  it('still renders the plot QR display action', () => {
    mount();
    expect(container!.textContent).toContain('แสดง QR');
  });
});
