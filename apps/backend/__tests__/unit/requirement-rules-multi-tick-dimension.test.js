'use strict';

/**
 * A filing may answer a case dimension with SEVERAL words at once.
 *
 * กทล.1 ส่วนที่ ๒ prints ลักษณะพื้นที่ as four checkboxes — ☐ กลางแจ้ง ☐ อาคาร/โรงเรือน
 * ระบบปิด ☐ โรงเรือนทั่วไป ☐ อื่น ๆ ระบุ (reports/research/2026-09-01-dtam-application-
 * baseline/facts.md:22) — and the attachments hang off the ticks: A4 แบบแปลนอาคาร for
 * Indoor/Greenhouse, A4' ภาพถ่ายแปลงและบริเวณโดยรอบ for Outdoor. A farm with a greenhouse
 * on one corner of an open field ticks two boxes and owes BOTH papers.
 *
 * The reader therefore has to be able to ask for several words on one dimension. It is the
 * READER only: a rule ROW still states one word, because one row is one sentence of law.
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: { requirementRule: { findMany: jest.fn(), create: jest.fn(), groupBy: jest.fn() } },
}));
const { prisma } = require('../../services/prisma-database');
const { rulesAt, plantCodesWithRulesAt } = require('../../services/requirement-rule-service');

const AT = new Date('2026-09-02T00:00:00Z');

function whereOfLastFindMany() {
    const calls = prisma.requirementRule.findMany.mock.calls;
    return calls[calls.length - 1][0].where;
}

describe('rulesAt — a dimension answered with several words', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prisma.requirementRule.findMany.mockResolvedValue([]);
    });

    it('asks for every ticked value in ONE query, keeping NULL as the wildcard', async () => {
        await rulesAt({ at: AT, areaType: ['OUTDOOR', 'GREENHOUSE'] });
        expect(whereOfLastFindMany().AND).toEqual(expect.arrayContaining([
            { OR: [{ areaType: null }, { areaType: { in: ['OUTDOOR', 'GREENHOUSE'] } }] },
        ]));
    });

    it('one query, not one per tick — the stamped snapshot stays a single ordered list', async () => {
        await rulesAt({ at: AT, areaType: ['OUTDOOR', 'GREENHOUSE', 'INDOOR'] });
        expect(prisma.requirementRule.findMany).toHaveBeenCalledTimes(1);
    });

    it('a one-element list asks exactly what the bare word asks', async () => {
        await rulesAt({ at: AT, areaType: ['INDOOR'] });
        expect(whereOfLastFindMany().AND).toEqual(expect.arrayContaining([
            { OR: [{ areaType: null }, { areaType: 'INDOOR' }] },
        ]));
    });

    it('duplicates and blank ticks collapse — the same law is not asked for twice', async () => {
        await rulesAt({ at: AT, areaType: ['OUTDOOR', ' OUTDOOR ', '', null, 'GREENHOUSE'] });
        expect(whereOfLastFindMany().AND).toEqual(expect.arrayContaining([
            { OR: [{ areaType: null }, { areaType: { in: ['OUTDOOR', 'GREENHOUSE'] } }] },
        ]));
    });

    it('an empty list means the filing said nothing, which is what NULL already means', async () => {
        await rulesAt({ at: AT, areaType: [] });
        expect(whereOfLastFindMany().AND).toEqual(expect.arrayContaining([{ areaType: null }]));
    });

    // The refusal is the whole reason the closed vocabulary exists: a word that is not law
    // would quietly match only the wildcard rows, and the paper it should have demanded
    // would never be asked for. One bad tick refuses the whole question.
    it('refuses the whole ask when ANY ticked word is outside the vocabulary', async () => {
        await expect(rulesAt({ at: AT, areaType: ['OUTDOOR', 'GLASSHOUSE'] }))
            .rejects.toMatchObject({ code: 'INVALID_RULE_DIMENSION' });
        expect(prisma.requirementRule.findMany).not.toHaveBeenCalled();
    });

    it('the same set support exists on the other two case dimensions', async () => {
        await rulesAt({ at: AT, landTenure: ['OWNED', 'RENTED'], certScope: ['PLANTING', 'PROCESSING'] });
        expect(whereOfLastFindMany().AND).toEqual(expect.arrayContaining([
            { OR: [{ landTenure: null }, { landTenure: { in: ['OWNED', 'RENTED'] } }] },
            { OR: [{ certScope: null }, { certScope: { in: ['PLANTING', 'PROCESSING'] } }] },
        ]));
    });
});

describe('plantCodesWithRulesAt — which plants the register actually holds law for', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns the distinct plants with an open rule at that instant', async () => {
        prisma.requirementRule.findMany.mockResolvedValue([
            { plantCode: 'cannabis' }, { plantCode: 'cannabis' }, { plantCode: 'kratom' },
        ]);
        await expect(plantCodesWithRulesAt({ at: AT })).resolves.toEqual(['cannabis', 'kratom']);
    });

    // A rule with plantCode NULL binds every plant, which is not the same as being law FOR
    // a plant: today the two NULL rows are company_reg and community_cert, and neither says
    // anything about กัญชา. Counting them as "kratom has law" is how a kratom filing ends up
    // judged by two company papers and nothing else.
    it('a plant-agnostic rule is not law for any particular plant', async () => {
        prisma.requirementRule.findMany.mockResolvedValue([
            { plantCode: null }, { plantCode: 'cannabis' },
        ]);
        await expect(plantCodesWithRulesAt({ at: AT })).resolves.toEqual(['cannabis']);
    });

    // Review finding 8. "Law that demands nothing" is law on the books, but it is not a
    // document list: a plant whose only open rows are isRequired:false would be reported
    // as open, the lens would skip the refusal, and the filing would be told it needs
    // nothing — the same hole this function exists to close, one level deeper.
    it('a rule that demands nothing is not a document list for its plant', async () => {
        prisma.requirementRule.findMany.mockResolvedValue([]);
        await plantCodesWithRulesAt({ at: AT });
        expect(whereOfLastFindMany()).toMatchObject({ isRequired: true });
    });

    // The window is the SAME one rulesAt uses, and it has two different edges on
    // purpose (requirement-rule-service.js asOfFilingDayEnd): law STARTS by the
    // Thai calendar day it was announced for — "คำขอถูกตัดสินด้วยชุดกติกา ณ วันยื่น"
    // — and STOPS at the instant it was retired. Asked with the raw instant on
    // both edges, a plant whose law starts today was reported as having none for
    // the first seven hours of that day, and the lens then refused the filing as
    // unjudgeable while the rules that judge it sat in the table (F-QA-05).
    it('asks for the law of the FILING DAY, and only for rules not yet retired at that instant', async () => {
        prisma.requirementRule.findMany.mockResolvedValue([]);
        await plantCodesWithRulesAt({ at: AT });
        const where = whereOfLastFindMany();
        // 2026-09-02T00:00:00Z is 07:00 ICT; the Thai day it falls in ends at 16:59:59.999Z
        expect(where.effectiveFrom).toEqual({ lte: new Date('2026-09-02T16:59:59.999Z') });
        expect(where.AND).toEqual(expect.arrayContaining([
            { OR: [{ effectiveTo: null }, { effectiveTo: { gt: AT } }] },
        ]));
    });
});
