'use strict';

/**
 * Retire an unpaid checkout order — the ONE place that does it.
 *
 * The payment_intent.canceled webhook (checkout-settlement-service
 * handleStripeEvent) takes the order out of the applicant's way. It must retire
 * all three rows, or the applicant is stuck: the old webhook cancelled only the
 * ORDER, its invoice stayed live, and
 * uniq_invoice_app_service_active (one live invoice per application +
 * serviceType, WHERE "isDeleted" = false — migration 20260701010000) then
 * refused the invoice of every later mint → P2002 → CHECKOUT_ALREADY_IN_PROGRESS
 * for ever (PR2 review I-1; proven on a real Postgres by
 * __tests__/integration/canceled-webhook-lets-the-applicant-pay-again-real-postgres.test.js).
 *
 * Inside the caller's transaction:
 *   1. the order → CANCELLED, compare-and-set on its id, its intent, and a status
 *      of PENDING_PAYMENT or CANCELLED (CANCELLED so a redelivered webhook still
 *      retires the invoice of an order cancelled before this helper existed). A SETTLED
 *      order never matches. No row matched → returns false, nothing else runs;
 *   2. its invoice, only while unpaid (paidAt null) and live → soft-deleted with
 *      deletedBy / deleteReason (PR2 review M-1), status 'cancelled';
 *   3. its charge row, only while PENDING → CANCELLED.
 * Status and soft-delete columns only. No amount on any row is written.
 */

const RETIRED_BY = 'system:checkout-order-retired';

const RETIRE_REASONS = Object.freeze({
    INTENT_CANCELED: 'PAYMENT_INTENT_CANCELED',
});

/**
 * @param {object} tx — a Prisma transaction client
 * @param {object} args
 * @param {{id: string, stripePaymentIntentId: string|null, invoiceId?: string|null,
 *          paymentTransactionId?: string|null}} args.order — as read by the caller
 * @param {string} args.reason — one of RETIRE_REASONS
 * @returns {Promise<boolean>} true when the order row was matched and retired
 */
async function retireCheckoutOrderInTx(tx, { order, reason }) {
    const moved = await tx.checkoutOrder.updateMany({
        where: {
            id: order.id,
            status: { in: ['PENDING_PAYMENT', 'CANCELLED'] },
            stripePaymentIntentId: order.stripePaymentIntentId,
        },
        data: { status: 'CANCELLED' },
    });
    if (!moved?.count) { return false; }
    if (order.invoiceId) {
        await tx.invoice.updateMany({
            where: { id: order.invoiceId, isDeleted: false, paidAt: null },
            data: {
                isDeleted: true,
                deletedAt: new Date(),
                deletedBy: RETIRED_BY,
                deleteReason: reason,
                status: 'cancelled',
            },
        });
    }
    if (order.paymentTransactionId) {
        await tx.paymentTransaction.updateMany({
            where: { id: order.paymentTransactionId, status: 'PENDING' },
            data: { status: 'CANCELLED' },
        });
    }
    return true;
}

module.exports = { retireCheckoutOrderInTx, RETIRE_REASONS, RETIRED_BY };
