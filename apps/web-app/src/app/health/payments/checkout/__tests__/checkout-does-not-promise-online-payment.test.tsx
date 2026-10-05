/**
 * The checkout screen says what really happens (audit 2026-09-17 UXUI-X01,
 * operator decision 6).
 *
 * What really happens: POST /payments/checkout creates an order and a Stripe
 * PromptPay PaymentIntent and returns its clientSecret
 * (apps/backend/services/checkout/stripe-checkout-service.js). Since the
 * PromptPay QR step (2026-09-27) it also returns a publishable key, and with
 * one the screen opens Stripe's QR (checkout-promptpay-qr.test.tsx). Without
 * one (the mock adapter; the HAPPY fixture below) no QR can be shown and
 * nothing can be paid here, and this file pins that the screen says so.
 * And no staff member can take the payment instead: the fee states are
 * left only by the verified Stripe webhook
 * (apps/backend/services/workflow-transition-service.js — the finance roles
 * hold no transition).
 *
 * What the screen said: header "ดำเนินการชำระผ่านระบบออนไลน์"; after the press
 * "คุณยังไม่ถูกเรียกเก็บเงินจนกว่าจะทำขั้นตอนชำระเงินถัดไปเสร็จ" above a single
 * back link, a next step that does not exist; and on STRIPE_CHECKOUT_DISABLED
 * "กรุณาติดต่อเจ้าหน้าที่การเงินเพื่อดำเนินการชำระเงิน", a payment no staff
 * surface can record.
 *
 * Scaffold: checkout-states.test.tsx (same mocks, same helpers).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { CheckoutResult } from '@/lib/services/checkout-service';
import { HAPPY } from '@/lib/services/__fixtures__/checkout-fixtures';
import { ONLINE_PAYMENT_STEP_TH } from '@/constants/service-facts';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockCreateCheckout = jest.fn<(args: unknown) => Promise<CheckoutResult>>();
const mockGetPaymentTermsConsent = jest.fn<() => Promise<{ success: boolean; data?: unknown }>>();
const mockAcceptPaymentTerms = jest.fn<() => Promise<{ success: boolean }>>();

jest.mock('@/lib/services/checkout-service', () => {
  const actual = jest.requireActual('@/lib/services/checkout-service') as Record<string, unknown>;
  return {
    ...actual,
    createCheckout: (args: unknown) => mockCreateCheckout(args),
  };
});

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service') as {
    PaymentService: Record<string, unknown>;
  };
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getPaymentTermsConsent: () => mockGetPaymentTermsConsent(),
      acceptPaymentTerms: () => mockAcceptPaymentTerms(),
      getQuotations: async () => ({ dtam: null, platform: null }),
    },
  };
});

let mockSearchParams = new URLSearchParams();

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
    usePathname: () => '/health/payments/checkout',
    useSearchParams: () => mockSearchParams,
  };
});

import CheckoutClientView, { CHECKOUT_ERROR_MAP } from '../client-view';
import { metadata as checkoutMetadata } from '../page';

const START_LABEL = 'เริ่มขั้นตอนชำระเงิน';
const NOT_OPEN = 'ยังชำระค่าบริการผ่านระบบไม่ได้';
const NOT_CHARGED = 'ยังไม่ได้เรียกเก็บเงิน';
/** A sentence that sends the applicant to staff in order to PAY. */
const STAFF_TAKES_PAYMENT = /ติดต่อเจ้าหน้าที่[^ ]*\s*เพื่อ(ดำเนินการ)?ชำระ/;

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('checkout screen: no promise of an online payment it cannot take', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams({ app: 'APP-1', milestone: 'M1' });
    mockGetPaymentTermsConsent.mockResolvedValue({ success: true, data: { consents: {} } });
    mockAcceptPaymentTerms.mockResolvedValue({ success: true });
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

  async function mountView(): Promise<void> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<CheckoutClientView />);
    });
    await flushAsync();
  }

  async function tickTermsAndStart(): Promise<void> {
    const box = container!.querySelector<HTMLInputElement>('[data-testid="checkout-terms-checkbox"]');
    expect(box).not.toBeNull();
    await act(async () => {
      box!.click();
    });
    await flushAsync();
    const btn = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent || '').includes(START_LABEL),
    );
    expect(btn).toBeDefined();
    await act(async () => {
      btn!.click();
    });
    await flushAsync();
  }

  it('before the press: states only what holds whether or not the QR can be shown, and does not call it online payment', async () => {
    // Before the press this screen has not asked the backend whether a
    // publishable key exists (PromptPay QR step, 2026-09-27), so it may say
    // neither "cannot pay here" nor "pay now": it says how paying works and
    // what happens if the channel is not ready (ONLINE_PAYMENT_STEP_TH).
    await mountView();
    const text = container!.textContent || '';
    expect(text).not.toContain('ชำระผ่านระบบออนไลน์');
    expect(text).not.toContain('ชำระเงินออนไลน์');
    expect(text).not.toContain(NOT_OPEN);
    expect(text).toContain(ONLINE_PAYMENT_STEP_TH);
    expect(String(checkoutMetadata.title)).not.toContain('ออนไลน์');
    expect(String(checkoutMetadata.description)).not.toContain('ออนไลน์');
  });

  it('after the press with no publishable key in the response: names no next payment step, says nothing was charged and why', async () => {
    mockCreateCheckout.mockResolvedValue(HAPPY);
    await mountView();
    await tickTermsAndStart();

    const text = container!.textContent || '';
    expect(text).toContain('สร้างรายการสำเร็จ รอชำระเงิน');
    expect(text).not.toContain('ขั้นตอนชำระเงินถัดไป');
    expect(text).toContain(NOT_OPEN);
    expect(text).toContain(NOT_CHARGED);
  });

  it('the refund disclosure above the tick is the payment-terms no-refund rule (v1.1 §2, kept by v1.2 §7.1)', async () => {
    await mountView();
    const section = container!.querySelector('[data-testid="checkout-terms-section"]');
    expect(section).not.toBeNull();
    const text = (section!.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('ไม่สามารถขอคืนได้ แม้ผลจะไม่ผ่านหรือคำขอถูกยกเลิกเพราะพ้นกำหนดแก้ไข');
  });

  it('STRIPE_CHECKOUT_DISABLED does not send the applicant to finance staff to pay', async () => {
    mockCreateCheckout.mockResolvedValue({
      success: false,
      error: 'STRIPE_CHECKOUT_DISABLED',
      status: 503,
      code: 'STRIPE_CHECKOUT_DISABLED',
    } as CheckoutResult);
    await mountView();
    await tickTermsAndStart();

    const text = container!.textContent || '';
    expect(text).not.toContain('ติดต่อเจ้าหน้าที่การเงิน');
    expect(text).toContain(NOT_CHARGED);
  });

  it('no refusal on this screen tells the applicant that staff will take the payment', () => {
    for (const [code, sentence] of Object.entries(CHECKOUT_ERROR_MAP)) {
      expect(`${code}: ${STAFF_TAKES_PAYMENT.test(sentence)}`).toBe(`${code}: false`);
    }
    const src = fs.readFileSync(path.join(__dirname, '../client-view.tsx'), 'utf8');
    expect(src).not.toMatch(STAFF_TAKES_PAYMENT);
  });
});
