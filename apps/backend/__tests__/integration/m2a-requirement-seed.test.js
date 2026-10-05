/**
 * M2a Task 1 — the two founding document rules must exist as DATA after
 * migration 20260815200000_requirement_rules (spec §3 "seed ชุดแรก": JURISTIC →
 * COMPANY_REG, COMMUNITY_ENTERPRISE → COMMUNITY_CERT; INDIVIDUAL gets nothing
 * extra).
 *
 * The rows are addressed by FIXED ids, not by shape: a fixed id is what makes
 * the seed re-runnable (ON CONFLICT ("id") DO NOTHING) and what lets a later
 * migration or an admin close exactly this rule instead of guessing which row
 * the ministry meant.
 *
 * Runs against a REAL Postgres and skips cleanly without DATABASE_URL, so a
 * green local run is NOT evidence of DB behaviour — the DB-side claim stays
 * PENDING(staging) (plan Global Constraints; spec AC8 / M1 AC5 convention).
 */

const { PrismaClient } = require('@prisma/client');
const {
    getCanonicalSlotId,
    buildUploadedSlotSet,
} = require('../../routes/api/applications/validation-slot-utils');

const SEED_JURISTIC_ID = 'm2a-seed-juristic-company-reg';
const SEED_COMMUNITY_ID = 'm2a-seed-community-cert';

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('M2a requirement_rules seed (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        if (prisma) { await prisma.$disconnect(); }
    });

    it('carries both founding rules, each reachable by its fixed id', async () => {
        const rows = await prisma.requirementRule.findMany({
            where: { id: { in: [SEED_JURISTIC_ID, SEED_COMMUNITY_ID] } },
            orderBy: { id: 'asc' },
        });

        expect(rows.map((r) => r.id)).toEqual([SEED_COMMUNITY_ID, SEED_JURISTIC_ID]);
    });

    it('binds each holder type to its slot, in canonical form, on every dimension left open', async () => {
        const juristic = await prisma.requirementRule.findUnique({ where: { id: SEED_JURISTIC_ID } });
        const community = await prisma.requirementRule.findUnique({ where: { id: SEED_COMMUNITY_ID } });

        expect(juristic.holderType).toBe('JURISTIC');
        expect(juristic.slotId).toBe('company_reg');
        expect(community.holderType).toBe('COMMUNITY_ENTERPRISE');
        expect(community.slotId).toBe('community_cert');

        // "stored canonical" was the assertion here until the กทล.1 v2 fold
        // (spec 2026-09-01) moved the canon out from under both rows. These two
        // were written by an APPLIED, frozen migration and requirement_rules is
        // append-only, so neither can be rewritten — T3 files the กทล.1 law under
        // the v2 slots and CLOSES these two, and that has to land in the same
        // batch as the fold.
        //
        // Named concretely, because these two ids are exactly what T3 has to
        // close: a fixed-point check would pass for any string (both sides run the
        // same fold) and is already covered by upload-slot-canonicalisation.
        expect(getCanonicalSlotId(juristic.slotId)).toBe('juristic_reg_6m');
        expect(getCanonicalSlotId(community.slotId)).toBe('community_reg_members');
        // And what the old assertion was really defending: the rule and the
        // applicant's upload still MEET at one id, so a document already on file
        // under the seed's own spelling keeps counting
        // (application-document-requirements.js:140,:148 canonicalise both sides).
        expect(buildUploadedSlotSet([{ slotId: 'company_reg' }]).has('juristic_reg_6m')).toBe(true);
        expect(buildUploadedSlotSet([{ slotId: 'community_cert' }]).has('community_reg_members')).toBe(true);

        for (const row of [juristic, community]) {
            // null dimension = every value of that dimension (plan Interfaces)
            expect(row.requestType).toBeNull();
            expect(row.plantCode).toBeNull();
            expect(row.isRequired).toBe(true);
            expect(row.maxDocumentAgeMonths).toBe(6);
            // still in force: open-ended and un-closed
            expect(row.effectiveTo).toBeNull();
            expect(row.closedAt).toBeNull();
            expect(row.closedBy).toBeNull();
            expect(row.effectiveFrom.toISOString()).toBe('2026-08-15T00:00:00.000Z');
            expect(row.createdBy).toBe('SYSTEM-M2A-SEED');
        }
    });

    it('survives a re-run of its own seed statement without duplicating or rewriting the rule', async () => {
        const before = await prisma.requirementRule.findUnique({ where: { id: SEED_JURISTIC_ID } });

        // the migration's own INSERT, replayed: ON CONFLICT ("id") DO NOTHING
        // must make this a no-op instead of a primary-key error or an overwrite
        await prisma.$executeRaw`
      INSERT INTO "requirement_rules" ("id","holderType","requestType","plantCode","slotId","isRequired","maxDocumentAgeMonths","effectiveFrom","effectiveTo","createdBy","reason","createdAt")
      VALUES (${SEED_JURISTIC_ID}, 'JURISTIC', NULL, NULL, 'company_reg', TRUE, 6, '2026-08-15T00:00:00Z'::timestamp, NULL, 'SYSTEM-M2A-SEED', 'replay guard', NOW())
      ON CONFLICT ("id") DO NOTHING`;

        const after = await prisma.requirementRule.findUnique({ where: { id: SEED_JURISTIC_ID } });
        const count = await prisma.requirementRule.count({ where: { id: SEED_JURISTIC_ID } });

        expect(count).toBe(1);
        expect(after.reason).toBe(before.reason);
        expect(after.createdAt.toISOString()).toBe(before.createdAt.toISOString());
    });
});
