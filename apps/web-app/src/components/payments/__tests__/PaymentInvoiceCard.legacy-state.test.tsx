/**
 * PaymentInvoiceCard.legacy-state.test.tsx — one-fee residue sweep, fix round
 * 1 (2026-09-26, controller decision on review Important-1).
 *
 * A `component === 'STATE'` invoice is not a hypothetical shape: real rows
 * minted before the 2026-09-11 one-ค่าบริการ ruling (~22 on record) are still
 * surfaced today by apps/backend/services/phase-billing-service.js
 * flattenRequiredInvoices for any settlement carrying a state.invoice — a
 * historical boundary the W14 ruling kept, not dead code.
 *
 * After the one-fee residue sweep's first pass (fix/one-fee-residue, commits
 * 1ec08aa2/d5f0f9f2) removed the retired isStateSide branch, such a row fell
 * through to the generic non-CHECKOUT fallback, which:
 *   - labelled it 'ไม่ระบุ' ("unspecified") instead of naming what it is;
 *   - claimed the COMPANY issued it ("บริษัท Predictive AI Solution Co., Ltd.");
 *   - invented a VAT-7% split on an amount that was, by law, VAT-exempt
 *     (ป.รัษฎากร ม.77/1(10)).
 *
 * Fixed truthfully and minimally: one label naming what the row actually is,
 * no VAT line, no company-issuer claim. The total stays exactly the stored
 * amount either way — no money computation changes.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import PaymentInvoiceCard from '../PaymentInvoiceCard';
import type { PaymentRecord } from '@/lib/services/payment-service';

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,FAKE') },
}));

/** The exact wording the controller specified, taken from ONE constant. */
const LEGACY_STATE_FEE_LABEL_TH = 'ค่าธรรมเนียมรัฐ (รายการก่อนเปลี่ยนเป็นค่าบริการก้อนเดียว)';

const legacyStateInvoice: PaymentRecord = {
  id: 'inv-legacy-state-1',
  type: 'INVOICE',
  documentNumber: 'INV-2569-STATE-LEGACY-1',
  applicationId: 'app-legacy-1',
  amount: 5000,
  status: 'PENDING',
  erpStatus: 'PENDING',
  createdAt: '2026-05-16T00:00:00.000Z',
  serviceType: 'PHASE_1_STATE_FEE',
  phase: 'PHASE_1',
  component: 'STATE',
  isPaid: false,
};

describe('PaymentInvoiceCard — a real legacy STATE row (pre-2026-09-11)', () => {
  it('names it truthfully, not "ไม่ระบุ"', () => {
    const html = renderToStaticMarkup(<PaymentInvoiceCard invoice={legacyStateInvoice} />);
    expect(html).not.toContain('ไม่ระบุ');
    expect(html).toContain(LEGACY_STATE_FEE_LABEL_TH);
  });

  it('shows no VAT line — the state fee was VAT-exempt, not a service fee split into 7%', () => {
    const html = renderToStaticMarkup(<PaymentInvoiceCard invoice={legacyStateInvoice} />);
    expect(html).not.toContain('VAT 7%');
    // The subtotal/VAT breakdown row ("ค่าบริการ" + a computed VAT figure)
    // must not appear either — only the total, unchanged.
    expect(html).not.toContain('฿4,673'); // Math.round(5000/1.07*0.93) — the invented subtotal
    expect(html).not.toContain('฿327'); // Math.round(5000/1.07*0.07) — the invented VAT
  });

  it('names no company issuer for a document that was, by law, a government receipt', () => {
    const html = renderToStaticMarkup(<PaymentInvoiceCard invoice={legacyStateInvoice} />);
    expect(html).not.toContain('บริษัท Predictive AI Solution Co., Ltd.');
  });

  it('the total is exactly the stored amount — no money computation changed', () => {
    const html = renderToStaticMarkup(<PaymentInvoiceCard invoice={legacyStateInvoice} />);
    expect(html).toContain('฿5,000');
  });
});
