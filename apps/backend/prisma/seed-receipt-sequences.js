/**
 * Seed: receipt_sequences — per-(issuer, document, year) monotonic counter rows.
 *
 * Batch 16 (2026-05-16) introduced the `ReceiptSequence` table. Batch 16-A
 * (this revision) extended it with structured columns
 * (issuerType, documentType, yearBE, yearAD, nextNumber) for the two-issuer
 * billing flow (DTAM-side / PLATFORM-side).
 *
 * Rows are inserted on first use via `INSERT ... ON CONFLICT DO NOTHING` in
 * the application code, so seeding is NOT strictly required for correctness
 * — but pre-creating them:
 *
 *   1. surfaces the existence of the counter in admin dashboards from day
 *      one (avoids the "empty table" UX);
 *   2. lets monitoring read `nextNumber` without a NULL guard;
 *   3. gives ops a place to set a starting offset if accounting wants the
 *      first receipt of a fresh year to begin at, say, 100 instead of 1.
 *
 * Idempotency:
 *   - Uses `upsert` keyed on the compound unique index
 *     (issuerType, documentType, yearBE, yearAD); empty `update: {}` so
 *     re-running never overwrites a running counter.
 *
 * Year semantics (matches receipt-sequence-service.js + invoice-issuers.js):
 *   - DTAM rows store the Buddhist Era year in `yearBE` and `yearAD=0`.
 *   - PLATFORM rows store the Common Era year in `yearAD` and `yearBE=0`.
 *   - This makes the unique constraint stable across calendars: a (DTAM,
 *     QUOTATION, 2569, 0) row never collides with (PLATFORM, QUOTATION,
 *     0, 2025).
 *
 * Compliance basis: TFRS for NPAEs ch.18 (รายได้), Revenue Code §86/4
 * (ภ.พ.30 sequential tax-invoice numbering).
 */

'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Convert CE year → BE (พ.ศ.) by adding 543.
function toBuddhistYear(ceYear) {
    return ceYear + 543;
}

async function main() {
    console.log('Seeding receipt_sequences...');

    const now = new Date();
    const currentCE = now.getFullYear();
    const currentBE = toBuddhistYear(currentCE);

    // B16-A (2026-05-16): six canonical buckets — three per issuer side.
    // The legacy (prefix, year) shape used by receipt-numbering-service.js
    // is still maintained by ITS seed-receipt-sequences-legacy.js (kept in
    // git history); this file now writes the canonical B16-A shape.
    const SEED_ROWS = [
        // DTAM — state-side document stream (Treasury / กรมบัญชีกลาง).
        // yearBE only; yearAD=0 marks "not applicable for this issuer".
        { issuerType: 'DTAM', documentType: 'QUOTATION',                  yearBE: currentBE, yearAD: 0 },
        { issuerType: 'DTAM', documentType: 'INVOICE',                    yearBE: currentBE, yearAD: 0 },
        { issuerType: 'DTAM', documentType: 'GOVERNMENT_REVENUE_RECEIPT', yearBE: currentBE, yearAD: 0 },
        // PLATFORM — platform-side document stream (VAT-registered entity).
        { issuerType: 'PLATFORM', documentType: 'QUOTATION',         yearBE: 0, yearAD: currentCE },
        { issuerType: 'PLATFORM', documentType: 'INVOICE',           yearBE: 0, yearAD: currentCE },
        { issuerType: 'PLATFORM', documentType: 'FULL_TAX_INVOICE',  yearBE: 0, yearAD: currentCE },
    ];

    for (const row of SEED_ROWS) {
        await prisma.receiptSequence.upsert({
            where: {
                issuerType_documentType_yearBE_yearAD: {
                    issuerType: row.issuerType,
                    documentType: row.documentType,
                    yearBE: row.yearBE,
                    yearAD: row.yearAD,
                },
            },
            // Empty update so we never overwrite a live counter.
            update: {},
            create: {
                issuerType: row.issuerType,
                documentType: row.documentType,
                yearBE: row.yearBE,
                yearAD: row.yearAD,
                nextNumber: 1,
                lastAllocatedAt: now,
            },
        });
        console.log(
            `  ${row.issuerType}/${row.documentType} yearBE=${row.yearBE} yearAD=${row.yearAD} `
            + '(nextNumber starts at 1)',
        );
    }

    // Wave 0 purge: the issuer_bank_accounts seed block was removed with the
    // orphan IssuerBankAccount model (zero production reads — the applicant
    // "where do I transfer" surface reads the BankAccount model instead).
    console.log('B16-A seeding complete.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
