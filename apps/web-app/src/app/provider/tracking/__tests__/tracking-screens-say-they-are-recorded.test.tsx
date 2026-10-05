/**
 * PDPA ม.39 ข้อ 3 — จอของพนักงานติดตามต้องบอกว่ากำลังถูกบันทึก
 *
 * มติ 2026-09-05 (docs/design/2026-09-05-tnt-loop-and-farmer-updates.md §3.3) มีสามข้อ
 * ที่ยังบังคับอยู่แม้ขอบเขตจะเปิดกว้าง · สองข้อแรกอยู่หลังบ้านแล้ว
 * (services/farm-access-audit.js ติดที่ router ของ /api/provider/planting-cycles)
 * ข้อสามคือจอนี้: *"หน้าจอต้องบอกพนักงานว่ากำลังถูกบันทึก ไม่ใช่เพื่อขู่"*
 *
 * เทสนี้เรนเดอร์หน้าจริงทั้งสองหน้า ไม่ได้ grep หา import — หน้าที่ import ไว้แล้ว
 * แต่ไม่ได้วางไว้ในผลลัพธ์ ยังผ่าน grep ได้สบาย
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
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
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/provider/tracking',
  useSearchParams: () => new URLSearchParams(),
}));

// ProviderLayout ลาก auth/role plumbing เข้ามาทั้งชุด · จอที่ทดสอบคือ children
jest.mock('../../components/provider-layout', () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Passthrough.displayName = 'MockProviderLayout';
  return { __esModule: true, default: Passthrough };
});

import TrackingListView from '../client-view';
import TrackingDetailView from '../[id]/client-view';

const CYCLE_ROW = {
  id: 'cycle-1',
  cycleName: 'รอบที่ 1/2569',
  status: 'GROWING',
  startDate: '2026-01-05',
  expectedHarvestDate: '2026-05-05',
  farm: { id: 'farm-1', farmName: 'ฟาร์มทดสอบ', district: 'เมือง', province: 'เชียงใหม่' },
  plotCount: 2,
  cultivationMethods: ['OUTDOOR'],
  totalAreaSqm: 800,
  counts: { activities: 4, batches: 1, lots: 2 },
};

const CYCLE_DETAIL = {
  ...CYCLE_ROW,
  cyclePlots: [],
  plantSpecies: { id: 'sp-1', code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis' },
  _count: { cultivationLogs: 4, batches: 1, lots: 2 },
};

describe('จอติดตามการปลูกบอกพนักงานว่าการเปิดดูถูกบันทึก (PDPA ม.39)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/plot-qrs')) {
        return Promise.resolve({ success: true, data: [] });
      }
      if (url.includes('/activities')) {
        return Promise.resolve({ success: true, data: [], meta: { pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } } });
      }
      if (url.includes('planting-cycles/cycle-1')) {
        return Promise.resolve({ success: true, data: CYCLE_DETAIL });
      }
      return Promise.resolve({
        success: true,
        data: [CYCLE_ROW],
        meta: { pagination: { page: 1, limit: 25, total: 1, totalPages: 1 } },
      });
    });
  });

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

  async function mount(Page: React.ComponentType) {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(<Page />);
    });
    for (let i = 0; i < 10; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  it.each([
    ['รายการ', TrackingListView],
    ['รายละเอียด', TrackingDetailView],
  ])('จอ%s บอกว่าการเข้าดูข้อมูลฟาร์มถูกบันทึกไว้', async (_name, Page) => {
    await mount(Page as React.ComponentType);
    const notice = container!.querySelector('[data-testid="farm-access-notice"]');
    expect(notice).toBeTruthy();
    const text = notice!.textContent || '';
    expect(text).toContain('บันทึก');
    expect(text).toMatch(/การเข้าดู|การเปิดดู/);
  });

  it.each([
    ['รายการ', TrackingListView],
    ['รายละเอียด', TrackingDetailView],
  ])('จอ%s อ้างกฎหมายที่สั่งให้บันทึก ประโยคจึงเป็นข้อเท็จจริงไม่ใช่คำขู่', async (_name, Page) => {
    await mount(Page as React.ComponentType);
    const notice = container!.querySelector('[data-testid="farm-access-notice"]');
    expect(notice!.textContent || '').toContain('PDPA');
    expect(notice!.textContent || '').toContain('39');
  });

  it.each([
    ['รายการ', TrackingListView],
    ['รายละเอียด', TrackingDetailView],
  ])('จอ%s วางป้ายนี้เป็นข้อความประจำ ไม่ใช่กล่องเตือนสีแดง', async (_name, Page) => {
    await mount(Page as React.ComponentType);
    const notice = container!.querySelector('[data-testid="farm-access-notice"]');
    expect(notice!.className).not.toMatch(/red|danger|destructive|warning/i);
  });

  it('จอรายการประกาศขอบเขตตามมติ: ทุกฟาร์มทั่วประเทศ ไม่ผูกกับการมอบหมายงาน', async () => {
    await mount(TrackingListView);
    const scope = container!.querySelector('[data-testid="tracking-scope-note"]');
    expect(scope).toBeTruthy();
    expect(scope!.textContent || '').toContain('ทั่วประเทศ');
    expect(scope!.textContent || '').toContain('ไม่จำกัดเฉพาะงานที่คุณได้รับมอบหมาย');
  });
});
