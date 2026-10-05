/**
 * checkout-shows-quotation-and-terms.test.tsx — F-G4-64.
 *
 * The page where the applicant actually pays must show WHAT they are paying
 * against, and take the Q4 acknowledgment.
 *
 * `grep -rin 'quotation|ใบเสนอราคา|ACCEPTED'` over this folder returned 0 lines
 * before this change (synthesis.md §1.2 row 15), and PAYMENT_TERMS consent lived
 * only in slip-upload-modal.tsx while payment_slips has 0 rows — so no applicant
 * has ever seen that disclosure (register.md G).
 *
 * Coordinator ruling 2 (2026-08-28) — ONE consent namespace. The acknowledgment
 * is recorded through the SAME consent API the slip modal uses
 * (POST /api/consent, category PAYMENT_TERMS), and the backend gate reads the
 * UserConsent ledger (services/billing/payment-terms-gate.js). The checkout
 * REQUEST therefore carries no version string and no acceptedAt: a request body
 * is not evidence that a human was shown a document, and
 * routes/api/finance/payments.js reads neither.
 *
 * Harness: the createRoot + act pattern from the sibling checkout-states.test.tsx
 * (@testing-library/react is not installed in this workspace).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { CheckoutResult } from '@/lib/services/checkout-service';
import type { QuotationsBySide } from '@/lib/services/payment-service';
import { HAPPY } from '@/lib/services/__fixtures__/checkout-fixtures';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockCreateCheckout = jest.fn<(args: unknown) => Promise<CheckoutResult>>();
const mockGetPaymentTermsConsent =
  jest.fn<() => Promise<{ success: boolean; data?: unknown }>>();
const mockAcceptPaymentTerms = jest.fn<() => Promise<{ success: boolean }>>();
// F-G4-64 final round R15: the idle screen names the document it is about to
// charge against, which it reads from the same endpoint the payments list uses.
const mockGetQuotations = jest.fn<() => Promise<QuotationsBySide | null>>();

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
      getQuotations: () => mockGetQuotations(),
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

const START_LABEL = 'เริ่มขั้นตอนชำระเงิน';
const TERMS_HEADING = 'เงื่อนไขการชำระเงินและการคืนเงิน';
const GRANTED_CONSENT = { consents: { PAYMENT_TERMS: { granted: true, version: '1.0.0' } } };

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('the checkout page names the document and takes the acknowledgment (F-G4-64)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams({ app: 'app-1', milestone: 'M1' });
    mockCreateCheckout.mockResolvedValue(HAPPY);
    // No consent on file — the ordinary first-time shape.
    mockGetPaymentTermsConsent.mockResolvedValue({ success: true, data: { consents: {} } });
    mockAcceptPaymentTerms.mockResolvedValue({ success: true });
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });
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

  function termsCheckbox(): HTMLInputElement | null {
    return container!.querySelector<HTMLInputElement>('[data-testid="checkout-terms-checkbox"]');
  }

  async function click(el: HTMLElement | null): Promise<void> {
    expect(el).not.toBeNull();
    await act(async () => {
      el!.click();
    });
    await flushAsync();
  }

  it('the start button is disabled until the payment terms are acknowledged', async () => {
    await mountView();

    expect(container!.textContent).toContain(TERMS_HEADING);
    expect(findButton(START_LABEL)!.disabled).toBe(true);

    await click(termsCheckbox());

    expect(findButton(START_LABEL)!.disabled).toBe(false);
  });

  it('the acknowledgment is recorded through the consent API, and the checkout request carries no version string', async () => {
    await mountView();
    await click(termsCheckbox());
    await click(findButton(START_LABEL));

    expect(mockAcceptPaymentTerms).toHaveBeenCalledTimes(1);
    expect(mockCreateCheckout).toHaveBeenCalledWith({
      applicationId: 'app-1',
      milestone: 'M1',
      mockScenario: undefined,
    });
    // Ruling 2: no second version namespace on the wire.
    const [args] = mockCreateCheckout.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(args)).not.toContain('paymentTermsAccepted');
  });

  it('a consent already on file enables the button and is not recorded twice', async () => {
    mockGetPaymentTermsConsent.mockResolvedValue({ success: true, data: GRANTED_CONSENT });

    await mountView();

    expect(termsCheckbox()).toBeNull();
    expect(findButton(START_LABEL)!.disabled).toBe(false);

    await click(findButton(START_LABEL));

    expect(mockAcceptPaymentTerms).not.toHaveBeenCalled();
    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);
  });

  it('a failed consent write stops before the charge and names the cause', async () => {
    mockAcceptPaymentTerms.mockResolvedValue({ success: false });

    await mountView();
    await click(termsCheckbox());
    await click(findButton(START_LABEL));

    expect(mockCreateCheckout).not.toHaveBeenCalled();
    expect(container!.textContent).toContain('บันทึกการยอมรับเงื่อนไขการชำระเงินไม่สำเร็จ');
  });

  it('the created state names the quotation the charge collects against', async () => {
    mockCreateCheckout.mockResolvedValue({
      success: true,
      data: {
        checkoutOrderId: 'co-1',
        paymentIntentId: 'pi_1',
        clientSecret: 's',
        milestone: 'M1',
        quotationNumber: 'QT-PRD-2026-000001',
        breakdown: {
          platformFeeNet: 5500,
          platformFeeVat: 385,
          platformFeeGross: 5885,
          totalPayableAmount: 5885,
        },
      },
    } as CheckoutResult);

    await mountView();
    await click(termsCheckbox());
    await click(findButton(START_LABEL));

    expect(container!.textContent).toContain('ใบเสนอราคาที่ยอมรับไว้');
    expect(container!.textContent).toContain('QT-PRD-2026-000001');
  });

  it('a response without a quotation number does not draw an empty row', async () => {
    await mountView();
    await click(termsCheckbox());
    await click(findButton(START_LABEL));

    expect(container!.textContent).not.toContain('ใบเสนอราคาที่ยอมรับไว้');
  });

  // The gate's seven refusals, straight off this screen. The per-code Thai
  // lives in CHECKOUT_ERROR_MAP (Policy 5) and is asserted through the map so
  // one sentence cannot be two things; what is proved here is that the code
  // travels to the screen as that sentence and never as itself.
  const RAIL_CODES = [
    'QUOTATION_NOT_ISSUED',
    'QUOTATION_NOT_ACCEPTED',
    'QUOTATION_EXPIRED',
    'QUOTATION_GATE_UNAVAILABLE',
    'CHECKOUT_PHASE_NOT_PRICED',
    'CHECKOUT_PRICE_DRIFT',
    'PAYMENT_TERMS_NOT_ACCEPTED',
  ] as const;

  it.each(RAIL_CODES)('the %s refusal reaches the screen in Thai, never as a raw code', async (code) => {
    mockCreateCheckout.mockResolvedValue({
      success: false,
      code,
      status: 409,
      error: code,
    } as CheckoutResult);

    await mountView();
    await click(termsCheckbox());
    await click(findButton(START_LABEL));

    const text = container!.textContent || '';
    expect(text).toContain(CHECKOUT_ERROR_MAP[code]);
    expect(text).not.toContain(code);
  });

  it('the PAYMENT_TERMS_NOT_ACCEPTED refusal puts the box back, so the sentence names a control that exists', async () => {
    // review r0 major 1 — the failure branch renders neither the terms section
    // nor the start button, so telling the applicant to tick and press again
    // named two controls that were not on the screen. The reachable case: a
    // grant on file under an older ConsentVersions.PAYMENT_TERMS.
    // isPaymentTermsGranted ignores the version, so the box was already
    // replaced by "ท่านได้ยอมรับเงื่อนไขนี้ไว้แล้ว", the press skipped
    // acceptPaymentTerms, payment-terms-gate.js refused, and a reload
    // re-derived the same state forever. slip-upload-modal.tsx recovers by
    // resetting both flags; this rail must too.
    mockGetPaymentTermsConsent.mockResolvedValue({ success: true, data: GRANTED_CONSENT });
    mockCreateCheckout.mockResolvedValue({
      success: false,
      code: 'PAYMENT_TERMS_NOT_ACCEPTED',
      status: 409,
      error: 'PAYMENT_TERMS_NOT_ACCEPTED',
    } as CheckoutResult);

    await mountView();
    expect(termsCheckbox()).toBeNull();

    await click(findButton(START_LABEL));

    expect(container!.textContent).toContain(CHECKOUT_ERROR_MAP.PAYMENT_TERMS_NOT_ACCEPTED);
    expect(termsCheckbox()).not.toBeNull();
    expect(findButton(START_LABEL)).not.toBeNull();

    // And the way back out really works: tick, press, and the acknowledgment is
    // recorded again under whatever version the server holds now.
    mockCreateCheckout.mockResolvedValue(HAPPY);
    await click(termsCheckbox());
    await click(findButton(START_LABEL));

    expect(mockAcceptPaymentTerms).toHaveBeenCalledTimes(1);
    expect(mockCreateCheckout).toHaveBeenCalledTimes(2);
  });

  it('every OTHER refusal keeps the failed state and does not reopen the box', async () => {
    mockGetPaymentTermsConsent.mockResolvedValue({ success: true, data: GRANTED_CONSENT });
    mockCreateCheckout.mockResolvedValue({
      success: false,
      code: 'QUOTATION_NOT_ACCEPTED',
      status: 409,
      error: 'QUOTATION_NOT_ACCEPTED',
    } as CheckoutResult);

    await mountView();
    await click(findButton(START_LABEL));

    expect(container!.textContent).toContain(CHECKOUT_ERROR_MAP.QUOTATION_NOT_ACCEPTED);
    expect(termsCheckbox()).toBeNull();
    expect(findButton(START_LABEL)).toBeNull();
  });

  it('the terms refusal points at the box on THIS page, which is the one that clears it', async () => {
    // The applicant is standing in front of the checkbox; sending them to the
    // payments list would name a longer road to the same act.
    expect(CHECKOUT_ERROR_MAP.PAYMENT_TERMS_NOT_ACCEPTED).toContain(TERMS_HEADING);
    expect(CHECKOUT_ERROR_MAP.PAYMENT_TERMS_NOT_ACCEPTED).toContain('หน้านี้');
  });
});

/**
 * Fix round 2 (review r1).
 *
 * MAJOR — the page must still run with no backend at all. `createCheckout` has
 * a mock branch ("mock: resolve the fixture … without touching the network",
 * checkout-service.ts); the consent read and the consent write did not, so
 * every press on the page in mock mode went through POST /api/consent first.
 * e2e/checkout-visual.spec.ts drives this exact page with
 * NEXT_PUBLIC_CHECKOUT_API_MODE=mock and NO server, and clicks the real
 * เริ่มขั้นตอนชำระเงิน button in four tests.
 *
 * MINOR — the tick's accessible name must be the sentence the applicant agrees
 * to, not the heading above it (WCAG 2.5.3: the visible label has to be part of
 * the accessible name). The slip rail's identical control carries no aria-label
 * (slip-upload-modal.tsx).
 */
describe('the checkout page in mock mode (F-G4-64 fix r2)', () => {
  const ORIGINAL_API_MODE = process.env.NEXT_PUBLIC_CHECKOUT_API_MODE;
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = 'mock';
    mockSearchParams = new URLSearchParams({ app: 'app-1', milestone: 'M1' });
    mockCreateCheckout.mockResolvedValue(HAPPY);
    // What a real mock-mode run gets when it asks a server that is not there.
    mockGetPaymentTermsConsent.mockRejectedValue(new Error('ECONNREFUSED'));
    mockAcceptPaymentTerms.mockRejectedValue(new Error('ECONNREFUSED'));
    // Same environment: no server to answer the quotation lookup either. The
    // page must still draw its disclosure and reach the fixture charge.
    mockGetQuotations.mockRejectedValue(new Error('ECONNREFUSED'));
  });

  afterEach(() => {
    if (ORIGINAL_API_MODE === undefined) {
      delete process.env.NEXT_PUBLIC_CHECKOUT_API_MODE;
    } else {
      process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = ORIGINAL_API_MODE;
    }
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

  function termsCheckbox(): HTMLInputElement | null {
    return container!.querySelector<HTMLInputElement>('[data-testid="checkout-terms-checkbox"]');
  }

  async function click(el: HTMLElement | null): Promise<void> {
    expect(el).not.toBeNull();
    await act(async () => {
      el!.click();
    });
    await flushAsync();
  }

  it('reads no consent ledger on mount: there is no backend to read it from', async () => {
    await mountView();

    expect(mockGetPaymentTermsConsent).not.toHaveBeenCalled();
  });

  it('the press writes no consent and still reaches the fixture charge', async () => {
    await mountView();
    await click(termsCheckbox());
    await click(findButton(START_LABEL));

    expect(mockAcceptPaymentTerms).not.toHaveBeenCalled();
    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain('สร้างรายการสำเร็จ รอชำระเงิน');
  });

  it('the disclosure is still shown and still has to be ticked', async () => {
    await mountView();

    expect(container!.textContent).toContain(TERMS_HEADING);
    expect(termsCheckbox()).not.toBeNull();
    expect(findButton(START_LABEL)!.disabled).toBe(true);

    await click(termsCheckbox());

    expect(findButton(START_LABEL)!.disabled).toBe(false);
  });
});

describe('the acknowledgment reads as what it acknowledges (F-G4-64 fix r2)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams({ app: 'app-1', milestone: 'M1' });
    mockCreateCheckout.mockResolvedValue(HAPPY);
    mockGetPaymentTermsConsent.mockResolvedValue({ success: true, data: { consents: {} } });
    mockAcceptPaymentTerms.mockResolvedValue({ success: true });
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });
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

  it('the tick carries no aria-label, so its name is the sentence in its own label', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<CheckoutClientView />);
    });
    await flushAsync();

    const box = container.querySelector<HTMLInputElement>('[data-testid="checkout-terms-checkbox"]');
    expect(box).not.toBeNull();
    // An aria-label REPLACES the label text for assistive tech and for voice
    // control, so the applicant would hear a heading and have to say a phrase
    // that is not on the screen.
    expect(box!.getAttribute('aria-label')).toBeNull();

    const label = box!.closest('label');
    expect(label).not.toBeNull();
    expect(label!.textContent).toContain('ข้าพเจ้าได้อ่านและยอมรับเงื่อนไขการชำระเงินและการคืนเงินข้างต้น');
  });
});

/**
 * Final fix round (2026-08-29) — rulings R15, R16, R17, R18.
 *
 * R15/S15/S22: spec §3.5 binds this screen to show "เลขใบเสนอราคา + ยอดงวดจาก
 * snapshot + ข้อความยินยอมเงื่อนไขการชำระเงิน (Q4) เป็นช่องติ๊กบังคับ". The
 * quotation number and the figures were rendered only in the `created` branch,
 * i.e. AFTER the consent was recorded and the order + PaymentIntent were minted,
 * so the tick and the pay button sat on a screen that named neither the
 * document nor the sum, while one of its own bullets asserted the amount was
 * locked "ตามใบเสนอราคาที่ท่านยอมรับไว้".
 *
 * R16/S17: the created screen printed `session.milestone` verbatim ('M1').
 * R17/S18: one system voice on the page (คุณ); ท่าน only inside the quoted
 * legal bullets. R18/C11: `bg-mint-soft` is a fixed light hex with no .dark
 * counterpart while text-foreground flips, so the new blocks need a token.
 */
describe('the idle screen names the document and the sum it is about to charge (final round R15)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  const ACCEPTED_ROW = {
    id: 'qt-1',
    applicationId: 'app-1',
    issuerType: 'PLATFORM' as const,
    quotationNumber: 'QT-PRD-2026-000001',
    subtotal: '33000.00',
    vat: '2310.00',
    totalAmount: '35310.00',
    status: 'ACCEPTED' as const,
    acceptedAt: '2026-08-28T00:00:00.000Z',
    createdAt: '2026-08-25T00:00:00.000Z',
    validUntil: '2026-09-24T00:00:00.000Z',
    // A real W14 row carries the per-phase split beside `amount` (GAP-5,
    // quotation-service._buildInstallments); the split describes the whole
    // phase and is what a snapshot-less row is read through.
    installments: [
      { phase: 'PHASE_1', amount: 5885, stateAmount: 5000, platformAmount: 500, vatAmount: 385 },
      { phase: 'PHASE_2', amount: 29425, stateAmount: 25000, platformAmount: 2500, vatAmount: 1925 },
    ],
    acceptedSnapshot: {
      quotationNumber: 'QT-PRD-2026-000001',
      issuerType: 'PLATFORM',
      currency: 'THB',
      installments: [
        { phase: 'PHASE_1', amount: 5885, stateAmount: 5000, platformAmount: 500, vatAmount: 385, phaseTotal: 5885 },
        { phase: 'PHASE_2', amount: 29425, stateAmount: 25000, platformAmount: 2500, vatAmount: 1925, phaseTotal: 29425 },
      ],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams({ app: 'app-1', milestone: 'M1' });
    mockCreateCheckout.mockResolvedValue(HAPPY);
    mockGetPaymentTermsConsent.mockResolvedValue({ success: true, data: { consents: {} } });
    mockAcceptPaymentTerms.mockResolvedValue({ success: true });
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: ACCEPTED_ROW });
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

  function summary(): HTMLElement | null {
    return container!.querySelector<HTMLElement>('[data-testid="checkout-quotation-summary"]');
  }

  function startButton(): HTMLButtonElement | null {
    return (
      Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((btn) =>
        (btn.textContent || '').includes(START_LABEL),
      ) ?? null
    );
  }

  it('shows the quotation number, the Thai instalment name and the accepted phase total BEFORE the tick', async () => {
    await mountView();

    // Still the pre-consent screen: nothing has been minted.
    expect(container!.querySelector('[data-testid="checkout-terms-checkbox"]')).not.toBeNull();
    expect(mockCreateCheckout).not.toHaveBeenCalled();

    const block = summary();
    expect(block).not.toBeNull();
    const text = block!.textContent || '';
    expect(text).toContain('QT-PRD-2026-000001');
    expect(text).toContain('งวดที่ 1 ค่าบริการตรวจสอบเอกสาร');
    // The snapshot's phaseTotal for the milestone on the URL, never a figure
    // this screen computed.
    expect(text).toContain('5,885');
    expect(text).not.toContain('29,425');
  });

  it('reads M2 from the URL and shows that instalment instead', async () => {
    mockSearchParams = new URLSearchParams({ app: 'app-1', milestone: 'M2' });

    await mountView();

    const text = summary()!.textContent || '';
    expect(text).toContain('งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง');
    expect(text).toContain('29,425');
  });

  /*
    Fix round 1 — reviewer MAJOR. A row with no acceptance snapshot still
    records the phase split (stateAmount/platformAmount/vatAmount), which is
    written identically onto both issuers' rows and describes the WHOLE phase
    (quotation-service._buildInstallments). That sum is the phase price; the
    row's own `amount` is only what THIS document asks for, and on a pre-W14
    PLATFORM row that is platform + VAT alone.
  */
  it('falls back to the phase the row records when it carries no snapshot', async () => {
    const noSnapshot = { ...ACCEPTED_ROW, acceptedSnapshot: null };
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: noSnapshot });

    await mountView();

    expect(summary()!.textContent).toContain('5,885');
  });

  it('a pre-W14 row closed by the repair script names the PHASE, not its own slice', async () => {
    // Spec §3.7: INVOICED with acceptedAt/acceptedBy/snapshot all null. The
    // gate passes it, the charge is minted from the full breakdown (29,425),
    // and this block sits directly above the no-refund tick — so printing the
    // row's 4,425 slice would take the consent against a figure nobody charges.
    mockSearchParams = new URLSearchParams({ app: 'app-1', milestone: 'M2' });
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: {
        ...ACCEPTED_ROW,
        status: 'INVOICED' as const,
        acceptedAt: null,
        acceptedSnapshot: null,
        installments: [
          { phase: 'PHASE_1', amount: 885, stateAmount: 5000, platformAmount: 500, vatAmount: 385 },
          { phase: 'PHASE_2', amount: 4425, stateAmount: 25000, platformAmount: 2500, vatAmount: 1925 },
        ],
      },
    });

    await mountView();

    const text = summary()!.textContent || '';
    expect(text).toContain('29,425');
    expect(text).not.toContain('4,425');
  });

  it('a row that never recorded the phase price names the document and no figure', async () => {
    // Pre-GAP-5 instalments carry {phase, amount} only. There is no honest
    // phase total to print, so the block prints the document and the instalment
    // and stops — it does not invent one, and it does not vanish either.
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: {
        ...ACCEPTED_ROW,
        acceptedSnapshot: null,
        installments: [{ phase: 'PHASE_1', amount: 5885 }, { phase: 'PHASE_2', amount: 29425 }],
      },
    });

    await mountView();

    const block = summary();
    expect(block).not.toBeNull();
    const text = block!.textContent || '';
    expect(text).toContain('QT-PRD-2026-000001');
    expect(text).toContain('งวดที่ 1 ค่าบริการตรวจสอบเอกสาร');
    expect(text).not.toContain('ยอดตามใบเสนอราคา');
    expect(text).not.toContain('5,885');
  });

  it('draws nothing when no quotation has been accepted: it may not name a document as accepted', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: { ...ACCEPTED_ROW, status: 'PENDING' as const, acceptedAt: null },
    });

    await mountView();

    expect(summary()).toBeNull();
  });

  it('a failed lookup is silent here, and never blocks the disclosure or the button', async () => {
    mockGetQuotations.mockResolvedValue(null);

    await mountView();

    expect(summary()).toBeNull();
    expect(container!.textContent).toContain(TERMS_HEADING);
    expect(startButton()).not.toBeNull();
  });

  it('the created screen names the instalment in Thai, never the raw enum (R16)', async () => {
    await mountView();
    await act(async () => {
      container!.querySelector<HTMLInputElement>('[data-testid="checkout-terms-checkbox"]')!.click();
    });
    await flushAsync();
    await act(async () => {
      startButton()!.click();
    });
    await flushAsync();

    const text = container!.textContent || '';
    expect(text).toContain('สร้างรายการสำเร็จ รอชำระเงิน');
    expect(text).toContain('งวดที่ 1 ค่าบริการตรวจสอบเอกสาร');
    expect(text).not.toMatch(/งวดที่ต้องชำระM1/);
  });

  it('the page speaks one voice: คุณ outside the quoted legal bullets (R17)', async () => {
    await mountView();

    const bullets = Array.from(
      container!.querySelectorAll('[data-testid="checkout-terms-section"] li'),
    ).map((li) => li.textContent || '');

    // The bullet about the accepted quotation drops the pronoun entirely.
    const quotationBullet = bullets.find((b) => b.includes('ใบเสนอราคา'));
    expect(quotationBullet).toBeDefined();
    expect(quotationBullet).not.toContain('ท่าน');
    expect(quotationBullet).not.toContain('คุณ');

    // And the system's own lines on this page never say ท่าน: every remaining
    // occurrence has to be inside a quoted legal bullet.
    const whole = container!.textContent || '';
    const insideBullets = bullets.join('');
    const occurrences = (whole.match(/ท่าน/g) || []).length;
    const inBullets = (insideBullets.match(/ท่าน/g) || []).length;
    expect(occurrences).toBe(inBullets);
  });

  it('the recorded-consent line is system voice, so it says คุณ (R17)', async () => {
    mockGetPaymentTermsConsent.mockResolvedValue({ success: true, data: GRANTED_CONSENT });

    await mountView();

    const recorded = container!.querySelector('[data-testid="checkout-terms-recorded"]');
    expect(recorded).not.toBeNull();
    expect(recorded!.textContent).toContain('คุณ');
    expect(recorded!.textContent).not.toContain('ท่าน');
  });

  it('the new blocks use token surfaces, so dark mode stays readable (R18)', async () => {
    await mountView();

    const terms = container!.querySelector('[data-testid="checkout-terms-section"]');
    expect(terms).not.toBeNull();
    const termsClass = terms!.className;
    expect(termsClass.includes('bg-muted') || termsClass.includes('dark:bg-muted')).toBe(true);

    const summaryClass = summary()!.className;
    expect(summaryClass.includes('bg-muted') || summaryClass.includes('dark:bg-muted')).toBe(true);
  });
});
