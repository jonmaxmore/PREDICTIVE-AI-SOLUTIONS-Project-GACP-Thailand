/**
 * payments-checkout-entry-flag.test.tsx — W2-03 D2 flag gate for the
 * "ชำระเงินออนไลน์" checkout entry link on /health/payments.
 *
 * NEW FILE by design: the D2 dispatch forbids editing the existing
 * payments-states.test.tsx cases, so the flag cases live here.
 *
 *   - flag OFF (isCheckoutUiEnabled() === false, the fail-closed default):
 *     the page renders NO checkout link and no "ชำระเงินออนไลน์" wording —
 *     the pre-W2-03 DOM is unchanged.
 *   - flag ON: an anchor to /health/payments/checkout?app=<activeApplicationId>
 *     labelled "ชำระเงินออนไลน์" appears.
 *
 * Strategy: createRoot + act + microtask flushes per
 * payments-states.test.tsx. `@/lib/config/checkout-mode` is mocked so the
 * flag flips per test without touching process.env. The heavy child
 * sections (TwoCard/Refund/QuotationReview) are mocked to
 * null so the page settles without network fan-out.
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

// Operator decision 6 (2026-09-17, audit UXUI-X01): the entry was labelled
// "ชำระเงินออนไลน์", but the screen behind it cannot take a payment yet (no
// PromptPay QR is shown), so it is named for what it does.
const CHECKOUT_ENTRY_LABEL = 'สร้างรายการชำระเงิน';
const CHECKOUT_LINK_SELECTOR = 'a[href^="/health/payments/checkout"]';

const phase1Payment: PaymentRecord = {
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

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('HealthPaymentsPage checkout entry flag (W2-03 D2)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetQuotations.mockResolvedValue(ACCEPTED_QUOTATION);
    mockGetMyPayments.mockResolvedValue([phase1Payment]);
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

  it('flag OFF (default fail-closed): no checkout link, no online-payment wording', async () => {
    mockIsCheckoutUiEnabled.mockReturnValue(false);

    await mountPage();

    expect(container!.querySelector(CHECKOUT_LINK_SELECTOR)).toBeNull();
    expect(container!.textContent).not.toContain(CHECKOUT_ENTRY_LABEL);
  });

  it('flag ON: renders the checkout entry link with the active applicationId', async () => {
    mockIsCheckoutUiEnabled.mockReturnValue(true);

    await mountPage();

    const link = container!.querySelector<HTMLAnchorElement>(CHECKOUT_LINK_SELECTOR);
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/health/payments/checkout?app=APP-1');
    expect(link!.textContent).toContain(CHECKOUT_ENTRY_LABEL);
  });
});
