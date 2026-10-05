/**
 * quotation-invoiced-without-acceptance.test.tsx — F-G4-64 spec §3.7.
 *
 * A quotation closed by the repair script is INVOICED with acceptedAt still
 * null, because no acceptance ever happened and inventing one would be
 * inventing a record. The screen must say what that row is, and must not offer
 * a button for a step that is over.
 *
 * Also pins coordinator ruling 12: when the application's cultivation-method
 * count has moved away from the scopeCount the row was priced under, the API
 * answers scopeMismatch and the card says so instead of letting the applicant
 * read the document as a description of the form they are looking at now.
 *
 * Harness: the createRoot + act pattern of the sibling
 * quotation-review-section.test.tsx (@testing-library/react is not installed).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { QuotationRecord, QuotationsBySide } from '@/lib/services/payment-service';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30_000);

const mockGetQuotations = jest.fn<() => Promise<QuotationsBySide>>();

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service') as {
    PaymentService: Record<string, unknown>;
  };
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getQuotations: () => mockGetQuotations(),
      acceptQuotation: jest.fn(),
      viewQuotationPdf: jest.fn(),
    },
  };
});

import QuotationReviewSection from '../QuotationReviewSection';

const base: QuotationRecord = {
  id: 'qt-1',
  applicationId: 'app-1',
  issuerType: 'PLATFORM',
  quotationNumber: 'QT-PRD-2026-000001',
  subtotal: '33000.00',
  vat: '2310.00',
  totalAmount: '35310.00',
  status: 'INVOICED',
  createdAt: '2026-08-25T00:00:00.000Z',
  lineItems: [],
};

const REPAIRED_LABEL = 'ออกใบแจ้งหนี้แล้ว (ชำระก่อนมีขั้นตอนยอมรับ)';
const ORDINARY_LABEL = 'ออกใบแจ้งหนี้แล้ว';
const SCOPE_MISMATCH_COPY = 'จำนวนรูปแบบการปลูกที่คำขอระบุไว้ในวันที่ออกใบ';
// review r2 minor 4 — no staff surface can void and re-issue a quotation, so the
// card must not promise one; what staff need is the number of the document.
const REISSUE_PROMISE = 'ออกใบเสนอราคาใหม่';
const STAFF_CONTACT_COPY = 'กรุณาติดต่อเจ้าหน้าที่';

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('an INVOICED row says which of the two it is (F-G4-64 §3.7)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
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

  async function mountSection(): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<QuotationReviewSection applicationId="app-1" />);
    });
    await flushAsync();
    return container;
  }

  function findButton(label: string): HTMLButtonElement | null {
    return (
      Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((btn) =>
        (btn.textContent || '').includes(label),
      ) ?? null
    );
  }

  it('INVOICED with no acceptedAt is labelled as billed before the acceptance step existed', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: { ...base, acceptedAt: null },
    });

    const el = await mountSection();

    expect(el.textContent).toContain(REPAIRED_LABEL);
    expect(findButton('ยอมรับใบเสนอราคา')).toBeNull();
  });

  it('INVOICED WITH an acceptedAt keeps the ordinary label', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: { ...base, acceptedAt: '2026-08-28T03:00:00.000Z' },
    });

    const el = await mountSection();

    expect(el.textContent).toContain(ORDINARY_LABEL);
    expect(el.textContent).not.toContain(REPAIRED_LABEL);
  });

  it('a scope mismatch is named on the card, not hidden behind figures that look current', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: {
        ...base,
        status: 'PENDING',
        scopeMismatch: true,
        applicationScopeCount: 3,
      },
    });

    const el = await mountSection();

    expect(el.textContent).toContain(SCOPE_MISMATCH_COPY);
  });

  it('the mismatch notice names the document to quote and promises no new one', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: {
        ...base,
        status: 'PENDING',
        scopeMismatch: true,
        applicationScopeCount: 3,
      },
    });

    const el = await mountSection();
    const text = el.textContent || '';

    expect(text).toContain(STAFF_CONTACT_COPY);
    expect(text).toContain('QT-PRD-2026-000001');
    expect(text).not.toContain(REISSUE_PROMISE);
  });

  it('a row whose scope still matches says nothing about a mismatch', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: { ...base, status: 'PENDING', scopeMismatch: false, applicationScopeCount: 1 },
    });

    const el = await mountSection();

    expect(el.textContent).not.toContain(SCOPE_MISMATCH_COPY);
  });
});
