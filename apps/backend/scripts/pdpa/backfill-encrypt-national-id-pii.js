#!/usr/bin/env node
/**
 * PDPA Detokenize STAGE B3 — National-ID at-rest ENCRYPT backfill.
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md (STAGE B —
 * ENCRYPT). This is the encrypt-backfill that runs AFTER the B3 image
 * (extension lists updated + entity hook + @unique-drop migration) is
 * deployed with `ENABLE_PDPA_FIELD_ENCRYPTION` still OFF, and BEFORE the flag
 * is flipped ON. It encrypts the full B3-decided plaintext set on existing
 * rows, in place, idempotently:
 *
 *   User  : ALL_USER_PII_COLUMNS — the B3 ACTIVE set (Phase 1 ∪ Phase 2 ∪
 *           national-ID Phase 3, MINUS the DEFERRED search/sort/group columns
 *           province / firstName / lastName / phoneNumber). Notably ADDS
 *           healthId / providerId / idCard(_deprecated) / taxId /
 *           communityRegistrationNo / laserCode over the legacy Phase-1
 *           backfill.
 *   Entity: thaiCitizenId — the SECOND plaintext national ID (RFC "REQUIRED
 *           scope addition").
 *
 * ## Why this exists separately from backfill-encrypt-user-pii.js
 *
 * The legacy Phase-1 script hardcodes `PHASE_1_PII_COLUMNS` only (the inert
 * display-only columns) and has no Entity pass. Rather than mutate that
 * audited script's column set, B3 ships a dedicated mirror that:
 *   - encrypts the WHOLE decided set (User + Entity),
 *   - reuses the proven pure helpers (runBackfill / rowNeedsBackfill /
 *     buildUpdatePayload) from the Phase-1 script for the User pass,
 *   - adds an Entity pass + a hard "0 rows still plaintext for the encrypt
 *     set" assertion across BOTH models.
 *
 * ## Discipline (matches backfill-encrypt-user-pii.js + the B2 hmac backfill)
 *
 *   - Uses `basePrisma` — the UN-extended client. basePrisma bypasses the
 *     tenant scope, the soft-delete filter AND the PDPA encrypt extension
 *     (see services/prisma-database.js export note), so it sees EVERY tenant's
 *     rows and we encrypt MANUALLY via `encryptValue()` (never double-encrypt
 *     through the extension). No withoutTenantScope wrapper needed — basePrisma
 *     is already un-scoped.
 *   - Idempotent: `encryptValue` short-circuits any value already prefixed with
 *     `enc:v1:`, and rowNeedsBackfill / the Entity pass skip already-encrypted
 *     and null/empty values. Re-running is a no-op; a crash mid-run resumes via
 *     cursor pagination (User) / "still-plaintext" re-query (Entity).
 *   - Selects rows by `id` ONLY (never by the plaintext being encrypted — a
 *     WHERE on an about-to-be-or-already-encrypted column would be a logic
 *     trap). The Entity pass pages by id and re-tests the columns in JS.
 *   - Batched (cursor pagination), `--dry-run`, `--batch-size`, `--max-rows`.
 *   - FINAL ASSERTION: 0 rows still hold plaintext in the encrypt set
 *     (User.ALL_USER_PII_COLUMNS + Entity.thaiCitizenId). Real runs exit
 *     non-zero if any plaintext remains.
 *
 * ## Operational sequence (STAGE B3)
 *
 *   1. Deploy the B3 image (extension lists + entity hook + @unique-drop
 *      migration) with `ENABLE_PDPA_FIELD_ENCRYPTION` still OFF.
 *   2. `node apps/backend/scripts/pdpa/backfill-encrypt-national-id-pii.js --dry-run`
 *      (reports what WOULD be encrypted + what plaintext would remain).
 *   3. `node apps/backend/scripts/pdpa/backfill-encrypt-national-id-pii.js`
 *      (real run — must end "0 plaintext remaining").
 *   4. Flip `ENABLE_PDPA_FIELD_ENCRYPTION=true` in the next deploy.
 *   Rollback at any point = flip the flag OFF (KEEP the key — the enc:v1:
 *   prefix lets the extension read both plaintext and ciphertext rows).
 *
 * ## KEY CONSISTENCY
 *
 * This backfill encrypts with the SAME `ENCRYPTION_KEY` the serving process
 * uses (field-encryption.js derives the AES key from it). A key MISMATCH
 * between backfill-time and serve-time would silently surface
 * '[PII_DECRYPT_FAILED]' to real users. Do NOT rotate ENCRYPTION_KEY around
 * this backfill — it ALSO keys the live `*Hmac` ID-lookup columns.
 *
 * NOTE: run-once ops. Do NOT auto-run. First live run MUST be a `--dry-run` on
 * staging (golden rule #2 / #7).
 *
 * ## CLI flags
 *
 *   --dry-run       Count rows to encrypt, do not write
 *   --batch-size N  Rows per cursor page (default 100)
 *   --max-rows N    Stop after processing N rows per model (default unlimited)
 *   --verbose       Log per-row progress (default: per-batch only)
 *
 * ## Exit codes
 *
 *   0 — success (real run: assertion held; dry-run: always 0)
 *   1 — runtime error OR (real run) plaintext still remaining
 *   2 — invalid CLI flags
 */

'use strict';

const path = require('path');

// Reuse the audited pure orchestration helpers from the Phase-1 script — same
// cursor pagination / idempotency / dry-run semantics, parameterised by the
// column list we pass in.
const {
    parseArgs,
    rowNeedsBackfill,
    buildUpdatePayload,
    runBackfill,
} = require(path.join(__dirname, 'backfill-encrypt-user-pii'));

const ENTITY_TYPE_INDIVIDUAL = 'INDIVIDUAL';

/**
 * Entity.thaiCitizenId encrypt pass. Pages by id (never by the plaintext),
 * encrypts in place, idempotent (skips enc:v1:-prefixed + null/empty).
 * Returns a stats object. Mirrors runBackfill's contract but for the single
 * Entity column.
 */
async function runEntityBackfill({
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
            // INDIVIDUAL entities are the only ones carrying thaiCitizenId;
            // isDeleted=false matches the active set the assertion checks. We
            // page by id and re-test the column value in JS (never WHERE on the
            // plaintext being encrypted).
            where: { isDeleted: false, type: ENTITY_TYPE_INDIVIDUAL },
        };
        if (cursor) {
            findArgs.cursor = { id: cursor };
            findArgs.skip = 1;
        }
        const batch = await client.entity.findMany(findArgs);
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
                    logger.log(`[dry-run] would encrypt entity ${row.id} columns=${Object.keys(payload).join(',')}`);
                }
                continue;
            }
            await client.entity.update({ where: { id: row.id }, data: payload });
            stats.rowsUpdated += 1;
            if (verbose) {
                logger.log(`[ok] encrypted entity ${row.id} columns=${Object.keys(payload).join(',')}`);
            }
        }

        logger.log(
            `[entity batch ${stats.pagesScanned}] scanned=${batch.length} `
            + `cumulative_scanned=${stats.rowsScanned} `
            + `updated=${stats.rowsUpdated} `
            + `skipped=${stats.rowsSkipped} `
            + `needs_backfill=${stats.rowsRequiringBackfill}`,
        );

        if (batch.length < take) {break;}
    }

    return stats;
}

/**
 * Hard post-run assertion: 0 rows still hold plaintext in the encrypt set.
 * Counts, in JS (no WHERE on the encrypted columns — Prisma can't filter the
 * `enc:v1:` prefix portably), every active row whose in-scope columns still
 * contain a non-empty, non-prefixed string. Returns { user, entity } counts.
 *
 * Cheap at pilot scale (~13 prod rows); for larger datasets it pages the same
 * way the backfill does.
 */
async function countRemainingPlaintext({ client, userColumns, entityColumns, versionPrefix, batchSize = 500 }) {
    const remaining = { user: 0, entity: 0 };

    const scanModel = async (model, columns, where, bump) => {
        let cursor = null;
        const select = { id: true };
        for (const c of columns) {select[c] = true;}
        for (;;) {
            const findArgs = { take: batchSize, orderBy: { id: 'asc' }, select, where };
            if (cursor) { findArgs.cursor = { id: cursor }; findArgs.skip = 1; }
            const rows = await model.findMany(findArgs);
            if (rows.length === 0) {break;}
            cursor = rows[rows.length - 1].id;
            for (const row of rows) {
                if (rowNeedsBackfill(row, columns, versionPrefix)) {bump();}
            }
            if (rows.length < batchSize) {break;}
        }
    };

    await scanModel(client.user, userColumns, { isDeleted: false }, () => { remaining.user += 1; });
    await scanModel(
        client.entity,
        entityColumns,
        { isDeleted: false, type: ENTITY_TYPE_INDIVIDUAL },
        () => { remaining.entity += 1; },
    );

    return remaining;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    // basePrisma = un-extended (no tenant scope, no soft-delete filter, no PDPA
    // encrypt extension) so we encrypt manually and see every tenant's rows.
    const prismaDb = require(path.join(__dirname, '..', '..', 'services', 'prisma-database'));
    const basePrisma = prismaDb.basePrisma || prismaDb.prisma;

    const {
        ALL_USER_PII_COLUMNS,
        ENTITY_PII_COLUMNS,
        VERSION_PREFIX,
        encryptValue,
    } = require(path.join(__dirname, '..', '..', 'services', 'prisma-pdpa-extension'));

    console.log('────────────────────────────────────────────────────────');
    console.log('PDPA STAGE B3 — National-ID at-rest ENCRYPT backfill');
    console.log(`mode: ${args.dryRun ? 'DRY-RUN' : 'WRITE'}`);
    console.log(`batch-size: ${args.batchSize}`);
    console.log(`max-rows: ${args.maxRows === Infinity ? 'unlimited' : args.maxRows}`);
    console.log(`User columns: ${ALL_USER_PII_COLUMNS.join(', ')}`);
    console.log(`Entity columns: ${ENTITY_PII_COLUMNS.join(', ')}`);
    console.log('────────────────────────────────────────────────────────');

    const startedAt = Date.now();

    // 1) User pass — reuse the audited Phase-1 orchestration with the full
    //    B3 active column set.
    const userStats = await runBackfill({
        client: basePrisma,
        columns: ALL_USER_PII_COLUMNS,
        versionPrefix: VERSION_PREFIX,
        encryptValueFn: encryptValue,
        batchSize: args.batchSize,
        maxRows: args.maxRows,
        dryRun: args.dryRun,
        verbose: args.verbose,
    });

    // 2) Entity pass — thaiCitizenId.
    const entityStats = await runEntityBackfill({
        client: basePrisma,
        columns: ENTITY_PII_COLUMNS,
        versionPrefix: VERSION_PREFIX,
        encryptValueFn: encryptValue,
        batchSize: args.batchSize,
        maxRows: args.maxRows,
        dryRun: args.dryRun,
        verbose: args.verbose,
    });

    // 3) Assertion — 0 rows still plaintext for the encrypt set.
    const remaining = await countRemainingPlaintext({
        client: basePrisma,
        userColumns: ALL_USER_PII_COLUMNS,
        entityColumns: ENTITY_PII_COLUMNS,
        versionPrefix: VERSION_PREFIX,
    });

    const elapsedMs = Date.now() - startedAt;
    const totalRemaining = remaining.user + remaining.entity;

    console.log('────────────────────────────────────────────────────────');
    console.log(`Done in ${elapsedMs}ms`);
    console.log(JSON.stringify({ userStats, entityStats, remainingPlaintext: remaining }, null, 2));
    console.log('────────────────────────────────────────────────────────');

    if (args.dryRun) {
        // Dry-run never wrote — report what WOULD remain, exit 0 regardless.
        console.log(`[dry-run] plaintext rows that WOULD remain after a real run: user=${remaining.user} entity=${remaining.entity}`);
        return;
    }

    if (totalRemaining > 0) {
        console.error(
            `[backfill-encrypt-national-id-pii] ASSERTION FAILED: ${totalRemaining} row(s) still hold plaintext `
            + `in the encrypt set (user=${remaining.user}, entity=${remaining.entity}). The flag MUST NOT be flipped ON.`,
        );
        process.exit(1);
    }
    console.log('[assertion] 0 rows still plaintext for the encrypt set — safe to flip ENABLE_PDPA_FIELD_ENCRYPTION=true.');
}

// Exported for tests; the IIFE only fires when invoked from the CLI.
module.exports = {
    runEntityBackfill,
    countRemainingPlaintext,
    ENTITY_TYPE_INDIVIDUAL,
};

if (require.main === module) {
    main().then(
        () => process.exit(0),
        (err) => {
            console.error('[backfill-encrypt-national-id-pii] FATAL:', err && err.stack ? err.stack : err);
            process.exit(1);
        },
    );
}
