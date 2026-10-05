/**
 * checkout-states.test.tsx — W2-03 D2 state-assertion tests for the
 * `/health/payments/checkout` client view.
 *
 * Covers, per the D2 dispatch:
 *   1. loading  — pending createCheckout shows an indicator and disables
 *                 the start button (double-click guard).
 *   2. success  — HAPPY fixture renders the "สร้างรายการสำเร็จ รอชำระเงิน"
 *                 heading, the milestone FROM THE RESPONSE (not the query
 *                 param), and the payable digit-for-digit — one figure, no ledger split (operator 2026-09-07).
 *   3. no-client-math proof — HAPPY_NON_SUMMING must render total = 9999
 *                 exactly as the response says. If the UI recomputed the
 *                 total locally it would show 5885 and this test fails.
 *   4. no-paid-wording — the created state may NEVER contain paid wording;
 *                 the order is awaiting payment.
 *   5. 409      — CHECKOUT_ALREADY_IN_PROGRESS maps to the ground-truth
 *                 Thai copy character-for-character (scope amendment).
 *   6. 5xx / STRIPE_CHECKOUT_DISABLED / timeout — per-case Thai copy;
 *                 timeout additionally offers a working retry button.
 *   7. missing ?app — Thai error naming the cause + link back to
 *                 /health/payments; the service is never called.
 *   8. grep pin — the client-view source imports nothing from
 *                 constants/fees and performs no arithmetic on any
 *                 breakdown field.
 *
 * Strategy: createRoot + act with multiple microtask flushes (same
 * pattern as ../../__tests__/payments-states.test.tsx). createCheckout
 * is mocked at the module boundary so each test controls the envelope;
 * fixtures come verbatim from D1's __fixtures__/checkout-fixtures.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { CheckoutResult } from '@/lib/services/checkout-service';
import { milestoneLabelTh } from '@/lib/services/payment-service';
import {
  HAPPY,
  HAPPY_NON_SUMMING,
  CONFLICT_409,
  SERVER_ERROR_500,
  TIMEOUT,
} from '@/lib/services/__fixtures__/checkout-fixtures';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockCreateCheckout = jest.fn<(args: unknown) => Promise<CheckoutResult>>();
// F-G4-64 (coordinator ruling 2): the press now records the PAYMENT_TERMS
// acknowledgment through the SAME consent API the slip modal uses, before it
// asks for a charge. Stub both calls so this suite still tests the checkout
// states and not the consent transport; every assertion below is unchanged.
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
      // Final round R15: the idle screen reads the accepted quotation. This
      // suite is about the checkout states, so the lookup answers 'none' and
      // no network is touched.
      getQuotations: async () => ({ dtam: null, platform: null }),
    },
  };
});

// Pin next/navigation with a per-test mutable URLSearchParams. Stable
// router reference per the payments-states.test.tsx rationale.
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

import CheckoutClientView from '../client-view';

/** Same Intl pattern as the view (and payments formatCurrency). */
function thb(value: number): string {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
  }).format(value);
}

const GROUND_TRUTH_409_TH =
  'มีรายการชำระเงินของงวดนี้กำลังดำเนินการอยู่แล้ว กรุณาเปิดหน้าชำระเงินเดิมหรือลองใหม่อีกครั้ง';

const START_LABEL = 'เริ่มขั้นตอนชำระเงิน';
const SUCCESS_HEADING = 'สร้างรายการสำเร็จ รอชำระเงิน';

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('HealthPaymentsCheckout states (W2-03 D2)', () => {
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

  function findButton(label: string): HTMLButtonElement | null {
    return (
      Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((btn) =>
        (btn.textContent || '').includes(label),
      ) ?? null
    );
  }

  // The start button is disabled until the disclosure is answered, so every
  // press has to tick the box first (T12 item 11).
  async function tickTerms(): Promise<void> {
    const box = container!.querySelector<HTMLInputElement>('[data-testid="checkout-terms-checkbox"]');
    expect(box).not.toBeNull();
    await act(async () => {
      box!.click();
    });
    await flushAsync();
  }

  async function clickButton(label: string): Promise<void> {
    const btn = findButton(label);
    expect(btn).not.toBeNull();
    await act(async () => {
      btn!.click();
    });
    await flushAsync();
  }

  it('loading: pending createCheckout shows an indicator and disables the start button', async () => {
    let resolveCheckout!: (result: CheckoutResult) => void;
    mockCreateCheckout.mockReturnValue(
      new Promise<CheckoutResult>((resolve) => {
        resolveCheckout = resolve;
      }),
    );

    await mountView();
    await tickTerms();
    await clickButton(START_LABEL);

    // Still pending — the button must be disabled (double-click guard)
    // and a visible progress indicator must be present.
    const startBtn = findButton(START_LABEL);
    expect(startBtn).not.toBeNull();
    expect(startBtn!.disabled).toBe(true);
    expect(container!.querySelector('.animate-spin')).not.toBeNull();
    expect(container!.textContent).toContain('กำลังสร้างรายการชำระเงิน');

    // Drain the pending promise so nothing leaks into the next test.
    await act(async () => {
      resolveCheckout(HAPPY);
    });
    await flushAsync();
    expect(container!.textContent).toContain(SUCCESS_HEADING);
  });

  it('success (HAPPY): heading + milestone from the RESPONSE + the payable, without the ledger split', async () => {
    // Query milestone deliberately differs from the response milestone —
    // the success view must show data.milestone (M1), never the query (M99).
    mockSearchParams = new URLSearchParams({ app: 'APP-1', milestone: 'M99' });
    mockCreateCheckout.mockResolvedValue(HAPPY);

    await mountView();
    await tickTerms();
    await clickButton(START_LABEL);

    const text = container!.textContent || '';
    expect(text).toContain(SUCCESS_HEADING);

    const breakdown = HAPPY.data!.breakdown;
    // มติ operator 2026-09-07 (ปิด F-MONEY-UI-02): "ไม่ต้อง เราแยกตามบริการ …
    // เรื่ององค์ประกอบบัญชี จะไปคุยกันเอง" — จอนี้เคยกางครบสี่ยอด (ราคาเต็ม ·
    // ค่าแพลตฟอร์ม · VAT · รวม) ซึ่งคือบัญชีภายในของผู้ขาย ตอนนี้บอกแค่
    // "จ่ายค่าบริการอะไร งวดไหน เท่าไร รวมภาษีแล้ว" — ยอดเดียว ตรงกับที่ถูกเรียกเก็บ
    expect(text).toContain(thb(breakdown.totalPayableAmount));
    expect(text).not.toContain(thb(breakdown.platformFeeNet));
    expect(text).not.toContain(thb(breakdown.platformFeeVat));
    expect(text).toContain('รวมภาษีมูลค่าเพิ่มแล้ว');

    // Milestone comes from the response, not the query param — and since the
    // final round (R16 / finding S17) it is NAMED rather than printed as its
    // enum: this screen used to show the machine code 'M1' directly under a
    // document that calls the same thing งวดที่ 1. The label map is shared
    // (payment-service.PHASE_LABEL_TH), so the response still decides WHICH
    // instalment is named; only the wording is the product's.
    expect(text).toContain(milestoneLabelTh(HAPPY.data!.milestone));
    expect(text).not.toContain('M99');
    expect(text).not.toMatch(/งวดที่ต้องชำระM1/);

    // Params pass through to the service untouched.
    expect(mockCreateCheckout).toHaveBeenCalledWith({
      applicationId: 'APP-1',
      milestone: 'M99',
      mockScenario: undefined,
    });
  });

  it('no-client-math proof (HAPPY_NON_SUMMING): total renders 9999 exactly as the response says', async () => {
    mockCreateCheckout.mockResolvedValue(HAPPY_NON_SUMMING);

    await mountView();
    await tickTerms();
    await clickButton(START_LABEL);

    const text = container!.textContent || '';
    expect(text).toContain(SUCCESS_HEADING);
    // The response says 9999; a UI that recomputed the sum locally would
    // show 5885 instead and fail here.
    expect(text).toContain(thb(HAPPY_NON_SUMMING.data!.breakdown.totalPayableAmount));
    expect(text).toContain(thb(9999));
    expect(text).not.toContain(thb(5885));
  });

  it('no-paid-wording: the created state never claims the payment happened', async () => {
    mockCreateCheckout.mockResolvedValue(HAPPY);

    await mountView();
    await tickTerms();
    await clickButton(START_LABEL);

    const text = container!.textContent || '';
    expect(text).toContain(SUCCESS_HEADING);
    for (const forbidden of ['ชำระเงินสำเร็จ', 'จ่ายแล้ว', 'ชำระแล้ว', 'การชำระเงินเสร็จสมบูรณ์']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('409 conflict: ground-truth Thai copy character-for-character + mockScenario passthrough', async () => {
    mockSearchParams = new URLSearchParams({
      app: 'APP-1',
      milestone: 'M1',
      mockScenario: 'conflict',
    });
    mockCreateCheckout.mockResolvedValue(CONFLICT_409);

    await mountView();
    await tickTerms();
    await clickButton(START_LABEL);

    expect(container!.textContent).toContain(GROUND_TRUTH_409_TH);
    expect(mockCreateCheckout).toHaveBeenCalledWith({
      applicationId: 'APP-1',
      milestone: 'M1',
      mockScenario: 'conflict',
    });
  });

  it('5xx: generic Thai failure copy (no raw English code) + path back to the payments list', async () => {
    mockCreateCheckout.mockResolvedValue(SERVER_ERROR_500);

    await mountView();
    await tickTerms();
    await clickButton(START_LABEL);

    const text = container!.textContent || '';
    expect(text).toContain('ไม่สามารถสร้างรายการชำระเงินได้');
    expect(text).not.toContain('CHECKOUT_FAILED');
    expect(container!.querySelector('a[href="/health/payments"]')).not.toBeNull();
  });

  // Renamed from "...pointing at the legacy channel": there is no legacy
  // channel any more (slips retired, no staff role records a payment), and the
  // copy now says nothing was created or charged (operator decision 6).
  it('STRIPE_CHECKOUT_DISABLED: Thai copy saying online payment is not enabled', async () => {
    mockCreateCheckout.mockResolvedValue({
      success: false,
      error: 'STRIPE_CHECKOUT_DISABLED',
      status: 503,
      code: 'STRIPE_CHECKOUT_DISABLED',
    } as CheckoutResult);

    await mountView();
    await tickTerms();
    await clickButton(START_LABEL);

    const text = container!.textContent || '';
    expect(text).toContain('ระบบชำระเงินออนไลน์ยังไม่เปิดใช้งาน');
    expect(container!.querySelector('a[href="/health/payments"]')).not.toBeNull();
  });

  it('timeout: Thai retry copy + a retry button that calls createCheckout again', async () => {
    mockCreateCheckout.mockResolvedValueOnce(TIMEOUT);

    await mountView();
    await tickTerms();
    await clickButton(START_LABEL);

    expect(container!.textContent).toContain('เชื่อมต่อกับระบบไม่สำเร็จ');
    const retryBtn = findButton('ลองใหม่อีกครั้ง');
    expect(retryBtn).not.toBeNull();

    // Retry actually re-invokes the service and can succeed.
    mockCreateCheckout.mockResolvedValueOnce(HAPPY);
    await clickButton('ลองใหม่อีกครั้ง');
    expect(mockCreateCheckout).toHaveBeenCalledTimes(2);
    expect(container!.textContent).toContain(SUCCESS_HEADING);
  });

  it('missing ?app: Thai cause + link back to /health/payments, service never called', async () => {
    mockSearchParams = new URLSearchParams({ milestone: 'M1' });

    await mountView();

    const text = container!.textContent || '';
    expect(text).toContain('ไม่พบเลขคำขอ');
    expect(container!.querySelector('a[href="/health/payments"]')).not.toBeNull();
    expect(findButton(START_LABEL)).toBeNull();
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it('grep pin: client-view has no constants/fees import and no arithmetic on breakdown fields', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'client-view.tsx'), 'utf8');

    expect(src).not.toMatch(/constants\/fees/);

    const fields = [
      'platformFeeNet',
      'platformFeeVat',
      'platformFeeGross',
      'totalPayableAmount',
    ];
    for (const field of fields) {
      // No `<field> +`, `<field> *`, `<field> -`, `<field> /`, `<field> %` …
      expect(src).not.toMatch(new RegExp(`${field}\\s*[+\\-*/%]`));
      // …and no `+ breakdown.<field>` style either.
      expect(src).not.toMatch(new RegExp(`[+\\-*/%]\\s*(?:breakdown\\.)?${field}`));
    }
  });
});
