'use strict';

/**
 * ลักษณะพื้นที่ is a CHECKBOX ROW, and the papers hang off the ticks.
 *
 * กทล.1 ส่วนที่ ๒ (reports/research/2026-09-01-dtam-application-baseline/facts.md:22) prints
 * ☐ กลางแจ้ง ☐ อาคาร/โรงเรือนระบบปิด ☐ โรงเรือนทั่วไป ☐ อื่น ๆ ระบุ, and ส่วนที่ ๓ ties
 * A4 แบบแปลนอาคาร to Indoor/Greenhouse and A4' ภาพถ่ายแปลงและบริเวณโดยรอบ to Outdoor
 * (facts.md:38-39). A greenhouse standing on one corner of an open field is two ticks and
 * two papers.
 *
 * The lens used to reduce the ticks to the MOST CONTROLLED one before asking the register,
 * on the argument that erring toward stricter law "cannot under-ask". The live register
 * falsifies that: the three areaType rows demand DISJOINT slots, so climbing to GREENHOUSE
 * does not add the building plan on top of the field photographs — it throws the field
 * photographs away. A farm ticking กลางแจ้ง + โรงเรือน was told it was ครบ while missing A4'.
 */

const { buildHerbRuleRows } = require('../../scripts/seed-herb-requirement-rules');

const mockRulesAt = jest.fn();
const mockPlantCodes = jest.fn();
jest.mock('../../services/requirement-rule-service', () => ({
    rulesAt: (...args) => mockRulesAt(...args),
    plantCodesWithRulesAt: (...args) => mockPlantCodes(...args),
    RULE_DIMENSIONS: {
        landTenure: ['OWNED', 'STATE_PERMITTED', 'RENTED'],
        areaType: ['OUTDOOR', 'GREENHOUSE', 'INDOOR'],
        certScope: ['PLANTING', 'PROCESSING'],
    },
}));
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const {
    resolveApplicationRequirements,
    deriveDimensions,
} = require('../../services/application-requirements-service');

const ALL_ROWS = buildHerbRuleRows('cannabis', { effectiveFrom: '2026-09-02T00:00:00Z' })
    .map((row, index) => ({ id: `rule-${index}`, ...row }));

/** rulesAt's real semantics, now including a set-valued ask: NULL column = every value. */
function rulesFor(asked) {
    const matches = (column, stored) => {
        const wanted = asked[column] === undefined ? null : asked[column];
        if (stored === null || stored === undefined) { return true; }
        if (Array.isArray(wanted)) { return wanted.includes(stored); }
        return wanted === null ? false : wanted === stored;
    };
    return ALL_ROWS.filter((row) => (
        matches('holderType', row.holderType)
        && matches('requestType', row.requestType)
        && matches('plantCode', row.plantCode)
        && matches('landTenure', row.landTenure)
        && matches('areaType', row.areaType)
        && matches('certScope', row.certScope)
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRulesAt.mockImplementation(async (asked) => rulesFor(asked));
    mockPlantCodes.mockResolvedValue(['cannabis']);
});

function individualNew(formData = {}) {
    return {
        id: 'app-ticks',
        entity: { type: 'INDIVIDUAL' },
        formData: { plantId: 'cannabis', requestType: 'NEW', certScope: 'PLANTING', ...formData },
    };
}

const requiredOf = (payload) => payload.slots.filter((s) => s.required).map((s) => s.slotId).sort();

describe('a filing may tick several ลักษณะพื้นที่, and owes the papers of every tick', () => {
    test('กลางแจ้ง + โรงเรือน owes BOTH the field photographs and the building plan', async () => {
        const payload = await resolveApplicationRequirements(
            individualNew({ cultivationMethods: ['outdoor', 'greenhouse'] }), [],
        );
        expect(requiredOf(payload)).toEqual(expect.arrayContaining([
            'field_surround_photos', 'building_plan_photos',
        ]));
    });

    test('the paper that used to go missing is named, so this cannot regress quietly', async () => {
        const payload = await resolveApplicationRequirements(
            individualNew({ cultivationMethods: ['outdoor', 'greenhouse'] }), [],
        );
        // Before 2026-09-05 this filing reported complete:true with A4' never asked for.
        expect(payload.missingRequired).toContain('field_surround_photos');
        expect(payload.complete).toBe(false);
    });

    test('each slot still says WHY it is asked for — one tick per reason, not one reason per filing', async () => {
        const payload = await resolveApplicationRequirements(
            individualNew({ cultivationMethods: ['outdoor', 'indoor'] }), [],
        );
        const reason = (id) => payload.slots.find((s) => s.slotId === id)?.requiredReason;
        expect(reason('field_surround_photos')).toBe('OUTDOOR');
        expect(reason('building_plan_photos')).toBe('INDOOR');
    });

    test('the register is asked ONE question carrying every tick, not one question per tick', async () => {
        await resolveApplicationRequirements(
            individualNew({ cultivationMethods: ['outdoor', 'greenhouse', 'indoor'] }), [],
        );
        expect(mockRulesAt).toHaveBeenCalledTimes(1);
        expect(mockRulesAt.mock.calls[0][0].areaType).toEqual(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
    });

    test('a single tick asks its own papers — the planting licence is optional, not owed', async () => {
        // controlled_herb_license bound the PLANTING scope from 2026-09-06 and stopped on
        // 2026-10-05 (operator: never ask for a paper the law does not require — there is
        // no cannabis planting licence in force). It is shown as optional, never required.
        const payload = await resolveApplicationRequirements(
            individualNew({ cultivationMethods: ['outdoor'] }), [],
        );
        expect(requiredOf(payload)).toEqual([
            'field_surround_photos', 'id_house_reg', 'land_rights', 'producer_supervision_letter',
            'production_util_plan', 'security_residue_plan', 'site_map_coords', 'site_photos',
            'sop_manual',
        ]);
    });
});

describe('what the filing says about how it grows is read from everywhere it says it', () => {
    test('the plots are ticks too — a filing whose plots differ owes every plot’s papers', async () => {
        const dims = deriveDimensions(individualNew({
            plots: [{ solarSystem: 'OUTDOOR' }, { solarSystem: 'GREENHOUSE' }],
        }));
        expect(dims.areaTypes).toEqual(['OUTDOOR', 'GREENHOUSE']);
    });

    test('the order is the vocabulary’s, so the stamped snapshot is byte-stable', async () => {
        const a = deriveDimensions(individualNew({ cultivationMethods: ['greenhouse', 'outdoor'] }));
        const b = deriveDimensions(individualNew({ cultivationMethods: ['outdoor', 'greenhouse'] }));
        expect(a.areaTypes).toEqual(b.areaTypes);
        expect(a.areaTypes).toEqual(['OUTDOOR', 'GREENHOUSE']);
    });

    test('a filing that says nothing about how it grows falls back to its stated single value', async () => {
        const dims = deriveDimensions({
            id: 'legacy', entity: { type: 'INDIVIDUAL' }, areaType: 'GREENHOUSE',
            formData: { plantId: 'cannabis' },
        });
        expect(dims.areaTypes).toEqual(['GREENHOUSE']);
    });

    test('a filing that says nothing at all is judged by the rules that bind everybody', async () => {
        const dims = deriveDimensions({ id: 'blank', entity: { type: 'INDIVIDUAL' }, formData: { plantId: 'cannabis' } });
        expect(dims.areaTypes).toEqual([]);
    });

    test('the site step owns the answer: farmData.areaTypes wins over every legacy source', async () => {
        // cultivationMethods is the MONEY declaration (modules/billing fee-service bills
        // per method). Once the filing states ลักษณะพื้นที่ in its own field, the invoice
        // and the law are allowed to say different things.
        const dims = deriveDimensions(individualNew({
            farmData: { areaTypes: ['GREENHOUSE'] },
            cultivationMethods: ['outdoor', 'indoor'],
            plots: [{ solarSystem: 'OUTDOOR' }],
        }));
        expect(dims.areaTypes).toEqual(['GREENHOUSE']);
    });

    test('คำที่ไม่อยู่ในทะเบียนสามคำ ไม่ใช่ติ๊ก — รวมถึง OTHER ที่ถูกถอดออก 2026-09-11', async () => {
        // operator: "เรามีแค่ 3 อย่างนะ" · ☐ อื่น ๆ ระบุ ถูกถอดทั้งจากจอ จากทะเบียน
        // และจากใบที่ระบบพิมพ์ · คำที่ทะเบียนไม่รู้จักถูกกรองทิ้ง = เงียบ = wildcard
        // ซึ่งเป็นพฤติกรรมเดิมของคำแปลกอยู่แล้ว ไม่ใช่สาขาใหม่
        const dims = deriveDimensions(individualNew({
            farmData: { areaTypes: ['OTHER'] },
        }));
        expect(dims.areaTypes).toEqual([]);
    });

    test('one slot demanded by two ticks explains itself the same way every time', async () => {
        // building_plan_photos is filed twice, once for INDOOR and once for GREENHOUSE.
        // The badge a farmer reads must not depend on the order the database returned, so
        // the register is made to answer in the reverse order here: first-row-wins would
        // read INDOOR, the vocabulary order reads GREENHOUSE, and only one of those is
        // the same answer twice.
        //
        // ลำดับทะเบียนเปลี่ยนเป็น OUTDOOR / GREENHOUSE / INDOOR เมื่อ 2026-09-11 ให้ตรงกับ
        // ลำดับที่ผู้ยื่นเห็นบนจอ — คำตอบที่คงที่จึงเป็น GREENHOUSE ไม่ใช่ INDOOR
        // คุณสมบัติที่ข้อนี้ตรึงไม่เปลี่ยน: ป้ายต้องไม่ขึ้นกับลำดับแถวที่ฐานคืนมา
        mockRulesAt.mockImplementation(async (asked) => rulesFor(asked).slice().reverse());
        const payload = await resolveApplicationRequirements(
            individualNew({ cultivationMethods: ['greenhouse', 'indoor'] }), [],
        );
        expect(payload.slots.find((s) => s.slotId === 'building_plan_photos').requiredReason)
            .toBe('GREENHOUSE');
    });

    // Review finding 1 (HIGH). The wizard is not asking the farmer for the plot's
    // ประเภทพื้นที่ in the general case: farm-info-step.tsx:253 creates แปลงที่ 1 with a
    // hardcoded 'OUTDOOR', and farm-info-plots-land-sections.tsx:145 DISABLES the select
    // whenever the ticks leave only one option. So an indoor-only farm carries
    // plots:[{solarSystem:'OUTDOOR'}] that nobody chose and nobody can change. Unioning
    // that in demanded ภาพถ่ายแปลงและบริเวณโดยรอบ from a farm with no open field, and the
    // submit gate would refuse the filing forever. The plots are a FALLBACK, not a tick.
    test('a default the farmer never chose is not a tick — the plots answer only when nothing else does', async () => {
        const dims = deriveDimensions(individualNew({
            cultivationMethods: ['indoor'],
            plots: [{ solarSystem: 'OUTDOOR' }],
        }));
        expect(dims.areaTypes).toEqual(['INDOOR']);
    });

    test('a filing with no method list is still read from its plots', async () => {
        const dims = deriveDimensions(individualNew({
            plots: [{ solarSystem: 'GREENHOUSE' }, { solarSystem: 'INDOOR' }],
        }));
        expect(dims.areaTypes).toEqual(['GREENHOUSE', 'INDOOR']);
    });

    // Review finding 6. The comment says the site step's answer wins outright; the code
    // said it wins only if at least one word survived mapping.
    test('the site step owns the answer even when its words are unusable', async () => {
        const dims = deriveDimensions(individualNew({
            farmData: { areaTypes: ['hydroponic'] },
            cultivationMethods: ['outdoor'],
        }));
        expect(dims.areaTypes).toEqual([]);
    });

    // Review finding 5. The tie-break exists for two AREA rows demanding one slot. It must
    // not outrank a reason from another dimension: a paper demanded because the land is
    // rented has to keep saying so.
    /**
     * Review layer 2, finding C4. The original case fed the rows RENTED-first, which is
     * the one order the guard never has to act on — first-row-wins already answers
     * 'RENTED' there, so the test passed against the naive implementation it was written
     * to pin. The tie-break exists because "the badge a farmer reads must not depend on
     * the order the database happened to return", so BOTH orders are the test.
     */
    test.each([
        ['rented row first', [
            { id: 'r-rent', slotId: 'land_rights', isRequired: true, landTenure: 'RENTED' },
            { id: 'r-out', slotId: 'land_rights', isRequired: true, areaType: 'OUTDOOR' },
        ]],
        ['area row first', [
            { id: 'r-out', slotId: 'land_rights', isRequired: true, areaType: 'OUTDOOR' },
            { id: 'r-rent', slotId: 'land_rights', isRequired: true, landTenure: 'RENTED' },
        ]],
    ])('the area tie-break never overrides a reason from another dimension (%s)', async (_name, rows) => {
        mockRulesAt.mockImplementation(async () => rows);
        const payload = await resolveApplicationRequirements(
            individualNew({ cultivationMethods: ['outdoor'], farmData: { landOwnership: 'RENT' } }), [],
        );
        expect(payload.slots.find((s) => s.slotId === 'land_rights').requiredReason).toBe('RENTED');
    });

    test('a spelling the platform does not know is dropped, never guessed into a tick', async () => {
        const dims = deriveDimensions(individualNew({ cultivationMethods: ['outdoor', 'hydroponic'] }));
        expect(dims.areaTypes).toEqual(['OUTDOOR']);
    });
});
