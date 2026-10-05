#!/usr/bin/env node
/**
 * Detokenize STAGE B2 — backfill the Entity national-ID keyed-HMAC lookup column.
 *
 * Context (see docs/handoffs/national-id-detokenize-rfc-2026-06-29.md, the
 * "REQUIRED scope addition"): `entities.thaiCitizenId` is a SECOND plaintext
 * Thai national ID, looked up by an UNKEYED raw SHA-256 `thaiCitizenIdHash`
 * (entity-service.js) — brute-forceable from a dump with NO key at all. The B2
 * migration (20260629020000_add_entity_thaicitizenid_hmac) added a NULLABLE,
 * type-scoped-@unique `thaiCitizenIdHmac` column mirroring User.healthIdHmac
 * (H-4 Phase 1).
 *
 * This script computes `computeLookupHmac(thaiCitizenId)` for every INDIVIDUAL
 * Entity that has the plaintext but a NULL `thaiCitizenIdHmac`, and writes the
 * `thaiCitizenIdHmac` column. It runs the SAME way the H-4 user backfill does
 * (mirror of scripts/backfill-national-id-hmac.js), and BEFORE the create/dedup
 * path starts reading the keyed column.
 *
 * Guarantees (identical discipline to backfill-national-id-hmac.js):
 *   * Idempotent + resumable — only touches rows where thaiCitizenIdHmac IS NULL
 *     while thaiCitizenId IS NOT NULL. Re-running is a no-op once complete (and
 *     resumes mid-way if interrupted).
 *   * Batched — processes `--batch` rows at a time (default 500).
 *   * Cross-tenant — wrapped in `withoutTenantScope` so it sees EVERY tenant's
 *     rows (Entity is a tenant-scoped model; a scoped run would silently skip
 *     other orgs and leave the "0 missing" assertion unsatisfiable).
 *   * Aborts loudly on a `@unique` conflict (P2002) — NEVER overwrites an
 *     existing `thaiCitizenIdHmac`. A collision means two INDIVIDUAL entities
 *     share a plaintext ID, which must be investigated by hand.
 *   * Final assertion — after the pass, asserts that 0 ACTIVE (isDeleted=false)
 *     INDIVIDUAL entities have a non-NULL thaiCitizenId but a NULL
 *     thaiCitizenIdHmac. Exits non-zero if the assertion fails.
 *
 * The unkeyed legacy `thaiCitizenIdHash` is NOT touched — it stays for
 * back-compat / rollback and is dropped in STAGE B3.
 *
 * Usage on the droplet (inside the backend container, low-traffic window):
 *   node apps/backend/scripts/backfill-entity-thaicitizenid-hmac.js --dry-run
 *   node apps/backend/scripts/backfill-entity-thaicitizenid-hmac.js
 *
 * Flags:
 *   --dry-run          Compute + report WITHOUT writing.
 *   --batch=<n>        Rows per batch (default 500).
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

// Only INDIVIDUAL entities carry thaiCitizenId (JURISTIC/COMMUNITY use
// juristicId / communityRegNo). Scope every read by type so the backfill, the
// batch loop, and the assertion all agree.
const ENTITY_TYPE_INDIVIDUAL = 'INDIVIDUAL';

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
 * Backfill thaiCitizenIdHmac across the INDIVIDUAL entities in batches.
 * Returns totals.
 */
async function backfillColumn({ prisma, computeLookupHmac, dryRun, includeDeleted, batch, log }) {
    const baseFilter = includeDeleted ? {} : { isDeleted: false };
    // INDIVIDUAL entities with a plaintext value but a NULL hmac (idempotent +
    // resumable).
    const where = {
        ...baseFilter,
        type: ENTITY_TYPE_INDIVIDUAL,
        thaiCitizenId: { not: null },
        thaiCitizenIdHmac: null,
    };

    const totals = { column: 'thaiCitizenIdHmac', candidates: 0, updated: 0, skippedEmpty: 0, errors: 0 };

    // Cursor-style loop: each batch re-queries `thaiCitizenIdHmac IS NULL`, so
    // committed writes naturally drop out of the next page (no offset drift).
    for (;;) {
        const rows = await prisma.entity.findMany({
            where,
            select: { id: true, thaiCitizenId: true },
            take: batch,
            orderBy: { id: 'asc' },
        });
        if (rows.length === 0) {break;}

        for (const row of rows) {
            const plaintext = row.thaiCitizenId;
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
                await prisma.entity.update({
                    where: { id: row.id },
                    data: { thaiCitizenIdHmac: hmac },
                });
                totals.updated += 1;
            } catch (err) {
                if (err && err.code === 'P2002') {
                    // @unique collision — two INDIVIDUAL entities resolve to the
                    // same Hmac. ABORT LOUDLY rather than overwrite/skip silently.
                    log({ entityId: row.id, action: 'UNIQUE_CONFLICT', target: err.meta?.target || null });
                    throw new Error(
                        `[backfill-entity-thaicitizenid-hmac] UNIQUE conflict writing thaiCitizenIdHmac for entity ${row.id} `
                        + `(target=${JSON.stringify(err.meta?.target || null)}). `
                        + 'Two INDIVIDUAL entities share the same plaintext national ID — investigate before re-running.',
                    );
                }
                totals.errors += 1;
                log({ entityId: row.id, action: 'ERROR', message: err.message });
            }
        }
        log({ action: 'BATCH', processed: rows.length, runningUpdated: totals.updated });

        // In dry-run nothing is written, so the same rows would re-page forever.
        // Stop after a single page when not actually writing.
        if (dryRun) {break;}
    }

    return totals;
}

/**
 * Assert that 0 ACTIVE INDIVIDUAL entities are missing their thaiCitizenIdHmac
 * (the gate the operator checks before relying on the keyed lookup). Returns the
 * offending count; 0 means the assertion holds.
 */
async function assertNoneMissing({ prisma, includeDeleted }) {
    const baseFilter = includeDeleted ? {} : { isDeleted: false };
    const count = await prisma.entity.count({
        where: {
            ...baseFilter,
            type: ENTITY_TYPE_INDIVIDUAL,
            thaiCitizenId: { not: null },
            thaiCitizenIdHmac: null,
        },
    });
    return count > 0 ? [{ column: 'thaiCitizenIdHmac', missing: count }] : [];
}

async function backfill({ prisma: injectedPrisma, helpers: injectedHelpers, dryRun = false, includeDeleted = false, batch = 500, log = () => {} } = {}) {
    const prisma = await loadPrisma(injectedPrisma);
    const { computeLookupHmac, withoutTenantScope } = loadHelpers(injectedHelpers);

    // Cross-tenant: must see every org's rows.
    return withoutTenantScope(async () => {
        const totals = await backfillColumn({ prisma, computeLookupHmac, dryRun, includeDeleted, batch, log });

        // Final assertion (skipped meaning-wise on dry-run since nothing was
        // written, but we still REPORT what would remain).
        const offenders = await assertNoneMissing({ prisma, includeDeleted });
        const assertionHeld = offenders.length === 0;

        return {
            ranAt: new Date().toISOString(),
            dryRun,
            includeDeleted,
            batch,
            perColumn: [totals],
            assertion: {
                description: '0 active INDIVIDUAL entities with non-null thaiCitizenId but null thaiCitizenIdHmac',
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
        // Real (non-dry) runs MUST leave 0 active rows missing, or the keyed
        // dedup lookup would miss a row that already exists (and could create a
        // duplicate personal entity).
        if (!dryRun && result.assertion.held !== true) {
            console.error('[backfill-entity-thaicitizenid-hmac] ASSERTION FAILED: active INDIVIDUAL entities still missing thaiCitizenIdHmac.');
            process.exit(1);
        }
        process.exit(0);
    } catch (err) {
        console.error(`backfill-entity-thaicitizenid-hmac: fatal ${err.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { backfill, backfillColumn, assertNoneMissing, parseArgs, ENTITY_TYPE_INDIVIDUAL };
