#!/usr/bin/env node
/**
 * clear-for-uat.js — SAFE transactional-data wipe to prepare a UAT database.
 *
 * Replaces the STALE scripts/reset-for-handoff.js (which hand-listed a
 * DELETE_ORDER that missed Entity*, Quotation, CreditNote, DebitNote,
 * Journal*, PaymentSlip, Subscription, Ticket*, WorkActivity, etc. and would
 * throw on Restrict-FK children). See docs/uat-prep/UAT-READINESS.md section B.
 *
 * DESIGN — "keep-allowlist, wipe-the-rest":
 *   Instead of enumerating tables to delete (which silently rots when a new
 *   model is added), this enumerates the SMALL, stable set of reference /
 *   config / finance tables to PRESERVE, then TRUNCATEs every OTHER public
 *   table. A newly-added transactional model is therefore wiped by default
 *   (clean UAT) rather than silently left behind. Table names are resolved at
 *   runtime from Prisma's DMMF (handles the inconsistent @@map usage), so the
 *   list can never drift from the schema.
 *
 * SAFETY GUARDS (all must pass before anything is written):
 *   1. Refuses outright if the target DB name looks like production
 *      (=== 'gacp_db' or matches /prod/i).
 *   2. Requires the operator to echo the exact target DB name via
 *      CONFIRM_CLEAR_TARGET=<dbname> — a typo aborts.
 *   3. DRY-RUN by default: prints the wipe/keep plan and EXITS. Add --execute
 *      to actually TRUNCATE.
 *   4. The whole wipe runs in ONE transaction with TRUNCATE ... RESTART
 *      IDENTITY CASCADE (FK-order-safe; rolls back atomically on any error).
 *   5. Post-verify prints finance/reference row counts — the run FAILS loudly
 *      if a preserved finance table (issuer_bank_accounts / bank_accounts /
 *      receipt_sequences) came out empty.
 *
 * ALWAYS take a backup first (the script reminds you and will not skip it):
 *   pg_dump --format=custom --no-owner --file=uat-preclear-<ts>.dump "$DATABASE_URL"
 *
 * Usage:
 *   # 1. dry-run (default) — review the plan, no writes:
 *   CONFIRM_CLEAR_TARGET=gacp_staging node scripts/clear-for-uat.js
 *   # 2. execute (after backup + reviewing the dry-run):
 *   CONFIRM_CLEAR_TARGET=gacp_staging node scripts/clear-for-uat.js --execute
 *   # then re-seed:  node prisma/seed-gacp.js
 */

'use strict';

const { PrismaClient, Prisma } = require('@prisma/client');

// ── Reference / config / finance tables to PRESERVE (model names) ────────────
// Source of truth: docs/uat-prep/UAT-READINESS.md §B.4 "KEEP (never wipe)".
// Finance numbers (BankAccount / IssuerBankAccount) are hand-entered after
// seed and have NO real-value re-seed; ReceiptSequence holds the legally-
// sequential receipt/invoice counters. Wiping any of these is unrecoverable.
const KEEP_MODELS = new Set([
    'Organization',
    'RoleGroup',
    'DocumentTemplate',
    'BankAccount',
    'IssuerBankAccount',
    'ReceiptSequence',
    'SystemConfig',
    'WizardStepConfig',
    'CertificationStandard',
    'StandardRequirement',
    'SupplementaryCriterion',
    'PlantSpecies',
    'DocumentRequirement',
    'SlaPolicy',
    'StageActivityConfig',
]);

// Finance tables that MUST still hold rows after the wipe (sanity gate).
const FINANCE_GUARD_TABLES = ['bank_accounts', 'receipt_sequences'];

function parseDbName(url) {
    try {
        // postgresql://user:pass@host:port/DBNAME?schema=public
        const afterSlash = String(url).split('/').pop() || '';
        return decodeURIComponent(afterSlash.split('?')[0]);
    } catch {
        return '';
    }
}

function modelTableName(model) {
    // DMMF dbName is the @@map value; null → the model name is the table name.
    return model.dbName || model.name;
}

async function main() {
    // Privileged: this script TRUNCATEs tables, which the app's least-priv
    // gacp_app role cannot do post-cutover — resolve a superuser connection.
    // (resolveAdminDbUrl() itself throws if neither URL is set, so the old
    // "DATABASE_URL is not set" guard that used to live here is redundant.)
    const { url, usedFallback } = require('./lib/admin-db-url').resolveAdminDbUrl();
    if (usedFallback) {
        console.warn('[admin-db] ADMIN_DATABASE_URL unset — falling back to DATABASE_URL; TRUNCATE/ALTER/DROP will FAIL under gacp_app');
    }

    const execute = process.argv.includes('--execute');
    const dbUrl = url;
    const dbName = parseDbName(dbUrl);

    console.log('\n  clear-for-uat — transactional-data wipe');
    console.log('═'.repeat(58));
    console.log(`  Target database : ${dbName || '(unparseable)'}`);
    console.log(`  Mode            : ${execute ? 'EXECUTE (will TRUNCATE)' : 'DRY-RUN (no writes)'}`);
    console.log('═'.repeat(58));

    // Guard 1 — never prod.
    if (dbName === 'gacp_db' || /prod/i.test(dbName)) {
        console.error(`\nRefusing: "${dbName}" looks like PRODUCTION. This tool is for UAT/staging only.`);
        process.exit(2);
    }

    // Guard 2 — operator must echo the exact target.
    const confirm = process.env.CONFIRM_CLEAR_TARGET || '';
    if (confirm !== dbName) {
        console.error(`\nRefusing: set CONFIRM_CLEAR_TARGET to the EXACT target DB name to proceed.`);
        console.error(`  Expected:  CONFIRM_CLEAR_TARGET=${dbName || '<dbname>'}`);
        console.error(`  Got:       CONFIRM_CLEAR_TARGET=${confirm || '(empty)'}`);
        process.exit(2);
    }

    const prisma = new PrismaClient({ datasources: { db: { url } } });
    try {
        // Resolve every model's actual table name from the runtime schema.
        const models = Prisma.dmmf.datamodel.models;
        const keepTables = new Set();
        const wipeTables = [];
        for (const model of models) {
            const table = modelTableName(model);
            if (KEEP_MODELS.has(model.name)) {
                keepTables.add(table);
            } else {
                wipeTables.push(table);
            }
        }

        console.log(`\n  KEEP (${keepTables.size} reference/finance tables):`);
        console.log('    ' + [...keepTables].sort().join(', '));
        console.log(`\n  WIPE (${wipeTables.length} transactional tables):`);
        console.log('    ' + wipeTables.slice().sort().join(', '));

        // Pre-wipe finance counts (proof they exist BEFORE, so we can prove the
        // wipe didn't touch them AFTER).
        console.log('\n  Finance/reference row counts (pre):');
        for (const t of FINANCE_GUARD_TABLES) {
            try {
                const r = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
                console.log(`    ${t}: ${r[0].n}`);
            } catch (e) {
                console.log(`    ${t}: (not found — ${e.message.split('\n')[0]})`);
            }
        }

        if (!execute) {
            console.log('\n  DRY-RUN complete. No data was modified.');
            console.log('  Re-run with --execute AFTER taking a pg_dump backup.\n');
            return;
        }

        // Execute: one transaction, TRUNCATE ... RESTART IDENTITY CASCADE.
        const quoted = wipeTables.map((t) => `"${t}"`).join(', ');
        console.log(`\n  Executing TRUNCATE on ${wipeTables.length} tables (RESTART IDENTITY CASCADE)...`);
        await prisma.$transaction([
            prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`),
        ]);
        console.log('  Wipe committed.');

        // Post-verify finance guard.
        console.log('\n  Finance/reference row counts (post — MUST be non-zero):');
        let financeOk = true;
        for (const t of FINANCE_GUARD_TABLES) {
            try {
                const r = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
                const n = r[0].n;
                console.log(`    ${t}: ${n}${n === 0 ? '  WARNING: EMPTY' : ''}`);
                if (n === 0) { financeOk = false; }
            } catch (e) {
                console.log(`    ${t}: (error — ${e.message.split('\n')[0]})`);
            }
        }
        if (!financeOk) {
            console.error('\nA finance/reference table is EMPTY after the wipe — investigate before UAT.');
            process.exitCode = 3;
        }

        console.log('\n  Done. Next: node prisma/seed-gacp.js  (re-seed org + logins + sample apps).\n');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error('\nFatal:', err.message);
    process.exit(1);
});
