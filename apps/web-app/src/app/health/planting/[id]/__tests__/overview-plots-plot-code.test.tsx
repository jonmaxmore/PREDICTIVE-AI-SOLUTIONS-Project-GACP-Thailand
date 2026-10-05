/**
 * The plot code has to leave the database and reach a post in a field.
 *
 * มกษ. 3502-2561 ข้อ 8(1) requires a recorded "รหัสแปลงปลูก". Layer 1 minted it
 * (apps/backend/shared/plot-code.js) and put it on Plot.plotCode, but a code the
 * farmer cannot see is a column, not a sign. The plots tab is where plots are
 * managed, so it is where the code has to appear — on the desktop table AND on
 * the mobile card, because the farmer holding the phone in the field is the
 * person who reads it out when the QR stops scanning.
 *
 * Three things are pinned here:
 *   1. the permanent code is rendered (not the per-cycle QR string, which is
 *      reborn every season and must never be printed on a permanent sign);
 *   2. a print affordance exists and points at the sign sheet;
 *   3. a revoked sign says so, and its reprint carries the SAME code — minting
 *      a new one would orphan every harvest, lot and package already recorded
 *      against the old one.
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

const LIVE_CODE = 'PLOT-7F2KX-M9QRT';
const REVOKED_CODE = 'PLOT-3B8HN-VWZ42';

const baseProps = {
  cycleId: 'cycle-1',
  cycle: {
    cultivationMethods: ['OUTDOOR'],
    certificate: { certificateNumber: 'GACP-TH-2569-000001' },
    startDate: '2026-01-01',
    expectedHarvestDate: '2026-06-01',
    seedSource: null,
    notes: null,
    plots: [
      { cyclePlotId: 'plot-1', name: 'แปลง A', solarSystem: 'OUTDOOR', allocatedAreaSqm: 100 },
      { cyclePlotId: 'plot-2', name: 'แปลง B', solarSystem: 'OUTDOOR', allocatedAreaSqm: 200 },
    ],
  },
  hasActiveCertificate: true,
  harvestBlockers: [],
  submittingPlotQr: false,
  handleGeneratePlotQrs: jest.fn(),
  perPlotProgress: [
    { cyclePlotId: 'plot-1', plotName: 'แปลง A', plannedPlantCount: 100 },
    { cyclePlotId: 'plot-2', plotName: 'แปลง B', plannedPlantCount: 50 },
  ],
  // The API row the plots tab already consumes, plus the three permanent-code
  // fields Layer 1 added to Plot. See the report: GET /planting-cycles/:id/plot-qrs
  // does not return plotCode / qrIssuedAt / qrRevokedAt yet, so they are stubbed
  // here exactly as the UI expects to read them.
  plotQrByCyclePlotId: new Map([
    ['plot-1', {
      qrCode: 'QR123',
      trackingUrl: 'https://example.test/trace/plot-cycle/QR123',
      plotCode: LIVE_CODE,
      qrIssuedAt: '2026-02-01T00:00:00.000Z',
      qrRevokedAt: null,
    }],
    ['plot-2', {
      qrCode: 'QR456',
      trackingUrl: 'https://example.test/trace/plot-cycle/QR456',
      plotCode: REVOKED_CODE,
      qrIssuedAt: '2026-02-01T00:00:00.000Z',
      qrRevokedAt: '2026-05-04T00:00:00.000Z',
    }],
  ]),
  openQrPreview: jest.fn(),
};

describe('overview-plots tab — permanent plot code and its print affordance', () => {
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

  function mount(props: Record<string, unknown> = baseProps) {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(
        <NotebookTabs value="plots">
          <PlantingCycleDetailTabsSectionAOverviewPlots {...props} />
        </NotebookTabs>,
      );
    });
  }

  function signLinks() {
    return Array.from(container!.querySelectorAll('a')).filter(
      (a) => (a.getAttribute('href') || '').includes('/plot-signs'),
    );
  }

  it('renders the permanent plot code on the desktop table and the mobile card', () => {
    mount();
    const codeNodes = Array.from(container!.querySelectorAll('[data-plot-code]'))
      .map((node) => node.getAttribute('data-plot-code'));
    // one desktop row + one mobile card for each of the two plots
    expect(codeNodes.filter((code) => code === LIVE_CODE)).toHaveLength(2);
    expect(container!.textContent).toContain(LIVE_CODE);
  });

  it('offers a print affordance per plot that targets that plot code', () => {
    mount();
    const perPlot = signLinks().filter((a) => (a.getAttribute('href') || '').includes(LIVE_CODE));
    expect(perPlot.length).toBeGreaterThan(0);
    expect(perPlot[0].getAttribute('href')).toBe(
      `/health/planting/cycle-1/plot-signs?code=${LIVE_CODE}`,
    );
  });

  it('offers one press that prints the signs for every plot in the cycle', () => {
    mount();
    const all = signLinks().find((a) => a.getAttribute('href') === '/health/planting/cycle-1/plot-signs');
    expect(all).toBeDefined();
    expect(all!.textContent).toContain('พิมพ์ป้ายทุกแปลง');
  });

  it('says a revoked sign is revoked, and its reprint keeps the same code', () => {
    mount();
    expect(container!.textContent).toContain('ป้ายถูกยกเลิก');
    const reprint = signLinks().filter((a) => (a.textContent || '').includes('พิมพ์ป้ายใหม่'));
    expect(reprint.length).toBeGreaterThan(0);
    // The reprint must reuse the revoked plot's own code, never mint a new one.
    reprint.forEach((a) => {
      expect(a.getAttribute('href')).toBe(`/health/planting/cycle-1/plot-signs?code=${REVOKED_CODE}`);
    });
  });

  it('tells the farmer plainly when a plot has no code yet instead of showing a blank cell', () => {
    mount({
      ...baseProps,
      plotQrByCyclePlotId: new Map([
        ['plot-1', { qrCode: null, trackingUrl: null }],
        ['plot-2', { qrCode: null, trackingUrl: null }],
      ]),
    });
    expect(container!.textContent).toContain('ยังไม่มีรหัสแปลง');
    expect(signLinks().filter((a) => (a.getAttribute('href') || '').includes('code='))).toHaveLength(0);
  });
});
