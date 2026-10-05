#!/usr/bin/env node
/**
 * Backfill Application.reviewerId from the legacy JSON assignment.
 *
 * Context: reviewer assignment historically lived ONLY in
 * `formData.PROVIDERAssignment.reviewerId` (JSON). The canonical
 * `Application.reviewerId` column was added later (Wave A Phase 44) and is
 * written by scheduler-assign-reviewer-handler going forward. Rows assigned
 * before Phase 44 have the JSON entry but a NULL column, so the ownership
 * checks have to keep a JSON fallback.
 *
 * This script populates the column for those legacy rows so the JSON fallback
 * can be removed (single source of truth for reviewer-ownership auth).
 *
 * Disambiguation: the legacy JSON value may be either a User.id (newer clients)
 * or a User.providerId (older clients). We resolve it safely:
 *   1. if a User exists with id === value         → column = value
 *   2. else if a User exists with providerId===value → column = that User.id
 *   3. else                                        → SKIP (logged as unresolved)
 *
 * Idempotent: only touches rows where `reviewerId IS NULL`. Re-running is safe.
 *
 * Usage on the droplet (inside the backend container):
 *   node apps/backend/scripts/backfill-reviewer-id.js --dry-run
 *   node apps/backend/scripts/backfill-reviewer-id.js
 *
 * Flags:
 *   --dry-run   Resolve + report WITHOUT writing.
 *
 * Output: per-row JSON log lines + a final totals object.
 * Exit codes: 0 success, 1 fatal (DB unavailable / unexpected error).
 */

'use strict';

const path = require('path');

function parseArgs(argv) {
    return { dryRun: argv.includes('--dry-run') };
}

async function loadPrisma(injected) {
    if (injected) {
        return injected;
    }
    const mod = require(path.resolve(__dirname, '../services/prisma-database'));
    const prisma = mod && mod.prisma ? mod.prisma : null;
    if (!prisma) {
        throw new Error('prisma client unavailable');
    }
    return prisma;
}

/**
 * Resolve a legacy JSON assignment value to a canonical User.id.
 * Returns { resolvedId, via } or null when it cannot be resolved.
 */
async function resolveUserId(prisma, value) {
    if (!value) {
        return null;
    }
    const byId = await prisma.user.findUnique({ where: { id: value }, select: { id: true } });
    if (byId) {
        return { resolvedId: byId.id, via: 'id' };
    }
    const byProvider = await prisma.user.findFirst({ where: { providerId: value }, select: { id: true } });
    if (byProvider) {
        return { resolvedId: byProvider.id, via: 'providerId' };
    }
    return null;
}

async function backfill({ prisma: injectedPrisma, dryRun = false, log = () => {} } = {}) {
    const prisma = await loadPrisma(injectedPrisma);

    // Only legacy rows: column null. Pull the JSON to read the assignment.
    const rows = await prisma.application.findMany({
        where: { reviewerId: null, isDeleted: false },
        select: { id: true, applicationNumber: true, formData: true },
    });

    const totals = { scanned: rows.length, candidates: 0, updated: 0, skippedNoJson: 0, unresolved: 0, errors: 0 };

    for (const row of rows) {
        const fd = (row.formData && typeof row.formData === 'object') ? row.formData : {};
        const assignment = (fd.PROVIDERAssignment && typeof fd.PROVIDERAssignment === 'object') ? fd.PROVIDERAssignment : {};
        const legacyValue = assignment.reviewerId || null;
        if (!legacyValue) {
            totals.skippedNoJson += 1;
            continue;
        }
        totals.candidates += 1;
        try {
            const resolved = await resolveUserId(prisma, legacyValue);
            if (!resolved) {
                totals.unresolved += 1;
                log({ applicationId: row.id, applicationNumber: row.applicationNumber, legacyValue, action: 'UNRESOLVED' });
                continue;
            }
            if (!dryRun) {
                await prisma.application.update({
                    where: { id: row.id },
                    data: { reviewerId: resolved.resolvedId },
                });
            }
            totals.updated += 1;
            log({
                applicationId: row.id,
                applicationNumber: row.applicationNumber,
                legacyValue,
                resolvedId: resolved.resolvedId,
                via: resolved.via,
                action: dryRun ? 'WOULD_UPDATE' : 'UPDATED',
            });
        } catch (err) {
            totals.errors += 1;
            log({ applicationId: row.id, legacyValue, action: 'ERROR', message: err.message });
        }
    }

    return { ranAt: new Date().toISOString(), dryRun, totals };
}

async function main() {
    const { dryRun } = parseArgs(process.argv.slice(2));
    try {
        const result = await backfill({
            dryRun,
            log: (entry) => console.log(JSON.stringify(entry)),
        });
        console.log(JSON.stringify(result));
        process.exit(0);
    } catch (err) {
        console.error(`backfill-reviewer-id: fatal ${err.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { backfill, resolveUserId, parseArgs };
