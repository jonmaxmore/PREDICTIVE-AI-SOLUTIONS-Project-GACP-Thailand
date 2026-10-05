/**
 * checkout-terms-are-v1-2.test.tsx — the disclosure above the tick is v1.2.
 *
 * Operator 2026-10-03 ("ใช้ 1.2" → "ทำได้เลย"): docs/legal/payment-terms-th-v1.2.md
 * replaces v1.1 for new acceptances, and the backend now records every new
 * grant as payment-terms-th-v1.2 (ConsentVersions.PAYMENT_TERMS). The screen
 * the applicant ticks therefore has to summarise v1.2: the line names the
 * quotation, invoice and receipt print (the catalogue), what each line covers
 * (§2.5), and that the price is one fee with no state part (§2.6). v1.1's
 * state/platform split must not appear, and neither may v1.1's "locked at
 * submission" sentence, which v1.2 §3.4 replaced with "binding once accepted".
 *
 * Harness: the createRoot + act pattern of checkout-shows-quotation-and-terms.test.tsx.
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
const mockGetQuotations = jest.fn<() => Promise<QuotationsBySide | null>>();

jest.mock('@/lib/services/checkout-service', () => {
  const actual = jest.requireActual('@/lib/services/checkout-service') as Record<string, unknown>;
  return { ...actual, createCheckout: (args: unknown) => mockCreateCheckout(args) };
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
    push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(),
    forward: jest.fn(), prefetch: jest.fn(), pathname: '/', query: {},
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

describe('the checkout disclosure summarises payment-terms v1.2', () => {
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

  async function mountView(): Promise<void> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<CheckoutClientView />);
    });
    await flushAsync();
  }

  function termsText(): string {
    const section = container!.querySelector('[data-testid="checkout-terms-section"]');
    expect(section).not.toBeNull();
    return (section!.textContent || '').replace(/\s+/g, ' ');
  }

  it('names the document and its edition: ฉบับที่ 1.2', async () => {
    await mountView();
    const version = container!.querySelector('[data-testid="checkout-terms-version"]');
    expect(version).not.toBeNull();
    expect(version!.textContent).toContain('เงื่อนไขการชำระค่าบริการและการคืนเงิน');
    expect(version!.textContent).toContain('ฉบับที่ 1.2');
  });

  it('names every line with the catalogue names the finance documents print', async () => {
    await mountView();
    const text = termsText();
    expect(text).toContain('งวดที่ 1 ค่าบริการตรวจสอบเอกสาร');
    expect(text).toContain('งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง');
    expect(text).toContain('ค่าบริการต่ออายุใบรับรอง');
  });

  it('states what each line covers (§2.5)', async () => {
    await mountView();
    const text = termsText();
    expect(text).toContain('รับและตรวจความครบถ้วน ความถูกต้องของเอกสารคำขอตามหลักเกณฑ์ GACP');
    expect(text).toContain('นัดหมายและตรวจประเมินแปลงปลูก ณ สถานที่จริง');
    expect(text).toContain('ตรวจประเมินเพื่อต่ออายุ');
  });

  it('states one fee with no state part, and what it does not include (§2.6)', async () => {
    await mountView();
    expect(termsText()).toContain(
      'ค่าบริการเป็นจำนวนเดียวที่บริษัทเรียกเก็บ ไม่แยกเป็นส่วนของหน่วยงานรัฐ และไม่รวมค่าเดินทาง ค่าที่พัก หรือค่าตอบแทนของผู้ตรวจ',
    );
  });

  it('carries none of the retired v1.1 wording', async () => {
    await mountView();
    const text = termsText();
    expect(text).not.toContain('ค่าธรรมเนียมรัฐ');
    expect(text).not.toContain('ค่าบริการแพลตฟอร์ม');
    expect(text).not.toContain('ล็อกราคา ณ วันยื่นคำขอ');
    // v1.2 §3.4: the accepted quotation binds every instalment.
    expect(text).toContain('ราคาตามใบเสนอราคานั้นผูกพันทุกงวดของคำขอนี้จนชำระครบ');
  });

  it('an applicant whose grant is v1.1 is shown the box again, not "already accepted"', async () => {
    mockGetPaymentTermsConsent.mockResolvedValue({
      success: true,
      data: {
        consents: {
          PAYMENT_TERMS: {
            granted: true,
            version: 'payment-terms-th-v1.1',
            currentVersion: 'payment-terms-th-v1.2',
          },
        },
      },
    });
    await mountView();
    expect(container!.querySelector('[data-testid="checkout-terms-checkbox"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="checkout-terms-recorded"]')).toBeNull();
  });
});
