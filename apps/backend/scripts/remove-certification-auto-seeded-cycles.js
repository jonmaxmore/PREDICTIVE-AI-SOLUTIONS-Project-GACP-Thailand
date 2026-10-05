#!/usr/bin/env node
'use strict';

/**
 * Remove the planting cycles and harvest batches that certificate issuance used to invent —
 * and refuse to touch a row a farmer actually created.
 *
 * WHAT THIS IS
 *   Until 2026-08-26, minting a certificate ran createInitialAssets, which seeded a
 *   PlantingCycle called "Featured Cycle 1/<year>" — English in a Thai product, bound to no
 *   plot, starting on the issue date rather than on anything that was planted — plus a
 *   HarvestBatch with freshWeight 0 and a QR pointing at localhost. Both appeared in the
 *   farmer's own cycle and batch lists, mixed in with the rows they had created themselves
 *   (G4 walk 2026-08-25 12:51:22 — ledger F-G4-22).
 *
 *   The code is gone (certificate-service.js, and certificate-no-cultivation-auto-seed.test.js
 *   pins its absence). The ROWS it already wrote are still in the dataset. This removes those.
 *
 * WHY THE MARKERS ARE WHAT THEY ARE
 *   A cycle is deleted only when it carries the exact `notes` string the bootstrap stamped
 *   AND is empty in every way that would make it real. The note alone is not enough: a farmer
 *   could type anything. Emptiness alone is not enough either: a cycle created five minutes
 *   ago is legitimately empty. Both, together, describe only the artefact.
 *
 * USAGE
 *   node scripts/remove-certification-auto-seeded-cycles.js            # dry run (default)
 *   node scripts/remove-certification-auto-seeded-cycles.js --apply    # delete, guarded
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const CYCLE_NOTE = 'Auto-generated upon Certification';
const BATCH_NOTE = 'Initial Batch from Certification';

function redactedUrl(raw) {
    try {
        const u = new URL(raw);
        return `${u.protocol}//<redacted>@${u.hostname}:${u.port || '5432'}${u.pathname}`;
    } catch {
        return '<unparseable DATABASE_URL — redacted>';
    }
}

async function main() {
    const apply = process.argv.includes('--apply');
    const raw = process.env.DATABASE_URL;
    if (!raw) { console.error('ABORTED: DATABASE_URL is not set'); process.exit(1); }

    const url = new URL(raw);
    url.port = '6543';
    url.searchParams.set('pgbouncer', 'true');
    url.searchParams.set('connection_limit', '1');

    console.log(`database: ${redactedUrl(url.toString())}`);
    console.log(`mode    : ${apply ? 'APPLY — rows will be deleted' : 'DRY RUN — nothing will be written'}\n`);

    const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    try {
        const candidates = await prisma.plantingCycle.findMany({
            where: { notes: CYCLE_NOTE },
            select: {
                id: true, cycleName: true, status: true, plotId: true, createdAt: true,
                _count: { select: { cyclePlots: true, careLogs: true, batches: true } },
                batches: {
                    select: {
                        id: true, batchNumber: true, notes: true, freshWeight: true,
                        _count: { select: { lots: true } },
                    },
                },
            },
        });

        if (candidates.length === 0) {
            console.log('No auto-seeded cycles found. Nothing to do.');
            return;
        }

        const doomedCycles = [];
        const doomedBatches = [];

        for (const c of candidates) {
            const reasons = [];
            // Anything a farmer touched makes this NOT the artefact, whatever the note says.
            if (c._count.cyclePlots > 0) { reasons.push(`${c._count.cyclePlots} plot assignment(s)`); }
            if (c._count.careLogs > 0) { reasons.push(`${c._count.careLogs} care log(s)`); }
            if (c.plotId) { reasons.push('a legacy plot binding'); }

            for (const b of c.batches) {
                if (b.notes !== BATCH_NOTE) { reasons.push(`batch ${b.batchNumber} is not the seeded one`); }
                if (Number(b.freshWeight) > 0) { reasons.push(`batch ${b.batchNumber} carries a real weight (${b.freshWeight})`); }
                if (b._count.lots > 0) { reasons.push(`batch ${b.batchNumber} has ${b._count.lots} packed lot(s)`); }
            }

            if (reasons.length) {
                console.log(`KEEP    "${c.cycleName}" (${c.id}) — ${reasons.join('; ')}`);
                continue;
            }
            console.log(`DELETE  "${c.cycleName}" (${c.id}) ${c.createdAt.toISOString().slice(0, 16)} — empty in every relation, carries the bootstrap note`);
            for (const b of c.batches) {
                console.log(`        └ batch ${b.batchNumber} (fresh=${b.freshWeight}, lots=0)`);
                doomedBatches.push(b.id);
            }
            doomedCycles.push(c.id);
        }

        console.log(`\n${doomedCycles.length} cycle(s) and ${doomedBatches.length} batch(es) to remove, ${candidates.length - doomedCycles.length} kept`);

        if (!apply) {
            console.log('\nDRY RUN — nothing deleted. To delete, re-run with --apply');
            return;
        }
        if (doomedCycles.length === 0) { return; }

        // Batches first: a batch references its cycle.
        const result = await prisma.$transaction(async (tx) => {
            const b = await tx.harvestBatch.deleteMany({ where: { id: { in: doomedBatches } } });
            const c = await tx.plantingCycle.deleteMany({ where: { id: { in: doomedCycles } } });
            return { batches: b.count, cycles: c.count };
        });
        console.log(`\ndeleted: ${JSON.stringify(result)}`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(`FAILED: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
    process.exit(1);
});
