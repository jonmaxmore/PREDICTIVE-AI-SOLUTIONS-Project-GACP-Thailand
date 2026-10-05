/**
 * T5, จอ — พนักงานต้องรู้ว่ากำลังถูกบันทึก
 *
 * ครึ่งหลังบ้านของ T5 บันทึกทุกครั้งที่มีข้อมูลฟาร์มออกไป (services/farm-access-audit.js)
 * ครึ่งนี้บอกคนที่กำลังดู · ไม่ใช่เพื่อขู่ — การเปิดดูโดยรู้ตัวว่าถูกบันทึกกับโดยไม่รู้ตัว
 * เป็นการกระทำคนละอย่างกันในทางวินัย และในทาง PDPA ความโปร่งใสกับเจ้าหน้าที่เองก็เป็น
 * ส่วนหนึ่งของมาตรการตาม ม.37(1) ไม่ใช่ของแถม
 *
 * เทสนี้เรนเดอร์หน้าจริงทั้งสองหน้า ไม่ได้ grep หา import — หน้าที่ import ไว้แล้ว
 * แต่ไม่ได้วางไว้ในผลลัพธ์ ยังผ่าน grep ได้สบาย
 */
import * as React from 'react';
import { describe, expect, it, afterEach, jest, beforeEach } from '@jest/globals';
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
// The list screen's DataTable reads router/pathname/searchParams for its URL
// state; a mock with only useParams crashes there and reads like a missing notice.
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'cycle-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/planting',
  useSearchParams: () => new URLSearchParams(),
}));

import AdminPlantingListPage from '../page';
import AdminPlantingDetailPage from '../[id]/page';

const CYCLE = {
  id: 'cycle-1',
  cycleName: 'รอบทดสอบ',
  status: 'GROWING',
  startDate: '2026-01-01',
  expectedHarvestDate: '2026-06-01',
  farm: { id: 'farm-1', farmName: 'ฟาร์มทดสอบ', ownerId: 'owner-1' },
  plotCount: 1,
  cultivationMethods: ['OUTDOOR'],
  totalAreaSqm: 100,
  _count: { batches: 3, cultivationLogs: 8 },
  counts: { batches: 3, activities: 8 },
};

describe('the staff planting screens say the viewing is recorded', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/plot-qrs')) { return Promise.resolve({ success: true, data: [] }); }
      if (url.includes('cycle-1')) { return Promise.resolve({ success: true, data: CYCLE }); }
      return Promise.resolve({ success: true, data: { items: [CYCLE], total: 1 } });
    });
  });

  afterEach(() => {
    if (root) { act(() => { root?.unmount(); }); root = null; }
    if (container) { container.remove(); container = null; }
  });

  async function mount(Page: React.ComponentType) {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(<Page />);
    });
    await act(async () => { await Promise.resolve(); });
  }

  it.each([
    ['list', AdminPlantingListPage],
    ['detail', AdminPlantingDetailPage],
  ])('the %s screen tells the officer their viewing is being recorded', async (_name, Page) => {
    await mount(Page as React.ComponentType);
    const text = container!.textContent || '';
    expect(text).toContain('บันทึก');
    expect(text).toMatch(/การเข้าดู|การเปิดดู/);
  });

  it('names the law, so the sentence is a fact and not a threat', async () => {
    await mount(AdminPlantingListPage as React.ComponentType);
    expect(container!.textContent || '').toContain('PDPA');
  });

  it('does not shout — it is a standing notice, not an error', async () => {
    await mount(AdminPlantingListPage as React.ComponentType);
    const notice = container!.querySelector('[data-testid="farm-access-notice"]');
    expect(notice).toBeTruthy();
    expect(notice!.className).not.toMatch(/red|danger|destructive/i);
  });
});
