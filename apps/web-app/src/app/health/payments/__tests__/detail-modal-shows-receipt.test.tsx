/**
 * detail-modal-shows-receipt.test.tsx — ledger F-G4-53 (finish).
 *
 * The phase card already quotes the receipt number (phase-card-shows-receipt
 * .test.tsx). The card's 'ดูรายละเอียด' opens the invoice detail modal in
 * client-view.tsx, and that modal listed only เลขที่เอกสาร / งวด / ประเภท /
 * สถานะ: the one screen an applicant opens to read a document never named the
 * receipt that document produced, even though GET /invoices/my carries both
 * `receiptNumber` and `receiptIssuedAt`.
 *
 * One document, one name (fix round 1, A-F1): the card names the document per
 * side (the company's CHECKOUT/PLATFORM number is a tax invoice that doubles as
 * the receipt, the state's is a plain receipt). The modal must not invent a
 * second name for the same number, so the label the dialog prints is asserted
 * against the label the CARD prints for the SAME record, both read from the DOM.
 *
 * Pinned here through the REAL getMyPayments mapping (api.get mocked at the
 * transport) and the real TwoCardPaymentSection + PaymentInvoiceCard, driven by
 * a real click on the card's detail button:
 *   (a) a receipted checkout row → the dialog's number-row label is the card's
 *       document label, and the dialog dates it in Buddhist era (2569);
 *   (b) a paid row with no receipt → the dialog says nothing about a receipt;
 *   (c) number without a date → the number row alone, no date row, no '-';
 *   (d) date without a number → the date row alone (the two rows are gated
 *       independently, not nested).
 *
 * Scaffold per phase-card-shows-receipt.test.tsx (same mocks).
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
// receiptIssuedAt mapping is part of the code under test).
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
// Real (the mock factory spreads the actual module): the two names the receipt
// document can carry, taken from the source the screen itself reads.
import { receiptNumberRowLabelTH } from '@/lib/services/payment-service';

const APP_ID = 'APP-1';
const RECEIPT_NUMBER = 'TAX-PRD-2026-000005';
const RECEIPT_ISSUED_AT = '2026-08-27T04:27:41.396Z';
const RECEIPT_DATE_LABEL = 'วันที่ออกใบเสร็จ';
// Thai glues the number-of noun phrase together with no space, the way this
// same dialog prints 'เลขที่เอกสาร' and the preview prints 'เลขที่ใบแจ้งหนี้'.
// With no separator left, a startsWith() finder would also pick up the
// เลขที่เอกสาร row, so the receipt row is identified by its WHOLE label.
const RECEIPT_NUMBER_ROW_PREFIX = 'เลขที่';
// Both sides' names for the document, so case (b) — where the card quotes no
// receipt and there is no label to read off it — can still ask "is there a
// receipt row at all?" without hand-copying a string that may be renamed.
const RECEIPT_NUMBER_ROW_LABELS = [
  receiptNumberRowLabelTH({ component: 'STATE' }),
  receiptNumberRowLabelTH({ component: 'CHECKOUT' }),
];

const checkoutM1LineItems = [
  { lineNumber: 1, code: 'STATE_FEE', description: 'ค่าบริการดำเนินการรับรองมาตรฐาน GACP (ราคาเต็ม)', quantity: 1, unitPrice: '5000.00', amount: '5000.00', isTaxable: true },
  { lineNumber: 2, code: 'PLATFORM_FEE', description: 'ค่าบริการแพลตฟอร์ม', quantity: 1, unitPrice: '500.00', amount: '500.00', isTaxable: true },
  { lineNumber: 3, code: 'VAT', description: 'ภาษีมูลค่าเพิ่ม 7%', quantity: 1, unitPrice: '385.00', amount: '385.00', isTaxable: false },
];

// Raw rows as GET /invoices/my serialises them (listByApplicant →
// withDerivedStatus): Decimal money as strings, erpStatus derived from the
// stored status + receipt columns.
const rawPaidWithReceipt = {
  id: 'inv-co-m1-receipted',
  invoiceNumber: 'INV-CO-D810DEBF-M1',
  applicationId: APP_ID,
  totalAmount: '5885.00',
  status: 'RECEIPT_ISSUED',
  erpStatus: 'RECEIPT_ISSUED',
  receiptNumber: RECEIPT_NUMBER,
  receiptIssuedAt: RECEIPT_ISSUED_AT,
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

// The register can hold one half of the receipt without the other: the bind
// script writes the number, the settlement writes the date. Each row on the
// modal answers for its own column, so neither half hides the other.
const rawReceiptNumberOnly = {
  ...rawPaidWithReceipt,
  id: 'inv-co-m1-number-only',
  receiptIssuedAt: null,
};

const rawReceiptDateOnly = {
  ...rawPaidWithReceipt,
  id: 'inv-co-m1-date-only',
  receiptNumber: null,
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
  if (!section) throw new Error('phase section not found');
  const cards = section.querySelectorAll<HTMLElement>('[data-testid="payment-invoice-card-CHECKOUT"]');
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

function detailButton(card: HTMLElement): HTMLButtonElement {
  const btn = Array.from(card.querySelectorAll('button')).find(
    (b) => (b.textContent || '').trim() === 'ดูรายละเอียด',
  );
  if (!btn) throw new Error('detail button not found on the phase card');
  return btn as HTMLButtonElement;
}

/**
 * The document label the CARD prints next to the receipt number, read from the
 * DOM: the paragraph is "<label> <number>", the number sits in its own <code>.
 */
function cardReceiptDocumentLabel(card: HTMLElement): string {
  const line = card.querySelector<HTMLElement>('[data-testid="payment-invoice-receipt-number"]');
  if (!line) throw new Error('the card does not quote a receipt number');
  const number = (line.querySelector('code')?.textContent || '').trim();
  return (line.textContent || '').replace(number, '').trim();
}

function dialog(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[role="dialog"]');
  if (!el) throw new Error('detail dialog did not open');
  return el;
}

function dialogText(container: HTMLElement): string {
  return dialog(container).textContent || '';
}

/** Every "label / value" row of the dialog, read from the DOM. */
function dialogRows(container: HTMLElement): Array<{ label: string; value: string }> {
  return Array.from(dialog(container).querySelectorAll<HTMLElement>('div.flex.justify-between')).map(
    (row) => ({
      label: (row.firstElementChild?.textContent || '').trim(),
      value: (row.lastElementChild?.textContent || '').trim(),
    }),
  );
}

/**
 * The dialog row that names the receipt number. With `cardLabel` the match is
 * exact against the card's own words; without one (the card quotes no receipt)
 * it is exact against either name the document can carry. Never a prefix
 * match: 'เลขที่เอกสาร' is a different row and is always present.
 */
function receiptNumberRow(
  container: HTMLElement,
  cardLabel?: string,
): { label: string; value: string } | undefined {
  const labels = cardLabel
    ? [`${RECEIPT_NUMBER_ROW_PREFIX}${cardLabel}`]
    : RECEIPT_NUMBER_ROW_LABELS;
  return dialogRows(container).find((r) => labels.includes(r.label));
}

describe('HealthPaymentsPage detail modal lists the receipt (F-G4-53)', () => {
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

  async function openDetail(el: HTMLElement): Promise<void> {
    const btn = detailButton(phase1CheckoutCard(el));
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();
  }

  it('(a) a receipted checkout row: the dialog names the document exactly as the card does, and dates it in BE', async () => {
    const el = await mountPage([rawPaidWithReceipt]);
    const cardLabel = cardReceiptDocumentLabel(phase1CheckoutCard(el));
    await openDetail(el);

    const row = receiptNumberRow(el, cardLabel);
    // The dialog has a row naming the receipt number.
    expect(row).toBeTruthy();
    // One document, one name: the dialog may only prefix the card's own label.
    expect(row?.label).toBe(`${RECEIPT_NUMBER_ROW_PREFIX}${cardLabel}`);
    expect(row?.value).toBe(RECEIPT_NUMBER);

    const text = dialogText(el);
    expect(text).toContain(RECEIPT_DATE_LABEL);
    expect(text).toContain('2569');
  });

  it('(b) a paid checkout row without a receipt: the dialog says nothing about a receipt', async () => {
    const el = await mountPage([rawPaidNoReceipt]);
    await openDetail(el);

    expect(receiptNumberRow(el)).toBeUndefined();
    const text = dialogText(el);
    expect(text).not.toContain(RECEIPT_DATE_LABEL);
    expect(text).not.toContain('TAX-PRD');
  });

  it('(c) a receipt number with no issue date: the number row alone, and no dash stands in for the date', async () => {
    const el = await mountPage([rawReceiptNumberOnly]);
    const cardLabel = cardReceiptDocumentLabel(phase1CheckoutCard(el));
    await openDetail(el);

    const row = receiptNumberRow(el, cardLabel);
    expect(row?.label).toBe(`${RECEIPT_NUMBER_ROW_PREFIX}${cardLabel}`);
    expect(row?.value).toBe(RECEIPT_NUMBER);

    expect(dialogText(el)).not.toContain(RECEIPT_DATE_LABEL);
    const placeholders = Array.from(dialog(el).querySelectorAll('*')).filter(
      (node) => (node.textContent || '').trim() === '-',
    );
    expect(placeholders).toHaveLength(0);
  });

  it('(d) an issue date with no number yet: the date row renders on its own column, not on the number', async () => {
    const el = await mountPage([rawReceiptDateOnly]);
    await openDetail(el);

    const text = dialogText(el);
    expect(text).toContain(RECEIPT_DATE_LABEL);
    expect(text).toContain('2569');
    expect(receiptNumberRow(el)).toBeUndefined();
    expect(text).not.toContain('TAX-PRD');
  });
});
