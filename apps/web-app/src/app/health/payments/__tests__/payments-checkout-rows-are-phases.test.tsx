/**
 * payments-checkout-rows-are-phases.test.tsx — ledger F-G4-48.
 *
 * The checkout rail mints ONE invoice per milestone, serviceType
 * CERTIFICATION_CHECKOUT_M1 / _M2 (apps/backend/services/checkout/
 * stripe-checkout-service.js). /health/payments used to file both under
 * "ไม่ระบุงวด" with ประเภท "ไม่ระบุ" (evidence/g4-rebuild-2026-08-25/c02/
 * C02-01-payments-after-repair.png) because payment-service's
 * mapServicePhaseComponent only knew PHASE_x_*.
 *
 * Pinned here, end to end through the REAL getMyPayments mapping (api.get is
 * mocked at the transport, not the service):
 *   1. _M1 → งวดที่ 1, _M2 → งวดที่ 2; the text 'ไม่ระบุงวด' / 'ไม่ระบุ' is gone.
 *   2. Each phase section holds exactly ONE card, the CHECKOUT card, labelled
 *      with the CHECKOUT component text; no STATE/PLATFORM card and no
 *      "missing side" placeholder (the two-card pair would draw an empty half).
 *   3. The two-transfer wording ("โอน 2 ครั้ง") does not apply to a single
 *      invoice and is absent from those sections.
 *   4. The checkout rail has no bank channel: the issuer lookup (which the
 *      backend answers 400 UNKNOWN_SERVICE_TYPE for these serviceTypes,
 *      apps/backend/routes/api/finance/issuers.js) is never made for a
 *      CHECKOUT card and no lookup error reaches the farmer.
 *   5. The money still adds up: ยอดที่ชำระแล้ว = 5,885 + 29,425 = 35,310.
 *
 * Scaffold per payments-cancelled-rows.test.tsx: createRoot + act + microtask
 * flushes, TwoCardPaymentSection + PaymentInvoiceCard REAL, the self-fetching
 * history/refund/quotation sections nulled out.
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

// Transport-level mock so PaymentService.getMyPayments runs for real
// (normalizeServiceType + mapServicePhaseComponent are the code under test).
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
import { SERVICE_NAME } from '@/lib/pricing/fee-services';

const APP_ID = 'APP-1';
// Read from the source rather than retyped: this test failed on 2026-09-05 not
// because the screen broke but because the label was corrected in one place and
// copied in another. A literal here is a second definition of the same string.
// round 5: a checkout card is titled by the catalogue name of the service the row bills
// (server `service`); "ค่าบริการรับรอง" was a name no catalogue holds.
const CHECKOUT_LABEL_BY_PHASE: Record<string, string> = { 'งวดที่ 1': SERVICE_NAME.PHASE_1, 'งวดที่ 2': SERVICE_NAME.PHASE_2 };
const UNKNOWN_PHASE_LABEL = 'ไม่ระบุงวด';
const UNKNOWN_COMPONENT_LABEL = 'ไม่ระบุ';
const TWO_TRANSFERS = 'โอน 2 ครั้ง';
const ISSUER_LOOKUP_ERROR = 'ไม่สามารถดึงข้อมูลบัญชีผู้รับชำระได้';

// Raw rows as GET /invoices/my serialises them: Decimal money as strings,
// status as stored. Mirrors the two paid rows in the C02-01 evidence.
const rawCheckoutM1 = {
  id: 'inv-co-m1',
  invoiceNumber: 'INV-CO-D810DEBF-M1',
  applicationId: APP_ID,
  totalAmount: '5885.00',
  status: 'RECEIPT_ISSUED',
  createdAt: '2026-08-26T03:00:00.000Z',
  paidAt: '2026-08-26T03:05:00.000Z',
  serviceType: 'CERTIFICATION_CHECKOUT_M1',
  service: { key: 'PHASE_1', name: SERVICE_NAME.PHASE_1, coverage: 'ครอบคลุม: x' },
  lineItems: [
    { lineNumber: 1, code: 'STATE_FEE', description: 'ค่าบริการดำเนินการรับรองมาตรฐาน GACP (ราคาเต็ม)', quantity: 1, unitPrice: '5000.00', amount: '5000.00', isTaxable: true },
    { lineNumber: 2, code: 'PLATFORM_FEE', description: 'ค่าบริการแพลตฟอร์ม', quantity: 1, unitPrice: '500.00', amount: '500.00', isTaxable: true },
    { lineNumber: 3, code: 'VAT', description: 'ภาษีมูลค่าเพิ่ม 7%', quantity: 1, unitPrice: '385.00', amount: '385.00', isTaxable: false },
  ],
};

const rawCheckoutM2 = {
  id: 'inv-co-m2',
  invoiceNumber: 'INV-CO-F785F58B-M2',
  applicationId: APP_ID,
  totalAmount: '29425.00',
  status: 'RECEIPT_ISSUED',
  createdAt: '2026-08-26T04:00:00.000Z',
  paidAt: '2026-08-26T04:05:00.000Z',
  serviceType: 'CERTIFICATION_CHECKOUT_M2',
  service: { key: 'PHASE_2', name: SERVICE_NAME.PHASE_2, coverage: 'ครอบคลุม: y' },
  lineItems: [
    { lineNumber: 1, code: 'STATE_FEE', description: 'ค่าบริการดำเนินการรับรองมาตรฐาน GACP (ราคาเต็ม)', quantity: 1, unitPrice: '25000.00', amount: '25000.00', isTaxable: true },
    { lineNumber: 2, code: 'PLATFORM_FEE', description: 'ค่าบริการแพลตฟอร์ม', quantity: 1, unitPrice: '2500.00', amount: '2500.00', isTaxable: true },
    { lineNumber: 3, code: 'VAT', description: 'ภาษีมูลค่าเพิ่ม 7%', quantity: 1, unitPrice: '1925.00', amount: '1925.00', isTaxable: false },
  ],
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

function phaseSection(container: HTMLElement, phaseLabel: string): HTMLElement {
  const section = container.querySelector<HTMLElement>(`[data-testid="two-card-phase-${phaseLabel}"]`);
  if (!section) throw new Error(`phase section not found: ${phaseLabel}`);
  return section;
}

describe('HealthPaymentsPage checkout rows are phases (F-G4-48)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/invoices/my') return { success: true, data: [rawCheckoutM2, rawCheckoutM1] };
      return { success: true, data: [] };
    });
    // What the backend really answers for a checkout serviceType
    // (apps/backend/routes/api/finance/issuers.js: not in SERVICE_TYPES → 400).
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

  it('files CERTIFICATION_CHECKOUT_M1 under งวดที่ 1 and _M2 under งวดที่ 2, never ไม่ระบุงวด', async () => {
    const el = await mountPage();

    expect(el.textContent).not.toContain(UNKNOWN_PHASE_LABEL);
    expect(el.textContent).not.toContain(UNKNOWN_COMPONENT_LABEL);

    const phase1 = phaseSection(el, 'งวดที่ 1');
    expect(phase1.textContent).toContain('5,885');
    expect(phase1.textContent).not.toContain('29,425');

    const phase2 = phaseSection(el, 'งวดที่ 2');
    expect(phase2.textContent).toContain('29,425');
    expect(phase2.textContent).not.toContain('5,885');
  });

  it('renders each checkout invoice as ONE full-width card labelled as the CHECKOUT component', async () => {
    const el = await mountPage();

    for (const phaseLabel of ['งวดที่ 1', 'งวดที่ 2']) {
      const section = phaseSection(el, phaseLabel);

      const checkoutCards = section.querySelectorAll('[data-testid="payment-invoice-card-CHECKOUT"]');
      expect(checkoutCards).toHaveLength(1);
      expect(checkoutCards[0]!.textContent).toContain(CHECKOUT_LABEL_BY_PHASE[phaseLabel]);

      // Never the STATE/PLATFORM pair, never an empty half.
      expect(section.querySelector('[data-testid="payment-invoice-card-STATE"]')).toBeNull();
      expect(section.querySelector('[data-testid="payment-invoice-card-PLATFORM"]')).toBeNull();
      expect(section.querySelector('[data-testid="state-card-missing"]')).toBeNull();
      expect(section.querySelector('[data-testid="platform-card-missing"]')).toBeNull();

      // One invoice is one transfer: the two-transfer copy does not apply.
      expect(section.textContent).not.toContain(TWO_TRANSFERS);
    }
  });

  it('never looks up a bank channel for a checkout invoice and shows no lookup error', async () => {
    const el = await mountPage();

    expect(mockGetIssuerByServiceType).not.toHaveBeenCalled();
    expect(el.textContent).not.toContain('UNKNOWN_SERVICE_TYPE');
    expect(el.textContent).not.toContain(ISSUER_LOOKUP_ERROR);
  });

  it('keeps the paid total honest: ยอดที่ชำระแล้ว = 35,310 and nothing is owed', async () => {
    const el = await mountPage();

    expect(metricValue(el, 'ยอดที่ชำระแล้ว')).toContain('35,310');
    expect(metricValue(el, 'ยอดรอชำระ')).toContain('0');
    expect(metricValue(el, 'ยอดรอชำระ')).not.toMatch(/[1-9]/);
  });
});
