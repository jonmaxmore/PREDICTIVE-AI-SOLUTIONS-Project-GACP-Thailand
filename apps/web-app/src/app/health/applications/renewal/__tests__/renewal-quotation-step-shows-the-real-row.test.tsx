/**
 * renewal-quotation-step-shows-the-real-row.test.tsx — F-G4-64 final round R23
 * (finding S13).
 *
 * The renewal wizard's entry screen printed a priced document the BROWSER
 * invented: `QT-${Date.now().toString(36)}`, a client-side `validUntil` of
 * today + 30 days and live fee figures, with no accept control anywhere on it.
 * Meanwhile this branch made renewal issue a real `QT-PRD-` row
 * (services/renewal-service.js) and made acceptance of THAT row a precondition
 * for every renewal payment (services/billing/quotation-gate.js).
 *
 * This is the same defect the branch fixed in wizard slot 10: "four applicants
 * were told they had accepted a document that did not exist". The screen now
 * renders the register's row through the SAME accept surface the payments page
 * uses (components/payments/QuotationReviewSection), or, when the register
 * holds none yet, names the page where the row is issued and accepted.
 *
 * Harness: createRoot + act (no @testing-library/react in this workspace),
 * wrapped in LanguageProvider because the step reads the dictionary.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { QUOTATION_EXPIRED_COPY_TH, type QuotationsBySide } from '@/lib/services/payment-service';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30_000);

const mockGetQuotations = jest.fn<() => Promise<QuotationsBySide | null>>();
const mockAcceptQuotation = jest.fn();
const mockViewQuotationPdf = jest.fn<() => Promise<boolean>>();

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service') as {
    PaymentService: Record<string, unknown>;
  };
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

import { LanguageProvider } from '@/lib/i18n/language-context';
import { QuotationStep } from '../quotation-step';
import type { Certificate } from '../types';

const RENEWAL_ID = 'renewal-abc';

const CERTIFICATE = {
  id: 'cert-1',
  certificateNumber: 'GACP-TH-2569-85B448',
  siteName: 'ฟาร์มทดสอบ',
} as unknown as Certificate;

const RENEWAL_ROW = {
  id: 'qt-r1',
  applicationId: RENEWAL_ID,
  issuerType: 'PLATFORM' as const,
  quotationNumber: 'QT-PRD-2026-000123',
  subtotal: '33000.00',
  vat: '2310.00',
  totalAmount: '35310.00',
  status: 'PENDING' as const,
  createdAt: '2026-08-25T00:00:00.000Z',
  validUntil: '2099-01-01T00:00:00.000Z',
  installments: [{ phase: 'PHASE_2', amount: 35310 }],
  lineItems: [],
};

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('the renewal quotation step renders the register row, not one the browser made up (R23)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockViewQuotationPdf.mockResolvedValue(true);
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: RENEWAL_ROW });
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

  async function mountStep(renewalId: string | null = RENEWAL_ID): Promise<HTMLDivElement> {
    await act(async () => {
      root?.render(
        <LanguageProvider>
          <QuotationStep
            certificate={CERTIFICATE}
            renewalId={renewalId}
            isDark={false}
            onBack={jest.fn()}
            onProceed={jest.fn()}
          />
        </LanguageProvider>,
      );
    });
    await flushAsync();
    return container!;
  }

  it('asks the register for the renewal application own quotation', async () => {
    await mountStep();

    expect(mockGetQuotations).toHaveBeenCalledWith(RENEWAL_ID);
  });

  it('shows the register number and the accept control, and invents no document number', async () => {
    const el = await mountStep();
    const text = el.textContent || '';

    expect(text).toContain('QT-PRD-2026-000123');
    expect(el.querySelector('[data-testid="quotation-review-section"]')).not.toBeNull();
    expect(
      Array.from(el.querySelectorAll('button')).some((b) =>
        (b.textContent || '').includes('ยอมรับใบเสนอราคา'),
      ),
    ).toBe(true);
    // The browser-minted number was `QT-` + a base36 slice of Date.now().
    const invented = text.match(/QT-(?!PRD|DTAM)[A-Z0-9]+/g) || [];
    expect(invented).toEqual([]);
  });

  it('with no row yet it points at the page that issues and accepts one', async () => {
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });

    const el = await mountStep();

    const link = Array.from(el.querySelectorAll('a')).find((a) =>
      (a.getAttribute('href') || '').includes(`/health/payments?app=${RENEWAL_ID}`),
    );
    expect(link).toBeDefined();
    expect(el.textContent || '').toContain('ใบเสนอราคา');
  });

  it('a failed lookup says so, and offers the button that asks again', async () => {
    mockGetQuotations.mockResolvedValue(null);

    const el = await mountStep();

    expect(el.textContent || '').toContain('ตรวจสอบใบเสนอราคาไม่สำเร็จ');
    const retry = Array.from(el.querySelectorAll('button')).find((b) =>
      (b.textContent || '').includes('ลองอีกครั้ง'),
    );
    expect(retry).toBeDefined();

    await act(async () => {
      retry!.click();
    });
    await flushAsync();

    expect(mockGetQuotations).toHaveBeenCalledTimes(2);
  });

  it('without a renewal id it asks the register for nothing and says why', async () => {
    const el = await mountStep(null);

    expect(mockGetQuotations).not.toHaveBeenCalled();
    expect(el.textContent || '').toContain('ยังไม่มีคำขอต่ออายุ');
  });

  /**
   * Review r1, minor 1. The accept surface computed its lapsed notice with the
   * surface hard-coded to 'payments-list', which draws a รีเฟรช button. This
   * wizard screen has none: its only controls are ย้อนกลับ / ถัดไป (the
   * ลองอีกครั้ง button belongs to the lookup-failed branch). Telling the holder
   * of a lapsed renewal offer to press a control that is not drawn is the same
   * defect the round already fixed one file away, so the surface travels as a
   * prop and this screen passes its own.
   */
  it('a lapsed row is explained in the words of a screen with no refresh button', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: { ...RENEWAL_ROW, validUntil: '2020-01-01T00:00:00.000Z' },
    });

    const el = await mountStep();
    const text = el.textContent || '';

    expect(text).toContain(QUOTATION_EXPIRED_COPY_TH);
    expect(text).not.toContain('กดรีเฟรชหน้านี้');
    // R21 still holds on this surface: a lapsed row draws no accept button.
    expect(
      Array.from(el.querySelectorAll('button')).some((b) =>
        (b.textContent || '').includes('ยอมรับใบเสนอราคา'),
      ),
    ).toBe(false);
  });
});
