#!/usr/bin/env node
/**
 * Backfill double-encoded Invoice.metadata — one-time bug 2.2 remediation.
 *
 * ## Why this script exists
 *
 * `Invoice.metadata` is a Prisma `Json?` column — Prisma serialises the
 * object itself. The old `holdInvoice` wrote `metadata: JSON.stringify(obj)`,
 * so any invoice that was ever HELD stored its metadata as a double-encoded
 * JSON *string* instead of a JSON object.
 *
 * Consequences of a string-typed metadata row:
 *   - `refund-service._readRefundBlock` saw `typeof meta !== 'object'` and
 *     returned null → the prior-refund idempotency guard was BYPASSED →
 *     a duplicate credit note + duplicate reversing journal entry
 *     (double-refund).
 *   - The WHT dup-guard read the same block and was likewise bypassed.
 *   - Any object-spread of the string produced indexed-char garbage.
 *
 * The forward fix (holdInvoice persists the object; _readRefundBlock
 * self-heals string rows on read) is already shipped. This script is the
 * one-shot BACKFILL that rewrites the string-typed rows into objects at rest
 * so the row is clean regardless of read path.
 *
 * ## Safety: which rows the script touches
 *
 * Only invoices where BOTH:
 *   1. `metadata` is non-null, AND
 *   2. the stored value is a JSON STRING (Prisma returns it as a JS string)
 *      that parses to an object.
 *
 * Object-typed metadata rows (the correct shape) are left untouched
 * (idempotent). A string that fails to JSON.parse is flagged and skipped —
 * never blindly overwritten.
 *
 * ## CLI flags
 *
 *   --dry-run        Show what would change, do not write (DEFAULT)
 *   --write          Actually write (must be passed explicitly)
 *   --batch-size N   Rows per page (default 200, max 5000)
 *   --max-rows N     Stop after N rows (default unlimited)
 *   --verbose        Per-row log (default: per-batch summary)
 *
 * ## Exit codes
 *   0 — success   1 — runtime error   2 — invalid CLI flags
 */

'use strict';

const path = require('path');

function parseArgs(argv) {
    // Dry-run is the DEFAULT — a write requires an explicit --write flag so the
    // script can never mutate data by accident on deploy.
    const args = {
        dryRun: true,
        batchSize: 200,
        maxRows: Infinity,
        verbose: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--dry-run') { args.dryRun = true; }
        else if (a === '--write') { args.dryRun = false; }
        else if (a === '--verbose') { args.verbose = true; }
        else if (a === '--batch-size') {
            const n = Number(argv[i + 1]);
            if (!Number.isInteger(n) || n < 1 || n > 5000) {
                throw new Error(`--batch-size must be integer 1..5000 (got ${argv[i + 1]})`);
            }
            args.batchSize = n;
            i += 1;
        } else if (a === '--max-rows') {
            const n = Number(argv[i + 1]);
            if (!Number.isInteger(n) || n < 1) {
                throw new Error(`--max-rows must be positive integer (got ${argv[i + 1]})`);
            }
            args.maxRows = n;
            i += 1;
        } else if (a === '--help' || a === '-h') {

            console.log('Usage: backfill-invoice-metadata-json.js [--dry-run|--write] [--batch-size N] [--max-rows N] [--verbose]');
            process.exit(0);
        } else {
            throw new Error(`Unknown arg: ${a}`);
        }
    }
    return args;
}

/**
 * Decide what (if anything) to do with a row's metadata.
 * Pure — no DB access. Returns one of:
 *   { action: 'skip', reason }          — leave the row alone
 *   { action: 'fix',  value: object }   — rewrite metadata to this object
 */
function classifyRow(row) {
    const meta = row.metadata;
    if (meta == null) { return { action: 'skip', reason: 'null_metadata' }; }
    if (typeof meta === 'object') { return { action: 'skip', reason: 'already_object' }; }
    if (typeof meta !== 'string') { return { action: 'skip', reason: 'non_string_scalar' }; }
    let parsed;
    try {
        parsed = JSON.parse(meta);
    } catch (_e) {
        return { action: 'skip', reason: 'unparseable_string' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        // A JSON string whose value is a primitive/array is not the
        // holdInfo/refund object shape — don't reshape it blindly.
        return { action: 'skip', reason: 'string_not_object' };
    }
    return { action: 'fix', value: parsed };
}

async function runBackfill({
    client,
    batchSize,
    maxRows,
    dryRun,
    verbose,
    logger = console,
}) {
    const stats = {
        pagesScanned: 0,
        rowsScanned: 0,
        rowsFixed: 0,
        rowsSkippedObject: 0,
        rowsSkippedNull: 0,
        rowsSkippedUnparseable: 0,
        rowsSkippedOther: 0,
    };

    let cursor = null;
    while (stats.rowsScanned < maxRows) {
        const take = Math.min(batchSize, maxRows - stats.rowsScanned);
        const findArgs = {
            // metadata NOT null narrows the scan; the string-vs-object decision
            // happens in JS (Prisma can't filter a Json column by JS type).
            where: { metadata: { not: null } },
            select: { id: true, invoiceNumber: true, metadata: true },
            orderBy: { id: 'asc' },
            take,
        };
        if (cursor) {
            findArgs.cursor = { id: cursor };
            findArgs.skip = 1;
        }
        const batch = await client.invoice.findMany(findArgs);
        if (batch.length === 0) { break; }

        stats.pagesScanned += 1;
        stats.rowsScanned += batch.length;
        cursor = batch[batch.length - 1].id;

        for (const row of batch) {
            const decision = classifyRow(row);
            if (decision.action === 'skip') {
                if (decision.reason === 'already_object') { stats.rowsSkippedObject += 1; }
                else if (decision.reason === 'null_metadata') { stats.rowsSkippedNull += 1; }
                else if (decision.reason === 'unparseable_string') {
                    stats.rowsSkippedUnparseable += 1;
                    logger.log(`[skip-unparseable] invoice ${row.invoiceNumber} — string metadata failed JSON.parse; manual review`);
                } else { stats.rowsSkippedOther += 1; }
                continue;
            }

            if (dryRun) {
                if (verbose) {
                    logger.log(`[dry-run] invoice ${row.invoiceNumber} — re-parse string metadata → object`);
                }
            } else {
                await client.invoice.update({
                    where: { id: row.id },
                    data: { metadata: decision.value },
                });
                if (verbose) {
                    logger.log(`[ok] invoice ${row.invoiceNumber} — metadata re-parsed to object`);
                }
            }
            stats.rowsFixed += 1;
        }

        logger.log(
            `[batch ${stats.pagesScanned}] scanned=${batch.length} `
            + `cumulative_scanned=${stats.rowsScanned} `
            + `fixed=${stats.rowsFixed} `
            + `skipped_object=${stats.rowsSkippedObject} `
            + `skipped_null=${stats.rowsSkippedNull} `
            + `skipped_unparseable=${stats.rowsSkippedUnparseable}`,
        );

        if (batch.length < take) { break; }
    }

    return stats;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const prismaDb = require(path.join(__dirname, '..', 'services', 'prisma-database'));
    const basePrisma = prismaDb.basePrisma || prismaDb.prisma;

    console.log('────────────────────────────────────────────────────────');
    console.log('Invoice.metadata JSON double-encode Backfill (bug 2.2)');
    console.log(`mode: ${args.dryRun ? 'DRY-RUN (default; pass --write to persist)' : 'WRITE'}`);
    console.log(`batch-size: ${args.batchSize}`);
    console.log(`max-rows: ${args.maxRows === Infinity ? 'unlimited' : args.maxRows}`);
    console.log('────────────────────────────────────────────────────────');

    const startedAt = Date.now();
    const stats = await runBackfill({
        client: basePrisma,
        batchSize: args.batchSize,
        maxRows: args.maxRows,
        dryRun: args.dryRun,
        verbose: args.verbose,
    });
    const elapsedMs = Date.now() - startedAt;

    console.log('────────────────────────────────────────────────────────');
    console.log(`Done in ${elapsedMs}ms`);
    console.log(JSON.stringify(stats, null, 2));
    console.log('────────────────────────────────────────────────────────');
}

module.exports = {
    parseArgs,
    classifyRow,
    runBackfill,
};

if (require.main === module) {
    main().then(
        () => process.exit(0),
        (err) => {

            console.error('[backfill-invoice-metadata-json] FATAL:', err && err.stack ? err.stack : err);
            process.exit(1);
        },
    );
}
