#!/usr/bin/env node
/**
 * PDPA Phase 1 — User PII Backfill Script
 *
 * System deep-dive Tier 6 — DBA + Security + Backend (2026-05-15):
 *
 * One-time job to encrypt existing plaintext PII in the `User` table after
 * the PDPA field-encryption Prisma extension (Tier 5) has been deployed
 * with `ENABLE_PDPA_FIELD_ENCRYPTION=false` (no behavior change yet).
 *
 * Scope (Phase 1 — display-only columns, never used in WHERE):
 *   idCard, taxId, laserCode, communityRegistrationNo,
 *   address, province, district, subdistrict, zipCode
 *
 * ## Operational sequence
 *
 *   1. Deploy code with `ENABLE_PDPA_FIELD_ENCRYPTION` unset → no behavior change.
 *   2. Run THIS script:  `node apps/backend/scripts/pdpa/backfill-encrypt-user-pii.js`
 *      (or `--dry-run` first to count rows without touching the DB)
 *   3. Flip `ENABLE_PDPA_FIELD_ENCRYPTION=true` in the next deploy → all
 *      new writes encrypt, all reads decrypt transparently.
 *   4. To roll back: flip the env var OFF. The `enc:v1:` prefix marker
 *      ensures both legacy plaintext and post-backfill ciphertext rows
 *      remain readable (the extension's decryptValue passes plaintext
 *      through unchanged).
 *
 * ## Why we bypass the extension for the write
 *
 * The script uses `basePrisma` (the un-extended client) and calls
 * `encryptUserDataPayload` MANUALLY before each update. Using the extended
 * client would work too — but only if the env var is ON at backfill time,
 * which contradicts step 2 in the runbook (deploy code OFF, backfill,
 * flip ON). Manual encryption decouples the two operations.
 *
 * ## Idempotency
 *
 * `encryptValue` short-circuits when the input already starts with the
 * `enc:v1:` version prefix. Re-running the script is safe — already-
 * encrypted rows are no-ops. Crash recovery: rerun, the script picks up
 * where it left off via cursor pagination.
 *
 * ## CLI flags
 *
 *   --dry-run       Count rows to backfill, do not write
 *   --batch-size N  Rows per cursor page (default 100)
 *   --max-rows N    Stop after processing N rows (default unlimited)
 *   --verbose       Log per-row progress (default: per-batch only)
 *
 * ## Exit codes
 *
 *   0 — success
 *   1 — runtime error
 *   2 — invalid CLI flags
 */

const path = require('path');

function parseArgs(argv) {
    const args = {
        dryRun: false,
        batchSize: 100,
        maxRows: Infinity,
        verbose: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--dry-run') {args.dryRun = true;}
        else if (a === '--verbose') {args.verbose = true;}
        else if (a === '--batch-size') {
            const n = Number(argv[i + 1]);
            if (!Number.isInteger(n) || n < 1 || n > 5000) {
                throw new Error(`--batch-size must be an integer 1..5000 (got ${argv[i + 1]})`);
            }
            args.batchSize = n;
            i += 1;
        } else if (a === '--max-rows') {
            const n = Number(argv[i + 1]);
            if (!Number.isInteger(n) || n < 1) {
                throw new Error(`--max-rows must be a positive integer (got ${argv[i + 1]})`);
            }
            args.maxRows = n;
            i += 1;
        } else if (a === '--help' || a === '-h') {
             
            console.log('Usage: backfill-encrypt-user-pii.js [--dry-run] [--batch-size N] [--max-rows N] [--verbose]');
            process.exit(0);
        } else {
            throw new Error(`Unknown arg: ${a}`);
        }
    }
    return args;
}

/**
 * Returns true when a row has at least one Phase-1 column that still
 * contains plaintext (i.e. NOT already prefixed with `enc:v1:`). Skips
 * rows whose Phase-1 columns are all null/empty or all encrypted.
 */
function rowNeedsBackfill(row, columns, versionPrefix) {
    for (const col of columns) {
        const val = row[col];
        if (typeof val === 'string' && val.length > 0 && !val.startsWith(versionPrefix)) {
            return true;
        }
    }
    return false;
}

/**
 * Computes the encryption payload (only Phase-1 columns that need it).
 * Returns null when no column requires a write — caller can skip the UPDATE.
 */
function buildUpdatePayload(row, columns, encryptValueFn, versionPrefix) {
    const payload = {};
    let touched = false;
    for (const col of columns) {
        const val = row[col];
        if (typeof val === 'string' && val.length > 0 && !val.startsWith(versionPrefix)) {
            payload[col] = encryptValueFn(val);
            touched = true;
        }
    }
    return touched ? payload : null;
}

/**
 * Pure orchestration: walks the cursor-paginated user list and applies
 * encryption to each row that needs it. Extracted from main() so unit
 * tests can drive it with a fake client + fake encryptValue.
 *
 * Returns a stats object suitable for logging.
 */
async function runBackfill({
    client,
    columns,
    versionPrefix,
    encryptValueFn,
    batchSize,
    maxRows,
    dryRun,
    verbose,
    logger = console,
}) {
    const stats = {
        pagesScanned: 0,
        rowsScanned: 0,
        rowsRequiringBackfill: 0,
        rowsUpdated: 0,
        rowsSkipped: 0,
    };

    let cursor = null;
    const selectClause = { id: true };
    for (const c of columns) {selectClause[c] = true;}

    while (stats.rowsScanned < maxRows) {
        const take = Math.min(batchSize, maxRows - stats.rowsScanned);
        const findArgs = {
            take,
            orderBy: { id: 'asc' },
            select: selectClause,
            where: { isDeleted: false },
        };
        if (cursor) {
            findArgs.cursor = { id: cursor };
            findArgs.skip = 1;
        }
        const batch = await client.user.findMany(findArgs);
        if (batch.length === 0) {break;}

        stats.pagesScanned += 1;
        stats.rowsScanned += batch.length;
        cursor = batch[batch.length - 1].id;

        for (const row of batch) {
            if (!rowNeedsBackfill(row, columns, versionPrefix)) {
                stats.rowsSkipped += 1;
                continue;
            }
            stats.rowsRequiringBackfill += 1;
            const payload = buildUpdatePayload(row, columns, encryptValueFn, versionPrefix);
            if (!payload) {
                stats.rowsSkipped += 1;
                continue;
            }
            if (dryRun) {
                if (verbose) {
                    logger.log(`[dry-run] would update user ${row.id} columns=${Object.keys(payload).join(',')}`);
                }
                continue;
            }
            await client.user.update({
                where: { id: row.id },
                data: payload,
            });
            stats.rowsUpdated += 1;
            if (verbose) {
                logger.log(`[ok] encrypted user ${row.id} columns=${Object.keys(payload).join(',')}`);
            }
        }

        logger.log(
            `[batch ${stats.pagesScanned}] scanned=${batch.length} `
            + `cumulative_scanned=${stats.rowsScanned} `
            + `updated=${stats.rowsUpdated} `
            + `skipped=${stats.rowsSkipped} `
            + `needs_backfill=${stats.rowsRequiringBackfill}`,
        );

        if (batch.length < take) {break;} // last page
    }

    return stats;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    // Lazy-require so test environments can stub Prisma cleanly.
    // We use basePrisma (un-extended) so the script behaves identically
    // whether ENABLE_PDPA_FIELD_ENCRYPTION is on or off at backfill time.
    const prismaDb = require(path.join(__dirname, '..', '..', 'services', 'prisma-database'));
    const basePrisma = prismaDb.basePrisma || prismaDb.prisma;

    const {
        PHASE_1_PII_COLUMNS,
        VERSION_PREFIX,
        encryptValue,
    } = require(path.join(__dirname, '..', '..', 'services', 'prisma-pdpa-extension'));

     
    console.log('────────────────────────────────────────────────────────');
     
    console.log('PDPA Phase 1 — User PII Backfill');
     
    console.log(`mode: ${args.dryRun ? 'DRY-RUN' : 'WRITE'}`);
     
    console.log(`batch-size: ${args.batchSize}`);
     
    console.log(`max-rows: ${args.maxRows === Infinity ? 'unlimited' : args.maxRows}`);
     
    console.log(`columns: ${PHASE_1_PII_COLUMNS.join(', ')}`);
     
    console.log('────────────────────────────────────────────────────────');

    const startedAt = Date.now();
    const stats = await runBackfill({
        client: basePrisma,
        columns: PHASE_1_PII_COLUMNS,
        versionPrefix: VERSION_PREFIX,
        encryptValueFn: encryptValue,
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

// Exported for tests; the IIFE only fires when invoked from the CLI.
module.exports = {
    parseArgs,
    rowNeedsBackfill,
    buildUpdatePayload,
    runBackfill,
};

if (require.main === module) {
    main().then(
        () => process.exit(0),
        (err) => {
             
            console.error('[backfill] FATAL:', err && err.stack ? err.stack : err);
            process.exit(1);
        },
    );
}
