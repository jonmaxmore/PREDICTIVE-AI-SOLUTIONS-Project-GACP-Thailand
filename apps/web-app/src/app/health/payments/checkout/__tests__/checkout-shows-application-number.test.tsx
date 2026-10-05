/**
 * checkout-shows-application-number.test.tsx — display-only fix.
 *
 * the backlog ~line 611: the checkout screen printed the application's
 * UUID under "เลขคำขอ" (client-view.tsx read `applicationId` straight from
 * the URL) — not the applicationNumber the applicant actually knows (e.g.
 * APP-2569-MUJIXOBX-0C1EC3). Seen in walk screenshots A04/A09.
 *
 * The page already calls `PaymentService.getQuotations(applicationId)` on
 * mount (for the accepted-quotation summary); the backend's response for
 * that same call now also carries `applicationNumber` (an existing `select`
 * on that route, not a second query — apps/backend/routes/api/applications/
 * quotations.js). This is that same read shown to the applicant instead of
 * the raw URL param.
 *
 * Harness copied from the sibling checkout-shows-quotation-and-terms.test.tsx
 * (createRoot + act; @testing-library/react is not installed here).
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

const APPLICATION_UUID = '2a60c16c-8428-4d48-8bc2-a27bf8e0f445';
const APPLICATION_NUMBER = 'APP-2569-MUJIXOBX-0C1EC3';

const mockCreateCheckout = jest.fn<(args: unknown) => Promise<CheckoutResult>>();
const mockGetPaymentTermsConsent =
  jest.fn<() => Promise<{ success: boolean; data?: unknown }>>();
const mockAcceptPaymentTerms = jest.fn<() => Promise<{ success: boolean }>>();
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

import CheckoutClientView from '../client-view';

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('checkout page shows the applicationNumber, never the UUID', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams({ app: APPLICATION_UUID, milestone: 'M1' });
    mockCreateCheckout.mockResolvedValue(HAPPY);
    mockGetPaymentTermsConsent.mockResolvedValue({ success: true, data: { consents: {} } });
    mockAcceptPaymentTerms.mockResolvedValue({ success: true });
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: null,
      applicationNumber: APPLICATION_NUMBER,
    } as QuotationsBySide);
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

  it('idle state: shows the applicationNumber, not the raw UUID', async () => {
    await mountView();

    expect(container!.textContent).toContain(APPLICATION_NUMBER);
    expect(container!.textContent).not.toContain(APPLICATION_UUID);
  });

  it('created state: shows the applicationNumber, not the raw UUID', async () => {
    await mountView();

    await act(async () => {
      container!
        .querySelector<HTMLInputElement>('[data-testid="checkout-terms-checkbox"]')
        ?.click();
    });
    await flushAsync();

    await act(async () => {
      findButton('เริ่มขั้นตอนชำระเงิน')?.click();
    });
    await flushAsync();

    expect(container!.textContent).toContain('สร้างรายการสำเร็จ');
    expect(container!.textContent).toContain(APPLICATION_NUMBER);
    expect(container!.textContent).not.toContain(APPLICATION_UUID);
  });
});
