'use strict';

/**
 * An area declaration the platform cannot read is not "a filing with no area".
 *
 * ลักษณะพื้นที่ (กทล.1 ส่วนที่ ๒) decides two papers: แบบแปลนอาคาร (A4) hangs off
 * Indoor/Greenhouse and ภาพถ่ายแปลงและบริเวณโดยรอบ (A4') hangs off Outdoor. The lens asks
 * the register with the set of ticks; an EMPTY set is asked as `areaType: null`, which
 * returns only the rows that bind every area — so both papers vanish from the required
 * list, from missingRequired and from the submit gate, and the filing freezes that
 * reduced answer onto itself as the law its resubmits are judged by.
 *
 * That made an empty declaration a bypass, and `farmData` is the applicant's to write:
 * `stripServerOwnedKeys` removes TOP-LEVEL keys only, so a nested `areaTypes: []` rides
 * straight through /prepare while `cultivationMethods` — the MONEY declaration, printed on
 * the quotation and billed per method — stays honest and unsuspicious.
 *
 * The rule this suite pins: saying something unreadable is a statement, and an
 * unanswerable question earns a refusal, exactly as it does for an undeclared plant.
 * Saying nothing at all anywhere is left alone — Application.areaType is NOT NULL, so
 * true silence means a caller holding a bare formData, never an applicant who erased
 * their answer.
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

/** A filing as it exists in the table: areaType is a NOT NULL column. */
function filing({ formData = {}, farmData, areaType = 'OUTDOOR' } = {}) {
    return {
        id: 'app-area',
        areaType,
        entity: { type: 'INDIVIDUAL' },
        formData: {
            requestType: 'NEW',
            certScope: 'PLANTING',
            plantId: 'cannabis',
            cultivationMethods: ['outdoor'],
            ...(farmData === undefined ? {} : { farmData }),
            ...formData,
        },
    };
}

describe('an area declaration must be readable before it can be judged', () => {
    test('the honest outdoor filing is judged, and is asked for the field photographs', async () => {
        const payload = await resolveApplicationRequirements(filing(), []);
        expect(payload.blockingIssues).toEqual([]);
        expect(payload.missingRequired).toContain('field_surround_photos');
    });

    // The bypass itself. One nested key, no UI, no invoice effect, no second field to keep
    // consistent — and before this refusal it answered complete:true with A4' gone.
    test('an empty ลักษณะพื้นที่ set is refused, not read as "no area rules apply"', async () => {
        const payload = await resolveApplicationRequirements(filing({ farmData: { areaTypes: [] } }), []);
        expect(payload.blockingIssues).toEqual([
            expect.objectContaining({ code: 'AREA_TYPE_UNREADABLE' }),
        ]);
        expect(payload.complete).toBe(false);
        expect(payload.missingRequired).toEqual([]);
        expect(payload.slots).toEqual([]);
    });

    test('words no rule keys off are refused the same way', async () => {
        const payload = await resolveApplicationRequirements(
            filing({ farmData: { areaTypes: ['hydroponic', 'vertical-farm'] } }), [],
        );
        expect(payload.blockingIssues).toEqual([
            expect.objectContaining({ code: 'AREA_TYPE_UNREADABLE' }),
        ]);
    });

    test('the refusal is in Thai and names the words the platform does accept', async () => {
        const payload = await resolveApplicationRequirements(filing({ farmData: { areaTypes: [] } }), []);
        const [issue] = payload.blockingIssues;
        expect(issue.messageTH).toMatch(/[ก-๙]/);
        expect(issue.detail.accepted).toEqual(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
    });

    // Review finding 6 stands: a readable set still OWNS the answer and is not widened by
    // cultivationMethods or by the plots' born-OUTDOOR default.
    test('a readable set still owns the answer and nothing widens it', async () => {
        const dims = deriveDimensions(filing({
            farmData: { areaTypes: ['indoor'] },
            formData: { plots: [{ solarSystem: 'OUTDOOR' }] },
        }));
        expect(dims.areaTypes).toEqual(['INDOOR']);
        expect(dims.areaDeclarationUnreadable).toBe(false);
    });

    test('the NOT NULL column is still the last honest answer, and is not a refusal', async () => {
        const payload = await resolveApplicationRequirements(
            filing({ formData: { cultivationMethods: [] }, areaType: 'GREENHOUSE' }), [],
        );
        expect(payload.blockingIssues).toEqual([]);
        expect(payload.missingRequired).toContain('building_plan_photos');
    });

    // A caller holding a bare formData — every lens unit test, and the FE preview — says
    // nothing about area anywhere. That is silence, not a tampered answer, and it keeps
    // the wildcard it always had.
    test('a filing that says nothing about its area anywhere is not refused', async () => {
        const dims = deriveDimensions({ formData: { plantId: 'cannabis' } });
        expect(dims.areaTypes).toEqual([]);
        expect(dims.areaDeclarationUnreadable).toBe(false);
    });

    test('an unreadable area and an undeclared plant are reported as two separate refusals', async () => {
        const payload = await resolveApplicationRequirements(
            filing({ formData: { plantId: null }, farmData: { areaTypes: [] } }), [],
        );
        expect(payload.blockingIssues.map((i) => i.code).sort())
            .toEqual(['AREA_TYPE_UNREADABLE', 'PLANT_NOT_DECLARED']);
    });
});
