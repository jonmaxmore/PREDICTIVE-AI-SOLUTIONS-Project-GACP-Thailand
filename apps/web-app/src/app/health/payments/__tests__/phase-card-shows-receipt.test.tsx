/**
 * phase-card-shows-receipt.test.tsx — ledger F-G4-53.
 *
 * Since F-G4-48 a checkout invoice renders as the phase card
 * (PaymentInvoiceCard). GET /invoices/my rows carry `receiptNumber` and a
 * derived erpStatus RECEIPT_ISSUED once a receipt exists
 * (apps/backend/services/invoice-service.js toErpStatus/withDerivedStatus),
 * but the card said only 'ชำระแล้ว' and never showed the number
 * (evidence/g4-rebuild-2026-08-25/c02-b/C02-01-payments-after-repair.png:
 * receipts TAX-PRD-2026-000005/000006 exist, chip reads 'ชำระแล้ว').
 *
 * Pinned here through the REAL getMyPayments mapping (api.get mocked at the
 * transport), the page and the real TwoCardPaymentSection + PaymentInvoiceCard:
 *   (a) paid CHECKOUT row with erpStatus RECEIPT_ISSUED + receiptNumber →
 *       the งวดที่ 1 card's status chip reads 'ออกใบเสร็จแล้ว' and the card
 *       shows the receipt number so the applicant can quote it;
 *   (b) paid row without a receipt → chip 'ชำระแล้ว', no TAX-PRD text;
 *   (c) unpaid row → chip 'รอชำระ'.
 *
 * Scaffold per payments-checkout-rows-are-phases.test.tsx.
 */

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

// Transport-level mock so PaymentService.getMyPayments runs for real (the
// receiptNumber mapping is part of the code under test).
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

// AuthService.getUser must NOT return null — that would redirect.
jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: () => ({ id: 'user-1', role: 'HEALTH', email: 'farmer@test' }),
    getToken: () => 'test-token',
  },
}));

// Self-fetching sections nulled out so the page settles deterministically.
// TwoCardPaymentSection + PaymentInvoiceCard are deliberately NOT mocked.
jest.mock('@/components/payments/RefundVisibilitySection', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/payments/QuotationReviewSection', () => ({
  __esModule: true,
  default: () => null,
}));

// Stable router/searchParams references — see payments-states.test.tsx.
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
const RECEIPT_NUMBER = 'TAX-PRD-2026-000005';
const RECEIPT_ISSUED_LABEL = 'ออกใบเสร็จแล้ว';
const PAID_LABEL = 'ชำระแล้ว';
const PENDING_LABEL = 'รอชำระ';

const checkoutM1LineItems = [
  { lineNumber: 1, code: 'STATE_FEE', description: 'ค่าบริการดำเนินการรับรองมาตรฐาน GACP (ราคาเต็ม)', quantity: 1, unitPrice: '5000.00', amount: '5000.00', isTaxable: true },
  { lineNumber: 2, code: 'PLATFORM_FEE', description: 'ค่าบริการแพลตฟอร์ม', quantity: 1, unitPrice: '500.00', amount: '500.00', isTaxable: true },
  { lineNumber: 3, code: 'VAT', description: 'ภาษีมูลค่าเพิ่ม 7%', quantity: 1, unitPrice: '385.00', amount: '385.00', isTaxable: false },
];

// Raw rows as GET /invoices/my serialises them (listByApplicant →
// withDerivedStatus): Decimal money as strings, `erpStatus` derived from the
// stored status + receipt columns, `receiptNumber` as stored.
const rawPaidWithReceipt = {
  id: 'inv-co-m1-receipted',
  invoiceNumber: 'INV-CO-D810DEBF-M1',
  applicationId: APP_ID,
  totalAmount: '5885.00',
  status: 'RECEIPT_ISSUED',
  erpStatus: 'RECEIPT_ISSUED',
  receiptNumber: RECEIPT_NUMBER,
  receiptIssuedAt: '2026-08-26T03:06:00.000Z',
  createdAt: '2026-08-26T03:00:00.000Z',
  paidAt: '2026-08-26T03:05:00.000Z',
  serviceType: 'CERTIFICATION_CHECKOUT_M1',
  lineItems: checkoutM1LineItems,
};

const rawPaidNoReceipt = {
  id: 'inv-co-m1-paid',
  invoiceNumber: 'INV-CO-D810DEBF-M1',
  applicationId: APP_ID,
  totalAmount: '5885.00',
  status: 'PAID',
  erpStatus: 'PAID_PENDING_RECEIPT',
  receiptNumber: null,
  receiptIssuedAt: null,
  createdAt: '2026-08-26T03:00:00.000Z',
  paidAt: '2026-08-26T03:05:00.000Z',
  serviceType: 'CERTIFICATION_CHECKOUT_M1',
  lineItems: checkoutM1LineItems,
};

const rawUnpaid = {
  id: 'inv-co-m1-pending',
  invoiceNumber: 'INV-CO-D810DEBF-M1',
  applicationId: APP_ID,
  totalAmount: '5885.00',
  status: 'PENDING',
  erpStatus: 'PENDING',
  receiptNumber: null,
  receiptIssuedAt: null,
  createdAt: '2026-08-26T03:00:00.000Z',
  serviceType: 'CERTIFICATION_CHECKOUT_M1',
  lineItems: checkoutM1LineItems,
};

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function phase1CheckoutCard(container: HTMLElement): HTMLElement {
  const section = container.querySelector<HTMLElement>('[data-testid="two-card-phase-งวดที่ 1"]');
  if (!section) throw new Error('phase section not found: งวดที่ 1');
  const cards = section.querySelectorAll<HTMLElement>('[data-testid="payment-invoice-card-CHECKOUT"]');
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

function statusChipText(card: HTMLElement): string {
  const chip = card.querySelector('[data-testid="payment-invoice-status"]');
  if (!chip) throw new Error('status chip not found on the phase card');
  return (chip.textContent || '').trim();
}

describe('HealthPaymentsPage phase card shows the receipt (F-G4-53)', () => {
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
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/invoices/my') return { success: true, data: rows };
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

  it('(a) a receipted checkout row: chip reads ออกใบเสร็จแล้ว and the card quotes the receipt number', async () => {
    const el = await mountPage([rawPaidWithReceipt]);
    const card = phase1CheckoutCard(el);

    expect(statusChipText(card)).toBe(RECEIPT_ISSUED_LABEL);
    expect(card.textContent).toContain(RECEIPT_NUMBER);
    expect(card.textContent).toContain('ใบเสร็จ/ใบกำกับภาษี');
  });

  it('(b) a paid checkout row without a receipt: chip reads ชำระแล้ว and no receipt number is shown', async () => {
    const el = await mountPage([rawPaidNoReceipt]);
    const card = phase1CheckoutCard(el);

    expect(statusChipText(card)).toBe(PAID_LABEL);
    expect(card.textContent).not.toContain(RECEIPT_ISSUED_LABEL);
    expect(card.textContent).not.toContain('TAX-PRD');
    expect(card.textContent).not.toContain('ใบเสร็จ/ใบกำกับภาษี');
  });

  it('(c) an unpaid checkout row: chip reads รอชำระ', async () => {
    const el = await mountPage([rawUnpaid]);
    const card = phase1CheckoutCard(el);

    expect(statusChipText(card)).toBe(PENDING_LABEL);
    expect(card.textContent).not.toContain(RECEIPT_ISSUED_LABEL);
    expect(card.textContent).not.toContain('TAX-PRD');
  });
});
