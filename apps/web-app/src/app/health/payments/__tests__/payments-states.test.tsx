/**
 * payments-states.test.tsx — V1-B state-assertion tests for the
 * `/health/payments` page (initial render + post-effect branches).
 *
 * Four explicit state assertions for the V1-B acceptance:
 *   1. Loading skeleton renders BEFORE getMyPayments resolves.
 *   2. Empty-state copy renders when getMyPayments resolves with [].
 *   3. Inline error banner renders when getMyPayments rejects.
 *   4. Legacy-table + mobile-card action buttons carry `min-h-[44px]`
 *      (WCAG 2.5.5 — D6 fix).
 *
 * Strategy: createRoot + act with multiple microtask flushes per the
 * OnboardingModal.test.tsx pattern in this repo. The page fans out
 * to RefundVisibilitySection once payments
 * resolve with a known applicationId, so we keep payments=[] for the
 * empty/error cases (which short-circuit `activeApplicationId` to
 * '') and inject a single legacy-UNKNOWN payment for the D6 test
 * (also routed to the section path that doesn't mount the sub-trees).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { PaymentRecord } from '@/lib/services/payment-service';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGetMyPayments = jest.fn<() => Promise<PaymentRecord[]>>();
const mockGetIssuerByServiceType = jest.fn();
const mockGetCreditNotes = jest.fn();

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service');
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getMyPayments: (...args: unknown[]) => mockGetMyPayments(...(args as [])),
      getIssuerByServiceType: (...args: unknown[]) => mockGetIssuerByServiceType(...args),
      getCreditNotes: (...args: unknown[]) => mockGetCreditNotes(...args),
      downloadInvoicePdf: jest.fn(),
    },
  };
});

// AuthService.getUser must NOT return null — that would redirect.
jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: () => ({ id: 'user-1', role: 'HEALTH', email: 'farmer@test' }),
  },
}));

// Pin next/navigation. CRITICAL: useRouter and useSearchParams MUST
// return stable references. The default jest.setup.tsx mock returns a
// fresh object on every render — `HealthPaymentsPage` has
// `useEffect(loadPayments, [router])` so an unstable router causes
// `loadPayments` to fire on every render in an infinite loop, which
// `act()` cannot drain (10s timeout). Defining the stable refs
// INSIDE the factory keeps jest.mock hoisting happy.
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

async function flushAsync(rounds = 8): Promise<void> {
  // React 18 concurrent scheduling needs multiple microtask flushes
  // before all effects settle. Each `await Promise.resolve()` flushes
  // ONE microtask; loadPayments() chains 2-3 awaits + state setters
  // so we drain several rounds.
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('HealthPaymentsPage states (V1-B)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMyPayments.mockResolvedValue([]);
    mockGetIssuerByServiceType.mockResolvedValue({ success: true, data: null });
    mockGetCreditNotes.mockResolvedValue([]);
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

  it('renders the loading skeleton on initial SSR (loading=true is the default)', () => {
    // SSR initial markup — useEffect hasn't fired, so `loading=true`
    // and the PageSkeleton renders an animate-pulse marker.
    const html = renderToStaticMarkup(<HealthPaymentsPage />);
    expect(html).toContain('animate-pulse');
    expect(html).toContain('การชำระเงินและใบแจ้งหนี้');
  });

  it('renders the empty-state copy when getMyPayments resolves to []', async () => {
    mockGetMyPayments.mockResolvedValue([]);

    container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();

    expect(container.textContent).toContain('ไม่พบรายการชำระเงิน');
  });

  it('never claims there are no payments when the read FAILED', async () => {
    // Proven on the live demo by forcing GET /api/invoices/my to return 500: the
    // page rendered the error banner AND "ไม่พบรายการชำระเงิน" underneath it. The
    // second sentence is a claim about the applicant's MONEY that the page cannot
    // support — the same class as the wizard's requirement hook, which was fixed
    // on 2026-09-07 by separating "no answer yet" from "the answer is none".
    mockGetMyPayments.mockRejectedValue(new Error('boom'));

    container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();

    expect(container.textContent).toContain('ไม่สามารถโหลดข้อมูลการชำระเงินได้');
    expect(container.textContent).not.toContain('ไม่พบรายการชำระเงิน');
  });

  it('offers a way back when the read failed', async () => {
    mockGetMyPayments.mockRejectedValue(new Error('boom'));

    container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();

    expect(container.textContent).toContain('ลองใหม่');
  });

  it('renders the inline error banner when getMyPayments rejects', async () => {
    mockGetMyPayments.mockRejectedValue(new Error('boom'));

    container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();

    expect(container.textContent).toContain('ไม่สามารถโหลดข้อมูลการชำระเงินได้');
  });

  it('renders legacy-table action buttons with WCAG-compliant min-h-[44px] (D6)', async () => {
    // Single UNKNOWN-phase invoice routes through the legacy table +
    // mobile card-stack path (NOT TwoCardPaymentSection). This exercises
    // the desktop `min-h-[44px] rounded-lg px-3 py-1.5 text-xs` button
    // and the mobile `min-h-[44px] flex-1 rounded-lg px-3 py-2 text-xs`
    // button, both raised by V1-B's D6 fix.
    const legacyPayment: PaymentRecord = {
      id: 'inv-unknown-1',
      type: 'INVOICE',
      documentNumber: 'INV-2026-UNK-1',
      applicationId: '', // no application => skip the self-fetching sub-trees
      amount: 5000,
      status: 'PENDING',
      erpStatus: 'PENDING',
      createdAt: '2026-05-16T00:00:00.000Z',
      serviceType: '',
      phase: 'UNKNOWN',
      component: 'UNKNOWN',
      isPaid: false,
    };

    mockGetMyPayments.mockResolvedValue([legacyPayment]);

    container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();

    // Find every action button by visible label.
    const allButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).filter((btn) =>
      ['ดูรายละเอียด', 'ชำระแล้ว'].some((label) =>
        (btn.textContent || '').includes(label),
      ),
    );
    expect(allButtons.length).toBeGreaterThan(0);
    for (const btn of allButtons) {
      expect(btn.className).toContain('min-h-[44px]');
    }
  });
});
