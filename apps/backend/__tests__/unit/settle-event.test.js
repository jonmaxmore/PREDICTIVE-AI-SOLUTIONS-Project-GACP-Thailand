'use strict';
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);
jest.mock('../../shared/logger', () => { const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }; return { ...l, createLogger: () => l }; });

// F-G4-64 — settlement now closes the quotation AFTER its transaction commits.
// Both mocks are here so this suite exercises that branch; the four assertions
// below are unchanged on purpose: the point is that the close cannot alter any
// of them. `recordPhaseInvoiced` resolving to null is the pre-binding order
// (no quotation found), which the settle path logs and swallows.
jest.mock('../../services/quotation-service', () => ({ recordPhaseInvoiced: jest.fn(async () => null) }));
jest.mock('../../middleware/audit-logger', () => ({
  auditLogger: { log: jest.fn(async () => ({})) },
  AuditCategory: { PAYMENT: 'PAYMENT' },
  AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
  ResourceType: { APPLICATION: 'APPLICATION', PAYMENT: 'PAYMENT' },
}));

const settled = { id: 'ord_1', status: 'SETTLED' };
const pending = { id: 'ord_1', status: 'PENDING_PAYMENT', totalPayableAmount: 5535, milestone: 'M1',
  invoiceId: 'inv_1', quotationId: null, applicationId: 'app_1', organizationId: 'org_1',
  platformFeeNet: 5500, platformFeeVat: 35, platformFeeGross: 5535 };

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
const { recordPaymentEntry } = require('../../services/journal-entry-service');
const { writeApplicationStatus } = require('../../services/application-status-writer');
const { SETTLEMENT } = require('../../config/business-rules');

beforeEach(() => jest.clearAllMocks());

test('settle passes a bounded timeout to $transaction', async () => {
  mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...pending });
  await svc.settleFromPaymentIntent({ paymentIntent: { id: 'pi_1', amount_received: 553500 }, eventId: 'evt_1' });
  expect(mockDb.__txOpts.timeout).toBeGreaterThanOrEqual(30000);
});

test('an already-SETTLED order is a no-op (idempotent)', async () => {
  mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...settled });
  const r = await svc.settleFromPaymentIntent({ paymentIntent: { id: 'pi_1', amount_received: 553500 }, eventId: 'evt_1' });
  expect(r).toEqual({ settled: true, alreadySettled: true });
  expect(mockDb.$transaction).not.toHaveBeenCalled();
});

test('settleEvent stamps PROCESSED on success', async () => {
  mockDb.stripeWebhookEvent.findUnique.mockResolvedValue({ id: 'evt_1', status: 'RECEIVED', attempts: 0, payload: { data: { object: { id: 'pi_1', amount_received: 553500 } } } });
  mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...settled }); // already settled → clean PROCESSED
  const r = await svc.settleEvent('evt_1');
  expect(r.status).toBe('PROCESSED');
  expect(mockDb.stripeWebhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }));
});

test('settleEvent stamps FAILED + schedules retry when settle throws', async () => {
  mockDb.stripeWebhookEvent.findUnique.mockResolvedValue({ id: 'evt_2', status: 'RECEIVED', attempts: 0, payload: { data: { object: { id: 'pi_2', amount_received: 553500 } } } });
  mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...pending });
  mockDb.$transaction.mockRejectedValueOnce(new Error('P2028 timeout'));
  const r = await svc.settleEvent('evt_2');
  expect(r.status).toBe('FAILED');
  expect(mockDb.stripeWebhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', attempts: 1, nextRetryAt: expect.any(Date) }) }));
});

// Fix round 1 (money-review Important #1) — nextBackoff off-by-one regression
// guard. `attempts` passed into nextBackoff is already 1-based (post-
// incremented before the call), so the FIRST failure must schedule
// RETRY_BACKOFF_MS[0] (the 1-minute tier) — not RETRY_BACKOFF_MS[1] (5
// minutes), which is what an unshifted `b[Math.min(attempts, ...)]` index
// would deliver.
test('settleEvent schedules the FIRST retry at RETRY_BACKOFF_MS[0], not [1] (off-by-one regression guard)', async () => {
  mockDb.stripeWebhookEvent.findUnique.mockResolvedValue({ id: 'evt_3', status: 'RECEIVED', attempts: 0, payload: { data: { object: { id: 'pi_3', amount_received: 553500 } } } });
  mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...pending });
  mockDb.$transaction.mockRejectedValueOnce(new Error('P2028 timeout'));
  const before = Date.now();
  await svc.settleEvent('evt_3');
  const call = mockDb.stripeWebhookEvent.update.mock.calls[0][0];
  const deltaMs = call.data.nextRetryAt.getTime() - before;
  // Tolerance absorbs test-execution slack; RETRY_BACKOFF_MS[1] (300000ms)
  // is far outside this window, so the off-by-one bug fails this loudly.
  expect(deltaMs).toBeGreaterThanOrEqual(SETTLEMENT.RETRY_BACKOFF_MS[0] - 5000);
  expect(deltaMs).toBeLessThanOrEqual(SETTLEMENT.RETRY_BACKOFF_MS[0] + 1000);
});

// Fix round 1 (money-review Important #2) — the in-tx FOR-UPDATE race-loser
// branch must report alreadySettled (not a phantom fresh "settled") and
// must not repeat any of the settle writes.
test('a concurrent redelivery that loses the FOR-UPDATE race is a clean alreadySettled no-op, not a phantom settle', async () => {
  mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...pending });
  tx.$queryRaw.mockResolvedValueOnce([{ id: 'ord_1', status: 'SETTLED' }]);
  const r = await svc.settleFromPaymentIntent({ paymentIntent: { id: 'pi_1', amount_received: 553500 }, eventId: 'evt_race' });
  expect(r).toEqual({ settled: true, alreadySettled: true });
  expect(tx.checkoutOrder.update).not.toHaveBeenCalled();
  expect(tx.invoice.update).not.toHaveBeenCalled();
  expect(tx.checkoutDocument.create).not.toHaveBeenCalled();
  expect(recordPaymentEntry).not.toHaveBeenCalled();
  expect(writeApplicationStatus).not.toHaveBeenCalled();
});

// Fix round 1 (review ⚠️#1) — DEAD_LETTER must be terminal. Without this
// guard, a manual Stripe resend (or any re-drive) of a dead-lettered event
// would fall through into the settle attempt again, defeating the
// "operator action required" stop.
test('settleEvent short-circuits DEAD_LETTER — no re-attempt, not re-stamped', async () => {
  mockDb.stripeWebhookEvent.findUnique.mockResolvedValue({
    id: 'evt_dead', status: 'DEAD_LETTER', attempts: 5,
    payload: { data: { object: { id: 'pi_dead', amount_received: 553500 } } },
  });
  const r = await svc.settleEvent('evt_dead');
  expect(r.status).toBe('DEAD_LETTER');
  expect(mockDb.checkoutOrder.findFirst).not.toHaveBeenCalled();
  expect(mockDb.$transaction).not.toHaveBeenCalled();
  expect(mockDb.stripeWebhookEvent.update).not.toHaveBeenCalled();
});
