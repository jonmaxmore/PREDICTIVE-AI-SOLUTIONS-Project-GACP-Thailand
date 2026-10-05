'use strict';

/**
 * A filing the law cannot reach is not "a filing with no requirements".
 *
 * `plantId` decides WHICH BODY OF LAW judges a กทล.1 filing. The register is seeded
 * per plant — 23 cannabis rows plus two plant-agnostic rows, and those two are
 * company_reg and community_cert, both holder-specific. So an INDIVIDUAL filing whose
 * plant the register knows nothing about matched ZERO rules, was told it needed no
 * documents at all, passed the submit gate, and froze that empty answer onto itself as
 * the law every later resubmit is judged by.
 *
 * Nine slots became none by typing one word. The value is the applicant's to choose —
 * it is their crop, exactly as their land tenure is theirs — but "no law was filed for
 * this plant" is not a lenient answer, it is an unanswerable question, and the lens
 * refuses to answer it.
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

function filing(formData = {}) {
    return {
        id: 'app-plant',
        entity: { type: 'INDIVIDUAL' },
        formData: {
            requestType: 'NEW', certScope: 'PLANTING', cultivationMethods: ['outdoor'], ...formData,
        },
    };
}

describe('a filing must name a plant the law has been filed for', () => {
    test('the cannabis filing is judged, as before', async () => {
        const payload = await resolveApplicationRequirements(filing({ plantId: 'cannabis' }), []);
        expect(payload.blockingIssues).toEqual([]);
        // 9: the planting licence is optional since 2026-10-05 (no cannabis planting licence
        // is in force; ภ.ท. application lists it "ถ้ามี") — shown, never required.
        const required = payload.slots.filter((s) => s.required);
        expect(required).toHaveLength(9);
        expect(required.map((s) => s.slotId)).not.toContain('controlled_herb_license');
    });

    test('a filing that names no plant is refused, not judged by two company papers', async () => {
        const payload = await resolveApplicationRequirements(filing(), []);
        expect(payload.blockingIssues).toEqual([
            expect.objectContaining({ code: 'PLANT_NOT_DECLARED' }),
        ]);
        expect(payload.complete).toBe(false);
    });

    test('an invented plant is refused rather than accepted as a plant with no law', async () => {
        const payload = await resolveApplicationRequirements(filing({ plantId: 'x' }), []);
        expect(payload.blockingIssues).toEqual([
            expect.objectContaining({ code: 'PLANT_NOT_DECLARED' }),
        ]);
    });

    test('a real plant whose law is not filed yet is refused, and says which plants are open', async () => {
        const payload = await resolveApplicationRequirements(filing({ plantId: 'turmeric' }), []);
        expect(payload.blockingIssues).toEqual([
            expect.objectContaining({ code: 'PLANT_LAW_NOT_FILED' }),
        ]);
        expect(payload.blockingIssues[0].messageTH).toMatch(/[ก-๙]/);
    });

    /**
     * Review layer 2, finding C6. "Not refused" is not "judged". The earlier version of
     * this test asserted only `blockingIssues: []` — which a filing asked for ZERO
     * documents also satisfies, and reporting complete:true with nothing demanded is
     * precisely the hole the plant refusal was built to close. The claim in the name is
     * that kratom is now JUDGED, so the assertion has to be about the judgement: the law
     * filed for kratom is applied, and a filing with none of it on file is incomplete.
     */
    test('kratom starts being judged the day its rules are seeded, with no code change', async () => {
        mockPlantCodes.mockResolvedValue(['cannabis', 'kratom']);
        mockRulesAt.mockImplementation(async ({ plantCode }) => (
            plantCode === 'kratom'
                ? [{ id: 'k-1', slotId: 'land_rights', isRequired: true, plantCode: 'kratom' }]
                : []
        ));

        const payload = await resolveApplicationRequirements(filing({ plantId: 'kratom' }), []);

        expect(payload.blockingIssues).toEqual([]);
        // It was actually asked for something, and the something is kratom's own law.
        expect(payload.requiredSlotIds).toContain('land_rights');
        expect(payload.slots.filter((slot) => slot.required).length).toBeGreaterThan(0);
        // Nothing is attached, so "nothing is missing" would be a lie.
        expect(payload.missingRequired).toContain('land_rights');
        expect(payload.complete).toBe(false);
    });

    test('a blocked filing can never report complete, however many files it has attached', async () => {
        const everySlot = ALL_ROWS.map((row) => ({ documentType: row.slotId, supersededAt: null }));
        const payload = await resolveApplicationRequirements(filing({ plantId: 'x' }), everySlot);
        expect(payload.complete).toBe(false);
    });

    // Review finding 4. A blocked filing must not also hand out a document list: "attach
    // these papers" is wrong advice when the ministry has published no list for what is
    // being filed, and the plant-agnostic rows would supply exactly that wrong advice.
    test('a blocked filing is given no document advice at all', async () => {
        const payload = await resolveApplicationRequirements(
            { id: 'app-j', entity: { type: 'JURISTIC' }, formData: { requestType: 'NEW' } }, [],
        );
        expect(payload.blockingIssues).toHaveLength(1);
        expect(payload.missingRequired).toEqual([]);
        expect(payload.slots).toEqual([]);
        expect(payload.requiredSlotIds).toEqual([]);
        expect(payload.appliedRules).toEqual([]);
    });

    test('the plant is read from the filing only — the applications table has no plant column', async () => {
        const dims = deriveDimensions({
            id: 'a', entity: { type: 'INDIVIDUAL' }, plantType: 'cannabis', formData: {},
        });
        expect(dims.plantCode).toBeNull();
    });
});
