/**
 * quotation-card-identity-key.test.tsx — review follow-up (post-approval),
 * fix/checkout-ux.
 *
 * QuotationCard (QuotationReviewSection.tsx) holds `status` in its own
 * `useState(quotation.status)`, and until this fix was drawn with no `key`.
 * `/health/payments` client-view.tsx passes `quotations` down as a PROP
 * (parentOwnsData mode) keyed off `quotationApplicationId` (?app= or the
 * resolved active application) — switching that id (e.g. the applicant
 * follows a different ?app= link, or the page's own active-application
 * resolution changes) re-renders QuotationReviewSection with a DIFFERENT
 * quotation object WITHOUT unmounting QuotationCard (same component type,
 * same position in the tree). React therefore reuses the card's fiber and
 * keeps its stale local `status` — the pill can show the PREVIOUS
 * application's status against the NEW application's document.
 *
 * Fix: `key={quotation.id}` on each <QuotationCard> forces React to treat a
 * different quotation row as a different component instance, so its
 * `useState` initializer re-runs.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { QuotationAcceptResult, QuotationRecord, QuotationsBySide } from '@/lib/services/payment-service';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30_000);

const mockGetQuotations = jest.fn<() => Promise<QuotationsBySide>>();
const mockAcceptQuotation = jest.fn<() => Promise<QuotationAcceptResult>>();
const mockViewQuotationPdf = jest.fn<() => Promise<boolean>>();

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service');
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getQuotations: (...args: unknown[]) => mockGetQuotations(...(args as [])),
      acceptQuotation: (...args: unknown[]) => mockAcceptQuotation(...(args as [])),
      viewQuotationPdf: (...args: unknown[]) => mockViewQuotationPdf(...(args as [])),
    },
  };
});

import QuotationReviewSection from '../QuotationReviewSection';

function makePlatformQuotation(overrides: Partial<QuotationRecord>): QuotationRecord {
  return {
    id: 'q-app-a',
    applicationId: 'app-a',
    issuerType: 'PLATFORM',
    quotationNumber: 'QT-PRD-2026-000001',
    subtotal: 33000,
    vat: 2310,
    totalAmount: 35310,
    installments: [{ phase: 'PHASE_1', amount: 5885 }, { phase: 'PHASE_2', amount: 29425 }],
    status: 'PENDING',
    createdAt: '2026-06-05T00:00:00.000Z',
    lineItems: [
      { method: 'OUTDOOR', label: 'กลางแจ้ง (Outdoor)', phase1Amount: 5885, phase2Amount: 29425, netAmount: 33000, taxAmount: 2310 },
    ],
    ...overrides,
  };
}

/** The card's own status PILL — the header span, not page-wide text. */
function pillText(container: HTMLElement): string {
  const article = container.querySelector('article');
  const pill = article?.querySelector('span.rounded-full');
  return pill?.textContent?.trim() || '';
}

async function flushAsync(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('QuotationCard identity — a different quotation must not inherit the previous one\'s status', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('switching quotationApplicationId (same root, no remount of the page) updates the pill to the new application\'s own status', async () => {
    const appAQuotation = makePlatformQuotation({
      id: 'q-app-a', applicationId: 'app-a', quotationNumber: 'QT-PRD-2026-000001', status: 'PENDING',
    });
    const appBQuotation = makePlatformQuotation({
      id: 'q-app-b', applicationId: 'app-b', quotationNumber: 'QT-PRD-2026-000099', status: 'ACCEPTED',
    });

    await act(async () => {
      root!.render(
        <QuotationReviewSection
          applicationId="app-a"
          quotations={{ dtam: null, platform: appAQuotation }}
        />,
      );
    });
    await flushAsync();

    expect(pillText(container!)).toBe('รอการยอมรับ');

    // The SAME root re-renders with a DIFFERENT application's quotation —
    // exactly what client-view.tsx does when quotationApplicationId changes
    // (?app= switches, or the resolved active application changes). No
    // unmount() is called here.
    await act(async () => {
      root!.render(
        <QuotationReviewSection
          applicationId="app-b"
          quotations={{ dtam: null, platform: appBQuotation }}
        />,
      );
    });
    await flushAsync();

    // Must read application B's own ACCEPTED status, never application A's
    // leftover PENDING pill.
    expect(pillText(container!)).toBe('ยอมรับแล้ว');
    expect(container!.textContent).toContain('QT-PRD-2026-000099');
  });
});
