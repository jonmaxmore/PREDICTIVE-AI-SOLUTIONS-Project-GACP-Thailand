'use strict';

/**
 * R2 M5 — Task 6: closure-job guard, never expire a paid order (RED-first).
 *
 * Money-safety guard #3 (gateway truth): Task 3-5 made settlement retryable,
 * so a settle that failed/stalled can leave the LOCAL invoice reading PENDING
 * even though Stripe already captured the payment. Without this guard the
 * payment-closure sweep would eventually mark that PAID application
 * EXPIRED/PAYMENT_ABANDONED. Stripe — not the local row — is the source of
 * truth for whether money moved.
 *
 * Fail-SAFE: if the gateway call throws (Stripe unreachable), the guard
 * returns true (treat as paid, do not close) — a late close is recoverable,
 * a false close of a paying customer's application is not (the reopen
 * mechanism is unbuilt — see jobs/payment-closure-job.js module note).
 */
jest.mock('../../shared/logger', () => { const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; return { ...l, createLogger: () => l }; });
const mockDb = { checkoutOrder: { findFirst: jest.fn() } };
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));
const mockGetPaymentIntent = jest.fn();
jest.mock('../../services/payment/payment-adapter', () => ({ getPaymentAdapter: () => ({ getPaymentIntent: mockGetPaymentIntent }) }));
const { isInvoicePaidAtGateway } = require('../../jobs/payment-closure-job');

beforeEach(() => jest.clearAllMocks());

test('returns true when the order PI is succeeded at Stripe', async () => {
  mockDb.checkoutOrder.findFirst.mockResolvedValue({ id: 'o1', stripePaymentIntentId: 'pi_1' });
  mockGetPaymentIntent.mockResolvedValue({ status: 'succeeded' });
  expect(await isInvoicePaidAtGateway('inv_1')).toBe(true);
});

test('returns false when there is no captured PI', async () => {
  mockDb.checkoutOrder.findFirst.mockResolvedValue({ id: 'o1', stripePaymentIntentId: 'pi_1' });
  mockGetPaymentIntent.mockResolvedValue({ status: 'requires_payment_method' });
  expect(await isInvoicePaidAtGateway('inv_1')).toBe(false);
});

test('returns false when the invoice has no linked checkout order (never calls the gateway)', async () => {
  mockDb.checkoutOrder.findFirst.mockResolvedValue(null);
  expect(await isInvoicePaidAtGateway('inv_1')).toBe(false);
  expect(mockGetPaymentIntent).not.toHaveBeenCalled();
});

test('fail-SAFE: gateway throws (Stripe unreachable) -> returns true (do not close)', async () => {
  mockDb.checkoutOrder.findFirst.mockResolvedValue({ id: 'o1', stripePaymentIntentId: 'pi_1' });
  mockGetPaymentIntent.mockRejectedValue(new Error('Stripe unreachable'));
  expect(await isInvoicePaidAtGateway('inv_1')).toBe(true);
});
