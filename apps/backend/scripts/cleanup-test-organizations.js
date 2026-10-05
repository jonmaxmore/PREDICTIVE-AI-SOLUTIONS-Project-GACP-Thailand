#!/usr/bin/env node
'use strict';
/**
 * Delete the empty test-fixture organizations that integration runs left in the
 * shared Supabase dataset — and refuse to delete anything else.
 *
 * WHY THIS EXISTS
 *   The demo dataset is shared by the laptop and the preview stack. Integration
 *   suites (m5-*, a0-pr1/pr2-*, onsite-decision-mint-e2e, m4-*, optimistic-lock-wf-f7,
 *   cert-issuance-atomicity-be-t1) each mint their own throwaway Organization and do
 *   not always clean it up, so the tenant list an operator sees is mostly noise.
 *
 * WHY THE GUARDS ARE THIS PARANOID
 *   A name is not evidence. A real farmer's cooperative could plausibly be called
 *   "... Test Org", and a row that looks empty at a glance may still own a
 *   certificate or an invoice. So a row is deleted ONLY when the full conjunction in
 *   isDeletable() holds, and the emptiness check is generated from the Prisma DMMF
 *   rather than hand-listed, so a relation added to Organization tomorrow is checked
 *   automatically instead of being silently forgotten. The database agrees: the FK
 *   constraints added by migration 20260427120300_add_organization_fk_constraints are
 *   ON DELETE RESTRICT, so a non-empty org would fail the delete anyway; this script
 *   refuses first, with a readable reason, instead of throwing a constraint error.
 *
 * SAFETY CONTRACT (mirrors scripts/g4/set-certificate-business-date.js)
 *   - dry run is the default; nothing is written without --apply;
 *   - --apply additionally requires --expect=<n> and aborts unless exactly n rows are
 *     deletable, so a dataset that drifted since the dry run stops the run rather than
 *     being guessed at;
 *   - type=INTERNAL and the protected slugs are never touched, whatever else matches;
 *   - the connection string is never printed — only the redacted host (Law L2).
 *
 * Usage:
 *   node scripts/cleanup-test-organizations.js                      # dry run (default)
 *   node scripts/cleanup-test-organizations.js --apply --expect=42  # delete, guarded
 *   ... [--evidence <dir>]                                          # write decisions.json
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { PrismaClient, Prisma } = require('@prisma/client');

// Exact names minted by the integration suites. An exact list, not a /test/i regex:
// an unknown name must show up as "not a known fixture — skipped" and make a human
// look at it, never be swept up by a pattern that happened to match.
const KNOWN_FIXTURE_NAMES = new Set([
    'M5 Test Org',
    'M4 Test Org',
    'A0 PR1 Test Org',
    'A0 PR2 Test Org',
    'E2E Mint Org',
    'WF-F7 Test Org',
    'BE-T1 Test Org',
]);

// Belt and braces on top of the type check: the platform's own ops tenant, by slug.
const PROTECTED_SLUGS = new Set(['default']);

// The only org type a fixture is ever created with. INTERNAL is excluded on purpose —
// that is the platform tenant (and the ent01 verification org), never debris to sweep.
const DELETABLE_TYPES = new Set(['PRIVATE_CERTIFIER']);

function redactDbUrl(rawUrl) {
    try {
        const u = new URL(rawUrl);
        return `${u.protocol}//<redacted>@${u.hostname}:${u.port || '5432'}${u.pathname}`;
    } catch {
        return '<unparseable DATABASE_URL — redacted>';
    }
}

/**
 * Every model whose rows can belong to an organization.
 *
 * Deriving this from Organization's DECLARED relations is not enough, and an adversarial
 * review caught it: eight models carry a scalar `organizationId` with no reverse relation on
 * Organization and no foreign key at all — journal_entries, credit_notes, debit_notes,
 * manual_journal_entry_drafts, period_closes, purchase_invoices, tickets and
 * waiver_reopen_requests. A live check of pg_constraint found 73 foreign keys pointing at
 * organizations and zero covering those eight. Five of them are ledger tables.
 *
 * That is the difference between a safety check and a formality: an organization owning
 * nothing but a journal entry would have passed every guard, been reported as "empty", and
 * been hard-deleted, orphaning money rows that no constraint protects.
 *
 * So the field of view is every model with an `organizationId` scalar, whether or not
 * Organization admits the relationship, unioned with the declared to-many relations.
 */
function organizationRelations() {
    const models = Prisma.dmmf.datamodel.models;
    const org = models.find((m) => m.name === 'Organization');
    if (!org) {
        throw new Error('Organization model not found in Prisma DMMF — run prisma generate');
    }

    const declared = org.fields
        .filter((f) => f.kind === 'object' && f.isList)
        .map((f) => f.type);

    // The ones Organization does not admit to. A scalar organizationId is a tenancy claim
    // regardless of whether anyone declared the other half of it.
    const byScalar = models
        .filter((m) => m.name !== 'Organization')
        .filter((m) => m.fields.some((f) => f.kind === 'scalar' && f.name === 'organizationId'))
        .map((m) => m.name);

    return [...new Set([...declared, ...byScalar])].sort();
}

const clientProp = (modelName) => modelName[0].toLowerCase() + modelName.slice(1);

/**
 * The whole decision, in one place. `childRows` is a map modelName -> row count,
 * already restricted to this organization.
 */
function isDeletable(org, childRows) {
    if (org.type === 'INTERNAL') {
        return { deletable: false, reason: 'type=INTERNAL (platform tenant)' };
    }
    if (PROTECTED_SLUGS.has(org.slug)) {
        return { deletable: false, reason: `protected slug "${org.slug}"` };
    }
    if (org.legalHold) {
        return { deletable: false, reason: 'legalHold=true (PDPA retention)' };
    }
    if (!DELETABLE_TYPES.has(org.type)) {
        return { deletable: false, reason: `type=${org.type} is not a fixture type` };
    }
    if (!KNOWN_FIXTURE_NAMES.has(org.name)) {
        return { deletable: false, reason: 'not a known test-fixture name' };
    }

    const nonEmpty = Object.entries(childRows).filter(([, n]) => n > 0);
    if (nonEmpty.length > 0) {
        return {
            deletable: false,
            reason: `has real data: ${nonEmpty.map(([m, n]) => `${m}=${n}`).join(', ')}`,
        };
    }
    return { deletable: true, reason: 'known fixture name, zero rows in all tenant-scoped relations' };
}

function parseArgs(argv) {
    const args = { apply: false, expect: null, evidence: null };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--apply') {
            args.apply = true;
        } else if (a.startsWith('--expect=')) {
            args.expect = Number(a.slice('--expect='.length));
        } else if (a === '--expect') {
            i += 1;
            args.expect = Number(argv[i]);
        } else if (a === '--evidence') {
            i += 1;
            args.evidence = argv[i];
        } else {
            throw new Error(`unknown argument: ${a}`);
        }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!process.env.DATABASE_URL) {
        console.error('FATAL: DATABASE_URL is not set');
        process.exit(2);
    }
    const u = new URL(process.env.DATABASE_URL);
    u.port = '6543';
    u.searchParams.set('pgbouncer', 'true');
    u.searchParams.set('connection_limit', '1');
    const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

    console.log(`database: ${redactDbUrl(u.toString())}`);
    console.log(`mode:     ${args.apply ? 'APPLY (rows will be deleted)' : 'DRY RUN (nothing will be written)'}`);

    const relations = organizationRelations();
    console.log(
        `emptiness check covers ${relations.length} tenant-scoped tables `
        + '(every relation Organization declares, plus every model carrying an organizationId '
        + 'scalar — including the eight that have no foreign key back)\n',
    );

    const orgs = await prisma.organization.findMany({
        select: {
            id: true, name: true, slug: true, code: true, type: true,
            status: true, createdAt: true, legalHold: true,
        },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });

    // One grouped count per relation across every org, rather than 73 queries per row.
    const childRows = new Map(orgs.map((o) => [o.id, {}]));
    for (const model of relations) {
        const grouped = await prisma[clientProp(model)].groupBy({
            by: ['organizationId'],
            _count: { _all: true },
        });
        for (const row of grouped) {
            const bucket = childRows.get(row.organizationId);
            if (bucket) {
                bucket[model] = row._count._all;
            }
        }
    }

    const decisions = orgs.map((org) => {
        const { deletable, reason } = isDeletable(org, childRows.get(org.id));
        return { ...org, deletable, reason };
    });

    // Per-row audit line, printed before anything is deleted.
    for (const d of decisions) {
        const mark = d.deletable ? 'DELETE' : 'KEEP  ';
        console.log(
            `${mark}  ${d.createdAt.toISOString().slice(0, 10)}  ${d.id}  ` +
            `${JSON.stringify(d.name)} [${d.type}/${d.slug}] — ${d.reason}`,
        );
    }

    const doomed = decisions.filter((d) => d.deletable);
    console.log(`\n${doomed.length} deletable, ${decisions.length - doomed.length} kept, ${decisions.length} total`);

    if (args.evidence) {
        fs.mkdirSync(args.evidence, { recursive: true });
        fs.writeFileSync(
            path.join(args.evidence, 'org-cleanup-decisions.json'),
            JSON.stringify({
                database: redactDbUrl(u.toString()),
                mode: args.apply ? 'apply' : 'dry-run',
                relationsChecked: relations,
                decisions,
                ranAt: new Date().toISOString(),
            }, null, 2),
        );
    }

    if (!args.apply) {
        console.log('\nDRY RUN — nothing deleted. To delete, re-run with:');
        console.log(`  node scripts/cleanup-test-organizations.js --apply --expect=${doomed.length}`);
        await prisma.$disconnect();
        return;
    }

    // Same guard as set-certificate-business-date.js: assert the exact expected match
    // count and abort rather than guess. If the dataset moved between the dry run and
    // the apply, a human decides what that means, not this script.
    if (!Number.isInteger(args.expect)) {
        console.error('FATAL: --apply requires --expect=<n> (the count printed by the dry run) — refusing');
        process.exit(2);
    }
    if (doomed.length !== args.expect) {
        console.error(`FATAL: expected exactly ${args.expect} deletable organizations, found ${doomed.length} — refusing`);
        process.exit(1);
    }

    const ids = doomed.map((d) => d.id);
    const result = await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    if (result.count !== args.expect) {
        console.error(`FATAL: deleted ${result.count} rows but expected ${args.expect} — inspect the dataset now`);
        process.exit(1);
    }

    const survivors = await prisma.organization.findMany({
        where: { id: { in: ids } },
        select: { id: true },
    });
    if (survivors.length !== 0) {
        console.error(`FATAL: ${survivors.length} of the targeted rows still exist after the delete`);
        process.exit(1);
    }

    const remaining = await prisma.organization.count();
    console.log(`\nDELETED ${result.count} organizations. ${remaining} remain.`);
    for (const d of doomed) {
        console.log(`  deleted ${d.id} ${JSON.stringify(d.name)} [${d.slug}]`);
    }
    await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
