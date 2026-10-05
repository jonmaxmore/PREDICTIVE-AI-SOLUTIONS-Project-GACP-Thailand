'use strict';

const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set(['P2034', 'P2002']);

/**
 * Internal — call the Prisma-backed allocator. Returns the integer counter
 * value (next allocation). Throws if the Prisma client doesn't expose the
 * receiptSequence delegate (which means B16-A migration hasn't landed yet).
 *
 * Uses upsert inside a serializable transaction. The first allocator on a
 * fresh (prefix, year) bucket creates the row at counter=1; later allocators
 * bump the counter via the `update` branch.
 *
 * @param {object} prisma  Prisma client instance
 * @param {string} prefix
 * @param {number} year
 * @returns {Promise<number>}
  */
async function allocateSequenceCounter(prisma, prefix, year) {
    if (!prisma || !prisma.receiptSequence || typeof prisma.receiptSequence.upsert !== 'function') {
        const e = new Error('[receipt-numbering] prisma.receiptSequence delegate unavailable');
        e.code = 'RECEIPT_SEQUENCE_MODEL_MISSING';
        throw e;
    }
    const bump = async (tx) => {
        const row = await tx.receiptSequence.upsert({
            where: { prefix_year: { prefix, year } },
            create: {
                prefix,
                year,
                counter: 1,
                lastAllocatedAt: new Date(),
            },
            update: {
                counter: { increment: 1 },
                lastAllocatedAt: new Date(),
            },
            select: { counter: true },
        });
        return row.counter;
    };
    // Handed an interactive transaction client (Prisma removes $transaction
    // from it): the caller already holds a transaction, so bump inside it. The
    // upsert's row lock on (prefix, year) is held until that transaction
    // commits, and a rollback takes the increment with it — a document that
    // fails to issue leaves no gap. Before this branch, passing `tx` threw
    // "prisma.$transaction is not a function" → RECEIPT_SEQUENCE_DB_UNAVAILABLE.
    if (typeof prisma.$transaction !== 'function') {
        return bump(prisma);
    }
        // Bare client only: a Serializable conflict (P2034) or a lost race on the
    // first insert of a bucket (P2002) is retried a bounded number of times
    // with jitter. Inside a caller's tx the error propagates instead (above).
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
            // ReadCommitted, not Serializable: one atomic upsert-increment is
            // serialised by the row lock itself. Real Postgres proof: 20 parallel
            // allocators under Serializable all abort with P2034 except one per
            // round, so no small retry budget can cover them.
            return await prisma.$transaction(bump, { isolationLevel: 'ReadCommitted' });
        } catch (err) {
            lastErr = err;
            if (!RETRYABLE.has(err && err.code) || attempt === MAX_ATTEMPTS) { throw err; }
            await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 20 * attempt)));
        }
    }
    throw lastErr;
}

module.exports = { allocateSequenceCounter };
