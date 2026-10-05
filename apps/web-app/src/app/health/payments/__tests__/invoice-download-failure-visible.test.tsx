/**
 * invoice-download-failure-visible.test.tsx — B1 (2026-08-23).
 *
 * For 22 days every invoice PDF download returned 500
 * (`GET /api/invoices/:id/pdf` → "Failed to generate PDF", proven live on
 * preview against invoice c80fe4c0-…). The farmer saw NOTHING: the button's
 * onClick was `() => void PaymentService.downloadInvoicePdf(...)`, and the
 * service catches its own error and returns `false`, so the discarded
 * boolean was the only trace the failure ever left. Press, no file, no
 * message, no spinner — indistinguishable from a dead button.
 *
 * These tests pin the user-visible half of the fix: a failed download must
 * say what happened and what to do next, in Thai
 * (the thai-ui-copy guideline — "Error states name the cause and
 * the next action, never a bare apology").
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { PaymentRecord } from '@/lib/services/payment-service';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGetMyPayments = jest.fn<() => Promise<PaymentRecord[]>>();
const mockDownloadInvoicePdf = jest.fn<() => Promise<boolean>>();

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service');
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getMyPayments: (...args: unknown[]) => mockGetMyPayments(...(args as [])),
      getIssuerByServiceType: async () => ({ success: true, data: null }),
      getCreditNotes: async () => [],
      downloadInvoicePdf: (...args: unknown[]) => mockDownloadInvoicePdf(...(args as [])),
    },
  };
});

jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: () => ({ id: 'user-1', role: 'HEALTH', email: 'farmer@test' }),
    getToken: () => 'test-token',
  },
}));

jest.mock('next/navigation', () => {
  const router = {
    push: jest.fn(), replace: jest.fn(), refresh: jest.fn(),
    back: jest.fn(), forward: jest.fn(), prefetch: jest.fn(),
    pathname: '/', query: {},
  };
  const searchParams = new URLSearchParams();
  return {
    useRouter: () => router,
    usePathname: () => '/',
    useSearchParams: () => searchParams,
  };
});

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,FAKE') },
}));

import HealthPaymentsPage from '../client-view';

// A single UNKNOWN-phase invoice with no applicationId routes through the
// legacy table path and skips the Refund sub-tree, same
// trick payments-states.test.tsx uses.
const legacyPayment: PaymentRecord = {
  id: 'inv-b1',
  type: 'INVOICE',
  documentNumber: 'INV-2026-B1-0001',
  applicationId: '',
  amount: 885,
  status: 'PENDING',
  erpStatus: 'PENDING',
  createdAt: '2026-08-23T00:00:00.000Z',
  serviceType: '',
  phase: 'UNKNOWN',
  component: 'UNKNOWN',
  isPaid: false,
};

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function clickByText(container: HTMLElement, label: string): void {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').includes(label),
  );
  if (!btn) { throw new Error(`button "${label}" not found`); }
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('B1 — invoice PDF download failure is visible to the farmer', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMyPayments.mockResolvedValue([legacyPayment]);
  });

  afterEach(() => {
    if (root) { act(() => { root?.unmount(); }); root = null; }
    if (container) { container.remove(); container = null; }
  });

  async function openDetailModal(): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();
    clickByText(container, 'ดูรายละเอียด');
    await flushAsync(2);
    expect(container.textContent).toContain('รายละเอียดใบแจ้งหนี้');
    return container;
  }

  it('shows a Thai error naming the cause and the next action when the download fails', async () => {
    mockDownloadInvoicePdf.mockResolvedValue(false);

    const c = await openDetailModal();
    clickByText(c, 'ดาวน์โหลด PDF');
    await flushAsync();

    expect(mockDownloadInvoicePdf).toHaveBeenCalledTimes(1);

    const alert = c.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    const text = alert?.textContent || '';
    // Cause + next action, per thai-ui-copy. Not a bare apology.
    expect(text).toContain('ดาวน์โหลดใบแจ้งหนี้ไม่สำเร็จ');
    expect(text).toContain('ลองอีกครั้ง');
    expect(text).not.toContain('ขออภัย');
  });

  it('stays silent (no alert) when the download succeeds', async () => {
    mockDownloadInvoicePdf.mockResolvedValue(true);

    const c = await openDetailModal();
    clickByText(c, 'ดาวน์โหลด PDF');
    await flushAsync();

    expect(mockDownloadInvoicePdf).toHaveBeenCalledTimes(1);
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('clears a previous failure when a retry succeeds', async () => {
    mockDownloadInvoicePdf.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const c = await openDetailModal();
    clickByText(c, 'ดาวน์โหลด PDF');
    await flushAsync();
    expect(c.querySelector('[role="alert"]')).toBeTruthy();

    clickByText(c, 'ดาวน์โหลด PDF');
    await flushAsync();
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });
});
