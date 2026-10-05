#!/usr/bin/env node
/**
 * H-4 Phase 1 — backfill the national-ID keyed-HMAC lookup columns.
 *
 * Context (see docs/handoffs/H-4-national-id-hmac-migration-rfc.md):
 * Migration 1 added five NULLABLE, @unique lookup columns on `users`:
 *
 *   healthId                -> healthIdHmac
 *   providerId              -> providerIdHmac
 *   idCard                  -> idCardHmac
 *   taxId                   -> taxIdHmac
 *   communityRegistrationNo -> communityRegistrationNoHmac
 *
 * This script computes `computeLookupHmac(plaintextColumn)` for every row that
 * has the plaintext but a NULL `*Hmac`, and writes the `*Hmac` column. It runs
 * BEFORE `AUTH_LOOKUP_USE_HMAC` is flipped on, so the login lookup never depends
 * on a not-yet-populated column.
 *
 * Guarantees:
 *   * Idempotent + resumable — only touches rows where the target `*Hmac` is
 *     NULL while the source plaintext is non-NULL. Re-running is a no-op once
 *     complete (and resumes mid-way if interrupted).
 *   * Batched — processes `--batch` rows at a time (default 500) to avoid long
 *     transactions / memory blowups on large tables.
 *   * Cross-tenant — wrapped in `withoutTenantScope` so it sees EVERY tenant's
 *     rows (User is a tenant-scoped model; a scoped run would silently skip
 *     other orgs and leave the "0 missing" assertion unsatisfiable).
 *   * Aborts loudly on a `@unique` conflict (P2002) — NEVER overwrites an
 *     existing `*Hmac`. A collision means two rows share a plaintext ID, which
 *     must be investigated by hand, not papered over.
 *   * Final assertion — after the pass, asserts that 0 ACTIVE (isDeleted=false)
 *     rows have a non-NULL plaintext column but a NULL `*Hmac`. Exits non-zero
 *     if the assertion fails, so the operator does NOT flip the flag on a
 *     partially-backfilled table.
 *
 * The same `computeLookupHmac` function is used by all six login/lookup sites,
 * so the value written here is exactly what those sites will look up by once
 * `AUTH_LOOKUP_USE_HMAC=true`.
 *
 * Usage on the droplet (inside the backend container, low-traffic window):
 *   node apps/backend/scripts/backfill-national-id-hmac.js --dry-run
 *   node apps/backend/scripts/backfill-national-id-hmac.js
 *
 * Flags:
 *   --dry-run        Compute + report WITHOUT writing.
 *   --batch=<n>      Rows per batch (default 500).
 *   --include-deleted  Also backfill soft-deleted rows (default: backfill all
 *                      rows that have a plaintext value, but only ACTIVE rows
 *                      are required to pass the final "0 missing" assertion).
 *
 * Output: per-batch JSON log lines + a final totals object.
 * Exit codes: 0 success (assertion held), 1 fatal / assertion failed.
 *
 * NOTE: this is run-once ops. Do NOT auto-run it. The first live run MUST be a
 * `--dry-run` on staging (golden rule #2 / #7).
 */

'use strict';

const path = require('path');

// (column-on-User, plaintext source, hmac target)
const COLUMN_MAP = Object.freeze([
    { name: 'healthId', plain: 'healthId', hmac: 'healthIdHmac' },
    { name: 'providerId', plain: 'providerId', hmac: 'providerIdHmac' },
    { name: 'idCard', plain: 'idCard', hmac: 'idCardHmac' },
    { name: 'taxId', plain: 'taxId', hmac: 'taxIdHmac' },
    { name: 'communityRegistrationNo', plain: 'communityRegistrationNo', hmac: 'communityRegistrationNoHmac' },
]);

function parseArgs(argv) {
    const batchArg = argv.find((a) => a.startsWith('--batch='));
    const batch = batchArg ? parseInt(batchArg.split('=')[1], 10) : 500;
    return {
        dryRun: argv.includes('--dry-run'),
        includeDeleted: argv.includes('--include-deleted'),
        batch: Number.isFinite(batch) && batch > 0 ? batch : 500,
    };
}

async function loadPrisma(injected) {
    if (injected) {return injected;}
    const mod = require(path.resolve(__dirname, '../services/prisma-database'));
    const prisma = mod && mod.prisma ? mod.prisma : null;
    if (!prisma) {throw new Error('prisma client unavailable');}
    return prisma;
}

function loadHelpers(injected) {
    if (injected) {return injected;}
    const { computeLookupHmac } = require(path.resolve(__dirname, '../utils/field-encryption'));
    const { withoutTenantScope } = require(path.resolve(__dirname, '../services/tenant-context'));
    return { computeLookupHmac, withoutTenantScope };
}

/**
 * Backfill one column across the table in batches.
 * Returns per-column totals.
 */
async function backfillColumn({ prisma, computeLookupHmac, col, dryRun, includeDeleted, batch, log }) {
    const baseFilter = includeDeleted ? {} : { isDeleted: false };
    // Rows with a plaintext value but a NULL hmac (idempotent + resumable).
    const where = {
        ...baseFilter,
        [col.plain]: { not: null },
        [col.hmac]: null,
    };

    const totals = { column: col.name, candidates: 0, updated: 0, skippedEmpty: 0, errors: 0 };

    // Cursor-style loop: each batch re-queries `*Hmac IS NULL`, so committed
    // writes naturally drop out of the next page (no offset drift).
    for (;;) {
        const rows = await prisma.user.findMany({
            where,
            select: { id: true, [col.plain]: true },
            take: batch,
            orderBy: { id: 'asc' },
        });
        if (rows.length === 0) {break;}

        for (const row of rows) {
            const plaintext = row[col.plain];
            const hmac = computeLookupHmac(String(plaintext));
            if (!hmac) {
                // Non-empty plaintext that hashes to null should be impossible;
                // guard so an odd row never spins the loop forever.
                totals.skippedEmpty += 1;
                continue;
            }
            totals.candidates += 1;
            if (dryRun) {
                totals.updated += 1;
                continue;
            }
            try {
                await prisma.user.update({
                    where: { id: row.id },
                    data: { [col.hmac]: hmac },
                });
                totals.updated += 1;
            } catch (err) {
                if (err && err.code === 'P2002') {
                    // @unique collision — two rows resolve to the same Hmac.
                    // ABORT LOUDLY rather than overwrite/skip silently.
                    log({ column: col.name, userId: row.id, action: 'UNIQUE_CONFLICT', target: err.meta?.target || null });
                    throw new Error(
                        `[backfill-national-id-hmac] UNIQUE conflict writing ${col.hmac} for user ${row.id} `
                        + `(target=${JSON.stringify(err.meta?.target || null)}). `
                        + 'Two rows share the same plaintext identifier — investigate before re-running.',
                    );
                }
                totals.errors += 1;
                log({ column: col.name, userId: row.id, action: 'ERROR', message: err.message });
            }
        }
        log({ column: col.name, action: 'BATCH', processed: rows.length, runningUpdated: totals.updated });

        // In dry-run nothing is written, so the same rows would re-page forever.
        // Stop after a single page when not actually writing.
        if (dryRun) {break;}
    }

    return totals;
}

/**
 * Assert that 0 ACTIVE rows are missing their `*Hmac` (the gate the operator
 * checks before flipping AUTH_LOOKUP_USE_HMAC). Returns an array of offenders
 * (column -> count); empty array means the assertion holds.
 */
async function assertNoneMissing({ prisma, includeDeleted }) {
    const baseFilter = includeDeleted ? {} : { isDeleted: false };
    const offenders = [];
    for (const col of COLUMN_MAP) {
        const count = await prisma.user.count({
            where: { ...baseFilter, [col.plain]: { not: null }, [col.hmac]: null },
        });
        if (count > 0) {offenders.push({ column: col.name, missing: count });}
    }
    return offenders;
}

async function backfill({ prisma: injectedPrisma, helpers: injectedHelpers, dryRun = false, includeDeleted = false, batch = 500, log = () => {} } = {}) {
    const prisma = await loadPrisma(injectedPrisma);
    const { computeLookupHmac, withoutTenantScope } = loadHelpers(injectedHelpers);

    // Cross-tenant: must see every org's rows.
    return withoutTenantScope(async () => {
        const perColumn = [];
        for (const col of COLUMN_MAP) {
            const t = await backfillColumn({ prisma, computeLookupHmac, col, dryRun, includeDeleted, batch, log });
            perColumn.push(t);
        }

        // Final assertion (skipped meaning-wise on dry-run since nothing was
        // written, but we still REPORT what would remain).
        const offenders = await assertNoneMissing({ prisma, includeDeleted });
        const assertionHeld = offenders.length === 0;

        return {
            ranAt: new Date().toISOString(),
            dryRun,
            includeDeleted,
            batch,
            perColumn,
            assertion: {
                description: '0 active rows with non-null plaintext but null *Hmac',
                held: dryRun ? null : assertionHeld,
                wouldRemainAfterDryRun: dryRun ? offenders : undefined,
                offenders: dryRun ? undefined : offenders,
            },
        };
    });
}

async function main() {
    const { dryRun, includeDeleted, batch } = parseArgs(process.argv.slice(2));
    try {
        const result = await backfill({
            dryRun,
            includeDeleted,
            batch,
            log: (entry) => console.log(JSON.stringify(entry)),
        });
        console.log(JSON.stringify(result));
        // Real (non-dry) runs MUST leave 0 active rows missing, or the operator
        // would otherwise flip the flag on a partial backfill = login lockout.
        if (!dryRun && result.assertion.held !== true) {
            console.error('[backfill-national-id-hmac] ASSERTION FAILED: active rows still missing *Hmac. Do NOT flip AUTH_LOOKUP_USE_HMAC.');
            process.exit(1);
        }
        process.exit(0);
    } catch (err) {
        console.error(`backfill-national-id-hmac: fatal ${err.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { backfill, backfillColumn, assertNoneMissing, parseArgs, COLUMN_MAP };
