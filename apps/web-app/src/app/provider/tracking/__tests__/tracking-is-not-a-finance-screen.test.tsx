/**
 * "ติดตาม" ไม่รวมเรื่องเงิน และไม่มีตัวกรองการมอบหมายงาน
 *
 * มติ operator 2026-09-05 (docs/design/2026-09-05-tnt-loop-and-farmer-updates.md §3.3
 * และ design note 2026-09-05-tnt-data-scope §3) วางไว้สองบรรทัดในตาราง
 * เดียวกัน:
 *   - ฟาร์มทุกแห่งทั้งประเทศ ✅ เต็ม — *ไม่ผูกกับการมอบหมายงาน*
 *   - ข้อมูลการเงิน/ใบแจ้งหนี้ ❌ — *คนละหน้าที่ ไม่ได้อยู่ในคำว่า "ติดตาม"*
 *
 * เทสนี้ป้อน payload ที่ *มี* ฟิลด์การเงินปนมาโดยตั้งใจ เพราะการพิสูจน์ว่าจอไม่แสดงเงิน
 * ด้วย payload ที่ไม่มีเงินอยู่แล้ว ไม่ได้พิสูจน์อะไรเลย
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

jest.mock('../../components/provider-layout', () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Passthrough.displayName = 'MockProviderLayout';
  return { __esModule: true, default: Passthrough };
});

import TrackingListView from '../client-view';
import TrackingDetailView from '../[id]/client-view';

/** ค่าที่ต้องไม่โผล่บนจอ ตั้งให้จำเพาะจนบังเอิญตรงไม่ได้ */
const MONEY_POISON = {
  invoiceNumber: 'INV-9911-เลขใบแจ้งหนี้',
  quotationNumber: 'QT-9911-เลขใบเสนอราคา',
  receiptNumber: 'RC-9911-เลขใบเสร็จ',
  totalAmount: 987654.21,
  feeAmount: 123456.78,
  vatAmount: 654321.09,
  outstandingBalance: 555555.55,
  paymentStatus: 'UNPAID-สถานะชำระเงิน',
};

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
  ...MONEY_POISON,
};

const CYCLE_DETAIL = {
  ...CYCLE_ROW,
  cyclePlots: [
    {
      id: 'cp-1',
      plotId: 'plot-1',
      allocatedAreaSqm: 400,
      plannedPlantCount: 120,
      plot: { id: 'plot-1', name: 'แปลง A', solarSystem: 'OUTDOOR' },
    },
  ],
  plantSpecies: { id: 'sp-1', code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis' },
  _count: { cultivationLogs: 4, batches: 1, lots: 2 },
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

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

describe('จอติดตามการปลูกไม่ใช่จอการเงิน และไม่กรองด้วยการมอบหมายงาน', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/plot-qrs')) {
        return Promise.resolve({ success: true, data: [] });
      }
      if (url.includes('/activities')) {
        return Promise.resolve({ success: true, data: [] });
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

  it.each([
    ['รายการ', TrackingListView],
    ['รายละเอียด', TrackingDetailView],
  ])('จอ%s ไม่แสดงเลขเอกสารการเงินหรือจำนวนเงินใด แม้ payload จะมีปนมา', async (_name, Page) => {
    await mount(Page as React.ComponentType);
    const text = container!.textContent || '';

    for (const value of Object.values(MONEY_POISON)) {
      expect(text).not.toContain(String(value));
    }
    // จำนวนเงินที่ผ่านตัวจัดรูปแบบไทยแล้วก็ต้องไม่โผล่เช่นกัน
    expect(text).not.toContain((987654.21).toLocaleString('th-TH'));
    expect(text).not.toContain((123456.78).toLocaleString('th-TH'));
  });

  it.each([
    ['รายการ', TrackingListView],
    ['รายละเอียด', TrackingDetailView],
  ])('จอ%s ไม่พูดคำในหมวดการเงินเลย', async (_name, Page) => {
    await mount(Page as React.ComponentType);
    const text = container!.textContent || '';
    for (const word of ['ใบแจ้งหนี้', 'ใบเสนอราคา', 'ใบเสร็จ', 'ค่าธรรมเนียม', 'ชำระเงิน', 'ยอดค้าง', 'ภาษี']) {
      expect(text).not.toContain(word);
    }
  });

  it.each([
    ['รายการ', TrackingListView],
    ['รายละเอียด', TrackingDetailView],
  ])('จอ%s ไม่มีลิงก์ไปหน้าการเงิน เพราะลิงก์คือการบอกว่ามันเป็นส่วนหนึ่งของงานนี้', async (_name, Page) => {
    await mount(Page as React.ComponentType);
    const hrefs = Array.from(container!.querySelectorAll('a')).map((node) => node.getAttribute('href') || '');
    for (const href of hrefs) {
      expect(href).not.toContain('/provider/accounting');
      expect(href).not.toContain('/provider/receipts');
      expect(href).not.toContain('invoice');
      expect(href).not.toContain('payment');
    }
  });

  it('จอรายการไม่ส่งตัวกรอง "งานที่ได้รับมอบหมาย" ไปที่ประตูหลังบ้าน', async () => {
    await mount(TrackingListView);
    const urls = mockApiGet.mock.calls.map((call) => String(call[0]));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).not.toMatch(/assign|mine|myFarms|assignedTo|onlyMine/i);
    }
  });

  it('จอรายการไม่มีปุ่มกรองที่ตัดฟาร์มออกด้วยเงื่อนไขผู้รับผิดชอบ', async () => {
    await mount(TrackingListView);
    const chips = Array.from(container!.querySelectorAll('[data-testid^="tracking-status-chip-"]')).map(
      (node) => node.getAttribute('data-testid') || '',
    );
    expect(chips.length).toBeGreaterThan(1);
    // ทุกชิปเป็นสถานะรอบปลูก ไม่มีชิปใดพูดถึงผู้รับผิดชอบ
    for (const chip of chips) {
      expect(chip).not.toMatch(/assign|mine/i);
    }
    const text = container!.textContent || '';
    expect(text).not.toContain('เฉพาะงานของฉัน');
    expect(text).not.toContain('ที่ได้รับมอบหมายเท่านั้น');
  });
});
