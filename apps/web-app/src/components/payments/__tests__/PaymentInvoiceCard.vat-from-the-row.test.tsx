/**
 * Round 5 (review MINOR 3): the card's VAT line is the invoice row's own.
 * It used to be `total / 1.07 * 0.07`; a typed rate applied to the total.
 * Added with the implementation (pin, not RED-first; the RED for this finding
 * is the VAT-literal scan in no-screen-imports-a-literal-fee.test.ts).
 */
import { describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import PaymentInvoiceCard from '../PaymentInvoiceCard';
import type { PaymentRecord } from '@/lib/services/payment-service';

const base: PaymentRecord = {
    id: 'inv-1',
    type: 'INVOICE',
    documentNumber: 'INV-PRD-2569-000001',
    applicationId: 'app-1',
    amount: 6600,
    status: 'PENDING',
    createdAt: '2026-10-01T03:00:00.000Z',
    serviceType: 'CERTIFICATION_CHECKOUT_M1',
    phase: 'PHASE_1',
    component: 'CHECKOUT',
    isPaid: false,
} as PaymentRecord;

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('PaymentInvoiceCard VAT line', () => {
    it('prints the row\'s own subtotal and VAT (here at a 10% rate a typed 7% would get wrong)', () => {
        const t = text(renderToStaticMarkup(<PaymentInvoiceCard invoice={{ ...base, subtotal: 6000, vatAmount: 600 }} />));
        expect(t).toContain('6,000');
        expect(t).toContain('600');
        expect(t).not.toContain('6,168');
        expect(t).not.toContain('VAT 7%');
    });

    it('without the row\'s split it prints the total alone, no derived VAT', () => {
        const t = text(renderToStaticMarkup(<PaymentInvoiceCard invoice={{ ...base }} />));
        expect(t).toContain('6,600');
        expect(t).not.toContain('ภาษีมูลค่าเพิ่ม');
        expect(t).not.toContain('432');
    });
});
