/**
 * payments-phase-due-chip.test.tsx — the screen answers "จ่ายบิลไหนตอนไหน".
 *
 * operator, 2026-09-10: "งงมาก ไม่รู้จ่ายบิลไหนตอนไหน ... มีปุ่มชำระเงินออนไลน์มาตลอด
 * แล้วจ่ายได้ตลอด จ่ายซ้ำได้อีก".
 *
 * The page drew งวดที่ 1 and งวดที่ 2 as two equal cards, each with a total, in a fixed
 * numeric order, and said nothing about which one the system would actually accept money
 * for today. A farmer looking at that sees two identical-looking bills and no way to tell
 * them apart — and the one the checkout door would refuse looks exactly like the one it
 * would accept.
 *
 * Pinned here, through the REAL mapping and the REAL TwoCardPaymentSection:
 *   1. Each phase carries a state chip, and the wording comes from the ONE rule
 *      (phase-due-state.ts) rather than from a string retyped in the component — a second
 *      copy of the same sentence is how the chip and the rule start disagreeing.
 *   2. The phase that can be paid today is rendered FIRST, even when it is งวดที่ 2.
 *   3. A phase that is not yet collectable says so, and says why, instead of looking
 *      identical to the one that is.
 *   4. The chip reads the filing's status from the server. When that read fails, the chip
 *      says it cannot tell — it never claims the money is due.
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

jest.mock('@/lib/api/api-client', () => {
  const api = { get: (path: string) => mockApiGet(path), post: jest.fn(), getBlob: jest.fn() };
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
      getIssuerByServiceType: jest.fn(async () => ({ success: false, error: 'UNKNOWN_SERVICE_TYPE' })),
      downloadInvoicePdf: jest.fn(),
    },
  };
});

jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: () => ({ id: 'user-1', role: 'HEALTH', email: 'farmer@test' }),
    getToken: () => 'test-token',
  },
}));

jest.mock('@/components/payments/RefundVisibilitySection', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/payments/QuotationReviewSection', () => ({ __esModule: true, default: () => null }));

jest.mock('next/navigation', () => {
  const router = {
    push: jest.fn(), replace: jest.fn(), refresh: jest.fn(),
    back: jest.fn(), forward: jest.fn(), prefetch: jest.fn(),
    pathname: '/', query: {},
  };
  const searchParams = new URLSearchParams();
  return { useRouter: () => router, usePathname: () => '/', useSearchParams: () => searchParams };
});

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,FAKE') },
}));

import HealthPaymentsPage from '../client-view';
import { PHASE_DUE_COPY_TH } from '../phase-due-state';

const APP_ID = 'APP-DUE-1';

// The wording is read from the rule, never retyped: a literal here would be a second
// definition of the same sentence, and the test would keep passing while the two drift.
const DUE_NOW = PHASE_DUE_COPY_TH.DUE_NOW.label;
const NOT_YET = PHASE_DUE_COPY_TH.NOT_YET.label;
const SETTLED = PHASE_DUE_COPY_TH.SETTLED.label;
const UNKNOWN = PHASE_DUE_COPY_TH.UNKNOWN.label;

/** A legacy split invoice as GET /invoices/my serialises it. */
function legacyInvoice(
  id: string,
  serviceType: string,
  amount: string,
  status: string,
): Record<string, unknown> {
  return {
    id,
    invoiceNumber: `INV-${id}`,
    applicationId: APP_ID,
    totalAmount: amount,
    status,
    createdAt: '2026-07-16T03:00:00.000Z',
    serviceType,
    lineItems: [],
  };
}

// Lower-case `pending` on purpose: that is how the demo/prod register stores it
// (measured 2026-09-10), while staging stores the same word upper-case.
const p1State = legacyInvoice('p1s', 'PHASE_1_STATE_FEE', '5000.00', 'pending');
const p1Platform = legacyInvoice('p1p', 'PHASE_1_PLATFORM_FEE', '535.00', 'pending');
const p2State = legacyInvoice('p2s', 'PHASE_2_STATE_FEE', '25000.00', 'pending');
const p2Platform = legacyInvoice('p2p', 'PHASE_2_PLATFORM_FEE', '2675.00', 'pending');

function paidCopy(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, status: 'RECEIPT_ISSUED', paidAt: '2026-07-20T03:00:00.000Z', receiptNumber: `RCP-${row.id as string}` };
}

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function phaseSections(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="two-card-phase-"]'));
}

function chipOf(section: HTMLElement): string {
  const chip = section.querySelector<HTMLElement>('[data-testid="phase-due-chip"]');
  if (!chip) throw new Error(`no due chip in ${section.getAttribute('data-testid')}`);
  return (chip.textContent || '').trim();
}

describe('the payments page says which instalment to pay now', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  function serve(invoices: unknown[], applications: unknown[]): void {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/invoices/my') return { success: true, data: invoices };
      if (path === '/applications/my') return { success: true, data: applications };
      return { success: true, data: [] };
    });
  }

  beforeEach(() => { jest.clearAllMocks(); });

  afterEach(() => {
    if (root) { act(() => { root?.unmount(); }); root = null; }
    if (container) { container.remove(); container = null; }
  });

  async function mountPage(): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();
    return container!;
  }

  it('marks งวดที่ 1 due and งวดที่ 2 not-yet while the filing waits on the document fee', async () => {
    serve([p1State, p1Platform, p2State, p2Platform], [{ id: APP_ID, status: 'PENDING_DOC_FEE' }]);
    const el = await mountPage();

    const sections = phaseSections(el);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.getAttribute('data-testid')).toContain('งวดที่ 1');
    expect(chipOf(sections[0]!)).toContain(DUE_NOW);
    expect(chipOf(sections[1]!)).toContain(NOT_YET);
  });

  it('puts งวดที่ 2 FIRST once it is the one that can be paid', async () => {
    // Phase 1 collected, documents approved: the bill to pay is งวดที่ 2, and the farmer
    // should not have to scroll past a settled one to find it.
    serve(
      [paidCopy(p1State), paidCopy(p1Platform), p2State, p2Platform],
      [{ id: APP_ID, status: 'DOC_APPROVED' }],
    );
    const el = await mountPage();

    const sections = phaseSections(el);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.getAttribute('data-testid')).toContain('งวดที่ 2');
    expect(chipOf(sections[0]!)).toContain(DUE_NOW);
    expect(sections[1]!.getAttribute('data-testid')).toContain('งวดที่ 1');
    expect(chipOf(sections[1]!)).toContain(SETTLED);
  });

  it('never shows two งวด as due at the same time — that is the confusion itself', async () => {
    serve([p1State, p1Platform, p2State, p2Platform], [{ id: APP_ID, status: 'PENDING_AUDIT_FEE' }]);
    const el = await mountPage();

    const due = phaseSections(el).filter((s) => chipOf(s).includes(DUE_NOW));
    expect(due).toHaveLength(1);
    expect(due[0]!.getAttribute('data-testid')).toContain('งวดที่ 2');
  });

  it('says it cannot tell, rather than claiming money is due, when the filing status is unreadable', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/invoices/my') return { success: true, data: [p1State, p1Platform] };
      if (path === '/applications/my') return { success: false, error: 'BOOM' };
      return { success: true, data: [] };
    });
    const el = await mountPage();

    const sections = phaseSections(el);
    expect(sections).toHaveLength(1);
    expect(chipOf(sections[0]!)).toContain(UNKNOWN);
    expect(chipOf(sections[0]!)).not.toContain(DUE_NOW);
  });

  it('tells the farmer WHY a phase is not payable yet, not just that it is not', async () => {
    serve([p1State, p1Platform, p2State, p2Platform], [{ id: APP_ID, status: 'PENDING_DOC_FEE' }]);
    const el = await mountPage();

    const notYet = phaseSections(el).find((s) => chipOf(s).includes(NOT_YET));
    expect(notYet).toBeDefined();
    expect(notYet!.textContent).toContain(PHASE_DUE_COPY_TH.NOT_YET.hint);
  });
});
