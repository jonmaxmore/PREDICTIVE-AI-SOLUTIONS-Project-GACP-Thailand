/**
 * The checkout screen takes a PromptPay payment (operator ruling 2026-09-27:
 * PromptPay only, shown by Stripe's own component; settlement only from the
 * webhook).
 *
 * What is pinned here:
 *   1. QR call path — with a publishable key in the checkout response, the pay
 *      button loads Stripe.js with THAT key (from the backend, never from the
 *      web build) and calls stripe.confirmPromptPayPayment(clientSecret, {
 *      payment_method: { billing_details: { email } } }), which is what opens
 *      Stripe's QR modal. @stripe/stripe-js is mocked at the module boundary.
 *   2. The client never marks anything paid — even when Stripe.js reports
 *      `succeeded`, the screen waits until the backend's invoice (the one the
 *      webhook settles) reads paid, and only then names the receipt number the
 *      system issued.
 *   3. A truthful timeout — if the webhook has not settled the invoice within
 *      the watch window, the screen says the system has not received the
 *      provider's confirmation; it does not say paid, and it does not say
 *      "not charged".
 *   4. Email — Stripe requires billing_details.email for PromptPay. The
 *      backend's payerEmail is used as-is; when it is null the screen asks, the
 *      button stays disabled until a well-formed address is typed, and that
 *      address is what Stripe receives. Nothing is invented.
 *   5. No key — the response carries no publishable key (mock adapter, or a
 *      fixture): no pay button, Stripe.js is never loaded, and the screen says
 *      the QR cannot be shown and nothing was charged.
 *   6. The fail-closed refusals the backend raises before minting map to Thai.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { CheckoutResult } from '@/lib/services/checkout-service';
import type { PaymentRecord } from '@/lib/services/payment-service';
import { HAPPY } from '@/lib/services/__fixtures__/checkout-fixtures';
import { FINANCE_EMAIL } from '@/constants/contact-emails';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockCreateCheckout = jest.fn<(args: unknown) => Promise<CheckoutResult>>();
const mockGetPaymentTermsConsent = jest.fn<() => Promise<{ success: boolean; data?: unknown }>>();
const mockAcceptPaymentTerms = jest.fn<() => Promise<{ success: boolean }>>();
const mockGetMyPayments = jest.fn<() => Promise<PaymentRecord[]>>();

type ConfirmResult = { error?: { message?: string; payment_intent?: { status?: string } }; paymentIntent?: { status: string } };
const mockConfirmPromptPayPayment = jest.fn<(secret: string, data: unknown) => Promise<ConfirmResult>>();
const mockLoadStripe = jest.fn<(key: string) => Promise<unknown>>();

jest.mock('@stripe/stripe-js/pure', () => ({
  loadStripe: (key: string) => mockLoadStripe(key),
}));

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
      getMyPayments: () => mockGetMyPayments(),
    },
  };
});

let mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => {
  const router = {
    push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(),
    forward: jest.fn(), prefetch: jest.fn(), pathname: '/', query: {},
  };
  return {
    useRouter: () => router,
    usePathname: () => '/health/payments/checkout',
    useSearchParams: () => mockSearchParams,
  };
});

import CheckoutClientView, {
  CHECKOUT_ERROR_MAP,
  SETTLEMENT_POLL_INTERVAL_MS,
  SETTLEMENT_WATCH_TIMEOUT_MS,
} from '../client-view';

// A placeholder, split so secret-literal scanners never match it.
const PK = 'pk_test_' + 'q'.repeat(24);
const SECRET = 'pi_live_like_1_secret_abc';
const START_LABEL = 'เริ่มขั้นตอนชำระเงิน';
const PAY_LABEL = 'ชำระด้วย QR พร้อมเพย์';
const WAITING = 'กำลังรอการยืนยันการชำระเงินจากผู้ให้บริการรับชำระเงิน';
const NOT_CONFIRMED = 'ระบบยังไม่ได้รับการยืนยันจากผู้ให้บริการรับชำระเงิน';
const PAID_HEADING = 'ชำระเงินสำเร็จ';

function withKey(overrides: Record<string, unknown> = {}): CheckoutResult {
  return {
    success: true,
    data: {
      ...HAPPY.data!,
      clientSecret: SECRET,
      publishableKey: PK,
      invoiceId: 'inv-1',
      payerEmail: 'accounts@farm-co.example',
      ...overrides,
    },
  } as CheckoutResult;
}

function invoice(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'inv-1',
    type: 'INVOICE',
    documentNumber: 'INV-CO-1',
    amount: 5535,
    status: 'PENDING',
    erpStatus: 'PENDING',
    createdAt: '2026-09-27T00:00:00.000Z',
    serviceType: 'CERTIFICATION_CHECKOUT_M1',
    phase: 'PHASE_1',
    component: 'CHECKOUT',
    isPaid: false,
    isCancelled: false,
    receiptNumber: null,
    receiptIssuedAt: null,
    ...overrides,
  } as PaymentRecord;
}

async function flushAsync(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('checkout screen: PromptPay QR through Stripe.js, settled only by the webhook', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockSearchParams = new URLSearchParams({ app: 'APP-1', milestone: 'M1' });
    mockGetPaymentTermsConsent.mockResolvedValue({ success: true, data: { consents: {} } });
    mockAcceptPaymentTerms.mockResolvedValue({ success: true });
    mockLoadStripe.mockResolvedValue({
      confirmPromptPayPayment: (s: string, d: unknown) => mockConfirmPromptPayPayment(s, d),
    });
    mockGetMyPayments.mockResolvedValue([invoice()]);
  });

  afterEach(() => {
    if (root) {
      act(() => { root?.unmount(); });
      root = null;
    }
    container?.remove();
    container = null;
    jest.useRealTimers();
  });

  async function mountAndCreate(result: CheckoutResult): Promise<void> {
    mockCreateCheckout.mockResolvedValue(result);
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<CheckoutClientView />);
    });
    await flushAsync();
    const box = container.querySelector<HTMLInputElement>('[data-testid="checkout-terms-checkbox"]');
    await act(async () => { box!.click(); });
    await flushAsync();
    const start = buttonByText(START_LABEL);
    await act(async () => { start!.click(); });
    await flushAsync();
  }

  function buttonByText(label: string): HTMLButtonElement | undefined {
    return Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent || '').includes(label),
    );
  }

  async function pressPay(): Promise<void> {
    const pay = buttonByText(PAY_LABEL);
    expect(pay).toBeDefined();
    await act(async () => { pay!.click(); });
    await flushAsync();
  }

  const text = () => (container!.textContent || '').replace(/\s+/g, ' ');

  it('loads Stripe.js with the key the BACKEND returned and opens the PromptPay confirm with the payer email', async () => {
    mockConfirmPromptPayPayment.mockResolvedValue({ paymentIntent: { status: 'requires_action' } });
    await mountAndCreate(withKey());

    // Nothing Stripe-side happens before the applicant asks for the QR.
    expect(mockLoadStripe).not.toHaveBeenCalled();
    await pressPay();

    expect(mockLoadStripe).toHaveBeenCalledWith(PK);
    expect(mockConfirmPromptPayPayment).toHaveBeenCalledTimes(1);
    expect(mockConfirmPromptPayPayment).toHaveBeenCalledWith(SECRET, {
      payment_method: { billing_details: { email: 'accounts@farm-co.example' } },
    });
  });

  it('Stripe.js saying "succeeded" is NOT paid: the screen waits for the webhook-settled invoice, then names the receipt the system issued', async () => {
    jest.useFakeTimers();
    mockConfirmPromptPayPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    await mountAndCreate(withKey());
    await pressPay();

    expect(text()).toContain(WAITING);
    expect(text()).not.toContain(PAID_HEADING);
    for (const forbidden of ['ชำระเงินสำเร็จ', 'จ่ายแล้ว', 'ชำระแล้ว', 'การชำระเงินเสร็จสมบูรณ์']) {
      expect(text()).not.toContain(forbidden);
    }

    // The first watch still sees the invoice unpaid (the webhook has not landed).
    await act(async () => { jest.advanceTimersByTime(SETTLEMENT_POLL_INTERVAL_MS); });
    await flushAsync();
    expect(text()).not.toContain(PAID_HEADING);

    // The webhook settles it: paid, with the receipt number settlement wrote.
    mockGetMyPayments.mockResolvedValue([
      invoice({ isPaid: true, status: 'RECEIPT_ISSUED', erpStatus: 'RECEIPT_ISSUED', receiptNumber: 'TAX-PRD-2569-000123' }),
    ]);
    await act(async () => { jest.advanceTimersByTime(SETTLEMENT_POLL_INTERVAL_MS); });
    await flushAsync();

    expect(text()).toContain(PAID_HEADING);
    expect(text()).toContain('TAX-PRD-2569-000123');
    expect(mockGetMyPayments).toHaveBeenCalled();
  });

  it('once settled, nothing on the screen still says it is waiting for payment (found by the real walk, A09)', async () => {
    jest.useFakeTimers();
    mockConfirmPromptPayPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    mockGetMyPayments.mockResolvedValue([
      invoice({ isPaid: true, status: 'RECEIPT_ISSUED', erpStatus: 'RECEIPT_ISSUED', receiptNumber: 'TAX-PRD-2569-000123' }),
    ]);
    await mountAndCreate(withKey());
    await pressPay();
    await act(async () => { jest.advanceTimersByTime(SETTLEMENT_POLL_INTERVAL_MS); });
    await flushAsync();

    expect(text()).toContain(PAID_HEADING);
    expect(text()).not.toContain('รอชำระเงิน');
    const headings = Array.from(container!.querySelectorAll('h2')).map((h) => (h.textContent || '').trim());
    expect(headings).toContain('ชำระเงินสำเร็จ');
  });

  it('only the invoice this order settles counts: another paid invoice does not end the wait', async () => {
    jest.useFakeTimers();
    mockConfirmPromptPayPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    mockGetMyPayments.mockResolvedValue([
      invoice({ id: 'inv-OTHER', isPaid: true, receiptNumber: 'TAX-PRD-2569-000001' }),
      invoice(),
    ]);
    await mountAndCreate(withKey());
    await pressPay();
    await act(async () => { jest.advanceTimersByTime(SETTLEMENT_POLL_INTERVAL_MS * 3); });
    await flushAsync();
    expect(text()).not.toContain(PAID_HEADING);
    expect(text()).toContain(WAITING);
  });

  it('when the webhook has not settled it within the watch window, the screen says so truthfully', async () => {
    jest.useFakeTimers();
    mockConfirmPromptPayPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    await mountAndCreate(withKey());
    await pressPay();

    await act(async () => { jest.advanceTimersByTime(SETTLEMENT_WATCH_TIMEOUT_MS + SETTLEMENT_POLL_INTERVAL_MS); });
    await flushAsync();

    expect(text()).toContain(NOT_CONFIRMED);
    expect(text()).not.toContain(PAID_HEADING);
    // After a scan, "you were not charged" is not something this screen knows.
    expect(text()).not.toContain('ระบบยังไม่ได้เรียกเก็บเงินจากคุณ');
    expect(buttonByText('ตรวจสอบอีกครั้ง')).toBeDefined();
  });

  it('closing Stripe\'s modal without paying does not claim a payment and offers the QR again', async () => {
    mockConfirmPromptPayPayment.mockResolvedValue({ paymentIntent: { status: 'requires_payment_method' } });
    await mountAndCreate(withKey());
    await pressPay();
    expect(text()).not.toContain(PAID_HEADING);
    expect(text()).not.toContain(WAITING);
    expect(text()).toContain('ยังไม่มีการยืนยันการชำระเงิน');
    expect(buttonByText(PAY_LABEL)).toBeDefined();
  });

  it('a Stripe error shows Thai copy, never Stripe\'s English message, and keeps the button', async () => {
    mockConfirmPromptPayPayment.mockResolvedValue({ error: { message: 'Something went wrong in English' } });
    await mountAndCreate(withKey());
    await pressPay();
    expect(text()).not.toContain('Something went wrong in English');
    expect(text()).toContain('แสดง QR พร้อมเพย์ไม่สำเร็จ');
    expect(buttonByText(PAY_LABEL)).toBeDefined();
  });

  it('Stripe.js that fails to load (blocked, offline) is an error, not a silent no-op', async () => {
    mockLoadStripe.mockResolvedValue(null);
    await mountAndCreate(withKey());
    await pressPay();
    expect(mockConfirmPromptPayPayment).not.toHaveBeenCalled();
    expect(text()).toContain('แสดง QR พร้อมเพย์ไม่สำเร็จ');
  });

  it('no payer email on record: asks for one, keeps the button disabled until it is well-formed, and sends exactly what was typed', async () => {
    mockConfirmPromptPayPayment.mockResolvedValue({ paymentIntent: { status: 'requires_action' } });
    await mountAndCreate(withKey({ payerEmail: null }));

    const input = container!.querySelector<HTMLInputElement>('[data-testid="checkout-payer-email-input"]');
    expect(input).not.toBeNull();
    expect(input!.required).toBe(true);
    expect(input!.value).toBe('');
    expect(buttonByText(PAY_LABEL)!.disabled).toBe(true);

    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, 'not-an-email');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(buttonByText(PAY_LABEL)!.disabled).toBe(true);

    await act(async () => {
      setValue.call(input, 'typed@farmer.example');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(buttonByText(PAY_LABEL)!.disabled).toBe(false);
    await pressPay();

    expect(mockConfirmPromptPayPayment).toHaveBeenCalledWith(SECRET, {
      payment_method: { billing_details: { email: 'typed@farmer.example' } },
    });
  });

  it('review M-3: a pre-filled payer email sits in an editable field, is re-validated, and what the payer corrects is what Stripe receives', async () => {
    mockConfirmPromptPayPayment.mockResolvedValue({ paymentIntent: { status: 'requires_action' } });
    await mountAndCreate(withKey());

    const input = container!.querySelector<HTMLInputElement>('[data-testid="checkout-payer-email-input"]');
    expect(input).not.toBeNull();
    expect(input!.value).toBe('accounts@farm-co.example');
    expect(input!.readOnly).toBe(false);

    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, 'broken@');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(buttonByText(PAY_LABEL)!.disabled).toBe(true);

    await act(async () => {
      setValue.call(input, 'current-accounts@farm-co.example');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pressPay();
    expect(mockConfirmPromptPayPayment).toHaveBeenCalledWith(SECRET, {
      payment_method: { billing_details: { email: 'current-accounts@farm-co.example' } },
    });
  });

  it('review I-1: re-entering an order whose intent already SUCCEEDED shows no pay button and waits for the webhook, never loading Stripe.js', async () => {
    jest.useFakeTimers();
    await mountAndCreate(withKey({ clientSecret: null, paymentIntentStatus: 'succeeded' }));

    expect(buttonByText(PAY_LABEL)).toBeUndefined();
    expect(text()).toContain(WAITING);
    expect(mockLoadStripe).not.toHaveBeenCalled();

    mockGetMyPayments.mockResolvedValue([
      invoice({ isPaid: true, status: 'RECEIPT_ISSUED', erpStatus: 'RECEIPT_ISSUED', receiptNumber: 'TAX-PRD-2569-000124' }),
    ]);
    await act(async () => { jest.advanceTimersByTime(SETTLEMENT_POLL_INTERVAL_MS); });
    await flushAsync();
    expect(text()).toContain('TAX-PRD-2569-000124');
  });

  it('review I-1: a reused intent that is still processing also waits instead of offering a second confirm', async () => {
    await mountAndCreate(withKey({ paymentIntentStatus: 'processing' }));
    expect(buttonByText(PAY_LABEL)).toBeUndefined();
    expect(text()).toContain(WAITING);
  });

  it('review I-2 (operator 2026-09-27): no sentence on the pay step names the provider', async () => {
    await mountAndCreate(withKey({ payerEmail: null }));
    const section = container!.querySelector('[data-testid="checkout-promptpay-step"]');
    expect(section!.textContent).not.toMatch(/stripe/i);
    expect(section!.textContent).toContain('ผู้ให้บริการรับชำระเงิน');
  });

  it('no publishable key in the response: no pay button, Stripe.js never loads, and the screen says the QR cannot be shown and nothing was charged', async () => {
    await mountAndCreate(HAPPY);
    expect(buttonByText(PAY_LABEL)).toBeUndefined();
    expect(mockLoadStripe).not.toHaveBeenCalled();
    expect(text()).toContain('ยังแสดง QR พร้อมเพย์ให้สแกนไม่ได้');
    expect(text()).toContain('ระบบยังไม่ได้เรียกเก็บเงินจากคุณ');
  });

  it('fix round 3 (N-2): CHECKOUT_INTENT_UNUSABLE and CHECKOUT_ORDER_CHANGED have their own true Thai copy, name no provider, and UNUSABLE sends the payer to the company instead of a retry', async () => {
    const unusable = CHECKOUT_ERROR_MAP.CHECKOUT_INTENT_UNUSABLE;
    const changed = CHECKOUT_ERROR_MAP.CHECKOUT_ORDER_CHANGED;
    expect(typeof unusable).toBe('string');
    expect(typeof changed).toBe('string');
    for (const sentence of [unusable, changed]) {
      expect(sentence).not.toMatch(/stripe/i);
      expect(sentence).not.toMatch(/[A-Z]{3,}_[A-Z_]+/); // no raw code on screen
    }
    // A retry refuses again, so UNUSABLE must not offer one and must name the
    // company's contact from the one contact source.
    expect(unusable).toContain(FINANCE_EMAIL);
    expect(unusable).not.toMatch(/ลองใหม่/);

    mockCreateCheckout.mockResolvedValue({
      success: false, error: 'CHECKOUT_INTENT_UNUSABLE', code: 'CHECKOUT_INTENT_UNUSABLE', status: 409,
    } as CheckoutResult);
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<CheckoutClientView />);
    });
    await flushAsync();
    await act(async () => { container!.querySelector<HTMLInputElement>('[data-testid="checkout-terms-checkbox"]')!.click(); });
    await flushAsync();
    await act(async () => { buttonByText(START_LABEL)!.click(); });
    await flushAsync();
    expect(text()).toContain(unusable);
    expect(buttonByText('ลองใหม่อีกครั้ง')).toBeUndefined();
  });

  it('the backend fail-closed refusals map to Thai copy that says the QR is not available and nothing was charged', () => {
    for (const code of ['STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED', 'STRIPE_KEY_MODE_MISMATCH', 'STRIPE_NOT_CONFIGURED']) {
      const sentence = CHECKOUT_ERROR_MAP[code];
      expect(`${code}: ${typeof sentence}`).toBe(`${code}: string`);
      expect(sentence).toContain('ยังแสดง QR พร้อมเพย์ให้สแกนไม่ได้');
      expect(sentence).toContain('ระบบยังไม่ได้เรียกเก็บเงินจากคุณ');
    }
  });
});
