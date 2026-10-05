/**
 * fix/fee-line-descriptions round 2 (operator 2026-10-03) — the checkout screen
 * names a renewal's M2 as the renewal service, read from the quotation API's
 * `copy.services`, never "งวดที่ 2". A new filing's M2 keeps งวดที่ 2.
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30_000);

const RENEWAL = { name: 'ค่าบริการต่ออายุใบรับรอง', nameEn: 'x', coverage: 'ครอบคลุม: x', coverageEn: 'x' };
const P2 = { name: 'งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง', nameEn: 'x', coverage: 'ครอบคลุม: y', coverageEn: 'x' };
const P1 = { name: 'งวดที่ 1 ค่าบริการตรวจสอบเอกสาร', nameEn: 'x', coverage: 'ครอบคลุม: z', coverageEn: 'x' };

let mockQuotations: unknown = null;
jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service') as { PaymentService: Record<string, unknown> };
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getPaymentTermsConsent: async () => ({ success: true, data: { consents: {} } }),
      acceptPaymentTerms: async () => ({ success: true }),
      getQuotations: async () => mockQuotations,
    },
  };
});
jest.mock('@/lib/services/checkout-service', () => {
  const actual = jest.requireActual('@/lib/services/checkout-service') as Record<string, unknown>;
  return { ...actual, createCheckout: async () => ({ ok: false }) };
});
let mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => {
  const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(), forward: jest.fn(), prefetch: jest.fn() };
  return { useRouter: () => router, usePathname: () => '/health/payments/checkout', useSearchParams: () => mockSearchParams };
});

import CheckoutClientView from '../client-view';

const accepted = (total: number) => ({
  id: 'q-1', applicationId: 'APP-1', issuerType: 'PLATFORM', quotationNumber: 'QT-PRD-2569-000009',
  subtotal: 0, vat: 0, totalAmount: total, status: 'ACCEPTED', createdAt: '2026-10-03T00:00:00.000Z',
  acceptedAt: '2026-10-03T01:00:00.000Z',
  installments: [{ phase: 'PHASE_2', amount: total, phaseTotal: total }],
  acceptedSnapshot: { installments: [{ phase: 'PHASE_2', phaseTotal: String(total) }] },
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mockSearchParams = new URLSearchParams({ app: 'APP-1', milestone: 'M2' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(): Promise<string> {
  await act(async () => { root.render(<CheckoutClientView />); });
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  return (container.querySelector('[data-testid="checkout-quotation-summary"]')?.textContent || '').replace(/\s+/g, ' ');
}

describe('checkout milestone label', () => {
  it('a renewal M2 reads as ค่าบริการต่ออายุใบรับรอง, not งวดที่ 2', async () => {
    mockQuotations = { dtam: null, platform: accepted(35310), copy: { intro: 'i', note: 'n', services: { PHASE_1: null, PHASE_2: RENEWAL } } };
    const text = await mount();
    expect(text).toContain('ค่าบริการต่ออายุใบรับรอง');
    expect(text).not.toContain('งวดที่ 2');
    expect(text).toContain('35,310');
  });

  it('a new filing M2 keeps its instalment name', async () => {
    mockQuotations = { dtam: null, platform: accepted(29425), copy: { intro: 'i', note: 'n', services: { PHASE_1: P1, PHASE_2: P2 } } };
    const text = await mount();
    expect(text).toContain(P2.name);
    expect(text).toContain('29,425');
  });
});
