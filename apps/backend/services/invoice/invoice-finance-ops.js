/**
 * Invoice Finance Operations — extracted from invoice-service.js
 *
 * Heavy business operations: hold, release, forfeit, revenue summary.
 * These methods are mixed into the InvoiceService class at require time.
 *
 * @module services/invoice/invoice-finance-ops
 */

const { prisma } = require('../prisma-database');
const { createLogger } = require('../../shared/logger');
const _logger = createLogger('invoice-finance');

const INVOICE_STATUS = Object.freeze({
    PENDING: 'PENDING',
    PAID: 'PAID',
    PAID_PENDING_RECEIPT: 'PAID_PENDING_RECEIPT',
    RECEIPT_ISSUED: 'RECEIPT_ISSUED',
    OVERDUE: 'OVERDUE',
    CANCELLED: 'CANCELLED',
});

/**
 * Hold/Suspend an invoice (Finance team only).
 */
async function holdInvoice(invoice, invoiceId, reason, heldBy) {
    const currentStatus = String(invoice.status || '').toUpperCase();
    if (currentStatus === 'HELD') {
        throw new Error('Invoice is already on hold');
    }
    if (currentStatus === 'CANCELLED' || currentStatus === 'FORFEITED') {
        throw new Error('Cannot hold a cancelled or forfeited invoice');
    }

    const updated = await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
            status: 'HELD',
            notes: [
                invoice.notes || '',
                `[HOLD ${new Date().toISOString()}] ${reason || 'Held by Finance'}`,
            ].filter(Boolean).join('\n'),
            // Bug 2.2 fix: Invoice.metadata is a Prisma `Json?` column — Prisma
            // serialises the object itself. Writing JSON.stringify(...) here
            // double-encoded the column into a JSON STRING, so downstream
            // readers (refund-service._readRefundBlock, the WHT dup-guard) got a
            // string (typeof !== 'object'), returned null for the refund block,
            // and the prior-refund idempotency guard was bypassed → double
            // refund. Persist the OBJECT directly. The string-typed source guard
            // is kept so an already-corrupted legacy row self-heals on the next
            // hold.
            metadata: {
                ...(typeof invoice.metadata === 'string' ? JSON.parse(invoice.metadata || '{}') : (invoice.metadata || {})),
                holdInfo: {
                    previousStatus: currentStatus,
                    reason: reason || 'Held by Finance',
                    heldBy,
                    heldAt: new Date().toISOString(),
                },
            },
        },
    });

    return updated;
}

/**
 * Release hold on an invoice — restores previous status.
 */
async function releaseHold(invoice, invoiceId, releasedBy) {
    const currentStatus = String(invoice.status || '').toUpperCase();
    if (currentStatus !== 'HELD') {
        throw new Error('Invoice is not on hold');
    }

    let previousStatus = INVOICE_STATUS.PENDING;
    try {
        const meta = typeof invoice.metadata === 'string'
            ? JSON.parse(invoice.metadata || '{}')
            : (invoice.metadata || {});
        previousStatus = meta.holdInfo?.previousStatus || INVOICE_STATUS.PENDING;
    } catch (_e) {
        // fallback
    }

    const updated = await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
            status: previousStatus,
            notes: [
                invoice.notes || '',
                `[RELEASE ${new Date().toISOString()}] Released by ${releasedBy || 'Finance'}`,
            ].filter(Boolean).join('\n'),
        },
    });

    return updated;
}

/**
 * Mark revenue as forfeited (for CANCEL_EXPIRED cases).
 */
async function forfeitRevenue(invoice, invoiceId, reason) {
    const updated = await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
            status: 'FORFEITED',
            notes: [
                invoice.notes || '',
                `[FORFEITED ${new Date().toISOString()}] ${reason || 'Auto-cancel expired (CANCEL_EXPIRED)'}`,
            ].filter(Boolean).join('\n'),
        },
    });

    return updated;
}

/**
 * Get revenue summary with Wallet A / Wallet B segregation.
 */
async function getRevenueSummary(startDate, endDate) {
    const { calculateRevenueSplit } = require('../split-payment-calculator');

    const where = {
        isDeleted: false,
        status: { in: ['PAID', 'PAID_PENDING_RECEIPT', 'RECEIPT_ISSUED', 'paid'] },
    };
    if (startDate && endDate) {
        where.paidAt = {
            gte: new Date(startDate),
            lte: new Date(endDate),
        };
    }

    const invoices = await prisma.invoice.findMany({
        where,
        select: {
            serviceType: true,
            totalAmount: true,
            status: true,
            paidAt: true,
        },
    });

    return calculateRevenueSplit(invoices);
}

module.exports = {
    holdInvoice,
    releaseHold,
    forfeitRevenue,
    getRevenueSummary,
};
