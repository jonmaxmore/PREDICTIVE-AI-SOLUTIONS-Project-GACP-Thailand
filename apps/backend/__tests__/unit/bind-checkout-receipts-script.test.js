/**
 * Tests for scripts/bind-checkout-receipts-to-invoices.js (ledger F-G4-36).
 *
 * The binding decision is a pure function over plain checkout_orders rows (with the
 * invoice and the PLATFORM_TAX_INVOICE documents attached), so it is pinned here
 * without a database:
 *   1. planReceiptBindings — binds when the invoice has no receiptNumber and exactly
 *      one PLATFORM_TAX_INVOICE document exists; CONFLICT when a different number is
 *      already bound; ALREADY_BOUND (no-op, counted separately) when the same one is;
 *      refused when zero or more than one document exists.
 *   2. the update written is exactly what checkout-settlement-service.js writes at
 *      settle time (receiptIssuedBy 'stripe-webhook', receiptStatus 'ISSUED').
 *   3. requiring the module never constructs a PrismaClient (pattern:
 *      __tests__/unit/pdpa-backfill-script.test.js).
 */

const path = require('path');

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn() }));

const { PrismaClient } = require('@prisma/client');
const {
    planReceiptBindings,
} = require(path.join(__dirname, '..', '..', 'scripts', 'bind-checkout-receipts-to-invoices'));

const DOC_AT = new Date('2026-08-26T04:00:00.000Z');
// The live path (checkout-settlement-service) stamps receiptIssuedAt with the order's
// settledAt; the backfill must carry the same instant, not the document row's own createdAt.
const SETTLED_AT = new Date('2026-08-26T03:59:59.500Z');

let seq = 0;
function taxInvoiceDoc(overrides) {
    seq += 1;
    return {
        id: `doc-${seq}`,
        documentType: 'PLATFORM_TAX_INVOICE',
        documentNumber: `TAX-PRD-2026-${String(seq).padStart(6, '0')}`,
        createdAt: DOC_AT,
        ...overrides,
    };
}

function order(overrides) {
    seq += 1;
    const invoiceId = `inv-${seq}`;
    return {
        id: `order-${seq}`,
        status: 'SETTLED',
        settledAt: SETTLED_AT,
        milestone: 'M1',
        invoiceId,
        invoice: {
            id: invoiceId,
            invoiceNumber: `INV-${String(seq).padStart(4, '0')}`,
            receiptNumber: null,
            receiptStatus: null,
        },
        documents: [taxInvoiceDoc()],
        ...overrides,
    };
}

beforeEach(() => {
    seq = 0;
});

describe('requiring the module does not connect', () => {
    it('constructs no PrismaClient at require time', () => {
        expect(PrismaClient).not.toHaveBeenCalled();
        expect(typeof planReceiptBindings).toBe('function');
    });
});

describe('planReceiptBindings — binds', () => {
    it('binds the single PLATFORM_TAX_INVOICE document to an invoice with no receipt', () => {
        const o = order();
        const doc = o.documents[0];

        const plan = planReceiptBindings({ orders: [o] });

        expect(plan.refused).toEqual([]);
        expect(plan.alreadyBound).toEqual([]);
        expect(plan.bindings).toEqual([{
            invoiceId: o.invoiceId,
            receiptNumber: doc.documentNumber,
            receiptIssuedAt: SETTLED_AT,
            receiptIssuedBy: 'stripe-webhook',
            receiptStatus: 'ISSUED',
        }]);
    });

    it('falls back to the document createdAt only when the order carries no settledAt', () => {
        const o = order({ settledAt: null });
        const plan = planReceiptBindings({ orders: [o] });
        expect(plan.refused).toEqual([]);
        expect(plan.bindings[0].receiptIssuedAt).toEqual(DOC_AT);
    });

    it('ignores DTAM_DISBURSAL_RECEIPT documents when counting', () => {
        const tax = taxInvoiceDoc();
        const o = order({
            documents: [
                taxInvoiceDoc({ documentType: 'DTAM_DISBURSAL_RECEIPT', documentNumber: 'DTAM-0001' }),
                tax,
            ],
        });
        const plan = planReceiptBindings({ orders: [o] });
        expect(plan.refused).toEqual([]);
        expect(plan.bindings).toHaveLength(1);
        expect(plan.bindings[0].receiptNumber).toBe(tax.documentNumber);
    });

    it('does not mutate the input rows', () => {
        const o = order();
        const before = JSON.stringify(o);
        planReceiptBindings({ orders: [o] });
        expect(JSON.stringify(o)).toBe(before);
    });
});

describe('planReceiptBindings — CONFLICT vs ALREADY_BOUND', () => {
    it('CONFLICT when the invoice already carries a different receipt number', () => {
        const o = order();
        o.invoice.receiptNumber = 'TAX-PRD-2026-999999';

        const plan = planReceiptBindings({ orders: [o] });

        expect(plan.bindings).toEqual([]);
        expect(plan.alreadyBound).toEqual([]);
        expect(plan.refused).toHaveLength(1);
        expect(plan.refused[0].order.id).toBe(o.id);
        expect(plan.refused[0].reason).toMatch(/^CONFLICT/);
    });

    it('ALREADY_BOUND when the invoice already carries this exact number (no-op, counted apart)', () => {
        const o = order();
        o.invoice.receiptNumber = o.documents[0].documentNumber;

        const plan = planReceiptBindings({ orders: [o] });

        expect(plan.bindings).toEqual([]);
        expect(plan.refused).toEqual([]);
        expect(plan.alreadyBound).toHaveLength(1);
        expect(plan.alreadyBound[0].order.id).toBe(o.id);
        expect(plan.alreadyBound[0].reason).toMatch(/^ALREADY_BOUND/);
    });
});

describe('planReceiptBindings — refusals', () => {
    it('refuses when zero PLATFORM_TAX_INVOICE documents exist', () => {
        const none = order({ documents: [] });
        const onlyDtam = order({
            documents: [taxInvoiceDoc({ documentType: 'DTAM_DISBURSAL_RECEIPT', documentNumber: 'DTAM-0002' })],
        });
        const plan = planReceiptBindings({ orders: [none, onlyDtam] });
        expect(plan.bindings).toEqual([]);
        expect(plan.refused.map((r) => r.order.id).sort()).toEqual([none.id, onlyDtam.id].sort());
        for (const r of plan.refused) {
            expect(r.reason).toMatch(/NO_TAX_INVOICE_DOCUMENT/);
        }
    });

    it('refuses when more than one PLATFORM_TAX_INVOICE document exists', () => {
        const o = order({ documents: [taxInvoiceDoc(), taxInvoiceDoc()] });
        const plan = planReceiptBindings({ orders: [o] });
        expect(plan.bindings).toEqual([]);
        expect(plan.refused).toHaveLength(1);
        expect(plan.refused[0].reason).toMatch(/MULTIPLE_TAX_INVOICE_DOCUMENTS/);
    });

    it('refuses an order that is not SETTLED', () => {
        const pending = order({ status: 'PENDING_PAYMENT' });
        const plan = planReceiptBindings({ orders: [pending] });
        expect(plan.bindings).toEqual([]);
        expect(plan.refused[0].reason).toMatch(/NOT_SETTLED/);
    });

    it('refuses an order without an invoice', () => {
        const noId = order({ invoiceId: null, invoice: null });
        const idButNoRow = order({ invoice: null });
        const plan = planReceiptBindings({ orders: [noId, idButNoRow] });
        expect(plan.bindings).toEqual([]);
        expect(plan.refused).toHaveLength(2);
        for (const r of plan.refused) {
            expect(r.reason).toMatch(/NO_INVOICE/);
        }
    });

    it('refuses when two orders would bind the same invoice (the second one)', () => {
        const a = order();
        const b = order({ invoiceId: a.invoiceId, invoice: { ...a.invoice } });
        const plan = planReceiptBindings({ orders: [a, b] });
        expect(plan.bindings).toHaveLength(1);
        expect(plan.bindings[0].invoiceId).toBe(a.invoiceId);
        expect(plan.refused).toHaveLength(1);
        expect(plan.refused[0].order.id).toBe(b.id);
        expect(plan.refused[0].reason).toMatch(/DUPLICATE_INVOICE_IN_PLAN/);
    });
});
