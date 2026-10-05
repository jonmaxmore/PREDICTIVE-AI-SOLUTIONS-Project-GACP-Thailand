#!/usr/bin/env node
/**
 * PDPA close-natid-ROUND-6 — re-key the un-hooked audit / identity SCALAR
 * columns from a plaintext national/provider ID to a NON-PII value.
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md
 *
 * ## WHY THIS EXISTS
 * Rounds 1-4 + the core detokenize landed the national ID out of every JSON
 * column and the structured scalar columns (User / Entity / Certificate /
 * Invoice). ROUND-6 is the recurring CLASS that the data-grep keeps surfacing:
 * un-hooked SCALAR audit columns that the WRITE code stamped with code that
 * PREFERRED `req.user.providerId` / `req.user.healthId` (the DECRYPTED plaintext
 * national ID — middleware/auth-middleware.js:176-197) or
 * getActorIdentity()/normalizeHealthId() (which return that plaintext) OVER the
 * User UUID / canonicalId token. The forward fix (this round's code change)
 * stamps the right value at SOURCE; this script re-keys the HISTORICAL rows that
 * predate the forward fix.
 *
 * These columns are NEVER encrypted — they must hold a stable non-PII identifier:
 *   - AUDIT scalars  → the User UUID            (users.id)
 *   - The BUNDLE FK  → the canonicalId TOKEN    (users.canonicalId), because
 *                      application_bundles.healthId is an FK to users.canonicalId
 *                      (schema: application.prisma references: [canonicalId]).
 *                      Stamping a UUID there would dangle the FK.
 *
 * ## THE 5 COLUMNS (measured prod blast-radius at build time)
 *   - application_bundles.healthId      (FK → users.canonicalId)  → canonicalId
 *   - application_comments.authorId     (scalar String, no FK)    → users.id
 *   - revision_deadlines.createdBy      (scalar String?, no FK)   → users.id
 *   - revision_deadlines.updatedBy      (scalar String?, no FK)   → users.id
 *   - revision_deadlines.submittedBy    (scalar String?, no FK)   → users.id
 *   - applications.updatedBy            (scalar String?, no FK)   → users.id
 *   (application_bundles=0 rows, application_comments=0, revision_deadlines=0,
 *    applications.updatedBy=4 rows of which 1 carries a plaintext 13-digit ID.)
 *
 * ## HOW A ROW IS RE-KEYED
 *   1. Read the column value. SKIP unless it matches /^[0-9]{13}$/ (a plaintext
 *      national/provider ID). Anything else (a UUID, an HMAC token, a 'SYSTEM'
 *      sentinel, NULL) is left untouched → idempotent.
 *   2. token = computeLookupHmac(value)  (the SAME keyed HMAC H-4 wrote into the
 *      users.*Hmac lookup columns — NO new crypto, NO new key).
 *   3. Find the owning user: WHERE healthIdHmac = token OR providerIdHmac = token.
 *   4. Re-stamp the column:
 *        - bundle FK         → user.canonicalId (FK-safe; matches the re-keyed parent)
 *        - audit scalars     → user.id          (the stable UUID)
 *   5. NO MATCH → leave the row + log it (a national ID with no user is a data
 *      anomaly; for the FK-bearing bundle column leaving it is the FK-safe choice
 *      — a 'SYSTEM' sentinel would itself dangle the FK to users.canonicalId).
 *
 * ## SAFETY / OPS (mirrors rekey-canonicalid.js + the pdpa backfills)
 *   - Uses basePrisma (un-extended: no tenant scope, no soft-delete filter, no
 *     PDPA encrypt/decrypt extension) so it sees EVERY tenant's rows and reads
 *     the raw stored value.
 *   - Idempotent: re-running is a no-op (re-keyed rows no longer match the
 *     13-digit regex; the national-ID space and the UUID/HMAC space are disjoint).
 *   - --dry-run: reports what WOULD change, writes nothing.
 *   - Final assertion: 0 plaintext 13-digit values remaining across ALL 5 columns
 *     (exit 1 if any remain after a real run, so the operator never proceeds on a
 *     half-migrated table).
 *   - NOT RUN by anything. First live run MUST be a --dry-run on STAGING (golden
 *     rules #2/#7). Do NOT auto-run.
 *
 * Usage on the droplet (inside the backend container, low-traffic window):
 *   node apps/backend/scripts/pdpa/rekey-audit-scalars.js --dry-run
 *   node apps/backend/scripts/pdpa/rekey-audit-scalars.js
 *
 * Exit codes: 0 success (assertion held), 1 fatal / assertion failed.
 */

'use strict';

const path = require('path');

const THIRTEEN_DIGITS = /^[0-9]{13}$/;

function parseArgs(argv) {
    return {
        dryRun: argv.includes('--dry-run'),
        verbose: argv.includes('--verbose'),
    };
}

/**
 * The target columns. `target` selects which user field re-stamps the column:
 *   'canonicalId' → the FK-bearing bundle column (FK to users.canonicalId)
 *   'id'          → audit scalars (the stable User UUID)
 */
const TARGETS = [
    { table: 'application_bundles', column: 'healthId', target: 'canonicalId' },
    { table: 'application_comments', column: 'authorId', target: 'id' },
    { table: 'revision_deadlines', column: 'createdBy', target: 'id' },
    { table: 'revision_deadlines', column: 'updatedBy', target: 'id' },
    { table: 'revision_deadlines', column: 'submittedBy', target: 'id' },
    { table: 'applications', column: 'updatedBy', target: 'id' },
    // round-8 siblings (scalar String?, no FK) → users.id
    { table: 'invoices', column: 'receiptIssuedBy', target: 'id' },
    { table: 'certificates', column: 'revokedBy', target: 'id' },
    { table: 'certificates', column: 'updatedBy', target: 'id' },
];

function loadDeps(injected = {}) {
    if (injected.basePrisma && injected.computeLookupHmac) {
        return { basePrisma: injected.basePrisma, computeLookupHmac: injected.computeLookupHmac };
    }
    const prismaDb = require(path.join(__dirname, '..', '..', 'services', 'prisma-database'));
    const basePrisma = injected.basePrisma || prismaDb.basePrisma || prismaDb.prisma;
    if (!basePrisma) { throw new Error('basePrisma client unavailable'); }
    const { computeLookupHmac } = injected.computeLookupHmac
        ? injected
        : require(path.join(__dirname, '..', '..', 'utils', 'field-encryption'));
    return { basePrisma, computeLookupHmac };
}

/**
 * Resolve the owning user for a plaintext 13-digit ID via the keyed-HMAC lookup
 * columns (the same token H-4 computed). Returns { id, canonicalId } or null.
 */
async function resolveUserByPlaintextId(basePrisma, computeLookupHmac, value) {
    const token = computeLookupHmac(value);
    if (!token) { return null; }
    const rows = await basePrisma.$queryRawUnsafe(
        `SELECT "id", "canonicalId" FROM "users"
         WHERE "healthIdHmac" = $1 OR "providerIdHmac" = $1
         LIMIT 1`,
        token,
    );
    return rows && rows[0] ? rows[0] : null;
}

/**
 * Count plaintext 13-digit values still present in one column.
 */
async function countPlaintext(basePrisma, table, column) {
    const rows = await basePrisma.$queryRawUnsafe(
        `SELECT COUNT(*)::bigint AS c FROM "${table}" WHERE "${column}" ~ '^[0-9]{13}$'`,
    );
    return rows && rows[0] ? Number(rows[0].c) : 0;
}

async function rekey({ basePrisma: injectedPrisma, computeLookupHmac: injectedHmac, dryRun = false, verbose = false, log = () => {} } = {}) {
    const { basePrisma, computeLookupHmac } = loadDeps({ basePrisma: injectedPrisma, computeLookupHmac: injectedHmac });

    const result = {
        ranAt: new Date().toISOString(),
        dryRun,
        perColumn: [],
        scanned: 0,
        rekeyed: 0,
        skippedNonPlaintext: 0,
        unmatched: 0,
        remainingPlaintext: 0,
        assertionHeld: null,
    };

    for (const { table, column, target } of TARGETS) {
        const colStats = { table, column, target, scanned: 0, rekeyed: 0, unmatched: 0 };

        // Pull ONLY the rows whose column currently holds a plaintext 13-digit ID.
        // Postgres `~` regex match keeps the scan tight even on big tables.
        const rows = await basePrisma.$queryRawUnsafe(
            `SELECT "id" AS "rowId", "${column}" AS "val" FROM "${table}"
             WHERE "${column}" ~ '^[0-9]{13}$'`,
        );

        for (const row of rows) {
            colStats.scanned += 1;
            result.scanned += 1;
            const value = row.val;
            // Defensive: the WHERE already filters, but re-assert before writing.
            if (!THIRTEEN_DIGITS.test(String(value || ''))) {
                result.skippedNonPlaintext += 1;
                continue;
            }

            const user = await resolveUserByPlaintextId(basePrisma, computeLookupHmac, value);
            if (!user) {
                // No owning user for this national ID. Leave it (FK-safe for the
                // bundle column; a sentinel would dangle the FK to canonicalId).
                colStats.unmatched += 1;
                result.unmatched += 1;
                log({ phase: 'UNMATCHED', table, column, rowId: row.rowId });
                continue;
            }

            const newValue = target === 'canonicalId' ? user.canonicalId : user.id;
            if (!newValue) {
                // User exists but lacks the target field (should not happen) — skip
                // rather than null out an audit/FK column.
                colStats.unmatched += 1;
                result.unmatched += 1;
                log({ phase: 'NO_TARGET_VALUE', table, column, rowId: row.rowId, target });
                continue;
            }
            // Re-keying a value to ITSELF is impossible here (13-digit → UUID/HMAC),
            // so any match is a real change.
            if (!dryRun) {
                await basePrisma.$executeRawUnsafe(
                    `UPDATE "${table}" SET "${column}" = $1 WHERE "id" = $2`,
                    newValue,
                    row.rowId,
                );
            }
            colStats.rekeyed += 1;
            result.rekeyed += 1;
            if (verbose) {
                log({ phase: dryRun ? 'WOULD_REKEY' : 'REKEYED', table, column, rowId: row.rowId, target });
            }
        }

        result.perColumn.push(colStats);
        log({ phase: 'COLUMN_DONE', ...colStats });
    }

    // Final assertion: 0 plaintext 13-digit remaining across all 5 columns.
    // In --dry-run nothing was written, so this still reflects the pre-run state
    // (and will be > 0 — that is expected and NOT a failure for a dry run).
    let remaining = 0;
    for (const { table, column } of TARGETS) {
        remaining += await countPlaintext(basePrisma, table, column);
    }
    result.remainingPlaintext = remaining;
    result.assertionHeld = dryRun ? null : remaining === 0;

    log({ phase: 'COMPLETE', ...result });
    return result;
}

async function main() {
    const { dryRun, verbose } = parseArgs(process.argv.slice(2));
    console.log('────────────────────────────────────────────────────────');
    console.log('PDPA close-natid-ROUND-6 — re-key audit/identity SCALAR columns');
    console.log(`mode: ${dryRun ? 'DRY-RUN' : 'WRITE'}`);
    console.log(`columns: ${TARGETS.map((t) => `${t.table}.${t.column}→${t.target}`).join(', ')}`);
    console.log('────────────────────────────────────────────────────────');
    try {
        const result = await rekey({
            dryRun,
            verbose,
            log: (entry) => console.log(JSON.stringify(entry)),
        });
        console.log(JSON.stringify(result));
        if (result.unmatched > 0) {
            console.warn(
                `[rekey-audit-scalars] WARNING: ${result.unmatched} plaintext row(s) had NO owning user — `
                + 'left in place (FK-safe). Investigate these as data anomalies.',
            );
        }
        if (!dryRun && result.assertionHeld !== true) {
            console.error(
                `[rekey-audit-scalars] ASSERTION FAILED — ${result.remainingPlaintext} plaintext 13-digit `
                + 'value(s) still present across the 5 columns (likely the UNMATCHED rows).',
            );
            process.exit(1);
        }
        process.exit(0);
    } catch (err) {
        console.error(`rekey-audit-scalars: fatal ${err.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    rekey,
    parseArgs,
    resolveUserByPlaintextId,
    countPlaintext,
    TARGETS,
    THIRTEEN_DIGITS,
};
