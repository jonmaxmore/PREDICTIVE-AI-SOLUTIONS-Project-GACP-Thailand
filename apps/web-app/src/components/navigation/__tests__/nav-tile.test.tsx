/**
 * NavTile — tile launcher card (N1, N5-N7).
 *
 * Repo convention note: this suite was adapted from the task brief's RTL
 * (`@testing-library/react`) starter code to the repo's actual test
 * pattern (`react-dom/client` createRoot + act, manual DOM queries) —
 * `@testing-library/react` is not a dependency anywhere in this monorepo
 * (only `@testing-library/jest-dom` matchers are installed), and every
 * existing client-view test (dashboard-fetch-error.test.tsx,
 * certificates-error-state.test.tsx) uses createRoot + act. Adding a new
 * test-only dependency for one component would be an unrequested
 * lockfile change, so this mirrors the established pattern instead.
 *
 * Three states asserted:
 *   1. Normal tile is a real <a> link to item.path.
 *   2. Chip pill renders when chipText is set, and is entirely absent
 *      (not "0 รายการ") when chipText is null.
 *   3. Locked tile (ACTIVE_CERT_REQUIRED) renders NO <a> — it must not
 *      be clickable — and shows the lock reason from nav-config verbatim.
 *   4. The `unpaid` chip source (payments tile) uses a warning tone,
 *      distinct from the default leaf tone.
 */
import * as React from 'react';
import { describe, expect, it, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NavTile } from '../nav-tile';
import { FARMER_NAV } from '@/lib/navigation/nav-config';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const status = FARMER_NAV.find(i => i.key === 'status')!;
const planting = FARMER_NAV.find(i => i.key === 'planting')!;
const payments = FARMER_NAV.find(i => i.key === 'payments')!;

describe('NavTile', () => {
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

  function mount(ui: React.ReactElement): HTMLDivElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(ui);
    });
    return container;
  }

  it('การ์ดปกติเป็นลิงก์ไป path ของเมนู', () => {
    const el = mount(<NavTile item={status} chipText={null} locked={false} />);
    const link = el.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', '/health/status');
    expect(link!.textContent).toContain('ตรวจสอบสถานะ');
  });

  it('chip แสดงเมื่อมีข้อความ และไม่ render เมื่อ null (ห้ามโชว์ 0 รายการ)', () => {
    const el = mount(<NavTile item={status} chipText="2 รายการรอคุณดำเนินการ" locked={false} />);
    expect(el.textContent).toContain('2 รายการรอคุณดำเนินการ');

    act(() => {
      root!.render(<NavTile item={status} chipText={null} locked={false} />);
    });
    expect(el.textContent).not.toContain('รายการรอคุณ');
  });

  it('การ์ดล็อกไม่เป็นลิงก์ และบอกเหตุผล', () => {
    const el = mount(<NavTile item={planting} chipText={null} locked={true} />);
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('เปิดใช้เมื่อคุณได้รับใบรับรอง GACP');
  });

  it('chip ของ payments (chipSource unpaid) ใช้โทนเตือน ไม่ใช่โทนปกติ', () => {
    const el = mount(<NavTile item={payments} chipText="มียอดค้างชำระ 1 รายการ" locked={false} />);
    const chipEls = Array.from(el.querySelectorAll('span')).filter(
      (s) => s.textContent === 'มียอดค้างชำระ 1 รายการ',
    );
    expect(chipEls.length).toBe(1);
    expect(chipEls[0].className).toContain('amber');
  });
  it('การ์ดยืดเต็มช่อง grid (h-full) ทั้งแบบลิงก์และแบบล็อก เพื่อให้แถวเดียวกันสูงเท่ากัน', () => {
    const el = mount(<NavTile item={status} chipText={null} locked={false} />);
    const linkedCard = el.querySelector('a > div');
    expect(linkedCard).not.toBeNull();
    expect(linkedCard!.className).toContain('h-full');
    expect(el.querySelector('a')!.className).toContain('h-full');

    act(() => {
      root!.render(<NavTile item={planting} chipText={null} locked={true} />);
    });
    const lockedCard = el.querySelector('[aria-disabled="true"]');
    expect(lockedCard).not.toBeNull();
    expect(lockedCard!.className).toContain('h-full');
  });
});
