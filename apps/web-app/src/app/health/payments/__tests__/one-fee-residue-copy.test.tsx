/**
 * one-fee-residue-copy.test.tsx — sweep of the retired state-fee/platform-fee
 * split residue left in /health/payments (operator ruling 2026-09-11: one
 * ค่าบริการ, one issuer, no state/platform split).
 *
 * Pinned here, through the REAL getMyPayments mapping and the REAL detail
 * modal (client-view.tsx):
 *   1. mapComponentLabel no longer names a STATE row 'ค่าธรรมเนียมภาครัฐ'.
 *   2. The detail-modal fallback (no lineItems) no longer draws a VAT-exempt
 *      'ค่าธรรมเนียมภาครัฐ' row for a STATE-component invoice.
 *   3. The detail-modal fallback for a non-CHECKOUT invoice is labelled
 *      'ค่าบริการ', not 'ค่าบริการแพลตฟอร์ม (10%)' — the 10% platform slice no
 *      longer exists.
 *
 * Scaffold per detail-modal-shows-receipt.test.tsx (same mocks).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Envelope = { success: boolean; data?: unknown; error?: string };

const mockApiGet = jest.fn<(path: string) => Promise<Envelope>>();
const mockGetIssuerByServiceType = jest.fn<(serviceType: string) => Promise<Envelope>>();

jest.mock('@/lib/api/api-client', () => {
  const api = {
    get: (path: string) => mockApiGet(path),
    post: jest.fn(),
    getBlob: jest.fn(),
  };
  return { api, apiClient: api };
});

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service') as {
    PaymentService: Record<string, unknown>;
  };
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getIssuerByServiceType: (serviceType: string) => mockGetIssuerByServiceType(serviceType),
      downloadInvoicePdf: jest.fn(),
    },
  };
});

jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: () => ({ id: 'user-1', role: 'HEALTH', email: 'farmer@test' }),
    getToken: () => 'test-token',
  },
}));

jest.mock('@/components/payments/RefundVisibilitySection', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/payments/QuotationReviewSection', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('next/navigation', () => {
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
    pathname: '/',
    query: {},
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

const APP_ID = 'APP-1';

// No lineItems: forces the detail modal into its fallback branch, which is
// exactly the residue under test (client-view.tsx ~964-980).
const rawStateNoLineItems = {
  id: 'inv-state-fallback',
  invoiceNumber: 'INV-STATE-FALLBACK',
  applicationId: APP_ID,
  totalAmount: '5000.00',
  status: 'PENDING',
  erpStatus: 'PENDING',
  createdAt: '2026-08-26T03:00:00.000Z',
  serviceType: 'PHASE_1_STATE_FEE',
};

const rawPlatformNoLineItems = {
  id: 'inv-platform-fallback',
  invoiceNumber: 'INV-PLATFORM-FALLBACK',
  applicationId: APP_ID,
  totalAmount: '535.00',
  status: 'PENDING',
  erpStatus: 'PENDING',
  createdAt: '2026-08-26T03:00:00.000Z',
  serviceType: 'PHASE_1_PLATFORM_FEE',
};

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function dialog(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[role="dialog"]');
  if (!el) throw new Error('detail dialog did not open');
  return el;
}

function detailButtonFor(container: HTMLElement, testId: string): HTMLButtonElement {
  const card = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!card) throw new Error(`card ${testId} not found`);
  const btn = Array.from(card.querySelectorAll('button')).find(
    (b) => (b.textContent || '').trim() === 'ดูรายละเอียด',
  );
  if (!btn) throw new Error('detail button not found');
  return btn as HTMLButtonElement;
}

describe('HealthPaymentsPage — one-fee residue copy', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIssuerByServiceType.mockResolvedValue({ success: false, error: 'UNKNOWN_SERVICE_TYPE' });
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

  async function mountPage(rows: unknown[]): Promise<HTMLDivElement> {
    mockApiGet.mockImplementation(async (p: string) => {
      if (p === '/invoices/my') return { success: true, data: rows };
      return { success: true, data: [] };
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();
    return container;
  }

  it('a STATE-component invoice with no line items: the detail modal names no ค่าธรรมเนียมภาครัฐ row, no VAT-exempt claim', async () => {
    const el = await mountPage([rawStateNoLineItems]);
    await act(async () => {
      detailButtonFor(el, 'payment-invoice-card-STATE').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await flushAsync();

    const text = dialog(el).textContent || '';
    expect(text).not.toContain('ค่าธรรมเนียมภาครัฐ');
    expect(text).not.toContain('ยกเว้น (0%)');
    // The "ประเภท" row (mapComponentLabel) must not name it a state fee either.
    expect(text).not.toContain('ค่าธรรมเนียมภาครัฐ');
  });

  it('a non-CHECKOUT invoice with no line items: the fallback names ค่าบริการ, not ค่าบริการแพลตฟอร์ม (10%)', async () => {
    const el = await mountPage([rawPlatformNoLineItems]);
    await act(async () => {
      detailButtonFor(el, 'payment-invoice-card-PLATFORM').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await flushAsync();

    const text = dialog(el).textContent || '';
    expect(text).not.toContain('ค่าบริการแพลตฟอร์ม (10%)');
    expect(text).toContain('ค่าบริการ');
  });

  it('a real legacy STATE row (fix round 1, 2026-09-26): named truthfully, not ไม่ระบุ, no invented VAT, no company issuer', async () => {
    // Fix round 1 (controller decision, review Important-1): a real row
    // minted before the 2026-09-11 one-ค่าบริการ ruling (~22 on record, still
    // surfaced by phase-billing-service.js flattenRequiredInvoices), not
    // dead code. The generic non-CHECKOUT fallback used to call it 'ไม่ระบุ'
    // in this "ประเภท" row and invent a VAT-7% split + company issuer in the
    // fee-breakdown block below.
    const LEGACY_STATE_FEE_LABEL_TH = 'ค่าธรรมเนียมรัฐ (รายการก่อนเปลี่ยนเป็นค่าบริการก้อนเดียว)';
    const el = await mountPage([rawStateNoLineItems]);
    await act(async () => {
      detailButtonFor(el, 'payment-invoice-card-STATE').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await flushAsync();

    const text = dialog(el).textContent || '';
    expect(text).not.toContain('ไม่ระบุ');
    expect(text).toContain(LEGACY_STATE_FEE_LABEL_TH);
    expect(text).not.toContain('VAT 7%');
    expect(text).not.toContain('บริษัท Predictive AI Solution Co., Ltd.');
    // The total is exactly the stored amount (5,000) — no money changed.
    expect(text).toContain('5,000');
  });
});

describe('client-view.tsx source — stale two-card comment', () => {
  it('the phase-loop comment no longer describes two side-by-side STATE + PLATFORM cards', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'client-view.tsx'),
      'utf8',
    );
    expect(src).not.toContain('we render two side-by-side cards (STATE + PLATFORM)');
    expect(src).not.toContain('so the applicant transfers twice');
  });
});
