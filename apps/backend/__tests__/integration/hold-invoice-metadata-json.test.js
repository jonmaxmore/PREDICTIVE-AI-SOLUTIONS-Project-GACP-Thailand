/**
 * Bug 2.2 [MED] — holdInvoice JSON.stringifies into a Json? column, which
 * double-encodes Invoice.metadata and BYPASSES the refund idempotency guard.
 *
 * RED-first regression test.
 *
 * `Invoice.metadata` is a Prisma `Json?` column — Prisma serialises the
 * object itself. `holdInvoice` originally wrote `metadata: JSON.stringify(obj)`,
 * so the DB stored a JSON *string*. On a subsequent read
 * `refund-service._readRefundBlock` sees a string (typeof !== 'object') and
 * returns null → `initiateRefund`'s prior-refund idempotency guard is
 * bypassed → a duplicate credit note + duplicate reversing journal entry
 * (double-refund). The object-spread of a string also corrupts the row.
 *
 * Fix under test:
 *   (write) holdInvoice persists the metadata OBJECT directly (no stringify).
 *   (read)  _readRefundBlock self-heals an already-corrupted string row by
 *           JSON.parsing it before reading `.refund`, so the idempotency
 *           guard still fires for legacy corrupted rows.
 */

'use strict';

// Mock the DB module BEFORE requiring anything that pulls it (the project rules rule:
// prisma-database process.exit(1)s without DATABASE_URL; audit-logger +
// invoice-finance-ops import it directly).
const mockInvoiceUpdate = jest.fn(async ({ data }) => ({ id: 'inv-1', ...data }));
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        invoice: {
            update: (...args) => mockInvoiceUpdate(...args),
            findUnique: jest.fn(),
            findFirst: jest.fn(),
        },
    },
}));

const financeOps = require('../../services/invoice/invoice-finance-ops');
const refundService = require('../../services/refund-service');

const { _readRefundBlock } = refundService._internals;
const { REFUND_STATUS } = refundService;

describe('Bug 2.2 — holdInvoice writes metadata as a Json object, refund guard survives', () => {
    beforeEach(() => {
        mockInvoiceUpdate.mockClear();
    });

    it('holdInvoice persists metadata as an OBJECT, not a JSON string', async () => {
        const invoice = {
            id: 'inv-1',
            status: 'PENDING',
            notes: '',
            metadata: { refund: { status: REFUND_STATUS.INITIATED, creditNoteId: 'cn-1' } },
        };

        await financeOps.holdInvoice(invoice, 'inv-1', 'audit review', 'user-fin-1');

        expect(mockInvoiceUpdate).toHaveBeenCalledTimes(1);
        const { data } = mockInvoiceUpdate.mock.calls[0][0];

        // The core assertion: metadata must be a plain object Prisma can
        // serialise into the Json column — NOT a pre-stringified string.
        expect(typeof data.metadata).toBe('object');
        expect(data.metadata).not.toBeNull();
        expect(typeof data.metadata).not.toBe('string');

        // The hold info is recorded...
        expect(data.metadata.holdInfo).toMatchObject({
            previousStatus: 'PENDING',
            reason: 'audit review',
            heldBy: 'user-fin-1',
        });
        // ...and the pre-existing refund block is preserved (not clobbered by
        // a string-spread that would have produced indexed-char garbage).
        expect(data.metadata.refund).toEqual({
            status: REFUND_STATUS.INITIATED,
            creditNoteId: 'cn-1',
        });
    });

    it('holdInvoice metadata round-trips: a follow-up refund read still sees the block (guard NOT bypassed)', async () => {
        const invoice = {
            id: 'inv-1',
            status: 'PAID',
            notes: '',
            metadata: { refund: { status: REFUND_STATUS.INITIATED, creditNoteId: 'cn-9' } },
        };

        const updated = await financeOps.holdInvoice(invoice, 'inv-1', 'hold', 'fin');

        // Simulate the invoice being re-loaded for a second refund attempt. The
        // stored metadata (as Prisma would return it from a Json column) is the
        // object we just wrote.
        const reloaded = { ...updated, metadata: updated.metadata };
        const block = _readRefundBlock(reloaded);

        // The refund block is still visible → the initiateRefund idempotency
        // guard (existing.status === INITIATED) fires → NO double-refund.
        expect(block).not.toBeNull();
        expect(block.status).toBe(REFUND_STATUS.INITIATED);
    });

    it('_readRefundBlock self-heals a legacy DOUBLE-ENCODED (string) metadata row', () => {
        // A row corrupted by the old JSON.stringify bug: metadata is a JSON
        // STRING, not an object.
        const corruptedInvoice = {
            id: 'inv-legacy',
            metadata: JSON.stringify({
                refund: { status: REFUND_STATUS.INITIATED, creditNoteId: 'cn-legacy' },
            }),
        };

        const block = _readRefundBlock(corruptedInvoice);

        // Before the fix this returned null (typeof string !== 'object') → the
        // idempotency guard was bypassed → double-refund. After the fix it
        // parses the string and returns the block.
        expect(block).not.toBeNull();
        expect(block.status).toBe(REFUND_STATUS.INITIATED);
        expect(block.creditNoteId).toBe('cn-legacy');
    });
});
