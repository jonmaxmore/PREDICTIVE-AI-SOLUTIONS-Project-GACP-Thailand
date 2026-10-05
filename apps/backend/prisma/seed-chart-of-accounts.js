/**
 * Seed: chart_of_accounts — canonical Thai-NPAE-compliant account list.
 *
 * Batch B19-A (2026-05-16). Idempotent — calls
 * `chart-of-accounts-service.seedChartOfAccounts(prisma)` which uses
 * `prisma.account.upsert` with an empty `update: {}` when an Account
 * model exists, or a no-op fallback when it doesn't.
 *
 * Current state (verified 2026-05-16): there is NO `Account` Prisma
 * model in this codebase. Until DBA adds one (out of scope for B19-A)
 * the seeder logs the would-seed list so ops can see what the canonical
 * chart looks like, without doing any DB I/O.
 *
 * Compliance basis: TFRS for NPAEs ch.2 (financial reporting framework),
 *   ch.18 (รายได้), ch.21 (income tax). Revenue Code §86/4 / ภ.พ.30 for
 *   Output VAT account placement.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');

const {
    seedChartOfAccounts,
    CHART_OF_ACCOUNTS,
} = require('../services/chart-of-accounts-service');

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding chart_of_accounts...');
    const result = await seedChartOfAccounts(prisma);

    if (result.reason === 'NO_ACCOUNT_MODEL') {
        console.log(
            '  [skip] No `Account` Prisma model defined — exposing in-memory '
            + 'list via chart-of-accounts-service.getChartOfAccounts() only. '
            + 'DBA must add the model + migration before this seed performs '
            + 'any DB I/O.',
        );
        for (const row of CHART_OF_ACCOUNTS) {
            console.log(`    ${row.code.padEnd(10)} ${row.type.padEnd(10)} ${row.name}`);
        }
        return;
    }
    console.log(`  Seeded ${result.seeded} account(s) (idempotent upsert).`);
    for (const code of result.accounts || []) {
        console.log(`    upserted ${code}`);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
