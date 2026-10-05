'use strict';

/**
 * settlement-reconcile-job unit tests — Task 5
 * (design notes).
 *
 * Two independent, bounded, fault-isolated sweeps:
 *   Query A — retry stale/unprocessed stripe_webhook_events via settleEvent.
 *   Query B — re-drive PENDING_PAYMENT orders whose PaymentIntent Stripe
 *             reports 'succeeded', via settleFromPaymentIntent.
 *
 * Refinement A (controller ruling): query A is scoped to
 * type: 'payment_intent.succeeded' — settleEvent only knows how to settle
 * that event family; a charge.succeeded/payment_failed row retried here
 * would raise a false ORDER_NOT_FOUND/AMOUNT_MISMATCH.
 *
 * Refinement B (controller ruling): query B skips a candidate order whose
 * PaymentIntent already has a PROCESSED payment_intent.succeeded event —
 * that means settleFromPaymentIntent already ran and refused for a TERMINAL
 * reason (AMOUNT_MISMATCH / ORDER_NOT_FOUND); re-driving would re-alert the
 * same terminal case every 10 minutes forever.
 */

jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});

const mockDb = {
    stripeWebhookEvent: {
        findMany: jest.fn(async () => []),
        // Refinement B's per-order terminal-skip check. Defaults to "not yet
        // handled" so the three baseline tests below (which predate the
        // refinement) keep exercising the getPaymentIntent/settle path.
        findFirst: jest.fn(async () => null),
    },
    checkoutOrder: { findMany: jest.fn(async () => []) },
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));
jest.mock('../../services/tenant-context', () => ({
    withoutTenantScope: (fn) => fn(),
    runWithTenantContext: (_c, fn) => fn(),
}));
// NOTE: babel-plugin-jest-hoist requires any out-of-scope variable referenced
// inside a jest.mock() factory to be prefixed "mock" (case-insensitive) — a
// bare `settleEvent`/`getPaymentIntent` throws "module factory ... not
// allowed to reference any out-of-scope variables" under this repo's
// babel-jest transform (confirmed: jest.config.cjs transform: babel-jest).
// House convention already follows this (see scheduler-renewal-job.test.js:
// mockCronSchedule/mockRenewalRun/mockLogger).
const mockSettleEvent = jest.fn(async () => ({ status: 'PROCESSED' }));
const mockSettleFromPaymentIntent = jest.fn(async () => ({ settled: true }));
jest.mock('../../services/checkout/checkout-settlement-service', () => ({
    settleEvent: mockSettleEvent,
    settleFromPaymentIntent: mockSettleFromPaymentIntent,
}));
const mockGetPaymentIntent = jest.fn();
jest.mock('../../services/payment/payment-adapter', () => ({ getPaymentAdapter: () => ({ getPaymentIntent: mockGetPaymentIntent }) }));

const { runSettlementReconcile } = require('../../jobs/settlement-reconcile-job');

beforeEach(() => jest.clearAllMocks());

test('query A retries a stale unprocessed event', async () => {
    mockDb.stripeWebhookEvent.findMany.mockResolvedValueOnce([{ id: 'evt_a' }]);
    const s = await runSettlementReconcile();
    expect(mockSettleEvent).toHaveBeenCalledWith('evt_a');
    expect(s.retriedEvents).toBe(1);
});

test('query B re-drives an order whose PI Stripe reports succeeded', async () => {
    mockDb.checkoutOrder.findMany.mockResolvedValueOnce([{ id: 'ord_b', stripePaymentIntentId: 'pi_b', organizationId: 'org' }]);
    mockGetPaymentIntent.mockResolvedValue({ id: 'pi_b', status: 'succeeded', amount_received: 553500 });
    const s = await runSettlementReconcile();
    expect(mockSettleFromPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ paymentIntent: expect.objectContaining({ id: 'pi_b' }) }));
    expect(s.reDrivenOrders).toBe(1);
});

test('query B skips an order whose PI is NOT succeeded', async () => {
    mockDb.checkoutOrder.findMany.mockResolvedValueOnce([{ id: 'ord_c', stripePaymentIntentId: 'pi_c', organizationId: 'org' }]);
    mockGetPaymentIntent.mockResolvedValue({ id: 'pi_c', status: 'requires_payment_method' });
    const s = await runSettlementReconcile();
    expect(mockSettleFromPaymentIntent).not.toHaveBeenCalled();
    expect(s.reDrivenOrders).toBe(0);
});

describe('Refinement A — query A is scoped to payment_intent.succeeded', () => {
    test('a type=charge.succeeded RECEIVED event is NOT retried by query A', async () => {
        // A tiny in-memory fixture honoring the where.type/where.status.in
        // filters the implementation actually passes, so this proves the row
        // is excluded by the QUERY SHAPE, not merely that a literal appears
        // in the source. Only type/status are simulated — OR/nextRetryAt are
        // out of scope for this refinement and are ignored by the fixture.
        const rows = [
            { id: 'evt_charge', type: 'charge.succeeded', status: 'RECEIVED' },
            { id: 'evt_pi', type: 'payment_intent.succeeded', status: 'RECEIVED' },
        ];
        mockDb.stripeWebhookEvent.findMany.mockImplementationOnce(async ({ where }) =>
            rows.filter((r) => r.type === where.type && where.status.in.includes(r.status)));

        const s = await runSettlementReconcile();

        expect(mockSettleEvent).toHaveBeenCalledTimes(1);
        expect(mockSettleEvent).toHaveBeenCalledWith('evt_pi');
        expect(mockSettleEvent).not.toHaveBeenCalledWith('evt_charge');
        expect(s.retriedEvents).toBe(1);
    });

    test('the where-clause literally pins type: payment_intent.succeeded', async () => {
        await runSettlementReconcile();
        const [args] = mockDb.stripeWebhookEvent.findMany.mock.calls[0];
        expect(args.where.type).toBe('payment_intent.succeeded');
        expect(args.where.status).toEqual({ in: ['RECEIVED', 'FAILED'] });
    });
});

describe('Refinement B — query B skips an order whose PI already has a PROCESSED event', () => {
    test('a PROCESSED payment_intent.succeeded event for the PI stops the re-drive (terminal — not re-alerted every run)', async () => {
        mockDb.checkoutOrder.findMany.mockResolvedValueOnce([{ id: 'ord_d', stripePaymentIntentId: 'pi_d', organizationId: 'org' }]);
        mockDb.stripeWebhookEvent.findFirst.mockResolvedValueOnce({ id: 'evt_already' });
        mockGetPaymentIntent.mockResolvedValue({ id: 'pi_d', status: 'succeeded', amount_received: 553500 });

        const s = await runSettlementReconcile();

        // Skip happens before the Stripe round trip — a terminal order costs
        // neither a re-drive nor a wasted API call.
        expect(mockGetPaymentIntent).not.toHaveBeenCalled();
        expect(mockSettleFromPaymentIntent).not.toHaveBeenCalled();
        expect(s.reDrivenOrders).toBe(0);

        const [args] = mockDb.stripeWebhookEvent.findFirst.mock.calls[0];
        expect(args.where.status).toBe('PROCESSED');
        expect(args.where.type).toBe('payment_intent.succeeded');
        expect(args.where.payload).toEqual({ path: ['data', 'object', 'id'], equals: 'pi_d' });
    });
});
