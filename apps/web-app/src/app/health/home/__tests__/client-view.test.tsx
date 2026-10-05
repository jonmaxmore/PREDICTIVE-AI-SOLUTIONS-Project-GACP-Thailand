/**
 * /health/home — tile launcher composition (N1, N5-N7).
 *
 * Asserts the wiring that nav-tile.test.tsx can't cover on its own:
 *   1. The 'home' item (tier: 'system') never renders as a tile — it must
 *      not point at itself.
 *   2. Primary items render as the 2-col tile grid; secondary items render
 *      in the "เมนูเพิ่มเติม" row.
 *   3. Chips: pendingActions/unpaid text is derived from /api/applications/my
 *      (same endpoint the existing dashboard already calls) and a zero
 *      count hides the chip.
 *   4. Planting lock is presentation-only and resolves from
 *      /api/certificates/my: unlocked (a real link) before the fetch
 *      resolves and while there IS an active cert; locked (no <a>, shows
 *      the reason) only once the fetch resolves with no active cert.
 *
 * Follows the repo's real test pattern (createRoot + act, manual DOM
 * queries) — see dashboard-fetch-error.test.tsx / certificates-error-
 * state.test.tsx. `@testing-library/react` is not a dependency here.
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Route by URL so applications/my and certificates/my can be controlled
// independently per test.
const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
  apiClient: { get: (url: string) => mockApiGet(url) },
  api: { get: (url: string) => mockApiGet(url) },
}));

import HealthHomeClientView from '../client-view';

function pending(): Promise<unknown> {
  return new Promise(() => undefined);
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe('/health/home — tile launcher composition', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

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

  function mount() {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(<HealthHomeClientView />);
    });
  }

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it('ไม่มีการ์ด "หน้าหลัก" ชี้กลับมาที่ตัวเอง และแสดงหัวข้อคำถาม', () => {
    mockApiGet.mockImplementation(() => pending());
    mount();
    expect(container!.textContent).toContain('คุณต้องการทำอะไรวันนี้');
    // 'home' (tier: system) must never render as a tile.
    const homeLink = Array.from(container!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/health/home',
    );
    expect(homeLink).toBeUndefined();
  });

  it('primary item ทุกตัวมีลิงก์ในกริด และ secondary item อยู่ใต้หัว "เมนูเพิ่มเติม"', () => {
    mockApiGet.mockImplementation(() => pending());
    mount();
    const hrefs = Array.from(container!.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    for (const path of [
      '/health/applications/new',
      '/health/status',
      '/health/payments',
      '/health/certificates',
      '/health/planting',
      '/help',
    ]) {
      expect(hrefs).toContain(path);
    }
    expect(container!.textContent).toContain('เมนูเพิ่มเติม');
    for (const path of ['/health/workspaces', '/health/surveys', '/health/herbs']) {
      expect(hrefs).toContain(path);
    }
  });

  it('chip นับจาก /api/applications/my: pendingActions + unpaid แสดงเมื่อ count > 0', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/applications/my') {
        return Promise.resolve({
          success: true,
          data: [
            { status: 'PENDING_DOC_FEE' },
            { status: 'REVISION_REQUESTED' },
            { status: 'CERTIFIED' }, // does not count toward either bucket
          ],
        });
      }
      return pending();
    });
    mount();
    await flush();
    // pendingActions = PENDING_DOC_FEE + REVISION_REQUESTED = 2
    expect(container!.textContent).toContain('2 รายการรอคุณดำเนินการ');
    // unpaid = PENDING_DOC_FEE = 1
    expect(container!.textContent).toContain('มียอดค้างชำระ 1 รายการ');
  });

  it('chip ไม่แสดงเมื่อ count เป็น 0 (ห้ามโชว์ "0 รายการ")', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/applications/my') {
        return Promise.resolve({ success: true, data: [{ status: 'CERTIFIED' }] });
      }
      return pending();
    });
    mount();
    await flush();
    expect(container!.textContent).not.toContain('รายการรอคุณดำเนินการ');
    expect(container!.textContent).not.toContain('มียอดค้างชำระ');
  });

  it('การ์ดปลูก ไม่ล็อกก่อนข้อมูลใบรับรองมาถึง (unlocked-looking, ยังไม่ทราบ)', () => {
    mockApiGet.mockImplementation(() => pending());
    mount();
    const plantingLink = Array.from(container!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/health/planting',
    );
    expect(plantingLink).not.toBeUndefined();
  });

  it('การ์ดปลูก ล็อกเมื่อข้อมูลโหลดแล้วและไม่มีใบรับรอง active', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({ success: true, data: [{ status: 'expired' }] });
      }
      return pending();
    });
    mount();
    await flush();
    const plantingLink = Array.from(container!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/health/planting',
    );
    expect(plantingLink).toBeUndefined();
    expect(container!.textContent).toContain('เปิดใช้เมื่อคุณได้รับใบรับรอง GACP');
  });

  it('การ์ดปลูก ไม่ล็อกเมื่อมีใบรับรอง active จริง (case-insensitive, ยังไม่หมดอายุ)', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({
          success: true,
          data: [{ status: 'active', expiryDate: '2099-01-01T00:00:00.000Z' }],
        });
      }
      return pending();
    });
    mount();
    await flush();
    const plantingLink = Array.from(container!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/health/planting',
    );
    expect(plantingLink).not.toBeUndefined();
  });

  it('การ์ดปลูก ล็อก เมื่อ status ยังเป็น active แต่ expiryDate ผ่านไปแล้ว (หมดอายุตามธรรมชาติ — reviewer finding)', async () => {
    // Backend does NOT flip Certificate.status on natural expiry (see
    // certificates/cert-status.ts getCertBadgeKind comment) — a lapsed
    // cert can still carry status 'active' in the raw data. This tile's
    // lock check MUST reuse getCertBadgeKind (which factors in
    // expiryDate) instead of a bare status compare, or a farmer with a
    // naturally-lapsed cert would see planting unlocked while the
    // certificates page badge already reads "expired".
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({
          success: true,
          data: [{ status: 'active', expiryDate: '2020-01-01T00:00:00.000Z' }],
        });
      }
      return pending();
    });
    mount();
    await flush();
    const plantingLink = Array.from(container!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/health/planting',
    );
    expect(plantingLink).toBeUndefined();
    expect(container!.textContent).toContain('เปิดใช้เมื่อคุณได้รับใบรับรอง GACP');
  });

  it('การ์ดปลูก ไม่ล็อกเมื่อ certificates fetch ล้มเหลว (unknown ไม่ใช่ locked — F-2 fix)', async () => {
    // Final whole-branch review F-2: a fetch FAILURE used to set
    // certsLoaded:true with hasActiveCert:false — identical to "loaded,
    // confirmed no certificate". A certified farmer whose request 500s must
    // NOT see the locked dashed card with "เปิดใช้เมื่อคุณได้รับใบรับรอง GACP".
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.reject(new Error('network outage'));
      }
      return pending();
    });
    mount();
    await flush();
    const plantingLink = Array.from(container!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/health/planting',
    );
    expect(plantingLink).not.toBeUndefined();
    expect(container!.textContent).not.toContain('เปิดใช้เมื่อคุณได้รับใบรับรอง GACP');
  });

  it('การ์ดปลูก ไม่ล็อกเมื่อ certificates fetch คืน success:false (F-2 fix)', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({ success: false, error: 'down' });
      }
      return pending();
    });
    mount();
    await flush();
    const plantingLink = Array.from(container!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/health/planting',
    );
    expect(plantingLink).not.toBeUndefined();
    expect(container!.textContent).not.toContain('เปิดใช้เมื่อคุณได้รับใบรับรอง GACP');
  });

  it('การ์ดปลูก ไม่ล็อก เมื่อใบรับรองอยู่ในช่วงเตือนต่ออายุ (daysLeft < 90 แต่ยังใช้งานได้ — reviewer finding #2)', async () => {
    // getCertBadgeKind buckets a valid, still-usable cert with < 90 days
    // left as 'expiring' — a renewal REMINDER, distinct from 'expired'.
    // Gating the lock on `=== 'active'` (instead of `!== 'expired'`) would
    // falsely lock planting for every holder inside their 90-day renewal
    // window even though the cert is still perfectly valid.
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/certificates/my') {
        return Promise.resolve({
          success: true,
          data: [{ status: 'active', expiryDate: daysFromNow(45) }],
        });
      }
      return pending();
    });
    mount();
    await flush();
    const plantingLink = Array.from(container!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/health/planting',
    );
    expect(plantingLink).not.toBeUndefined();
    expect(container!.textContent).not.toContain('เปิดใช้เมื่อคุณได้รับใบรับรอง GACP');
  });
});
