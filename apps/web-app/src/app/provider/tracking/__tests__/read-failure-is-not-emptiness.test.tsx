/**
 * การอ่านที่ล้ม ต้องไม่ถูกวาดเป็น "ไม่มีข้อมูล"
 *
 * จอของพนักงานติดตามตอบคำถามว่า "ประเทศนี้มีรอบปลูกอะไรอยู่บ้าง" ตารางว่างคือคำตอบ
 * ว่า *ไม่มี* ซึ่งเป็นคนละเรื่องกับ *ยังไม่รู้* · การเอาสองอย่างนี้มาวาดเหมือนกัน คือการ
 * รายงานเท็จให้เจ้าหน้าที่ที่กำลังจะตัดสินใจจากมัน
 *
 * เทสนี้จึงยืนยันสองอย่างพร้อมกันในทุกการอ่านของทั้งสองจอ:
 *   1. เมื่ออ่านล้ม ต้องมีข้อความบอกว่าอ่านไม่สำเร็จ
 *   2. ต้องไม่มีข้อความ "ไม่พบ/ยังไม่มี" ของสถานะว่างจริงโผล่มาพร้อมกัน
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

const CYCLE_DETAIL = {
  id: 'cycle-1',
  cycleName: 'รอบที่ 1/2569',
  status: 'GROWING',
  startDate: '2026-01-05',
  expectedHarvestDate: '2026-05-05',
  farm: { id: 'farm-1', farmName: 'ฟาร์มทดสอบ', district: 'เมือง', province: 'เชียงใหม่' },
  cyclePlots: [],
  plantSpecies: { id: 'sp-1', code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis' },
  _count: { cultivationLogs: 0, batches: 0, lots: 0 },
};

const READ_FAILED = { success: false, error: 'ระบบปลายทางไม่ตอบสนอง' };

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

/** เปิดแท็บของ Radix ด้วย mousedown ปุ่มซ้าย ซึ่งเป็นสิ่งที่ trigger ฟังจริง */
async function openTab(label: string) {
  const trigger = Array.from(container!.querySelectorAll('[role="tab"]')).find(
    (node) => (node.textContent || '').includes(label),
  );
  expect(trigger).toBeTruthy();
  await act(async () => {
    trigger!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('จอติดตามการปลูก: อ่านไม่สำเร็จ ไม่ใช่ไม่มีข้อมูล', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('จอรายการ: เมื่ออ่านล้ม บอกว่าอ่านไม่สำเร็จ และไม่วาดตารางว่างให้อ่านว่าไม่มีฟาร์ม', async () => {
    mockApiGet.mockResolvedValue(READ_FAILED);
    await mount(TrackingListView);

    const errorBox = container!.querySelector('[data-testid="tracking-read-error"]');
    expect(errorBox).toBeTruthy();
    expect(errorBox!.textContent || '').toContain('ระบบปลายทางไม่ตอบสนอง');

    const text = container!.textContent || '';
    expect(text).not.toContain('ไม่พบรอบการปลูกที่ตรงกับเงื่อนไข');
    // ไม่มีตารางเลย เพราะตารางที่ไม่มีแถวคือคำกล่าวว่า "ค้นแล้วไม่เจอ"
    expect(container!.querySelector('table')).toBeNull();
  });

  it('จอรายการ: มีปุ่มให้ลองใหม่ ไม่ใช่ทางตัน', async () => {
    mockApiGet.mockResolvedValue(READ_FAILED);
    await mount(TrackingListView);
    const errorBox = container!.querySelector('[data-testid="tracking-read-error"]');
    expect(errorBox!.textContent || '').toContain('ลองอีกครั้ง');
  });

  it('จอรายละเอียด: เมื่ออ่านรอบปลูกล้ม บอกว่าอ่านไม่สำเร็จ และไม่วาดแท็บว่าง', async () => {
    mockApiGet.mockResolvedValue(READ_FAILED);
    await mount(TrackingDetailView);

    expect(container!.querySelector('[data-testid="tracking-detail-read-error"]')).toBeTruthy();
    expect(container!.querySelectorAll('[role="tab"]').length).toBe(0);
    const text = container!.textContent || '';
    expect(text).not.toContain('รอบปลูกนี้ยังไม่มีแปลงที่จัดสรรไว้');
  });

  it('จอรายละเอียด: QR ประจำแปลงอ่านล้ม ต้องไม่กลายเป็น "ยังไม่มีแปลงที่ออก QR"', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/plot-qrs')) {
        return Promise.resolve(READ_FAILED);
      }
      if (url.includes('/activities')) {
        return Promise.resolve({ success: true, data: [] });
      }
      return Promise.resolve({ success: true, data: CYCLE_DETAIL });
    });
    await mount(TrackingDetailView);
    await openTab('QR ประจำแปลง');

    expect(container!.querySelector('[data-testid="tracking-plot-qrs-read-error"]')).toBeTruthy();
    expect(container!.textContent || '').not.toContain('รอบปลูกนี้ยังไม่มีแปลงที่ออก QR ไว้');
  });

  it('จอรายละเอียด: บันทึกกิจกรรมอ่านล้ม ต้องไม่กลายเป็น "ไม่พบบันทึกกิจกรรม"', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/activities')) {
        return Promise.resolve(READ_FAILED);
      }
      if (url.includes('/plot-qrs')) {
        return Promise.resolve({ success: true, data: [] });
      }
      return Promise.resolve({ success: true, data: CYCLE_DETAIL });
    });
    await mount(TrackingDetailView);
    await openTab('บันทึกกิจกรรม');

    expect(container!.querySelector('[data-testid="tracking-activities-read-error"]')).toBeTruthy();
    expect(container!.textContent || '').not.toContain('ไม่พบบันทึกกิจกรรมที่ตรงกับตัวกรองที่เลือก');
  });

  it('อ่านสำเร็จแล้วว่างจริง ยังต้องพูดว่าว่าง ไม่ใช่เงียบ (สถานะที่สามมีอยู่จริง)', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('planting-cycles/cycle-1')) {
        return Promise.resolve({ success: true, data: CYCLE_DETAIL });
      }
      return Promise.resolve({
        success: true,
        data: [],
        meta: { pagination: { page: 1, limit: 25, total: 0, totalPages: 1 } },
      });
    });
    await mount(TrackingListView);

    expect(container!.querySelector('[data-testid="tracking-read-error"]')).toBeNull();
    expect(container!.textContent || '').toContain('ไม่พบรอบการปลูกที่ตรงกับเงื่อนไข');
  });
});
