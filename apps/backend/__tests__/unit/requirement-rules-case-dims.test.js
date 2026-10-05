'use strict';
jest.mock('../../services/prisma-database', () => ({ prisma: { requirementRule: { findMany: jest.fn(), create: jest.fn() } } }));
const { prisma } = require('../../services/prisma-database');
const { rulesAt, createRule, RULE_DIMENSIONS } = require('../../services/requirement-rule-service');

describe('requirement rules — กทล.1 case dimensions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rulesAt filters landTenure/areaType/certScope with NULL-as-wildcard', async () => {
    prisma.requirementRule.findMany.mockResolvedValue([]);
    await rulesAt({ at: new Date('2026-09-02'), landTenure: 'RENTED', areaType: 'INDOOR', certScope: 'PLANTING' });
    const where = prisma.requirementRule.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([
      { OR: [{ landTenure: null }, { landTenure: 'RENTED' }] },
      { OR: [{ areaType: null }, { areaType: 'INDOOR' }] },
      { OR: [{ certScope: null }, { certScope: 'PLANTING' }] },
    ]));
  });

  it('an unknown dimension value is refused, not silently widened', async () => {
    await expect(createRule({ slotId: 'landlord_consent', effectiveFrom: '2026-09-02', createdBy: 'op', landTenure: 'LEASED' }))
      .rejects.toMatchObject({ code: 'INVALID_RULE_DIMENSION' });
  });

  // review r0 F3 — the READ door is the half where a typo costs an application.
  // A caller (the submit gate's derivation) that says 'LEASE' instead of
  // 'RENTED' would match only NULL-dimension rules: landlord_consent would never
  // be required, the application would submit without the consent letter, and
  // nothing would say so. The write door already refuses this exact class of
  // word; the read door now refuses it with the same code, before any query.
  it('rulesAt refuses a case dimension outside the vocabulary instead of querying for nothing', async () => {
    await expect(rulesAt({ at: new Date('2026-09-02'), landTenure: 'LEASE' }))
      .rejects.toMatchObject({ code: 'INVALID_RULE_DIMENSION' });
    await expect(rulesAt({ at: new Date('2026-09-02'), areaType: 'GLASSHOUSE' }))
      .rejects.toMatchObject({ code: 'INVALID_RULE_DIMENSION' });
    await expect(rulesAt({ at: new Date('2026-09-02'), certScope: 'EXPORT' }))
      .rejects.toMatchObject({ code: 'INVALID_RULE_DIMENSION' });
    expect(prisma.requirementRule.findMany).not.toHaveBeenCalled();
  });

  it('rulesAt reads a padded value as the word it is, not as no match at all', async () => {
    prisma.requirementRule.findMany.mockResolvedValue([]);
    await rulesAt({ at: new Date('2026-09-02'), landTenure: ' RENTED ' });
    const where = prisma.requirementRule.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([
      { OR: [{ landTenure: null }, { landTenure: 'RENTED' }] },
    ]));
  });

  it('a caller that names no case dimension still gets only the rules that bind everyone', async () => {
    prisma.requirementRule.findMany.mockResolvedValue([]);
    await rulesAt({ at: new Date('2026-09-02'), holderType: 'INDIVIDUAL' });
    const where = prisma.requirementRule.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([
      { landTenure: null }, { areaType: null }, { certScope: null },
    ]));
  });

  it('vocabulary is the closed set the spec names', () => {
    expect(RULE_DIMENSIONS.landTenure).toEqual(['OWNED', 'STATE_PERMITTED', 'RENTED']);
    // สามคำ — 'OTHER' ถูกถอดออก 2026-09-11 (operator: "เรามีแค่ 3 อย่างนะ")
    // และลำดับมาจากประตูยื่นซึ่งเป็นแหล่งเดียว ไม่ได้พิมพ์ซ้ำที่นี่
    expect(RULE_DIMENSIONS.areaType).toEqual(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
    expect(RULE_DIMENSIONS.certScope).toEqual(['PLANTING', 'PROCESSING']);
  });
});

describe('the older three dimensions are laundered like the new three', () => {
    it('a padded holderType still asks for the rules written for that holder', async () => {
        prisma.requirementRule.findMany.mockResolvedValue([]);
        await rulesAt({ at: new Date('2026-09-02'), holderType: 'JURISTIC ', requestType: ' NEW', plantCode: 'cannabis ' });
        const where = prisma.requirementRule.findMany.mock.calls[0][0].where;
        expect(where.AND).toEqual(expect.arrayContaining([
            { OR: [{ holderType: null }, { holderType: 'JURISTIC' }] },
            { OR: [{ requestType: null }, { requestType: 'NEW' }] },
            { OR: [{ plantCode: null }, { plantCode: 'cannabis' }] },
        ]));
    });

    it('a whitespace-only dimension is the wildcard, not a search for a blank', async () => {
        prisma.requirementRule.findMany.mockResolvedValue([]);
        await rulesAt({ at: new Date('2026-09-02'), holderType: '   ' });
        const where = prisma.requirementRule.findMany.mock.calls[0][0].where;
        expect(where.AND).toEqual(expect.arrayContaining([{ holderType: null }]));
    });
});
