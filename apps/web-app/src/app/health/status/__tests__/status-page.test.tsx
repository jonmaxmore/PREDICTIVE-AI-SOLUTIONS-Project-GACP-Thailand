/**
 * /health/status — single-page ตรวจสอบสถานะ (N8, tile-home-redesign task 6).
 *
 * Data source: `/applications/my` (same endpoint + apiClient shape as
 * apps/web-app/src/app/health/applications/client-view.tsx and
 * lib/navigation/use-nav-chips.ts). Follows the repo's real test pattern —
 * createRoot + act, manual DOM queries — matching
 * app/health/home/__tests__/client-view.test.tsx (no @testing-library/react
 * dependency here).
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
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

import StatusClientView from '../client-view';

function pending(): Promise<unknown> {
  return new Promise(() => undefined);
}

describe('/health/status — single-page ตรวจสอบสถานะ (N8)', () => {
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
      root.render(<StatusClientView />);
    });
  }

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it('renders the ตรวจสอบสถานะ heading (BackHomeCrumb moved to the shell — task 1, W10)', async () => {
    // BackHomeCrumb used to render directly in this component; it now
    // renders at the DashboardLayout shell level (every /health/* page
    // gets it, not just this one) — see
    // components/layout/__tests__/dashboard-layout-back-home-crumb.test.tsx
    // for that coverage. Mounting StatusClientView alone (no DashboardLayout
    // ancestor, same as every other test in this file) no longer renders a
    // /health/home link — this test only pins the page's own heading.
    mockApiGet.mockImplementation(() => pending());
    mount();
    expect(container!.textContent).toContain('ตรวจสอบสถานะ');
  });

  it('renders one card per application — number + plant name', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/applications/my') {
        return Promise.resolve({
          success: true,
          data: [
            { id: 'app-1', applicationNumber: 'GACP-0001', plantName: 'กัญชา', status: 'ASSIGNED_FOR_REVIEW' },
            { id: 'app-2', applicationNumber: 'GACP-0002', plantName: 'กระท่อม', status: 'CERTIFIED' },
          ],
        });
      }
      return pending();
    });
    mount();
    await flush();
    expect(container!.textContent).toContain('GACP-0001');
    expect(container!.textContent).toContain('กัญชา');
    expect(container!.textContent).toContain('GACP-0002');
    expect(container!.textContent).toContain('กระท่อม');
    // status sentence naming the actor
    expect(container!.textContent).toContain('เจ้าหน้าที่กำลังตรวจเอกสารของคุณ');
  });

  it('needsUserAction card sorts to top and shows a prominent action button', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/applications/my') {
        return Promise.resolve({
          success: true,
          data: [
            { id: 'app-ok', applicationNumber: 'GACP-0100', plantName: 'ขิง', status: 'CERTIFIED' },
            { id: 'app-action', applicationNumber: 'GACP-0200', plantName: 'ไพล', status: 'PENDING_AUDIT_FEE' },
          ],
        });
      }
      return pending();
    });
    mount();
    await flush();
    const cards = Array.from(container!.querySelectorAll('[data-testid="status-app-card"]'));
    expect(cards.length).toBe(2);
    // the needsUserAction card (PENDING_AUDIT_FEE) floats to the top
    expect(cards[0]!.textContent).toContain('GACP-0200');
    expect(cards[0]!.getAttribute('data-needs-action')).toBe('true');
    const actionButton = cards[0]!.querySelector('button, a[data-testid="status-action-btn"]');
    expect(actionButton).not.toBeNull();
    expect(cards[0]!.textContent).toContain('ชำระเงินตอนนี้');
    // the non-action card carries no warning marker
    expect(cards[1]!.getAttribute('data-needs-action')).toBe('false');
  });

  it('shows an inline 5-step progress bar reflecting the mapped step', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/applications/my') {
        return Promise.resolve({
          success: true,
          data: [{ id: 'app-1', applicationNumber: 'GACP-0300', plantName: 'ขมิ้นชัน', status: 'CAR_REVIEWING' }],
        });
      }
      return pending();
    });
    mount();
    await flush();
    const card = container!.querySelector('[data-testid="status-app-card"]');
    expect(card).not.toBeNull();
    const steps = card!.querySelectorAll('[data-testid="status-step-dot"]');
    expect(steps.length).toBe(5);
    // CAR_REVIEWING maps to step 4 — the 4th dot (index 3) carries the
    // "current" marker.
    expect(steps[3]!.getAttribute('data-current')).toBe('true');
  });

  it('card links to the existing detail page /health/applications/[id]', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/applications/my') {
        return Promise.resolve({
          success: true,
          data: [{ id: 'app-77', applicationNumber: 'GACP-0400', plantName: 'พลาย', status: 'DOC_APPROVED' }],
        });
      }
      return pending();
    });
    mount();
    await flush();
    const link = Array.from(container!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/health/applications/app-77',
    );
    expect(link).not.toBeUndefined();
  });

  it('empty state invites the applicant to apply, linking /health/applications/new', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/applications/my') {
        return Promise.resolve({ success: true, data: [] });
      }
      return pending();
    });
    mount();
    await flush();
    const link = Array.from(container!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/health/applications/new',
    );
    expect(link).not.toBeUndefined();
    expect(container!.querySelectorAll('[data-testid="status-app-card"]').length).toBe(0);
  });

  // Fix round 1 (coordinator ruling) — EXPIRED/CANCEL_EXPIRED have 4
  // possible origins landing at different steps; the status string alone
  // can't say which, so a terminal card must never claim an active step.
  it('terminal cards (EXPIRED, CANCEL_EXPIRED, REJECTED) show an ended badge and NO active-step marker', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/applications/my') {
        return Promise.resolve({
          success: true,
          data: [
            { id: 'app-exp', applicationNumber: 'GACP-0500', plantName: 'ขิง', status: 'EXPIRED' },
            { id: 'app-cxl', applicationNumber: 'GACP-0501', plantName: 'ขิง', status: 'CANCEL_EXPIRED' },
            { id: 'app-rej', applicationNumber: 'GACP-0502', plantName: 'ขิง', status: 'REJECTED' },
          ],
        });
      }
      return pending();
    });
    mount();
    await flush();
    const cards = Array.from(container!.querySelectorAll('[data-testid="status-app-card"]'));
    expect(cards.length).toBe(3);
    for (const card of cards) {
      // No dot on a terminal card is ever marked "current".
      const currentDots = card.querySelectorAll('[data-testid="status-step-dot"][data-current="true"]');
      expect(currentDots.length).toBe(0);
      // The ended badge is present.
      const badge = card.querySelector('[data-testid="status-terminal-badge"]');
      expect(badge).not.toBeNull();
    }
    expect(container!.textContent).toContain('คำขอหมดอายุ');
    expect(container!.textContent).toContain('คำขอไม่ผ่านการพิจารณา');
  });

  it('non-terminal needsUserAction card (PENDING_AUDIT_FEE) keeps its active-step marker and carries no ended badge', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/applications/my') {
        return Promise.resolve({
          success: true,
          data: [{ id: 'app-pay', applicationNumber: 'GACP-0600', plantName: 'พลาย', status: 'PENDING_AUDIT_FEE' }],
        });
      }
      return pending();
    });
    mount();
    await flush();
    const card = container!.querySelector('[data-testid="status-app-card"]');
    expect(card).not.toBeNull();
    const currentDots = card!.querySelectorAll('[data-testid="status-step-dot"][data-current="true"]');
    expect(currentDots.length).toBe(1);
    expect(card!.querySelector('[data-testid="status-terminal-badge"]')).toBeNull();
  });

  it('an unrecognized/garbage status falls back to a safe card that points the farmer at the detail page', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/applications/my') {
        return Promise.resolve({
          success: true,
          data: [{ id: 'app-weird', applicationNumber: 'GACP-0700', plantName: 'ขิง', status: 'SOME_GARBAGE_STATUS' }],
        });
      }
      return pending();
    });
    mount();
    await flush();
    const card = container!.querySelector('[data-testid="status-app-card"]');
    expect(card).not.toBeNull();
    expect(card!.getAttribute('data-needs-action')).toBe('false');
    expect(card!.textContent).toContain('ดูรายละเอียดคำขอ');
  });
});
