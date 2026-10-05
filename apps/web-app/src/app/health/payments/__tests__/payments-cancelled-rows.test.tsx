/**
 * payments-cancelled-rows.test.tsx — a CANCELLED invoice on /health/payments.
 *
 * The ghost-invoice void marks duplicate invoices `status = 'CANCELLED'`
 * (apps/backend/services/invoice-service.js INVOICE_STATUS.CANCELLED). The
 * farmer's page must treat such a row as neither payable nor pending:
 *
 *   1. ยอดรอชำระ sums only the live pending row (885), never the cancelled
 *      5,000 on top of it.
 *   2. The cancelled row carries the Thai chip 'ยกเลิกแล้ว' (not the raw
 *      English status).
 *   3. The 'รอชำระ' tab hides it; 'ทั้งหมด' still lists it.
 *
 * Strategy: createRoot + act + microtask flushes per payments-states.test.tsx.
 * TwoCardPaymentSection stays REAL so a cancelled PHASE_1 row that leaked into
 * the two-card path would surface in the wrong card. The self-fetching
 * refund/quotation sections are nulled out.
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
const mockGetIssuerByServiceType = jest.fn<() => Promise<{ success: boolean; data: null }>>();

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
      getIssuerByServiceType: () => mockGetIssuerByServiceType(),
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

// AuthService.getUser must NOT return null — that would redirect.
jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: () => ({ id: 'user-1', role: 'HEALTH', email: 'farmer@test' }),
  },
}));

// Self-fetching sections nulled out so the page settles deterministically.
// TwoCardPaymentSection is deliberately NOT mocked (see header).
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
const CANCELLED_DOC = 'INV-2569-GHOST-1';
const PENDING_DOC = 'INV-2569-P1-PLATFORM';
const PAID_DOC = 'INV-2569-P1-STATE';

const CANCELLED_CHIP = 'ยกเลิกแล้ว';

// The ghost is listed FIRST on purpose: TwoCardPaymentSection picks the first
// STATE row for its state-side card, so a cancelled row that reaches it would
// shadow the real (paid) state invoice and offer a pay button for it.
const cancelledRow: PaymentRecord = {
  id: 'inv-ghost-1',
  type: 'INVOICE',
  documentNumber: CANCELLED_DOC,
  applicationId: APP_ID,
  amount: 5000,
  status: 'CANCELLED',
  erpStatus: 'CANCELLED',
  createdAt: '2026-08-20T00:00:00.000Z',
  serviceType: 'PHASE_1_STATE_FEE',
  phase: 'PHASE_1',
  component: 'STATE',
  isPaid: false,
  isCancelled: true,
};

const pendingRow: PaymentRecord = {
  id: 'inv-p1-platform',
  type: 'INVOICE',
  documentNumber: PENDING_DOC,
  applicationId: APP_ID,
  amount: 885,
  status: 'PENDING',
  erpStatus: 'PENDING',
  createdAt: '2026-08-21T00:00:00.000Z',
  serviceType: 'PHASE_1_PLATFORM_FEE',
  phase: 'PHASE_1',
  component: 'PLATFORM',
  isPaid: false,
  isCancelled: false,
};

const paidRow: PaymentRecord = {
  id: 'inv-p1-state',
  type: 'INVOICE',
  documentNumber: PAID_DOC,
  applicationId: APP_ID,
  amount: 5885,
  status: 'PAID',
  erpStatus: 'PAID',
  createdAt: '2026-08-21T00:00:00.000Z',
  paidAt: '2026-08-22T00:00:00.000Z',
  serviceType: 'PHASE_1_STATE_FEE',
  phase: 'PHASE_1',
  component: 'STATE',
  isPaid: true,
  isCancelled: false,
};

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function metricValue(container: HTMLElement, label: string): string {
  const labelNode = Array.from(container.querySelectorAll('p')).find(
    (p) => (p.textContent || '').trim() === label,
  );
  if (!labelNode) throw new Error(`metric label not found: ${label}`);
  return (labelNode.previousElementSibling?.textContent || '').trim();
}

// Both the desktop <tr> and the mobile <article> render in jsdom (Tailwind
// visibility classes do not apply), so a row can surface as either.
function rowsFor(container: HTMLElement, documentNumber: string): Element[] {
  return Array.from(container.querySelectorAll('tr, article')).filter((el) =>
    (el.textContent || '').includes(documentNumber),
  );
}

function filterButton(container: HTMLElement, label: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => (b.textContent || '').trim() === label,
  );
  if (!btn) throw new Error(`filter button not found: ${label}`);
  return btn;
}

describe('HealthPaymentsPage CANCELLED invoice rows', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetQuotations.mockResolvedValue(ACCEPTED_QUOTATION);
    mockGetMyPayments.mockResolvedValue([cancelledRow, pendingRow, paidRow]);
    mockGetIssuerByServiceType.mockResolvedValue({ success: true, data: null });
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

  it('ยอดรอชำระ sums the pending row only (885), not the cancelled 5,000', async () => {
    const el = await mountPage();

    const pending = metricValue(el, 'ยอดรอชำระ');
    expect(pending).toContain('885');
    expect(pending).not.toContain('5,885');

    // The paid KPI is untouched by the cancelled row.
    expect(metricValue(el, 'ยอดที่ชำระแล้ว')).toContain('5,885');
  });

  it('lists the cancelled row under ทั้งหมด with the ยกเลิกแล้ว chip', async () => {
    const el = await mountPage();

    const rows = rowsFor(el, CANCELLED_DOC);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.textContent).toContain(CANCELLED_CHIP);
    }

    // The raw English status never reaches the farmer.
    expect(el.textContent).not.toContain('CANCELLED');
  });

  it('ยกเลิกแล้ว chip uses token neutrals, no stock slate/zinc/emerald palette', async () => {
    // the gacp-design-tokens guideline: no slate-*/zinc-*/emerald-*
    // in new code; neutrals come from the token set. No probe counts this, so
    // the chip pins it here. The assertion is negative on purpose: it does
    // not name the token classes, so the chip can be restyled within the
    // token set without touching this test.
    const el = await mountPage();
    const stockPalette = /(^|\s)(bg|text|border)-(slate|zinc|emerald)-/;

    const chips = rowsFor(el, CANCELLED_DOC).flatMap((row) =>
      Array.from(row.querySelectorAll('span')).filter(
        (span) => (span.textContent || '').trim() === CANCELLED_CHIP,
      ),
    );
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.className).not.toMatch(stockPalette);
      const dot = chip.querySelector('span');
      expect(dot).not.toBeNull();
      expect(dot!.className).not.toMatch(stockPalette);
    }
  });

  it('รอชำระ tab hides the cancelled row; ทั้งหมด shows it again', async () => {
    const el = await mountPage();

    await act(async () => {
      filterButton(el, 'รอชำระ').click();
    });
    await flushAsync();

    expect(el.textContent).not.toContain(CANCELLED_DOC);
    // The pending PLATFORM card is still there (PaymentInvoiceCard does not
    // print the document number, so assert on the card itself).
    expect(el.querySelector('[data-testid="payment-invoice-card-PLATFORM"]')).not.toBeNull();
    // The only STATE rows are the paid one and the ghost; neither is pending.
    expect(el.querySelector('[data-testid="payment-invoice-card-STATE"]')).toBeNull();

    await act(async () => {
      filterButton(el, 'ทั้งหมด').click();
    });
    await flushAsync();

    expect(el.textContent).toContain(CANCELLED_DOC);
    expect(rowsFor(el, CANCELLED_DOC).length).toBeGreaterThan(0);
  });
});
