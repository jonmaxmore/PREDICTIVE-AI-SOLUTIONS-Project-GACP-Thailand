#!/usr/bin/env node
/**
 * Invoice VAT Audit Report — read-only diagnostic for Finance + Compliance
 *
 * System deep-dive Tier 11 — DBA + Backend + Compliance (2026-05-15).
 *
 * Purpose
 * ───────
 * Diagnose the invoice landscape across the database to inform Finance/Legal
 * decisions about Tier 8 + Tier 9 remediation. This script READS ONLY —
 * never writes — and produces a JSON summary that Finance can review.
 *
 * It answers three audit questions:
 *
 *   1. **Tier 9 backfill scope** — how many PLATFORM invoices still have
 *      vat=0 (pre-Tier-9 rows)? Categorized by status (pending/paid/etc.)
 *
 *   2. **Tier 8 underbilling exposure** — how many PAID PLATFORM invoices
 *      have totalAmount < canonical (5,535 for Phase 1, 27,675 for Phase 2)?
 *      These are rows where the customer paid the pre-Tier-8 underbilled
 *      amount → revenue & VAT-collection gap.
 *
 *   3. **Reconciliation** — for paid applications, does
 *      stateInvoice.totalAmount + platformInvoice.totalAmount
 *      = Application.phase1Amount + Application.phase2Amount?
 *
 * The report is meant to be:
 *   - Run weekly during the post-Tier-9 transition period
 *   - Reviewed by Finance + Legal + DTAM compliance officer
 *   - Used to prioritize the backfill script + decide on under-collected-VAT
 *     remediation policy (sunk cost vs. customer notification vs. credit note)
 *
 * Output
 * ──────
 * JSON to stdout. Pipe to a file: `node ... > audit-2026-05-15.json`
 * Or to a viewer: `node ... | jq .`
 *
 * CLI flags
 * ─────────
 *   --max-rows N      cap scan at N invoice rows (default: unlimited)
 *   --batch-size N    cursor page size (default 200, max 5000)
 *   --help            usage
 */

const path = require('path');

const PLATFORM_SERVICE_TYPES = Object.freeze([
    'PHASE_1_PLATFORM_FEE',
    'PHASE_2_PLATFORM_FEE',
]);

const STATE_SERVICE_TYPES = Object.freeze([
    'PHASE_1_STATE_FEE',
    'PHASE_2_STATE_FEE',
]);

// Canonical totals — see fee-service.js + the project rules §10
// Phase 1: 5,000 state + 500 platform + 35 VAT = 5,535
// Phase 2: 25,000 state + 2,500 platform + 175 VAT = 27,675
const CANONICAL_TOTALS = Object.freeze({
    PHASE_1_STATE_FEE: 5000,
    PHASE_1_PLATFORM_FEE: 535,    // 500 + 35 VAT
    PHASE_2_STATE_FEE: 25000,
    PHASE_2_PLATFORM_FEE: 2675,   // 2,500 + 175 VAT
});

function parseArgs(argv) {
    const args = { maxRows: Infinity, batchSize: 200 };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--max-rows') {
            const n = Number(argv[i + 1]);
            if (!Number.isInteger(n) || n < 1) {
                throw new Error(`--max-rows must be positive integer (got ${argv[i + 1]})`);
            }
            args.maxRows = n;
            i += 1;
        } else if (a === '--batch-size') {
            const n = Number(argv[i + 1]);
            if (!Number.isInteger(n) || n < 1 || n > 5000) {
                throw new Error(`--batch-size must be integer 1..5000 (got ${argv[i + 1]})`);
            }
            args.batchSize = n;
            i += 1;
        } else if (a === '--help' || a === '-h') {
             
            console.log('Usage: invoice-vat-audit-report.js [--max-rows N] [--batch-size N]');
            process.exit(0);
        } else {
            throw new Error(`Unknown arg: ${a}`);
        }
    }
    return args;
}

/**
 * Classify a single invoice row against the audit questions.
 * Returns a category string + the per-row delta (for paid rows).
 */
function classifyInvoice(row) {
    const serviceType = String(row.serviceType || '').toUpperCase();
    const status = String(row.status || '').toLowerCase();
    const vat = Number(row.vat || 0);
    const totalAmount = Number(row.totalAmount || 0);

    const isStateType = STATE_SERVICE_TYPES.includes(serviceType);
    const isPlatformType = PLATFORM_SERVICE_TYPES.includes(serviceType);

    if (!isStateType && !isPlatformType) {
        return { category: 'OUT_OF_SCOPE', delta: 0 };
    }

    const canonical = CANONICAL_TOTALS[serviceType];

    // Question 1: PLATFORM with vat=0 (Tier 9 backfill candidate)
    if (isPlatformType && vat === 0) {
        if (status === 'paid') {
            return { category: 'PLATFORM_PAID_NEEDS_VAT_BACKFILL', delta: 0 };
        }
        return { category: 'PLATFORM_PENDING_NEEDS_VAT_BACKFILL', delta: 0 };
    }

    // Question 2: PAID with totalAmount < canonical (Tier 8 underbilling)
    if (status === 'paid' && totalAmount < canonical) {
        const delta = canonical - totalAmount;
        if (isPlatformType) {
            return { category: 'PLATFORM_PAID_UNDERBILLED_PRE_TIER_8', delta };
        }
        // STATE rows don't include VAT, so underbilling can only happen if
        // a different bug was at play — flag separately for human review.
        return { category: 'STATE_PAID_UNDERBILLED_UNEXPECTED', delta };
    }

    // Healthy row
    if (status === 'paid') {return { category: 'PAID_AT_CANONICAL_OR_ABOVE', delta: 0 };}
    return { category: 'PENDING_HEALTHY', delta: 0 };
}

/**
 * Walks invoice rows and aggregates into the audit summary.
 * Pure orchestration — extracted from main() so tests can drive it.
 */
async function runAudit({ client, batchSize, maxRows, logger = console }) {
    const summary = {
        scannedAt: new Date().toISOString(),
        rowsScanned: 0,
        byCategory: {
            PLATFORM_PENDING_NEEDS_VAT_BACKFILL: { count: 0 },
            PLATFORM_PAID_NEEDS_VAT_BACKFILL: { count: 0 },
            PLATFORM_PAID_UNDERBILLED_PRE_TIER_8: { count: 0, totalDelta: 0 },
            STATE_PAID_UNDERBILLED_UNEXPECTED: { count: 0, totalDelta: 0 },
            PAID_AT_CANONICAL_OR_ABOVE: { count: 0 },
            PENDING_HEALTHY: { count: 0 },
            OUT_OF_SCOPE: { count: 0 },
        },
        samples: {
            PLATFORM_PAID_UNDERBILLED_PRE_TIER_8: [], // capture first N for Finance review
            STATE_PAID_UNDERBILLED_UNEXPECTED: [],
        },
    };

    const SAMPLE_LIMIT = 25; // keep samples small so the JSON stays human-readable
    let cursor = null;
    while (summary.rowsScanned < maxRows) {
        const take = Math.min(batchSize, maxRows - summary.rowsScanned);
        const findArgs = {
            where: {
                serviceType: { in: [...PLATFORM_SERVICE_TYPES, ...STATE_SERVICE_TYPES] },
                isDeleted: false,
            },
            select: {
                id: true,
                invoiceNumber: true,
                serviceType: true,
                status: true,
                subtotal: true,
                vat: true,
                totalAmount: true,
                applicationId: true,
                createdAt: true,
            },
            orderBy: { id: 'asc' },
            take,
        };
        if (cursor) {
            findArgs.cursor = { id: cursor };
            findArgs.skip = 1;
        }
        const batch = await client.invoice.findMany(findArgs);
        if (batch.length === 0) {break;}

        summary.rowsScanned += batch.length;
        cursor = batch[batch.length - 1].id;

        for (const row of batch) {
            const { category, delta } = classifyInvoice(row);
            const bucket = summary.byCategory[category];
            if (!bucket) {continue;} // defensive — unknown category

            bucket.count += 1;
            if (delta > 0 && Object.prototype.hasOwnProperty.call(bucket, 'totalDelta')) {
                bucket.totalDelta += delta;
            }

            // Capture samples for Finance review
            const sampleBucket = summary.samples[category];
            if (sampleBucket && sampleBucket.length < SAMPLE_LIMIT) {
                sampleBucket.push({
                    invoiceNumber: row.invoiceNumber,
                    applicationId: row.applicationId,
                    serviceType: row.serviceType,
                    status: row.status,
                    totalAmount: Number(row.totalAmount || 0),
                    canonicalTotal: CANONICAL_TOTALS[row.serviceType],
                    delta,
                });
            }
        }

        logger.log(
            `[audit batch] scanned_so_far=${summary.rowsScanned} `
            + `platform_vat_backfill=${summary.byCategory.PLATFORM_PENDING_NEEDS_VAT_BACKFILL.count
                + summary.byCategory.PLATFORM_PAID_NEEDS_VAT_BACKFILL.count} `
            + `paid_underbilled=${summary.byCategory.PLATFORM_PAID_UNDERBILLED_PRE_TIER_8.count}`,
        );

        if (batch.length < take) {break;}
    }

    return summary;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const prismaDb = require(path.join(__dirname, '..', '..', 'services', 'prisma-database'));
    const basePrisma = prismaDb.basePrisma || prismaDb.prisma;

     
    console.error('────────────────────────────────────────────────────────');
     
    console.error('Invoice VAT Audit Report (Tier 11 diagnostic)');
     
    console.error(`scan started: ${new Date().toISOString()}`);
     
    console.error(`batch-size: ${args.batchSize}, max-rows: ${args.maxRows === Infinity ? 'unlimited' : args.maxRows}`);
     
    console.error('mode: READ-ONLY (will not modify any data)');
     
    console.error('────────────────────────────────────────────────────────');

    const summary = await runAudit({
        client: basePrisma,
        batchSize: args.batchSize,
        maxRows: args.maxRows,
        logger: { log: (msg) => process.stderr.write(msg + '\n') },
    });

    // JSON to stdout so the caller can pipe to file / jq
     
    console.log(JSON.stringify(summary, null, 2));
}

module.exports = {
    PLATFORM_SERVICE_TYPES,
    STATE_SERVICE_TYPES,
    CANONICAL_TOTALS,
    parseArgs,
    classifyInvoice,
    runAudit,
};

if (require.main === module) {
    main().then(
        () => process.exit(0),
        (err) => {
             
            console.error('[invoice-vat-audit-report] FATAL:', err && err.stack ? err.stack : err);
            process.exit(1);
        },
    );
}
