'use strict';

/**
 * F-QA-05 — the register's law is dated by DAY, and the read has to honour the day.
 *
 * Operator ruling G2, verbatim (prisma/schema/requirement-rule.prisma:5-7):
 *   "รายการเอกสารบังคับ = ข้อมูลในฐานข้อมูล มีผลตามวันที่ ... คำขอถูกตัดสินด้วยชุดกติกา ณ วันยื่น"
 * — as of the DAY of filing. Every writer stores that day as a midnight
 * (`--effective-from=2026-09-07T00:00:00Z`, admin bodies, the M2a migration), and a
 * midnight written in UTC is 07:00 in Bangkok. So a rule announced for วันที่ 7
 * did not bind any filing made between 00:00 and 07:00 ICT on วันที่ 7: seven
 * identity rules approved by the operator (2a7ab531) were filed for 2026-09-07 and
 * a live resolve on the morning of 2026-09-07 still answered with the law of the 6th.
 *
 * WHY THIS SUITE NEEDS A REAL POSTGRES, when three unit suites already cover the
 * lens: they all hand the lens a fixture ROW SET (requirements-door.test.js:38-49
 * mocks rulesAt outright), so the where-clause that decides which rows are in force
 * is the one thing they cannot see. This defect lived entirely in that clause.
 *
 * The rows below are the suite's OWN law, filed under plant slugs the register
 * carries no rules for (kratom / turmeric) and read by an INDIVIDUAL filing, so the
 * assertions do not move when the ministry files another cannabis rule and do not
 * depend on which register the machine happens to hold. They are written with the
 * prisma client directly rather than through createRule: the subject here is the
 * READ door, and createRule would also write an audit row this suite would then
 * have to clean out of an append-only table.
 *
 * Skips cleanly with no database (test-support/test-database.js), so a green local
 * run without Postgres is NOT evidence — the suite names the reason in its title.
 */

const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
const { rulesAt } = require('../../services/requirement-rule-service');
const { resolveApplicationRequirements } = require('../../services/application-requirements-service');

/** Provenance stamp that makes every row this suite files findable and removable. */
const TEST_ACTOR = 'test-f-qa-05-as-of-filing-day';

/** The day the ministry announced. Stored the way every writer stores a day. */
const ANNOUNCED_DAY_MIDNIGHT_UTC = new Date('2026-09-07T00:00:00.000Z');
/** 01:30 ICT on the announced day — a farmer filing in its first hours. */
const EARLY_ON_ANNOUNCED_DAY = new Date('2026-09-06T18:30:00.000Z');
/** 23:00 ICT on the day BEFORE — the law must not have started yet. */
const LATE_ON_PREVIOUS_DAY = new Date('2026-09-06T16:00:00.000Z');
/** 10:00 ICT on the announced day: when the retired rule below was closed. */
const CLOSED_AT = new Date('2026-09-07T03:00:00.000Z');
/** 11:00 ICT — one hour after that closing. */
const AFTER_THE_CLOSING = new Date('2026-09-07T04:00:00.000Z');

const KRATOM = 'kratom';
const TURMERIC = 'turmeric';

/** The suite's own ส่วนที่ ๓, one row per sentence of law. */
const ROWS = [
    { slotId: 'id_house_reg', requestType: 'NEW', plantCode: KRATOM },
    { slotId: 'id_house_reg', requestType: 'RENEWAL', plantCode: KRATOM },
    { slotId: 'id_house_reg', requestType: 'REPLACEMENT', plantCode: KRATOM },
    { slotId: 'land_rights', requestType: 'NEW', plantCode: KRATOM },
    { slotId: 'prev_cert_original', requestType: 'RENEWAL', plantCode: KRATOM },
    { slotId: 'police_report', requestType: 'REPLACEMENT', plantCode: KRATOM },
    { slotId: 'damaged_cert', requestType: 'REPLACEMENT', plantCode: KRATOM },
    // A rule that started on the announced day and was RETIRED at 10:00 ICT the
    // same day. Its own plant, so it never joins the kratom sets above.
    {
        slotId: 'sop_manual',
        requestType: 'NEW',
        plantCode: TURMERIC,
        effectiveTo: CLOSED_AT,
        closedBy: TEST_ACTOR,
        closedAt: CLOSED_AT,
    },
];

/** An INDIVIDUAL filing, so the two plant-agnostic M2a rows (JURISTIC / COMMUNITY_ENTERPRISE) never bind. */
function filing(requestType, plantId = KRATOM) {
    return {
        id: `f-qa-05-${requestType.toLowerCase()}`,
        entity: { type: 'INDIVIDUAL' },
        formData: {
            plantId,
            requestType,
            certScope: 'PLANTING',
            farmData: { areaTypes: ['OUTDOOR'], landOwnership: 'OWNED' },
        },
    };
}

const requiredSlots = (payload) => payload.slots
    .filter((slot) => slot.required)
    .map((slot) => slot.slotId)
    .sort();

d('requirement rules are read as of the FILING DAY in Asia/Bangkok (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        // A previous aborted run must not leave law behind that this one would read.
        await prisma.requirementRule.deleteMany({ where: { createdBy: TEST_ACTOR } });
        await prisma.requirementRule.createMany({
            data: ROWS.map((row) => ({
                ...row,
                isRequired: true,
                effectiveFrom: ANNOUNCED_DAY_MIDNIGHT_UTC,
                createdBy: TEST_ACTOR,
                reason: 'F-QA-05 regression suite',
            })),
        });
    });

    afterAll(async () => {
        if (!prisma) { return; }
        await prisma.requirementRule.deleteMany({ where: { createdBy: TEST_ACTOR } });
        await prisma.$disconnect();
    });

    describe('rulesAt', () => {
        it('returns law announced for today to a filing made in the first hours of today', async () => {
            const rows = await rulesAt({
                at: EARLY_ON_ANNOUNCED_DAY,
                holderType: 'INDIVIDUAL',
                requestType: 'REPLACEMENT',
                plantCode: KRATOM,
                landTenure: 'OWNED',
                areaType: ['OUTDOOR'],
                certScope: 'PLANTING',
            }, prisma);

            expect(rows.map((row) => row.slotId).sort())
                .toEqual(['damaged_cert', 'id_house_reg', 'police_report']);
            // and the request-type dimension still filters: no NEW / RENEWAL row rode in
            expect(rows.every((row) => row.requestType === 'REPLACEMENT')).toBe(true);
        });

        it('does NOT return it to a filing made the day before, at 23:00 ICT', async () => {
            const rows = await rulesAt({
                at: LATE_ON_PREVIOUS_DAY,
                holderType: 'INDIVIDUAL',
                requestType: 'REPLACEMENT',
                plantCode: KRATOM,
                landTenure: 'OWNED',
                areaType: ['OUTDOOR'],
                certScope: 'PLANTING',
            }, prisma);

            expect(rows).toEqual([]);
        });

        it('stops returning a rule at the INSTANT it was closed, not at the end of its day', async () => {
            const ask = (at) => rulesAt({
                at,
                holderType: 'INDIVIDUAL',
                requestType: 'NEW',
                plantCode: TURMERIC,
                landTenure: 'OWNED',
                areaType: ['OUTDOOR'],
                certScope: 'PLANTING',
            }, prisma);

            expect((await ask(EARLY_ON_ANNOUNCED_DAY)).map((row) => row.slotId)).toEqual(['sop_manual']);
            // Retiring a rule takes effect at once — the day-granular reading is the
            // START of law only. A rule closed at 10:00 must not bind an 11:00 filing.
            expect(await ask(AFTER_THE_CLOSING)).toEqual([]);
        });
    });

    describe('the one lens, over the same rows', () => {
        it('gives a NEW filing exactly the NEW set', async () => {
            const payload = await resolveApplicationRequirements(filing('NEW'), [], {
                at: EARLY_ON_ANNOUNCED_DAY,
                client: prisma,
            });

            expect(payload.blockingIssues).toEqual([]);
            expect(requiredSlots(payload)).toEqual(['id_house_reg', 'land_rights']);
        });

        it('gives a RENEWAL the renewal paper AND the identity paper', async () => {
            const payload = await resolveApplicationRequirements(filing('RENEWAL'), [], {
                at: EARLY_ON_ANNOUNCED_DAY,
                client: prisma,
            });

            expect(payload.blockingIssues).toEqual([]);
            expect(requiredSlots(payload)).toEqual(['id_house_reg', 'prev_cert_original']);
        });

        it('gives a REPLACEMENT the identity paper and the either/or pair, and nothing from the NEW set', async () => {
            const payload = await resolveApplicationRequirements(filing('REPLACEMENT'), [], {
                at: EARLY_ON_ANNOUNCED_DAY,
                client: prisma,
            });

            expect(payload.blockingIssues).toEqual([]);
            expect(requiredSlots(payload)).toEqual(['id_house_reg']);
            // the pair is ONE demand, carried on requiredSlotIds and offered as two
            // slots neither of which is required on its own
            expect(payload.requiredSlotIds).toContain('police_report|damaged_cert');
            expect(payload.missingRequired.sort())
                .toEqual(['id_house_reg', 'police_report|damaged_cert']);
            expect(requiredSlots(payload)).not.toContain('land_rights');
        });
    });
});
