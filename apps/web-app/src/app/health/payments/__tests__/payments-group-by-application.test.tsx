/**
 * O3 (staging walk 2026-09-30): in a company workspace, /health/payments put the
 * invoices of TWO different applications under one "งวดที่ 1" with
 * "ยอดรวมงวด ฿11,770", and no card said which application or which invoice it
 * was. INV-CO-… appeared only inside the detail modal
 * (state/staging-walk-2026-09-30/screens/02-payments-juristic.png).
 *
 * Pinned here, through the REAL getMyPayments mapping, TwoCardPaymentSection and
 * PaymentInvoiceCard (api.get mocked at the transport):
 *   1. two applications × งวดที่ 1 draw two sections, one per application, each
 *      naming its application number;
 *   2. each section's ยอดรวมงวด covers only that application's invoices
 *      (฿5,885, never the combined ฿11,770);
 *   3. each card names its invoice number and its application number;
 *   4. ?app= / ?applicationId= still narrows the page to one application.
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

jest.mock('@/lib/api/api-client', () => {
  const api = {
    get: (path: string) => mockApiGet(path),
    post: jest.fn(),
    getBlob: jest.fn(),
  };
  return { api, apiClient: api };
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

// One stable URLSearchParams object whose contents each test sets — a new
// object per render would loop loadPayments (see payments-states.test.tsx).
const mockSearchParams = new URLSearchParams();
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
  return {
    useRouter: () => router,
    usePathname: () => '/',
    useSearchParams: () => mockSearchParams,
  };
});

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,FAKE') },
}));

import HealthPaymentsPage from '../client-view';

const APP_A = { id: 'aa75ba6e-f8ce-4a55-8599-bd5b5459655d', applicationNumber: 'APP-2569-MUJZRHP3-69A796', status: 'DOC_FEE_PAID' };
const APP_B = { id: '2a60c16c-8428-4d48-8bc2-a27bf8e0f445', applicationNumber: 'APP-2569-MUGKQ2X1-3C9D10', status: 'DOC_FEE_PAID' };

function paidM1(id: string, invoiceNumber: string, receiptNumber: string, applicationId: string) {
  return {
    id,
    invoiceNumber,
    applicationId,
    totalAmount: '5885',
    status: 'paid',
    erpStatus: 'RECEIPT_ISSUED',
    receiptNumber,
    receiptIssuedAt: '2026-09-29T15:14:45.402Z',
    createdAt: '2026-09-29T15:13:49.554Z',
    paidAt: '2026-09-29T15:14:45.402Z',
    serviceType: 'CERTIFICATION_CHECKOUT_M1',
    lineItems: [
      { lineNumber: 1, code: 'PLATFORM_FEE', description: 'ค่าบริการตรวจประเมินและรับรองมาตรฐาน GACP', quantity: 1, unitPrice: '5500', amount: '5500' },
      { lineNumber: 2, code: 'PLATFORM_VAT', description: 'ภาษีมูลค่าเพิ่ม 7% (ของค่าบริการ)', quantity: 1, unitPrice: '385', amount: '385' },
    ],
  };
}

const INVOICE_A = paidM1('inv-a', 'INV-CO-09246C23-M1', 'TAX-PRD-2026-000002', APP_A.id);
const INVOICE_B = paidM1('inv-b', 'INV-CO-CAFF6646-M1', 'TAX-PRD-2026-000001', APP_B.id);

async function flushAsync(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function phaseSections(container: HTMLElement, phaseLabel: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[data-testid="two-card-phase-${phaseLabel}"]`));
}

describe('HealthPaymentsPage — invoices are grouped and labelled by application (O3)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Array.from(mockSearchParams.keys())) mockSearchParams.delete(key);
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/invoices/my') return { success: true, data: [INVOICE_A, INVOICE_B] };
      if (path === '/applications/my') return { success: true, data: [APP_A, APP_B] };
      return { success: true, data: [] };
    });
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

  it('two applications × งวดที่ 1 draw one section per application, each naming its application number', async () => {
    const el = await mountPage();

    const sections = phaseSections(el, 'งวดที่ 1');
    expect(sections).toHaveLength(2);

    const sectionA = sections.find((s) => (s.textContent || '').includes(APP_A.applicationNumber));
    const sectionB = sections.find((s) => (s.textContent || '').includes(APP_B.applicationNumber));
    expect(sectionA).toBeDefined();
    expect(sectionB).toBeDefined();
    expect(sectionA).not.toBe(sectionB);
    expect(sectionA!.textContent).not.toContain(APP_B.applicationNumber);
    expect(sectionB!.textContent).not.toContain(APP_A.applicationNumber);
  });

  it('each งวดที่ 1 total covers only that application (฿5,885), never the combined ฿11,770', async () => {
    const el = await mountPage();

    const sections = phaseSections(el, 'งวดที่ 1');
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      const total = section.querySelector('[data-testid="phase-total"]');
      expect(total).not.toBeNull();
      expect(total!.textContent).toContain('5,885');
      expect(section.textContent).not.toContain('11,770');
    }
  });

  it('each card names its invoice number and its application number', async () => {
    const el = await mountPage();

    const cards = Array.from(el.querySelectorAll<HTMLElement>('[data-testid="payment-invoice-card-CHECKOUT"]'));
    expect(cards).toHaveLength(2);
    const cardA = cards.find((c) => (c.textContent || '').includes(INVOICE_A.invoiceNumber));
    const cardB = cards.find((c) => (c.textContent || '').includes(INVOICE_B.invoiceNumber));
    expect(cardA).toBeDefined();
    expect(cardB).toBeDefined();
    expect(cardA!.querySelector('[data-testid="payment-invoice-number"]')?.textContent).toContain(INVOICE_A.invoiceNumber);
    expect(cardA!.querySelector('[data-testid="payment-invoice-application-number"]')?.textContent).toContain(APP_A.applicationNumber);
    expect(cardB!.querySelector('[data-testid="payment-invoice-number"]')?.textContent).toContain(INVOICE_B.invoiceNumber);
    expect(cardB!.querySelector('[data-testid="payment-invoice-application-number"]')?.textContent).toContain(APP_B.applicationNumber);
    // Never the internal id in place of the number.
    expect(el.querySelector('[data-testid="payment-invoice-application-number"]')?.textContent).not.toContain(APP_A.id);
  });

  it.each(['app', 'applicationId'])('?%s= still narrows the page to one application', async (param) => {
    mockSearchParams.set(param, APP_B.id);
    const el = await mountPage();

    const sections = phaseSections(el, 'งวดที่ 1');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.textContent).toContain(APP_B.applicationNumber);
    expect(sections[0]!.textContent).toContain(INVOICE_B.invoiceNumber);
    expect(el.textContent).not.toContain(INVOICE_A.invoiceNumber);
  });
});
