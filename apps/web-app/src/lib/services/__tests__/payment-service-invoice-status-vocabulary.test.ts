/**
 * payment-service-invoice-status-vocabulary.test.ts — the ONE reading of an invoice's
 * status word, and the two things every screen kept getting wrong on its own.
 *
 * 1. CASE. The column does not hold one casing. Measured 2026-09-10 on the running
 *    systems: the demo/prod register stores `paid` and `pending` lower-case, staging
 *    stores `PAID` and `PENDING` upper-case. Any screen comparing `status === 'PAID'`
 *    is therefore correct on one database and wrong on the other — and /health/
 *    official-documents was the wrong one, calling a settled bill an outstanding
 *    invoice and refusing its download.
 *
 * 2. CANCELLED IS NOT PAID. `toErpStatus` (invoice-service.js:74) returns
 *    RECEIPT_ISSUED for ANY row that carries a receipt number, including one later
 *    voided. Without the cancelled guard a voided-after-receipt row reads as settled,
 *    is summed into ยอดที่ชำระแล้ว, and is drawn with the green ชำระเงินแล้ว chip. Both
 *    guards survived the whole 1261-test front-end suite unpinned before this file.
 *
 * These are pure functions over a row shape — no transport, no mocks needed.
 */
import { describe, expect, it } from '@jest/globals';

import { normalizeInvoiceStatus, invoiceIsPaid, invoiceIsCancelled } from '../payment-service';

describe('normalizeInvoiceStatus', () => {
    it('upper-cases, so one register’s casing is not a different fact from another’s', () => {
        expect(normalizeInvoiceStatus({ status: 'pending' })).toBe('PENDING');
        expect(normalizeInvoiceStatus({ status: 'paid' })).toBe('PAID');
        expect(normalizeInvoiceStatus({ status: 'PENDING' })).toBe('PENDING');
    });

    it('trims, so a stray space is not a status of its own', () => {
        expect(normalizeInvoiceStatus({ status: '  paid  ' })).toBe('PAID');
    });

    it('lets erpStatus lead — it is the accounting reading of the same row', () => {
        // withDerivedStatus (invoice-service.js:105) sends both. The derived one knows
        // about the receipt; the raw column does not.
        expect(normalizeInvoiceStatus({ status: 'paid', erpStatus: 'RECEIPT_ISSUED' }))
            .toBe('RECEIPT_ISSUED');
    });

    it('falls back to the raw column when the derived one is absent', () => {
        expect(normalizeInvoiceStatus({ status: 'pending', erpStatus: '' })).toBe('PENDING');
        expect(normalizeInvoiceStatus({ status: 'pending' })).toBe('PENDING');
    });

    it('answers an empty string for a row that names no status at all', () => {
        expect(normalizeInvoiceStatus({})).toBe('');
        expect(normalizeInvoiceStatus({ status: null })).toBe('');
    });
});

describe('invoiceIsPaid', () => {
    it('recognises a lower-case `paid` — the live demo/prod register spells it that way', () => {
        expect(invoiceIsPaid({ status: 'paid' })).toBe(true);
    });

    it('recognises every settled word, not just PAID', () => {
        // A bill becomes RECEIPT_ISSUED once its receipt is allocated
        // (invoice-service.js:430); PAID_PENDING_RECEIPT is the gap between the two.
        expect(invoiceIsPaid({ status: 'RECEIPT_ISSUED' })).toBe(true);
        expect(invoiceIsPaid({ status: 'PAID_PENDING_RECEIPT' })).toBe(true);
        expect(invoiceIsPaid({ status: 'APPROVED' })).toBe(true);
    });

    it('does not call an outstanding bill paid', () => {
        expect(invoiceIsPaid({ status: 'pending' })).toBe(false);
        expect(invoiceIsPaid({ status: 'OVERDUE' })).toBe(false);
        expect(invoiceIsPaid({})).toBe(false);
    });

    it('a CANCELLED row is not paid, even when it still carries a receipt', () => {
        // The shape toErpStatus produces for a voided row that was once receipted.
        expect(invoiceIsPaid({ status: 'CANCELLED', erpStatus: 'CANCELLED' })).toBe(false);
        expect(invoiceIsPaid({ status: 'cancelled' })).toBe(false);
    });
});

describe('invoiceIsCancelled', () => {
    it('is true for the voided word in either casing', () => {
        expect(invoiceIsCancelled({ status: 'CANCELLED' })).toBe(true);
        expect(invoiceIsCancelled({ status: 'cancelled' })).toBe(true);
        expect(invoiceIsCancelled({ status: 'paid', erpStatus: 'CANCELLED' })).toBe(true);
    });

    it('is false for every live word', () => {
        expect(invoiceIsCancelled({ status: 'pending' })).toBe(false);
        expect(invoiceIsCancelled({ status: 'RECEIPT_ISSUED' })).toBe(false);
        expect(invoiceIsCancelled({})).toBe(false);
    });
});
