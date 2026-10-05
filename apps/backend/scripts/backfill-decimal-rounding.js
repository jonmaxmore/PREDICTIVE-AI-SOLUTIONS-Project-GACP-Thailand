#!/usr/bin/env node
/**
 * Decimal-rounding backfill — Iter 24 (hardening loop, 2026-05-16).
 *
 * Companion to migration 20260517000000_decimal_unification. The migration
 * itself uses PostgreSQL's `USING column::DECIMAL(15,2)` cast which rounds
 * any sub-satang Float fraction half-away-from-zero, so the schema is safe.
 * THIS script catches a different (and much rarer) class of legacy drift:
 *
 *   - Invoices where `subtotal + vat` doesn't equal `totalAmount` because
 *     the application code wrote the three values from separate Float
 *     calculations and the arithmetic-error grew large enough to escape
 *     the 0.005 THB tolerance window after the cast.
 *
 * Why this might happen in legacy rows:
 *   The pre-Iter-24 code path wrote each of (subtotal, vat, totalAmount)
 *   independently from JS Float math. If any caller computed
 *   `totalAmount = (subtotal + vat) + extraneousFloat` and then later
 *   re-stored `subtotal` and `vat` from a different calculation path, the
 *   trio could fall out of parity — invisible while Float, visible the
 *   moment Decimal exact-math enforcement kicks in.
 *
 * What this script does:
 *   - Reads every Invoice row.
 *   - Re-computes `totalAmount = round2(subtotal + vat)`.
 *   - If the recomputed value differs from the stored value by more than
 *     ROUNDING_TOLERANCE_THB, the row is flagged.
 *   - DRY-RUN by default: prints a CSV-friendly diff to stdout and exits 0.
 *   - `--apply` flag: writes the corrected `totalAmount` back via a single
 *     UPDATE per row inside one Prisma transaction.
 *
 * Safety:
 *   - Read-only by default; `--apply` is opt-in.
 *   - No DELETE, no schema change.
 *   - `--limit N` flag bounds the row count for sanity (default 50,000).
 *   - Logs every change with the (id, invoiceNumber, before, after, delta)
 *     tuple so an auditor can reconstruct the operation from the log alone.
 *
 * When to run:
 *   - AFTER deploying migration 20260517000000_decimal_unification.
 *   - During a maintenance window; the script holds row-level UPDATE locks
 *     briefly per row but doesn't take a table lock.
 *
 * Usage:
 *   node apps/backend/scripts/backfill-decimal-rounding.js          # dry-run
 *   node apps/backend/scripts/backfill-decimal-rounding.js --apply  # live
 *   node apps/backend/scripts/backfill-decimal-rounding.js --limit 1000 --apply
 *
 * Compliance basis:
 *   - TFRS for NPAEs ch.2 (internal controls): periodic reconciliation of
 *     stored money fields against the canonical formula is a baseline
 *     control. This script formalises that check.
 *   - ป.รัษฎากร ม.86/4: ใบกำกับภาษี must show subtotal + VAT = total. Any
 *     row that violates this MUST be corrected before issuing a tax
 *     document against it.
 */

'use strict';

const ROUNDING_TOLERANCE_THB = 0.005;

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function parseArgs(argv) {
    const args = { apply: false, limit: 50_000 };
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--apply') {
            args.apply = true;
        } else if (arg === '--limit') {
            args.limit = parseInt(argv[i + 1], 10) || args.limit;
            i += 1;
        } else if (arg === '--help' || arg === '-h') {
            console.log(
                'Usage: backfill-decimal-rounding.js [--apply] [--limit N]\n'
                + '  --apply        Write corrections (default: dry-run only)\n'
                + '  --limit N      Max rows to inspect (default: 50000)',
            );
            process.exit(0);
        }
    }
    return args;
}

async function main() {
    const { apply, limit } = parseArgs(process.argv);

    // Late-require Prisma so the script is loadable in environments where
    // the client has not been generated yet (CI bootstrap), and so the
    // --help path doesn't require a DB connection.
    let prisma;
    try {
        ({ prisma } = require('../services/prisma-database'));
    } catch (err) {
        console.error('[backfill-decimal] Prisma client unavailable:', err.message);
        process.exit(2);
    }

    console.log(
        `[backfill-decimal] mode=${apply ? 'APPLY (writing)' : 'DRY-RUN (no writes)'} `
        + `limit=${limit} tolerance=${ROUNDING_TOLERANCE_THB} THB`,
    );

    const invoices = await prisma.invoice.findMany({
        where: { isDeleted: false },
        select: {
            id: true,
            invoiceNumber: true,
            subtotal: true,
            vat: true,
            totalAmount: true,
        },
        take: limit,
        orderBy: { createdAt: 'asc' },
    });

    console.log(`[backfill-decimal] inspecting ${invoices.length} invoice rows`);

    const drift = [];
    for (const inv of invoices) {
        const subtotal = Number(inv.subtotal) || 0;
        const vat = Number(inv.vat) || 0;
        const stored = Number(inv.totalAmount) || 0;
        const recomputed = round2(subtotal + vat);
        const delta = Math.abs(stored - recomputed);
        if (delta > ROUNDING_TOLERANCE_THB) {
            drift.push({
                id: inv.id,
                invoiceNumber: inv.invoiceNumber,
                subtotal: round2(subtotal),
                vat: round2(vat),
                before: round2(stored),
                after: recomputed,
                delta: round2(delta),
            });
        }
    }

    if (drift.length === 0) {
        console.log('[backfill-decimal] no drift detected — schema is consistent.');
        process.exit(0);
    }

    console.log(`[backfill-decimal] DRIFT FOUND in ${drift.length} rows:`);
    console.log('id,invoiceNumber,subtotal,vat,beforeTotal,afterTotal,delta');
    for (const d of drift) {
        console.log(
            `${d.id},${d.invoiceNumber},${d.subtotal},${d.vat},${d.before},${d.after},${d.delta}`,
        );
    }

    if (!apply) {
        console.log('[backfill-decimal] dry-run complete. Re-run with --apply to write fixes.');
        process.exit(0);
    }

    console.log('[backfill-decimal] applying corrections...');
    await prisma.$transaction(
        drift.map((d) =>
            prisma.invoice.update({
                where: { id: d.id },
                data: { totalAmount: d.after },
            }),
        ),
    );
    console.log(`[backfill-decimal] applied ${drift.length} corrections.`);
    process.exit(0);
}

main().catch((err) => {
    console.error('[backfill-decimal] FAILED:', err);
    process.exit(1);
});
