/**
 * payments-checkout-entry-needs-accepted-quotation.test.tsx — F-G4-64.
 *
 * The "ชำระเงินออนไลน์" entry needs an ACCEPTED quotation as well as a debt.
 *
 * The backend now refuses with QUOTATION_NOT_ACCEPTED (409)
 * (services/billing/quotation-gate.js, called by createCheckoutForApplication).
 * A button that leads straight to a refusal is a screen that sends the
 * applicant down a corridor with a locked door at the end; the card that can
 * unlock it (QuotationReviewSection) is on this same page, just below.
 *
 * The gate mirrors the backend's: EVERY quotation the application holds must
 * be accepted (a pre-W14 application legitimately carries a DTAM row too, and
 * both priced part of the bill), and holding none is not "accepted" either.
 *
 * Scaffold copied verbatim from payments-checkout-entry-needs-debt.test.tsx so
 * the two files cannot drift: createRoot + act with microtask flushes,
 * `@/lib/config/checkout-mode` mocked so the flag flips without process.env,
 * heavy child sections mocked to null so the page settles without fan-out.
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

const APP_ID = 'APP-1';
// Operator decision 6 (2026-09-17, audit UXUI-X01): the entry was labelled
// "ชำระเงินออนไลน์", but the screen behind it cannot take a payment yet (no
// PromptPay QR is shown), so it is named for what it does.
const CHECKOUT_ENTRY_LABEL = 'สร้างรายการชำระเงิน';
const CHECKOUT_LINK_SELECTOR = 'a[href^="/health/payments/checkout"]';
const POINTER_COPY = 'ยอมรับใบเสนอราคาก่อน จึงจะสร้างรายการชำระเงินได้';
const WAITING_COPY = 'ระบบกำลังออกใบเสนอราคาของคำขอนี้';
const STAFF_COPY = 'ไม่สามารถกดยอมรับได้แล้ว';
// review r2 minor 4 — the notice named a staff function that does not exist:
// no quotation route lives under routes/api/admin or routes/api/provider, so
// nobody can void and re-issue. What staff can act on is the document number.
const REISSUE_PROMISE = 'ออกใบเสนอราคาใหม่';
const STAFF_CONTACT_COPY = 'กรุณาติดต่อเจ้าหน้าที่';
const LOOKUP_FAILED_COPY = 'ตรวจสอบใบเสนอราคาไม่สำเร็จ';

const unpaidCheckoutM1: PaymentRecord = {
  id: 'inv-co-m1-open',
  type: 'INVOICE',
  documentNumber: 'INV-CO-D810DEBF-M1',
  applicationId: APP_ID,
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

const paidCheckoutM1: PaymentRecord = {
  ...unpaidCheckoutM1,
  id: 'inv-co-m1',
  type: 'RECEIPT',
  status: 'RECEIPT_ISSUED',
  erpStatus: 'RECEIPT_ISSUED',
  paidAt: '2026-08-26T03:05:00.000Z',
  isPaid: true,
};

function quotation(status: QuotationStatus): QuotationsBySide {
  return {
    dtam: null,
    platform: {
      id: 'qt-1',
      applicationId: APP_ID,
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

describe('HealthPaymentsPage checkout entry needs an accepted quotation (F-G4-64)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsCheckoutUiEnabled.mockReturnValue(true);
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

  it('with debt but a PENDING quotation, the pay entry is replaced by a pointer to the quotation card', async () => {
    mockGetMyPayments.mockResolvedValue([unpaidCheckoutM1]);
    mockGetQuotations.mockResolvedValue(quotation('PENDING'));

    const el = await mountPage();

    expect(el.textContent).toContain(POINTER_COPY);
    expect(el.querySelector(CHECKOUT_LINK_SELECTOR)).toBeNull();
  });

  it('with debt and an ACCEPTED quotation, the pay entry renders', async () => {
    mockGetMyPayments.mockResolvedValue([unpaidCheckoutM1]);
    mockGetQuotations.mockResolvedValue(quotation('ACCEPTED'));

    const el = await mountPage();

    const link = el.querySelector<HTMLAnchorElement>(CHECKOUT_LINK_SELECTOR);
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain(CHECKOUT_ENTRY_LABEL);
    expect(el.textContent).not.toContain(POINTER_COPY);
  });

  it('with debt and an INVOICED quotation, the pay entry renders (post-acceptance terminal)', async () => {
    mockGetMyPayments.mockResolvedValue([unpaidCheckoutM1]);
    mockGetQuotations.mockResolvedValue(quotation('INVOICED'));

    const el = await mountPage();

    expect(el.querySelector(CHECKOUT_LINK_SELECTOR)).not.toBeNull();
  });

  it('with debt and NO quotation at all, the pay entry is replaced by the waiting copy, not by the accept pointer', async () => {
    // The backend answers QUOTATION_NOT_ISSUED (409) for this shape, so the
    // button would lead to a locked door here too. Telling the applicant to
    // accept a quotation that does not exist would name an action the product
    // cannot deliver, so this case gets its own sentence: this page's own GET
    // is what re-issues, and its รีเฟรช button is what calls it again.
    mockGetMyPayments.mockResolvedValue([unpaidCheckoutM1]);
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });

    const el = await mountPage();

    expect(el.querySelector(CHECKOUT_LINK_SELECTOR)).toBeNull();
    expect(el.textContent).toContain(WAITING_COPY);
    expect(el.textContent).not.toContain(POINTER_COPY);
  });

  it('a pre-W14 pair with only the PLATFORM side accepted is not accepted (the gate wants both)', async () => {
    mockGetMyPayments.mockResolvedValue([unpaidCheckoutM1]);
    const both = quotation('ACCEPTED');
    mockGetQuotations.mockResolvedValue({
      ...both,
      dtam: { ...both.platform!, id: 'qt-0', issuerType: 'DTAM', status: 'PENDING' },
    });

    const el = await mountPage();

    expect(el.querySelector(CHECKOUT_LINK_SELECTOR)).toBeNull();
    expect(el.textContent).toContain(POINTER_COPY);
  });

  // ── Fix round 1 (review r0) ──────────────────────────────────────────────

  it.each(['EXPIRED', 'REJECTED'] as const)(
    'a %s quotation is not answered with an accept instruction the card below cannot offer',
    async (status) => {
      // review r0 minor 5 — QuotationReviewSection offers ยอมรับใบเสนอราคา only
      // for PENDING/SENT/DRAFT (F-G4-55 removed that instruction from the card's
      // own header for exactly this reason). Pointing at a button that is not
      // there reintroduced the defect one block higher up the page.
      mockGetMyPayments.mockResolvedValue([unpaidCheckoutM1]);
      mockGetQuotations.mockResolvedValue(quotation(status));

      const el = await mountPage();

      expect(el.querySelector(CHECKOUT_LINK_SELECTOR)).toBeNull();
      expect(el.textContent).not.toContain(POINTER_COPY);
      expect(el.textContent).toContain(STAFF_COPY);
    },
  );

  it.each(['EXPIRED', 'REJECTED'] as const)(
    'a %s quotation tells the applicant what to quote, not that a replacement will be issued',
    async (status) => {
      mockGetMyPayments.mockResolvedValue([unpaidCheckoutM1]);
      mockGetQuotations.mockResolvedValue(quotation(status));

      const el = await mountPage();
      const text = el.textContent || '';

      expect(text).toContain(STAFF_CONTACT_COPY);
      expect(text).toContain('QT-PRD-2026-000001');
      expect(text).not.toContain(REISSUE_PROMISE);
    },
  );

  it('a failed lookup is not announced to the applicant as "we are issuing your quotation"', async () => {
    // review r0 minor 6 — getQuotations now answers null when the request
    // failed, which is not the same fact as "this application holds no
    // quotation" and must not be told as if it were.
    mockGetMyPayments.mockResolvedValue([unpaidCheckoutM1]);
    mockGetQuotations.mockResolvedValue(null);

    const el = await mountPage();

    expect(el.querySelector(CHECKOUT_LINK_SELECTOR)).toBeNull();
    expect(el.textContent).toContain(LOOKUP_FAILED_COPY);
    expect(el.textContent).not.toContain(WAITING_COPY);
    expect(el.textContent).not.toContain(POINTER_COPY);
  });

  it('with no debt, nothing renders here whatever the quotation says (F-G4-49 stands)', async () => {
    mockGetMyPayments.mockResolvedValue([paidCheckoutM1]);
    mockGetQuotations.mockResolvedValue(quotation('ACCEPTED'));

    const el = await mountPage();

    expect(el.querySelector(CHECKOUT_LINK_SELECTOR)).toBeNull();
    expect(el.textContent).not.toContain(CHECKOUT_ENTRY_LABEL);
    expect(el.textContent).not.toContain(POINTER_COPY);
  });
});

/**
 * Final fix round (2026-08-29) — rulings R18 and R21.
 *
 * R18 (C11): the four refusal notices were drawn on `bg-mint-soft`, a fixed hex
 * (#f4f8f4, tailwind.config.cjs) with no `.dark` counterpart, while
 * `text-foreground` flips to near-white in `.dark`. The health portal ships a
 * theme toggle, so in dark mode the only text explaining why the pay button
 * disappeared was white on white.
 *
 * R21 (C1 FE / S16): the acceptance door now refuses a lapsed offer
 * (markQuotationAccepted, final round R1), so this page may not point at an
 * accept button for one — and the remedy is performed by the system on this
 * page's own GET, not by staff (ledger F-G4-71).
 */
describe('the payments page under the final-round rulings (F-G4-64)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  const FUTURE = '2099-01-01T00:00:00.000Z';
  const PAST = '2020-01-01T00:00:00.000Z';

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsCheckoutUiEnabled.mockReturnValue(true);
    mockGetMyPayments.mockResolvedValue([unpaidCheckoutM1]);
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

  function notice(): HTMLElement | null {
    return container!.querySelector<HTMLElement>('[data-testid="payments-quotation-notice"]');
  }

  it('a PENDING row inside its window still points at the card below', async () => {
    const rows = quotation('PENDING');
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: { ...rows.platform!, validUntil: FUTURE },
    });

    const el = await mountPage();

    expect(el.textContent).toContain(POINTER_COPY);
  });

  it('a lapsed PENDING row is not answered with an accept instruction (R21)', async () => {
    const rows = quotation('PENDING');
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: { ...rows.platform!, validUntil: PAST },
    });

    const el = await mountPage();
    const text = el.textContent || '';

    expect(el.querySelector(CHECKOUT_LINK_SELECTOR)).toBeNull();
    expect(text).not.toContain(POINTER_COPY);
    expect(text).toContain('เกินกำหนดยืนราคาแล้ว');
    // The system issues the replacement on this page's own GET; no staff door
    // exists for it (ledger F-G4-71).
    expect(text).not.toContain(STAFF_CONTACT_COPY);
    expect(text).not.toContain(REISSUE_PROMISE);
  });

  it('a lapsed PAIR is not promised a replacement the backend never issues (fix round 1)', async () => {
    // _lapsedOfferToReplace (apps/backend/services/quotation-issuance-on-submit.js)
    // refuses to touch an application holding two live rows — replacing a
    // pre-W14 pair with one W14 document is a repricing decision, not a repair.
    // So "ระบบจะออกใบใหม่ให้ กรุณากดรีเฟรชหน้านี้" would be a refresh for ever.
    const rows = quotation('PENDING');
    mockGetQuotations.mockResolvedValue({
      dtam: {
        ...rows.platform!,
        id: 'qt-0',
        issuerType: 'DTAM',
        quotationNumber: 'QT-DTAM-2026-000001',
        validUntil: PAST,
      },
      platform: { ...rows.platform!, validUntil: PAST },
    });

    const el = await mountPage();
    const text = el.textContent || '';

    expect(text).toContain('เกินกำหนดยืนราคาแล้ว');
    expect(text).not.toContain(REISSUE_PROMISE);
    expect(text).not.toContain('ระบบจะออกใบใหม่');
    expect(text).toContain(STAFF_CONTACT_COPY);
    expect(notice()!.textContent).toContain('QT-DTAM-2026-000001');
    expect(notice()!.textContent).toContain('QT-PRD-2026-000001');
  });

  it.each([
    ['PENDING' as const, FUTURE],
    ['PENDING' as const, PAST],
    ['EXPIRED' as const, FUTURE],
  ])('the %s notice sits on a token surface, readable in dark mode (R18)', async (status, validUntil) => {
    const rows = quotation(status);
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: { ...rows.platform!, validUntil },
    });

    await mountPage();

    const block = notice();
    expect(block).not.toBeNull();
    expect(
      block!.className.includes('bg-muted') || block!.className.includes('dark:bg-muted'),
    ).toBe(true);
    expect(block!.className).not.toMatch(/(^|\s)bg-mint-soft(\s|$)/);
  });

  it('the waiting notice and the failed-lookup notice are token surfaces too (R18)', async () => {
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });
    await mountPage();
    expect(notice()!.className.includes('bg-muted')).toBe(true);

    act(() => {
      root?.unmount();
    });
    root = null;
    container!.remove();

    mockGetQuotations.mockResolvedValue(null);
    await mountPage();
    expect(notice()!.className.includes('bg-muted')).toBe(true);
  });
});
