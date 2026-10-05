/**
 * payments-checkout-flag-off-notice.test.tsx — /health/payments fails LOUD
 * when the checkout UI flag is off (ledger UX-9: the walk sat 60 s waiting
 * for a pay button the product was never going to draw).
 *
 *   - flag OFF + an unpaid invoice (ยอดรอชำระ > 0)
 *     → a role="status" notice names the cause and the next action:
 *       'ระบบยังไม่เปิดช่องทางชำระเงินในสภาพแวดล้อมนี้ จึงยังชำระค่าบริการไม่ได้ ...'
 *     (it used to end "ติดต่อเจ้าหน้าที่เพื่อชำระค่าธรรมเนียม"; no staff role can
 *     take a payment, so the notice now says nothing was charged instead —
 *     operator decision 6, audit UXUI-05/UXUI-X01)
 *   - flag OFF + everything paid → no notice (nothing is owed).
 *   - flag ON → no notice (the checkout entry link renders instead —
 *     pinned by payments-checkout-entry-flag.test.tsx, untouched here).
 *
 * The notice keys on the page's own ยอดรอชำระ (pendingAmount). What that KPI
 * counts as owed is not this file's concern: a CANCELLED invoice's effect on
 * it is pinned by payments-cancelled-rows.test.tsx.
 *
 * Scaffold copied from payments-checkout-entry-flag.test.tsx: createRoot +
 * act + microtask flushes, `@/lib/config/checkout-mode` mocked so the flag
 * flips per test without touching process.env, heavy child sections mocked
 * to null so the page settles without network fan-out.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { PaymentRecord, QuotationsBySide } from '@/lib/services/payment-service';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGetMyPayments = jest.fn<() => Promise<PaymentRecord[]>>();
const mockGetQuotations = jest.fn<() => Promise<QuotationsBySide>>();
const mockIsCheckoutUiEnabled = jest.fn<() => boolean>();

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service') as {
    PaymentService: Record<string, unknown>;
  };
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getMyPayments: () => mockGetMyPayments(),
      getQuotations: () => mockGetQuotations(),
      downloadInvoicePdf: jest.fn(),
    },
  };
});

// F-G4-64: the payments page now asks GET /applications/:id/quotations and
// refuses to offer the pay entry until every quotation it holds is accepted,
// so this harness has to answer that call. An ACCEPTED row is the shape these
// suites were written against (they predate the gate); each assertion below is
// unchanged.
const ACCEPTED_QUOTATION: QuotationsBySide = {
  dtam: null,
  platform: {
    id: 'qt-1',
    applicationId: 'APP-1',
    issuerType: 'PLATFORM',
    quotationNumber: 'QT-PRD-2026-000001',
    subtotal: '33000.00',
    vat: '2310.00',
    totalAmount: '35310.00',
    status: 'ACCEPTED',
    acceptedAt: '2026-08-26T02:00:00.000Z',
    createdAt: '2026-08-25T00:00:00.000Z',
    lineItems: [],
  },
};

jest.mock('@/lib/config/checkout-mode', () => ({
  getCheckoutApiMode: () => 'live',
  isCheckoutUiEnabled: () => mockIsCheckoutUiEnabled(),
}));

// AuthService.getUser must NOT return null — that would redirect.
jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: () => ({ id: 'user-1', role: 'HEALTH', email: 'farmer@test' }),
  },
}));

// Child sections fetch their own data; null them out so the page settles
// deterministically. (jest module mocks only — the section files are
// untouched.)
jest.mock('@/components/payments/TwoCardPaymentSection', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/payments/RefundVisibilitySection', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/payments/QuotationReviewSection', () => ({
  __esModule: true,
  default: () => null,
}));

// Stable router/searchParams references — see payments-states.test.tsx
// for why instability here loops loadPayments forever.
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

const NOTICE_TEXT = 'ระบบยังไม่เปิดช่องทางชำระเงินในสภาพแวดล้อมนี้ จึงยังชำระค่าบริการไม่ได้';
const CHECKOUT_LINK_SELECTOR = 'a[href^="/health/payments/checkout"]';

const unpaidPhase1: PaymentRecord = {
  id: 'inv-p1-state',
  type: 'INVOICE',
  documentNumber: 'INV-2026-P1-1',
  applicationId: 'APP-1',
  amount: 5000,
  status: 'PENDING',
  erpStatus: 'PENDING',
  createdAt: '2026-08-01T00:00:00.000Z',
  serviceType: '',
  phase: 'PHASE_1',
  component: 'STATE',
  isPaid: false,
};

const paidPhase1: PaymentRecord = {
  ...unpaidPhase1,
  id: 'inv-p1-paid',
  documentNumber: 'INV-2026-P1-PAID',
  status: 'PAID',
  erpStatus: 'PAID',
  isPaid: true,
};

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function findNotice(container: HTMLElement): Element | undefined {
  return Array.from(container.querySelectorAll('[role="status"]')).find((el) =>
    (el.textContent || '').includes(NOTICE_TEXT),
  );
}

describe('HealthPaymentsPage checkout flag OFF notice (UX-9)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetQuotations.mockResolvedValue(ACCEPTED_QUOTATION);
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

  async function mountPage(): Promise<void> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();
  }

  it('flag OFF + unpaid invoice: the notice names the cause and the next action', async () => {
    mockIsCheckoutUiEnabled.mockReturnValue(false);
    mockGetMyPayments.mockResolvedValue([unpaidPhase1]);

    await mountPage();

    expect(findNotice(container!)).toBeDefined();
    expect(container!.querySelector(CHECKOUT_LINK_SELECTOR)).toBeNull();
  });

  it('flag OFF + everything paid: no notice, nothing is owed', async () => {
    mockIsCheckoutUiEnabled.mockReturnValue(false);
    mockGetMyPayments.mockResolvedValue([paidPhase1]);

    await mountPage();

    expect(findNotice(container!)).toBeUndefined();
    expect(container!.textContent).not.toContain(NOTICE_TEXT);
  });

  it('flag ON + unpaid invoice: no notice, the checkout entry renders instead', async () => {
    mockIsCheckoutUiEnabled.mockReturnValue(true);
    mockGetMyPayments.mockResolvedValue([unpaidPhase1]);

    await mountPage();

    expect(findNotice(container!)).toBeUndefined();
    expect(container!.textContent).not.toContain(NOTICE_TEXT);
    expect(container!.querySelector(CHECKOUT_LINK_SELECTOR)).not.toBeNull();
  });
});
