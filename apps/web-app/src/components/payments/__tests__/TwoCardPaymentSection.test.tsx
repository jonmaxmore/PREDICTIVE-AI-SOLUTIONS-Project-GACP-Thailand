/**
 * TwoCardPaymentSection.test.tsx — one-fee residue sweep (2026-09-26).
 *
 * Operator ruling 2026-09-11: there is no state-fee/platform-fee split. The
 * whole charge is one ค่าบริการ, one issuer (the company), one transfer.
 * This used to pin the retired two-card side-by-side pair (STATE +
 * PLATFORM cards, a "โอน 2 ครั้ง" header, and "missing side" placeholders).
 * That model is gone: every invoice for the phase now renders as its own
 * full-width card, stacked vertically, with no split-pair UI at all.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import TwoCardPaymentSection from '../TwoCardPaymentSection';
import type { PaymentRecord } from '@/lib/services/payment-service';

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service');
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getIssuerByServiceType: jest.fn().mockResolvedValue({ success: true, data: null }),
    },
  };
});

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,FAKE') },
}));

const stateInvoice: PaymentRecord = {
  id: 'inv-state-1',
  type: 'INVOICE',
  documentNumber: 'INV-2026-STATE-1',
  applicationId: 'app-1',
  amount: 5000,
  status: 'PENDING',
  erpStatus: 'PENDING',
  createdAt: '2026-05-16T00:00:00.000Z',
  serviceType: 'PHASE_1_STATE_FEE',
  phase: 'PHASE_1',
  component: 'STATE',
  isPaid: false,
};

const platformInvoice: PaymentRecord = {
  id: 'inv-plat-1',
  type: 'INVOICE',
  documentNumber: 'INV-2026-PLAT-1',
  applicationId: 'app-1',
  amount: 535,
  status: 'PENDING',
  erpStatus: 'PENDING',
  createdAt: '2026-05-16T00:00:00.000Z',
  serviceType: 'PHASE_1_PLATFORM_FEE',
  phase: 'PHASE_1',
  component: 'PLATFORM',
  isPaid: false,
};

describe('TwoCardPaymentSection (one-fee residue)', () => {
  it('renders one full-width card per invoice, never a side-by-side split pair', () => {
    const html = renderToStaticMarkup(
      <TwoCardPaymentSection
        phaseLabel="งวดที่ 1"
        invoices={[stateInvoice, platformInvoice]}
      />,
    );
    // Each invoice still gets its own card, keyed by component.
    expect(html).toContain('payment-invoice-card-STATE');
    expect(html).toContain('payment-invoice-card-PLATFORM');
    // The retired two-card design's subtitle is gone; fix round 1 (2026-09-26)
    // gives this real legacy row its own truthful label instead (a different
    // string — "ค่าธรรมเนียมรัฐ (รายการก่อนเปลี่ยนเป็นค่าบริการก้อนเดียว)" — not
    // the retired unqualified "ค่าธรรมเนียมรัฐ" card title).
    expect(html).not.toContain('เงินรายได้แผ่นดิน');
    // No split-pair grid, no two-transfer header suffix, no footnote.
    expect(html).not.toContain('โอน 2 ครั้ง');
    expect(html).not.toContain('ทำไมต้องโอน 2 ครั้ง?');
  });

  it('reports the combined total in the section header without the two-transfer suffix', () => {
    const html = renderToStaticMarkup(
      <TwoCardPaymentSection
        phaseLabel="งวดที่ 1"
        invoices={[stateInvoice, platformInvoice]}
      />,
    );
    // 5,000 + 535 = 5,535. Intl.NumberFormat th-TH renders as "฿5,535".
    expect(html).toContain('5,535');
    expect(html).not.toContain('โอน 2 ครั้ง');
  });

  it('renders a single invoice with no "missing side" placeholder', () => {
    const html = renderToStaticMarkup(
      <TwoCardPaymentSection
        phaseLabel="งวดที่ 1"
        invoices={[stateInvoice]}
      />,
    );
    expect(html).toContain('payment-invoice-card-STATE');
    expect(html).not.toContain('platform-card-missing');
    expect(html).not.toContain('state-card-missing');
  });
});
