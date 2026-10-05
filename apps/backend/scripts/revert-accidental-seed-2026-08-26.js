#!/usr/bin/env node
'use strict';

/**
 * Undo the rows an accidental seed wrote into the shared dataset on 2026-08-26 — and refuse
 * to touch anything else.
 *
 * WHAT HAPPENED
 *   prisma/seed-gacp.js called main() at module scope with no `require.main === module`
 *   guard, so REQUIRING the file seeded whatever DATABASE_URL pointed at. A worker required
 *   it to read its column names, and at 01:47-01:48 it wrote into the one Supabase dataset
 *   the laptop and the preview stack share:
 *
 *     3 users          somchai@gacpth.com · somying@gacpth.com · auditor2@gacp.go.th
 *     3 applications   APP-68-001 · APP-68-002 · APP-68-003
 *     1 farm, 2 plots
 *     1 certificate    GACP-ERP-100012 — status 'active', signature NULL
 *
 *   The certificate is the serious one. The seed writes it with certificate.upsert directly,
 *   so it never passes through generateCertificate and never meets the fail-closed signing
 *   path: an ACTIVE government certificate that the product's own verifier answers
 *   {signed:false} for. That is the exact defect three earlier signature-less certificates
 *   taught this repo to close, arriving through a door the fix did not cover.
 *
 * WHY DELETE RATHER THAN RE-SEED
 *   Re-running the seed would sign that certificate (the seed now goes through the real
 *   signing path) — but it would also rewrite existing users' passwords again and re-add the
 *   whole fixture set. Repairing one row by writing ten more is not a repair. An accident is
 *   reverted, not accommodated.
 *
 * WHAT THIS SCRIPT WILL NOT DO
 *   It will not touch the journey's own data: application APP-2569-MT87HW1N-450568,
 *   certificate GACP-TH-2569-CAE820, their farm, plot, cycles and harvests. Those are the
 *   evidence of a real pressed walk. Every row it deletes must match BOTH a known seed
 *   identifier AND the 2026-08-26 creation window, and it aborts rather than guessing if the
 *   counts are not exactly what was measured.
 *
 * WHAT IT CANNOT UNDO
 *   The seed also overwrote the passwords of the users that already existed (`password` sits
 *   in its upsert `update:` clause). Those hashes are gone. Deleting rows cannot bring them
 *   back — the operator has to set them deliberately.
 *
 * USAGE
 *   node scripts/revert-accidental-seed-2026-08-26.js                 # dry run (default)
 *   node scripts/revert-accidental-seed-2026-08-26.js --apply         # delete, guarded
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

// Everything the seed writes, by the identifier the seed itself uses. Names, not ids: ids are
// deterministic hashes of values this script would have to re-derive, and a re-derivation that
// drifts would delete the wrong row.
const SEED_USER_EMAILS = ['somchai@gacpth.com', 'somying@gacpth.com', 'auditor2@gacp.go.th'];
const SEED_APPLICATION_NUMBERS = ['APP-68-001', 'APP-68-002', 'APP-68-003'];
const SEED_CERTIFICATE_NUMBER_PREFIX = 'GACP-ERP-';

// The accident's window. Anything created outside it is not this accident, whatever it is called.
const WINDOW_START = new Date('2026-08-26T01:00:00.000Z');
const WINDOW_END = new Date('2026-08-26T03:00:00.000Z');

// Measured on 2026-08-26 by a read-only census, before anything was deleted. If the database
// does not match this, something changed since — stop and let a human look.
const EXPECTED = { users: 3, applications: 3, certificates: 1, plots: 2, farms: 1 };

// Never deletable, listed explicitly so the intent survives a careless edit of the logic above.
const PROTECTED_CERTIFICATE_NUMBERS = new Set(['GACP-TH-2569-CAE820']);
const PROTECTED_APPLICATION_NUMBERS = new Set(['APP-2569-MT87HW1N-450568']);

function redactedUrl(raw) {
    try {
        const u = new URL(raw);
        return `${u.protocol}//<redacted>@${u.hostname}:${u.port || '5432'}${u.pathname}`;
    } catch {
        return '<unparseable DATABASE_URL — redacted>';
    }
}

function inWindow(row) {
    return row.createdAt >= WINDOW_START && row.createdAt < WINDOW_END;
}

function abort(message) {
    console.error(`\nABORTED: ${message}`);
    console.error('Nothing was deleted.');
    process.exit(1);
}

async function main() {
    const apply = process.argv.includes('--apply');

    const raw = process.env.DATABASE_URL;
    if (!raw) { abort('DATABASE_URL is not set'); }
    const url = new URL(raw);
    // Transaction pooler: the session pooler caps this project at ~15 clients and the backend
    // already asks for 20 (see the EMAXCONNSESSION incident, ledger F-G4-01).
    url.port = '6543';
    url.searchParams.set('pgbouncer', 'true');
    url.searchParams.set('connection_limit', '1');

    console.log(`database: ${redactedUrl(url.toString())}`);
    console.log(`mode    : ${apply ? 'APPLY — rows will be deleted' : 'DRY RUN — nothing will be written'}\n`);

    const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });

    try {
        // ── gather, with both tests applied ────────────────────────────────────────────
        const certificates = (await prisma.certificate.findMany({
            where: { certificateNumber: { startsWith: SEED_CERTIFICATE_NUMBER_PREFIX } },
            select: { id: true, certificateNumber: true, status: true, signature: true, createdAt: true },
        })).filter(inWindow);

        const applications = (await prisma.application.findMany({
            where: { applicationNumber: { in: SEED_APPLICATION_NUMBERS } },
            select: { id: true, applicationNumber: true, status: true, createdAt: true },
        })).filter(inWindow);

        const users = (await prisma.user.findMany({
            where: { email: { in: SEED_USER_EMAILS } },
            select: { id: true, email: true, role: true, createdAt: true },
        })).filter(inWindow);

        const farms = (await prisma.farm.findMany({
            select: { id: true, farmName: true, createdAt: true },
        })).filter(inWindow);

        const plots = (await prisma.plot.findMany({
            select: { id: true, name: true, farmId: true, createdAt: true },
        })).filter(inWindow);

        // ── refuse to proceed on anything unexpected ───────────────────────────────────
        for (const c of certificates) {
            if (PROTECTED_CERTIFICATE_NUMBERS.has(c.certificateNumber)) {
                abort(`selection contains a protected certificate: ${c.certificateNumber}`);
            }
            if (c.signature) {
                abort(`${c.certificateNumber} carries a real signature — it did not come from the accidental seed`);
            }
        }
        for (const a of applications) {
            if (PROTECTED_APPLICATION_NUMBERS.has(a.applicationNumber)) {
                abort(`selection contains a protected application: ${a.applicationNumber}`);
            }
        }

        const actual = {
            users: users.length,
            applications: applications.length,
            certificates: certificates.length,
            plots: plots.length,
            farms: farms.length,
        };
        const drift = Object.keys(EXPECTED).filter((k) => EXPECTED[k] !== actual[k]);

        console.log('what the accident wrote, as the database has it now:');
        for (const c of certificates) {
            console.log(`  certificate  ${c.certificateNumber}  status=${c.status}  signature=${c.signature ? 'present' : 'NULL'}`);
        }
        for (const a of applications) { console.log(`  application  ${a.applicationNumber}  status=${a.status}`); }
        for (const u of users) { console.log(`  user         ${u.email}  role=${u.role}`); }
        for (const f of farms) { console.log(`  farm         ${f.farmName}`); }
        for (const p of plots) { console.log(`  plot         ${p.name}`); }

        console.log(`\ncounts: ${JSON.stringify(actual)}`);
        if (drift.length) {
            abort(
                `expected ${JSON.stringify(EXPECTED)} but found ${JSON.stringify(actual)} — `
                + `${drift.join(', ')} differ. The dataset changed since the census; re-measure before deleting.`,
            );
        }

        if (!apply) {
            console.log('\nDRY RUN — nothing deleted. To delete, re-run with:');
            console.log('  node scripts/revert-accidental-seed-2026-08-26.js --apply');
            return;
        }

        // ── delete, children before parents ────────────────────────────────────────────
        // Order is not cosmetic: certificates reference applications, farms and users;
        // applications reference users; plots reference farms. Anything out of order hits a
        // foreign key and leaves the revert half-done.
        const certIds = certificates.map((c) => c.id);
        const appIds = applications.map((a) => a.id);
        const plotIds = plots.map((p) => p.id);
        const farmIds = farms.map((f) => f.id);
        const userIds = users.map((u) => u.id);

        const deleted = await prisma.$transaction(async (tx) => {
            const c = await tx.certificate.deleteMany({ where: { id: { in: certIds } } });
            const a = await tx.application.deleteMany({ where: { id: { in: appIds } } });
            const p = await tx.plot.deleteMany({ where: { id: { in: plotIds } } });
            const f = await tx.farm.deleteMany({ where: { id: { in: farmIds } } });
            const u = await tx.user.deleteMany({ where: { id: { in: userIds } } });
            return { certificates: c.count, applications: a.count, plots: p.count, farms: f.count, users: u.count };
        });

        console.log(`\ndeleted: ${JSON.stringify(deleted)}`);
        console.log('\nStill outstanding, because deleting rows cannot fix it: the seed overwrote the');
        console.log('passwords of the users that already existed. Set them deliberately.');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(`FAILED: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
    process.exit(1);
});
