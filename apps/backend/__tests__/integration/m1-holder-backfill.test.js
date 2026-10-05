/**
 * M1 (2026-08-15) — the backfill of migration 20260815100000_certificate_holder_expand
 * must leave no certificate row without a holder. This asserts the post-migration
 * state against a REAL Postgres; skips cleanly without DATABASE_URL, so a green
 * local run is NOT evidence of DB behaviour (plan Global Constraints — staging only).
 */

const { PrismaClient } = require('@prisma/client');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('M1 holder backfill (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        if (prisma) { await prisma.$disconnect(); }
    });

    it('leaves no certificate row with NULL holderDisplayName/submittedByUserId/holderType', async () => {
        const [row] = await prisma.$queryRaw`
      SELECT COUNT(*) FILTER (WHERE "holderDisplayName" IS NULL) AS holder_null,
             COUNT(*) FILTER (WHERE "submittedByUserId" IS NULL) AS submitter_null,
             COUNT(*) FILTER (WHERE "holderType" IS NULL) AS type_null,
             COUNT(*) FILTER (WHERE "holderType" = 'LEGACY_PERSON') AS legacy_person,
             COUNT(*) AS total FROM "certificates"`;
        expect(Number(row.holder_null)).toBe(0);
        expect(Number(row.submitter_null)).toBe(0);
        expect(Number(row.type_null)).toBe(0);
        // legacy_person + total ไม่ assert ค่า — พิมพ์ลง evidence ตาม AC5
        console.log(`M1-BACKFILL-EVIDENCE total=${row.total} legacy_person=${row.legacy_person}`);
    });
});
