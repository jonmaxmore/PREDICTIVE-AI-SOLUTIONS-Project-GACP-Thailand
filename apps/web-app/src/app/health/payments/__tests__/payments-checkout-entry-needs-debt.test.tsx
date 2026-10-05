/**
 * payments-checkout-entry-needs-debt.test.tsx — ledger F-G4-49.
 *
 * The checkout entry on /health/payments (the "ชำระผ่านระบบออนไลน์" banner
 * with the "ชำระเงินออนไลน์" button) used to render for any application as
 * soon as the checkout UI flag was on, even with ยอดรอชำระ ฿0 on a CERTIFIED
 * application (evidence/g4-rebuild-2026-08-25/c02/C02-01). The entry is a
 * pay action: it renders only when the page's own ยอดรอชำระ (pendingAmount:
 * unpaid, not cancelled, application-scoped) is above zero. With nothing
 * owed, nothing renders there, no substitute copy.
 *
 *   - flag ON + every row paid          → no checkout link, no 'ชำระเงินออนไลน์'
 *   - flag ON + only a CANCELLED row     → same (a voided invoice is not owed)
 *   - flag ON + one unpaid row           → the link renders (the flag-ON case
 *     of payments-checkout-entry-flag.test.tsx, whose fixture is unpaid)
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

const APP_ID = 'APP-1';
// Operator decision 6 (2026-09-17, audit UXUI-X01): the entry was labelled
// "ชำระเงินออนไลน์", but the screen behind it cannot take a payment yet (no
// PromptPay QR is shown), so it is named for what it does.
const CHECKOUT_ENTRY_LABEL = 'สร้างรายการชำระเงิน';
const CHECKOUT_LINK_SELECTOR = 'a[href^="/health/payments/checkout"]';

// The two paid checkout invoices from the C02-01 evidence (CERTIFIED app).
const paidCheckoutM1: PaymentRecord = {
  id: 'inv-co-m1',
  type: 'RECEIPT',
  documentNumber: 'INV-CO-D810DEBF-M1',
  applicationId: APP_ID,
  amount: 5885,
  status: 'RECEIPT_ISSUED',
  erpStatus: 'RECEIPT_ISSUED',
  createdAt: '2026-08-26T03:00:00.000Z',
  paidAt: '2026-08-26T03:05:00.000Z',
  serviceType: 'CERTIFICATION_CHECKOUT_M1',
  phase: 'PHASE_1',
  component: 'CHECKOUT',
  isPaid: true,
  isCancelled: false,
};

const paidCheckoutM2: PaymentRecord = {
  ...paidCheckoutM1,
  id: 'inv-co-m2',
  documentNumber: 'INV-CO-F785F58B-M2',
  amount: 29425,
  serviceType: 'CERTIFICATION_CHECKOUT_M2',
  phase: 'PHASE_2',
};

const unpaidCheckoutM2: PaymentRecord = {
  ...paidCheckoutM2,
  id: 'inv-co-m2-open',
  documentNumber: 'INV-CO-F785F58B-M2-OPEN',
  type: 'INVOICE',
  status: 'PENDING',
  erpStatus: 'PENDING',
  paidAt: undefined,
  isPaid: false,
};

const cancelledUnpaid: PaymentRecord = {
  ...unpaidCheckoutM2,
  id: 'inv-ghost-1',
  documentNumber: 'INV-2569-GHOST-1',
  status: 'CANCELLED',
  erpStatus: 'CANCELLED',
  isCancelled: true,
};

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('HealthPaymentsPage checkout entry needs debt (F-G4-49)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetQuotations.mockResolvedValue(ACCEPTED_QUOTATION);
    mockIsCheckoutUiEnabled.mockReturnValue(true);
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

  async function mountPage(): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();
    return container;
  }

  it('flag ON + every row paid: no checkout link and no online-payment wording', async () => {
    mockGetMyPayments.mockResolvedValue([paidCheckoutM2, paidCheckoutM1]);

    const el = await mountPage();

    expect(el.querySelector(CHECKOUT_LINK_SELECTOR)).toBeNull();
    expect(el.textContent).not.toContain(CHECKOUT_ENTRY_LABEL);
  });

  it('flag ON + only a CANCELLED unpaid row: still nothing owed, no checkout link', async () => {
    mockGetMyPayments.mockResolvedValue([paidCheckoutM1, cancelledUnpaid]);

    const el = await mountPage();

    expect(el.querySelector(CHECKOUT_LINK_SELECTOR)).toBeNull();
    expect(el.textContent).not.toContain(CHECKOUT_ENTRY_LABEL);
  });

  it('flag ON + one unpaid row: the checkout link renders for the active application', async () => {
    mockGetMyPayments.mockResolvedValue([paidCheckoutM1, unpaidCheckoutM2]);

    const el = await mountPage();

    const link = el.querySelector<HTMLAnchorElement>(CHECKOUT_LINK_SELECTOR);
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(`/health/payments/checkout?app=${APP_ID}`);
    expect(link!.textContent).toContain(CHECKOUT_ENTRY_LABEL);
  });
});
