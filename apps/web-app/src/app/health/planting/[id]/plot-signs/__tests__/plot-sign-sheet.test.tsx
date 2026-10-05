/**
 * The printable sign itself.
 *
 * This is the artifact that gets stapled to a post and rained on. It has to
 * survive an ordinary printer on ordinary paper, so the test pins the things
 * that make that true rather than how it looks: one page per plot, the QR as an
 * image with a real quiet zone, and the code in human-readable characters
 * underneath — because when the QR stops scanning, the code is what gets read
 * down a phone.
 *
 * The revoked case is pinned hardest. A reprint MUST carry the same code; a new
 * one would orphan every harvest, lot and package already recorded against the
 * plot, and the chain package -> lot -> harvest -> cycle -> plot -> certificate
 * would break at the last link.
 */
import * as React from 'react';
import { describe, expect, it, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PlotSignSheet } from '../plot-sign-sheet';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CODE_A = 'PLOT-7F2KX-M9QRT';
const CODE_B = 'PLOT-3B8HN-VWZ42';
const QR_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

const signs = [
  {
    plotCode: CODE_A,
    plotName: 'แปลง A',
    farmName: 'ฟาร์มสมุนไพรบ้านหนองบัว',
    qrDataUrl: QR_DATA_URL,
    revokedAt: null,
  },
  {
    plotCode: CODE_B,
    plotName: 'แปลง B',
    farmName: 'ฟาร์มสมุนไพรบ้านหนองบัว',
    qrDataUrl: QR_DATA_URL,
    revokedAt: '2026-05-04T00:00:00.000Z',
  },
];

describe('PlotSignSheet — the thing that gets printed and nailed to a post', () => {
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

  function mount(props: React.ComponentProps<typeof PlotSignSheet>) {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(<PlotSignSheet {...props} />);
    });
  }

  it('prints one sign per plot, each on its own page', () => {
    mount({ signs });
    const pages = container!.querySelectorAll('[data-plot-sign]');
    expect(pages).toHaveLength(2);
    pages.forEach((page) => {
      expect(page.className).toContain('break-after-page');
    });
  });

  it('carries the QR, the plot name, the farm name and the code in readable characters', () => {
    mount({ signs: [signs[0]] });
    const image = container!.querySelector('img');
    expect(image).not.toBeNull();
    expect(image!.getAttribute('src')).toBe(QR_DATA_URL);
    expect(image!.getAttribute('alt')).toContain(CODE_A);

    const printed = container!.querySelector('[data-sign-code]');
    expect(printed).not.toBeNull();
    expect(printed!.textContent).toBe(CODE_A);

    expect(container!.textContent).toContain('แปลง A');
    expect(container!.textContent).toContain('ฟาร์มสมุนไพรบ้านหนองบัว');
  });

  it('keeps the code readable when the QR image could not be built', () => {
    mount({ signs: [{ ...signs[0], qrDataUrl: null }] });
    expect(container!.querySelector('img')).toBeNull();
    expect(container!.querySelector('[data-sign-code]')!.textContent).toBe(CODE_A);
    expect(container!.textContent).toContain('สร้างภาพ QR ไม่สำเร็จ');
  });

  it('marks a reprint as a reprint and reuses the same code', () => {
    mount({ signs: [signs[1]] });
    expect(container!.textContent).toContain('พิมพ์ใหม่แทนป้ายเดิม');
    const printed = container!.querySelector('[data-sign-code]');
    expect(printed!.textContent).toBe(CODE_B);
  });
});
