/**
 * quotation-accept-badge-no-reload.test.tsx — display-only fix.
 *
 * the backlog 2026-09-27 (promptpay-qr walk, screens/32 vs 33): the
 * quotation card's badge on /health/payments stays "รอการยอมรับ" after a
 * successful accept (POST .../quotations/PLATFORM/accept → 200) until a
 * manual page reload.
 *
 * Root cause: `QuotationReviewSection`'s success callback (`onAccepted`,
 * wired in client-view.tsx) fires TWO independent refetches —
 * `loadPayments()` and `loadQuotations()` — and `loadPayments()` flips the
 * page's single `loading` flag back to `true` for its own duration, EVERY
 * time it runs, not only on first mount. `QuotationReviewSection` is mounted
 * only while `!loading` (client-view.tsx render, around the quotation
 * panel), so when `loadPayments()` (one plain GET) settles BEFORE
 * `loadQuotations()` (a GET that also self-heals server-side, and is
 * therefore not guaranteed to be the faster of the two) — the panel
 * unmounts and remounts while `quotations` state still holds the
 * PRE-accept answer. The remounted card's `status` (QuotationCard,
 * `useState(quotation.status)`) locks onto that stale PENDING value: React
 * does not re-run a `useState` initializer on prop updates, so once
 * `loadQuotations()` finally lands the ACCEPTED answer, the card's own pill
 * never reads it — it is stuck until something remounts it again (a full
 * page reload).
 *
 * This test renders the REAL client-view + the REAL QuotationReviewSection
 * (neither mocked) and controls the two refetches' relative timing exactly
 * as loadPayments-settles-first, which is what the live evidence shows
 * happening on staging.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { PaymentRecord, QuotationsBySide, QuotationStatus } from '@/lib/services/payment-service';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30_000);

const APP_ID = 'APP-1';

const mockGetMyPayments = jest.fn<() => Promise<PaymentRecord[]>>();
const mockGetMyApplications = jest.fn<() => Promise<Array<{ id: string; status?: string | null }>>>();
const mockGetQuotations = jest.fn<() => Promise<QuotationsBySide | null>>();
const mockAcceptQuotation = jest.fn();
const mockViewQuotationPdf = jest.fn<() => Promise<boolean>>();

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service') as {
    PaymentService: Record<string, unknown>;
  };
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getMyPayments: () => mockGetMyPayments(),
      getMyApplications: () => mockGetMyApplications(),
      getQuotations: (...args: unknown[]) => mockGetQuotations(...(args as [])),
      acceptQuotation: (...args: unknown[]) => mockAcceptQuotation(...(args as [])),
      viewQuotationPdf: (...args: unknown[]) => mockViewQuotationPdf(...(args as [])),
      downloadInvoicePdf: jest.fn(),
    },
  };
});

jest.mock('@/lib/config/checkout-mode', () => ({
  getCheckoutApiMode: () => 'live',
  isCheckoutUiEnabled: () => false,
}));

jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: () => ({ id: 'user-1', role: 'HEALTH', email: 'farmer@test' }),
  },
}));

// Sections not under test — fanning them out would need their own service
// mocks and this bug lives entirely in the quotation panel + the page's
// `loading` flag.
jest.mock('@/components/payments/TwoCardPaymentSection', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/payments/RefundVisibilitySection', () => ({
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
  const searchParams = new URLSearchParams(`app=${APP_ID}`);
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

function quotation(status: QuotationStatus): QuotationsBySide {
  return {
    dtam: null,
    platform: {
      id: 'qt-1',
      applicationId: APP_ID,
      issuerType: 'PLATFORM',
      quotationNumber: 'QT-PRD-2026-000001',
      subtotal: 35310,
      vat: 2310,
      totalAmount: 35310,
      installments: [{ phase: 'PHASE_1', amount: 5885 }, { phase: 'PHASE_2', amount: 29425 }],
      status,
      createdAt: '2026-06-05T00:00:00.000Z',
      lineItems: [
        { method: 'OUTDOOR', label: 'กลางแจ้ง (Outdoor)', phase1Amount: 5885, phase2Amount: 29425, netAmount: 35310, taxAmount: 2310 },
      ],
    },
  };
}

async function flushAsync(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * The card's own status PILL, precisely — not a page-wide text search. The
 * page also prints a static "how it works" sentence containing the
 * substring "ยอมรับแล้ว" (client-view.tsx's Document Lifecycle legend),
 * which makes a container-wide `.textContent.toContain('ยอมรับแล้ว')`
 * assertion a false positive. `.rounded-full` is the pill's own class
 * (QuotationReviewSection.tsx statusPill/QuotationCard header span).
 */
function pillText(container: HTMLElement): string {
  const article = container.querySelector('article');
  const pill = article?.querySelector('span.rounded-full');
  return pill?.textContent?.trim() || '';
}

describe('quotation card badge after accept — no manual reload needed', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMyApplications.mockResolvedValue([]);
    mockViewQuotationPdf.mockResolvedValue(true);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('shows the accepted state right after a 200 accept, without a page reload', async () => {
    // getMyPayments: call #1 (initial page mount) resolves immediately.
    // call #2 (onAccepted's own `loadPayments()` refresh) is gated so the
    // test controls exactly when it settles.
    let paymentsCalls = 0;
    let unblockSecondPaymentsRead: () => void = () => {};
    const secondPaymentsGate = new Promise<void>((resolve) => {
      unblockSecondPaymentsRead = resolve;
    });
    mockGetMyPayments.mockImplementation(async () => {
      paymentsCalls += 1;
      if (paymentsCalls >= 2) await secondPaymentsGate;
      return [];
    });

    // getQuotations: call #1 (initial mount) resolves PENDING immediately.
    // call #2 (onAccepted's own `loadQuotations()` refresh) is gated
    // separately — this is the real backend's self-healing GET, which is
    // not guaranteed to answer before the plain payments GET above.
    let quotationsCalls = 0;
    let unblockSecondQuotationsRead: () => void = () => {};
    const secondQuotationsGate = new Promise<void>((resolve) => {
      unblockSecondQuotationsRead = resolve;
    });
    mockGetQuotations.mockImplementation(async () => {
      quotationsCalls += 1;
      if (quotationsCalls === 1) return quotation('PENDING');
      await secondQuotationsGate;
      return quotation('ACCEPTED');
    });
    mockAcceptQuotation.mockResolvedValue({ ok: true, row: quotation('ACCEPTED').platform });

    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();

    expect(pillText(container!)).toBe('รอการยอมรับ');

    const acceptBtn = Array.from(container?.querySelectorAll('button') || []).find(
      (b) => b.textContent?.includes('ยอมรับใบเสนอราคา'),
    );
    expect(acceptBtn).toBeTruthy();

    await act(async () => {
      acceptBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    // The press itself resolved (200) and both refetches started — this is
    // the ONLY user action this test takes; everything after is the
    // page's own follow-up, not a manual reload.
    expect(mockAcceptQuotation).toHaveBeenCalledWith(APP_ID, 'PLATFORM');

    // `loadPayments()` (a plain GET) settles first, exactly as staging
    // measured it (`loadQuotations()` self-heals server-side and is not
    // guaranteed to be faster). `quotations` state is still the PRE-accept
    // answer at this instant.
    unblockSecondPaymentsRead();
    await flushAsync();

    // Now the slower, self-healing refetch lands the true answer.
    unblockSecondQuotationsRead();
    await flushAsync();

    // The pill must read the accepted state now — not the pre-accept label —
    // with no further user action (no reload() call, no re-render trigger).
    expect(pillText(container!)).toBe('ยอมรับแล้ว');
  });
});
