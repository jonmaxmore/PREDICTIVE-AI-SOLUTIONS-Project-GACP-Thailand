'use strict';

/**
 * F-G4-36 — the settlement's receipt / tax-invoice number must be bound to the
 * paid invoice (W14 ruling: ONE number for ONE document).
 *
 * Before this fix the settle transaction allocated the TAX-PRD number, wrote it
 * onto the checkout_documents row, and updated the invoice with only
 * { status, paidAt, paymentMethod }. The invoice's receipt columns stayed null,
 * so every invoice-based reader (customer statement, daily cash report, bank
 * reconciliation, the invoice PDF, the farmer's payments page) was blind to the
 * receipt, and the accountant's listPendingReceipts queue (status paid +
 * receiptNumber null) listed the checkout invoice forever — pressing
 * "issue receipt" there would allocate a SECOND TAX-PRD number for the same
 * supply.
 *
 * Mock scaffold copied from settle-event.test.js (allocateReceiptNumber → N1).
 * The FOR-UPDATE race-loser case (no writes at all) is already pinned there
 * and is not duplicated here.
 */
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);
jest.mock('../../shared/logger', () => { const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }; return { ...l, createLogger: () => l }; });

// F-G4-64 — the quotation close runs after the settle transaction commits.
jest.mock('../../services/quotation-service', () => ({
  recordPhaseInvoiced: jest.fn(async () => ({ quotationId: 'qt-1', phase: 'PHASE_1', closed: false, status: 'ACCEPTED' })),
}));
jest.mock('../../middleware/audit-logger', () => ({
  auditLogger: { log: jest.fn(async () => ({})) },
  AuditCategory: { PAYMENT: 'PAYMENT' },
  AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
  ResourceType: { APPLICATION: 'APPLICATION', PAYMENT: 'PAYMENT' },
}));

const pending = { id: 'ord_1', status: 'PENDING_PAYMENT', totalPayableAmount: 5885, milestone: 'M1',
  invoiceId: 'inv_1', applicationId: 'app_1', organizationId: 'org_1', quotationId: 'qt-1',
  platformFeeNet: 5500, platformFeeVat: 385, platformFeeGross: 5885 };

const tx = {
  $queryRaw: jest.fn(async () => [{ id: 'ord_1', status: 'PENDING_PAYMENT' }]), // FOR UPDATE lock read
  checkoutOrder: { update: jest.fn() }, invoice: { update: jest.fn() },
  paymentTransaction: { update: jest.fn() }, checkoutDocument: { create: jest.fn() },
};
const mockDb = {
  checkoutOrder: { findFirst: jest.fn() },
  stripeWebhookEvent: { findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(async (cb, opts) => { mockDb.__txOpts = opts; return cb(tx); }),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));
jest.mock('../../services/journal-entry-service', () => ({ recordPaymentEntry: jest.fn() }));
jest.mock('../../services/application-status-writer', () => ({ writeApplicationStatus: jest.fn() }));
jest.mock('../../services/receipt-numbering-service', () => ({ allocateReceiptNumber: jest.fn(async () => ({ number: 'N1' })), ISSUER: { PLATFORM: 'PLATFORM', DTAM: 'DTAM' } }));

const svc = require('../../services/checkout/checkout-settlement-service');

const SUCCEEDED = { id: 'pi_1', amount_received: 588500, metadata: { checkoutOrderId: 'ord_1' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...pending });
});

test('(a) a fresh settle writes the allocated number into the invoice receipt columns, status stays paid', async () => {
  const r = await svc.settleFromPaymentIntent({ paymentIntent: SUCCEEDED, eventId: 'evt_1' });
  expect(r).toEqual({ settled: true });

  expect(tx.invoice.update).toHaveBeenCalledTimes(1);
  const { where, data } = tx.invoice.update.mock.calls[0][0];
  expect(where).toEqual({ id: 'inv_1' });
  expect(data).toEqual(expect.objectContaining({
    status: 'paid',
    paymentMethod: 'STRIPE',
    paidAt: expect.any(Date),
    receiptNumber: 'N1',
    receiptStatus: 'ISSUED',
    receiptIssuedBy: 'stripe-webhook',
    receiptIssuedAt: expect.any(Date),
  }));
  // The raw status vocabulary is read strictly as 'paid' by the credit-note,
  // debit-note, refund and WHT services; the receipt state lives in the
  // receipt columns (toErpStatus derives RECEIPT_ISSUED from them).
  expect(data.status).not.toBe('RECEIPT_ISSUED');
  // One settlement instant: receiptIssuedAt is the same moment as paidAt and
  // the order's settledAt.
  expect(data.receiptIssuedAt.getTime()).toBe(data.paidAt.getTime());
  const orderData = tx.checkoutOrder.update.mock.calls[0][0].data;
  expect(orderData.settledAt.getTime()).toBe(data.receiptIssuedAt.getTime());
});

test('(b) the invoice receiptNumber and the checkout_documents documentNumber are ONE number', async () => {
  await svc.settleFromPaymentIntent({ paymentIntent: SUCCEEDED, eventId: 'evt_1' });

  expect(tx.checkoutDocument.create).toHaveBeenCalledTimes(1);
  const doc = tx.checkoutDocument.create.mock.calls[0][0].data;
  const inv = tx.invoice.update.mock.calls[0][0].data;
  expect(doc.documentType).toBe('PLATFORM_TAX_INVOICE');
  expect(doc.documentNumber).toBe('N1');
  expect(inv.receiptNumber).toBe(doc.documentNumber);
  expect(doc.payload.documentNumber).toBe(inv.receiptNumber);
  // The document payload's issuedAt is the same settlement instant.
  expect(new Date(doc.payload.issuedAt).getTime()).toBe(inv.receiptIssuedAt.getTime());
});

// F-G4-64 §3.3 — ONE document, one number. The receipt number written onto the
// invoice and the number the quotation stamp records must name the same
// document, or the note left on a quotation that was never accepted
// (INVOICED_WITHOUT_ACCEPTANCE) would point at a receipt that does not exist.
test('(c) the quotation stamp names the SAME document number as the invoice receipt', async () => {
  const { recordPhaseInvoiced } = require('../../services/quotation-service');
  await svc.settleFromPaymentIntent({ paymentIntent: SUCCEEDED, eventId: 'evt_1' });

  const inv = tx.invoice.update.mock.calls[0][0].data;
  expect(recordPhaseInvoiced).toHaveBeenCalledWith(expect.objectContaining({
    quotationId: 'qt-1',
    milestone: 'M1',
    invoiceNumber: 'N1',
  }));
  expect(recordPhaseInvoiced.mock.calls[0][0].invoiceNumber).toBe(inv.receiptNumber);
  // The stamp carries the ONE settlement instant, not a second `new Date()`.
  expect(recordPhaseInvoiced.mock.calls[0][0].at.getTime()).toBe(inv.receiptIssuedAt.getTime());
});
