/**
 * /health/payments says what really happens (audit 2026-09-17 UXUI-X01,
 * operator decision 6).
 *
 * The checkout entry on this page leads to a screen that creates an order and
 * stops: the web app never shows the PromptPay QR (no Stripe.js, the returned
 * clientSecret is unused), so nothing can be paid there yet. The page said
 * otherwise: "ชำระค่าธรรมเนียมออนไลน์ผ่านระบบ" in its header, "คุณสามารถสร้าง
 * รายการชำระเงินและชำระผ่านระบบออนไลน์ได้ทันที" beside a "ชำระเงินออนไลน์"
 * button, and, with the checkout flag off, "ติดต่อเจ้าหน้าที่เพื่อชำระ
 * ค่าธรรมเนียม" although no staff role can record a payment
 * (apps/backend/services/workflow-transition-service.js: the fee states are left
 * only by the verified Stripe webhook).
 *
 * Scaffold: payments-checkout-flag-off-notice.test.tsx (same mocks).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { PaymentRecord, QuotationsBySide, QuotationStatus } from '@/lib/services/payment-service';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGetMyPayments = jest.fn<() => Promise<PaymentRecord[]>>();
const mockGetQuotations = jest.fn<() => Promise<QuotationsBySide | null>>();
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

jest.mock('@/lib/config/checkout-mode', () => ({
  getCheckoutApiMode: () => 'live',
  isCheckoutUiEnabled: () => mockIsCheckoutUiEnabled(),
}));

jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: () => ({ id: 'user-1', role: 'HEALTH', email: 'farmer@test' }),
  },
}));

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
import { PHASE_DUE_COPY_TH } from '../phase-due-state';
import { ONLINE_PAYMENT_STEP_TH } from '@/constants/service-facts';

const CHECKOUT_LINK_SELECTOR = 'a[href^="/health/payments/checkout"]';
const NOT_OPEN = 'ยังชำระค่าบริการผ่านระบบไม่ได้';
const NOT_CHARGED = 'ยังไม่ได้เรียกเก็บเงิน';
const STAFF_TAKES_PAYMENT = /ติดต่อเจ้าหน้าที่[^ ]*\s*เพื่อ(ดำเนินการ)?ชำระ/;

const unpaidCheckoutM1: PaymentRecord = {
  id: 'inv-co-m1-open',
  type: 'INVOICE',
  documentNumber: 'INV-CO-D810DEBF-M1',
  applicationId: 'APP-1',
  amount: 5885,
  status: 'PENDING',
  erpStatus: 'PENDING',
  createdAt: '2026-08-26T03:00:00.000Z',
  serviceType: 'CERTIFICATION_CHECKOUT_M1',
  phase: 'PHASE_1',
  component: 'CHECKOUT',
  isPaid: false,
  isCancelled: false,
};

function quotation(status: QuotationStatus): QuotationsBySide {
  return {
    dtam: null,
    platform: {
      id: 'qt-1',
      applicationId: 'APP-1',
      issuerType: 'PLATFORM',
      quotationNumber: 'QT-PRD-2026-000001',
      subtotal: '33000.00',
      vat: '2310.00',
      totalAmount: '35310.00',
      status,
      createdAt: '2026-08-25T00:00:00.000Z',
      lineItems: [],
    },
  };
}

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('/health/payments: no promise of an online payment it cannot take', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMyPayments.mockResolvedValue([unpaidCheckoutM1]);
    mockGetQuotations.mockResolvedValue(quotation('ACCEPTED'));
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

  async function mountPage(): Promise<string> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();
    return container.textContent || '';
  }

  // PromptPay QR step (2026-09-27): the page behind the entry shows Stripe's QR
  // when the backend holds a publishable key and says it cannot when it does
  // not. This page does not ask, so it states the sentence true in both
  // (ONLINE_PAYMENT_STEP_TH) and claims neither.
  it('flag on, debt, accepted quotation: the entry says how paying works without promising or denying it', async () => {
    mockIsCheckoutUiEnabled.mockReturnValue(true);
    const text = await mountPage();

    const link = container!.querySelector<HTMLAnchorElement>(CHECKOUT_LINK_SELECTOR);
    expect(link).not.toBeNull();
    expect(link!.textContent).not.toContain('ออนไลน์');
    expect(text).not.toContain('ชำระผ่านระบบออนไลน์ได้ทันที');
    expect(text).not.toContain('ชำระค่าธรรมเนียมออนไลน์ผ่านระบบ');
    expect(text).toContain(ONLINE_PAYMENT_STEP_TH);
    expect(text).not.toContain(NOT_OPEN);
  });

  it('flag on, pending quotation: the pointer does not promise online payment after acceptance', async () => {
    mockIsCheckoutUiEnabled.mockReturnValue(true);
    mockGetQuotations.mockResolvedValue(quotation('PENDING'));
    const text = await mountPage();

    expect(text).toContain('ยอมรับใบเสนอราคาก่อน');
    expect(text).not.toContain('ชำระเงินออนไลน์');
  });

  it('flag on, failed quotation lookup: names no online-payment button', async () => {
    mockIsCheckoutUiEnabled.mockReturnValue(true);
    mockGetQuotations.mockResolvedValue(null);
    const text = await mountPage();

    expect(text).toContain('ตรวจสอบใบเสนอราคาไม่สำเร็จ');
    expect(text).not.toContain('ชำระเงินออนไลน์');
  });

  it('flag off, debt: the notice does not send the applicant to staff to pay, and says nothing was charged', async () => {
    mockIsCheckoutUiEnabled.mockReturnValue(false);
    const text = await mountPage();

    const notice = Array.from(container!.querySelectorAll('[role="status"]')).find((el) =>
      (el.textContent || '').includes('ระบบยังไม่เปิดช่องทางชำระเงินในสภาพแวดล้อมนี้'),
    );
    expect(notice).toBeDefined();
    expect(notice!.textContent).not.toMatch(STAFF_TAKES_PAYMENT);
    expect(notice!.textContent).toContain(NOT_CHARGED);
    expect(text).not.toContain('ออนไลน์');
  });

  it('the phase chips say whether an instalment is due, not that it can be paid now', () => {
    // The DUE_NOW chip said "ชำระงวดนี้ได้เลย" under the notice that nothing can
    // be paid through the system yet; NOT_YET promised "ระบบจะเปิดให้ชำระ".
    for (const { hint } of Object.values(PHASE_DUE_COPY_TH)) {
      expect(hint).not.toContain('ได้เลย');
      expect(hint).not.toContain('เปิดให้ชำระ');
    }
    expect(PHASE_DUE_COPY_TH.DUE_NOW.hint).toContain('ถึงกำหนดชำระ');
  });

  it('no sentence in the page source sends the applicant to staff to pay', () => {
    const src = fs.readFileSync(path.join(__dirname, '../client-view.tsx'), 'utf8');
    expect(src).not.toMatch(STAFF_TAKES_PAYMENT);
  });
});
