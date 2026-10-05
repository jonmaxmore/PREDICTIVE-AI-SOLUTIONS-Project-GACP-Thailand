'use strict';

/**
 * THE ONE LENS — what กทล.1 asks THIS filing for, and what the server can already see.
 *
 * Four surfaces used to answer this question separately (wizard checklist, review page,
 * submit gate, officer's eyes) and they disagreed: a farmer was told ครบ on one screen and
 * ไม่ครบ on the next. This suite is the contract every one of them now reads.
 *
 * The rule rows here are the REAL cannabis set (scripts/seed-herb-requirement-rules.js),
 * filtered the way rulesAt filters them (NULL = every value), so a change to the law that
 * breaks a case shows up here rather than in a farmer's application.
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

const logger = require('../../shared/logger');
const {
    resolveApplicationRequirements,
    deriveDimensions,
} = require('../../services/application-requirements-service');

/** rulesAt's own semantics, applied to the real seed rows: NULL column = every value. */
const ALL_ROWS = buildHerbRuleRows('cannabis', { effectiveFrom: '2026-09-02T00:00:00Z' })
    .map((row, index) => ({ id: `rule-${index}`, ...row }));

function rulesFor(asked) {
    const matches = (column, value) => {
        const wanted = asked[column] === undefined ? null : asked[column];
        if (value === null || value === undefined) { return true; }
        // A case dimension may be asked with SEVERAL words at once (ลักษณะพื้นที่ is a
        // checkbox row), which is an IN over the stored word plus the NULL wildcard.
        if (Array.isArray(wanted)) { return wanted.includes(value); }
        return wanted === value;
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
    // The register holds กทล.1 law for cannabis and nothing else — the live state on
    // 2026-09-05, and the fact that decides whether a filing can be judged at all.
    mockPlantCodes.mockResolvedValue(['cannabis']);
});

/** A วิสาหกิจชุมชน renting its land and growing indoors — the plan's core case. */
function communityRentedIndoor(overrides = {}) {
    return {
        id: 'app-1',
        entity: { type: 'COMMUNITY_ENTERPRISE' },
        formData: {
            plantId: 'cannabis',
            requestType: 'NEW',
            certScope: 'PLANTING',
            cultivationMethods: ['indoor'],
            farmData: { landOwnership: 'RENT' },
            ...overrides,
        },
    };
}

const slotOf = (payload, slotId) => payload.slots.find((slot) => slot.slotId === slotId);

describe('the one lens — which documents this filing must carry', () => {
    test('the community + rented + indoor case asks for exactly the eleven กทล.1 slots', async () => {
        // Eleven since 2026-10-05: the planting licence (controlled_herb_license) is optional
        // for cannabis — no planting licence is in force; the ภ.ท. application lists it "ถ้ามี".
        const payload = await resolveApplicationRequirements(communityRentedIndoor(), []);
        const required = payload.slots.filter((slot) => slot.required).map((slot) => slot.slotId).sort();
        expect(required).toEqual([
            'building_plan_photos',
            'community_assignment',
            'community_reg_members',
            'id_house_reg',
            'land_rights',
            'landlord_consent',
            'production_util_plan',
            'security_residue_plan',
            'site_map_coords',
            'site_photos',
            'sop_manual',
        ]);
        expect(required).toHaveLength(11);
    });

    test('renting the land is why the landlord consent is asked for, and the payload says so', async () => {
        const payload = await resolveApplicationRequirements(communityRentedIndoor(), []);
        expect(slotOf(payload, 'landlord_consent')).toMatchObject({
            required: true, requiredReason: 'RENTED', satisfied: false,
        });
        expect(slotOf(payload, 'building_plan_photos')).toMatchObject({ requiredReason: 'INDOOR' });
        expect(slotOf(payload, 'land_rights')).toMatchObject({ requiredReason: 'ALWAYS' });
        expect(slotOf(payload, 'community_reg_members')).toMatchObject({ requiredReason: 'HOLDER_TYPE' });
    });

    test('owning the land instead removes the landlord consent, nothing else', async () => {
        const owned = communityRentedIndoor({ farmData: { landOwnership: 'OWNED' } });
        const payload = await resolveApplicationRequirements(owned, []);
        expect(slotOf(payload, 'landlord_consent')).toBeUndefined();
        expect(slotOf(payload, 'building_plan_photos')).toBeDefined();
    });

    test('every slot carries the words a farmer needs: label, what it is, where to get it', async () => {
        const payload = await resolveApplicationRequirements(communityRentedIndoor(), []);
        payload.slots.filter((slot) => slot.required).forEach((slot) => {
            expect(slot.labelTH).toMatch(/[ก-๙]/);
            expect(slot.sourceHint).toMatch(/[ก-๙]/);
            expect(slot.labelTH).not.toBe(slot.slotId);
        });
    });
});

describe('what the server can already see', () => {
    test('a โฉนด filed years ago under CHANOTE satisfies the land right', async () => {
        const payload = await resolveApplicationRequirements(communityRentedIndoor(), [{ documentType: 'CHANOTE' }]);
        expect(slotOf(payload, 'land_rights')).toMatchObject({ required: true, satisfied: true });
        expect(payload.missingRequired).not.toContain('land_rights');
    });

    test('an NS3 alone satisfies it too — the four land papers are one requirement', async () => {
        const payload = await resolveApplicationRequirements(communityRentedIndoor(), [{ documentType: 'NS3' }]);
        expect(slotOf(payload, 'land_rights')).toMatchObject({ satisfied: true });
    });

    test('a ส.ป.ก. alone satisfies it, and an unrelated paper does not', async () => {
        const spk = await resolveApplicationRequirements(communityRentedIndoor(), [{ documentType: 'SPK' }]);
        expect(slotOf(spk, 'land_rights').satisfied).toBe(true);

        const criminal = await resolveApplicationRequirements(communityRentedIndoor(), [{ documentType: 'CRIMINAL_BG' }]);
        expect(slotOf(criminal, 'land_rights').satisfied).toBe(false);
    });

    test('a draft upload counts, and the wizard’s own checklist never does', async () => {
        const app = communityRentedIndoor({
            draftDocuments: [{ slotId: 'SITE_MAP', fileUrl: '/uploads/x.pdf', fileName: 'map.pdf' }],
            documents: [{ id: 'sop_manual', uploaded: true }],
        });
        const payload = await resolveApplicationRequirements(app, []);
        expect(slotOf(payload, 'site_map_coords')).toMatchObject({
            satisfied: true, fileUrl: '/uploads/x.pdf', fileName: 'map.pdf',
        });
        expect(slotOf(payload, 'sop_manual').satisfied).toBe(false);
    });

    test('missingRequired names exactly the required slots with nothing behind them', async () => {
        const payload = await resolveApplicationRequirements(
            communityRentedIndoor(),
            [{ documentType: 'CHANOTE' }, { documentType: 'SITE_MAP' }],
        );
        const unsatisfied = payload.slots
            .filter((slot) => slot.required && !slot.satisfied)
            .map((slot) => slot.slotId)
            .sort();
        expect([...payload.missingRequired].sort()).toEqual(unsatisfied);
        expect(payload.complete).toBe(false);
    });

    test('complete flips only when every required slot is answered', async () => {
        const rows = [
            'CHANOTE', 'SITE_MAP', 'PRODUCTION_PLAN', 'SECURITY_PLAN', 'EXTERIOR_PHOTOS', 'SOP_MANUAL',
            'LAND_CONSENT', 'BUILDING_PLAN', 'IND_ID_CARD', 'COM_SVC01', 'COM_MEETING_DOC',
            'controlled_herb_license',
        ].map((documentType) => ({ documentType }));
        const payload = await resolveApplicationRequirements(communityRentedIndoor(), rows);
        expect(payload.missingRequired).toEqual([]);
        expect(payload.complete).toBe(true);
    });
});

describe('the two conditions no rule row can express', () => {
    test('a PLANTING filing shows the planting licence as optional, and EXPORT adds its own licence', async () => {
        // The planting licence is never required (operator 2026-10-05). The purpose adds its
        // OWN licence slot (licence_pt10 for EXPORT) — pinned in licence-slots-by-law.test.js.
        const app = communityRentedIndoor({ certificationPurposes: ['EXPORT'] });
        const payload = await resolveApplicationRequirements(app, []);
        expect(slotOf(payload, 'controlled_herb_license')).toMatchObject({ required: false });
        expect(payload.missingRequired).not.toContain('controlled_herb_license');
        expect(slotOf(payload, 'licence_pt10')).toMatchObject({ required: true, requiredReason: 'PURPOSE' });
    });

    test('a filing that declares no scope defaults to PLANTING — the licence is optional there too', async () => {
        const app = communityRentedIndoor();
        delete app.formData.certScope;
        const payload = await resolveApplicationRequirements(app, []);
        expect(slotOf(payload, 'controlled_herb_license')).toMatchObject({ required: false });
    });

    test('a replacement asks for the police report OR the damaged certificate, never both', async () => {
        const app = {
            id: 'app-2',
            entity: { type: 'INDIVIDUAL' },
            formData: { plantId: 'cannabis', replacementOf: 'GACP-TH-2569-000009', farmData: {} },
        };
        const payload = await resolveApplicationRequirements(app, []);
        expect(slotOf(payload, 'police_report')).toMatchObject({ required: false, requiredReason: 'REPLACEMENT' });
        expect(slotOf(payload, 'damaged_cert')).toMatchObject({ required: false, requiredReason: 'REPLACEMENT' });
        expect(payload.missingRequired).toContain('police_report|damaged_cert');

        const withOne = await resolveApplicationRequirements(app, [{ documentType: 'POLICE_REPORT' }]);
        expect(withOne.missingRequired).not.toContain('police_report|damaged_cert');
    });

    test('an individual filing asks for the producer supervision letter', async () => {
        const app = { id: 'app-3', entity: { type: 'INDIVIDUAL' }, formData: { plantId: 'cannabis', requestType: 'NEW', farmData: {} } };
        const payload = await resolveApplicationRequirements(app, []);
        expect(slotOf(payload, 'producer_supervision_letter')).toMatchObject({
            required: true, requiredReason: 'HOLDER_TYPE',
        });
        expect(slotOf(payload, 'community_reg_members')).toBeUndefined();
    });
});

describe('optional slots never block a filing', () => {
    test('the three optional slots are offered, never required, never missing', async () => {
        const payload = await resolveApplicationRequirements(communityRentedIndoor(), []);
        ['water_test', 'soil_test', 'additional_docs'].forEach((slotId) => {
            expect(slotOf(payload, slotId)).toMatchObject({ required: false });
            expect(payload.missingRequired).not.toContain(slotId);
        });
    });
});

describe('a draft can say anything; the rule engine may only be asked what it knows', () => {
    test('a lowercase legacy certScope resolves to the vocabulary, not to a refusal', async () => {
        const app = communityRentedIndoor({ certScope: 'planting' });
        const payload = await resolveApplicationRequirements(app, []);
        expect(payload.dims.certScope).toBe('PLANTING');
        expect(mockRulesAt.mock.calls[0][0].certScope).toBe('PLANTING');
    });

    test('a padded holder type still matches the rules written for it', async () => {
        const app = communityRentedIndoor();
        app.entity = { type: 'JURISTIC ' };
        const payload = await resolveApplicationRequirements(app, []);
        expect(payload.dims.holderType).toBe('JURISTIC');
        expect(slotOf(payload, 'juristic_reg_6m')).toBeDefined();
    });

    test('a word the rule table has never heard becomes the wildcard, never a guess', async () => {
        const app = communityRentedIndoor({ farmData: { landOwnership: 'ยืมมา' } });
        const payload = await resolveApplicationRequirements(app, []);
        expect(payload.dims.landTenure).toBeNull();
        expect(slotOf(payload, 'landlord_consent')).toBeUndefined();
    });

    test('a filing that has not said how it grows is judged by the rules that bind everybody', async () => {
        const app = { id: 'app-4', entity: { type: 'INDIVIDUAL' }, formData: { plantId: 'cannabis', requestType: 'NEW' } };
        const payload = await resolveApplicationRequirements(app, []);
        expect(payload.dims.areaTypes).toEqual([]);
        expect(slotOf(payload, 'building_plan_photos')).toBeUndefined();
        expect(slotOf(payload, 'field_surround_photos')).toBeUndefined();
        expect(slotOf(payload, 'land_rights')).toBeDefined();
    });

    test('which law judges this filing is read from server-owned keys only', () => {
        // renewalOf is written by renewal-service from a certificate the platform
        // issued; requestType and replacementOf are stripped from applicant payloads
        // (shared/form-data-ownership.js). serviceType is the WIZARD's key.
        expect(deriveDimensions({ formData: { renewalOf: 'GACP-TH-2569-000001' } }).requestType).toBe('RENEWAL');
        expect(deriveDimensions({ formData: { replacementOf: 'GACP-TH-2569-000002' } }).requestType).toBe('REPLACEMENT');
        expect(deriveDimensions({ formData: {} }).requestType).toBe('NEW');

        // The bypass this closes: one line in a POST body used to drop the whole
        // ส่วนที่ ๓ set down to two replacement rows.
        expect(deriveDimensions({ formData: { serviceType: 'REPLACEMENT' } }).requestType).toBe('NEW');
        expect(deriveDimensions({ formData: { serviceType: 'RENEWAL' } }).requestType).toBe('NEW');
    });

    test('a stated holder type is used as given — including when it is null', () => {
        // The gate reads the holder from the ENTITY ROW. If that says nothing, the
        // applicant's own applicantType must not be able to answer for it.
        const app = { entity: { type: 'JURISTIC' }, formData: { applicantType: 'INDIVIDUAL' } };
        expect(deriveDimensions(app, { holderType: null }).holderType).toBeNull();
        expect(deriveDimensions(app, { holderType: 'COMMUNITY_ENTERPRISE' }).holderType).toBe('COMMUNITY_ENTERPRISE');
        // With no override at all the entity row still wins over formData.
        expect(deriveDimensions(app).holderType).toBe('JURISTIC');
        // ...and the wizard's legacy word for วิสาหกิจชุมชน is understood.
        expect(deriveDimensions({ formData: { applicantType: 'COMMUNITY' } }).holderType).toBe('COMMUNITY_ENTERPRISE');
    });

    // Changed 2026-09-05. Logging it was not enough: the register answers a question
    // that names no plant with the two plant-agnostic rows (company_reg,
    // community_cert), both holder-specific, so an INDIVIDUAL filing was asked for
    // nothing at all and passed the submit gate carrying an empty stamp.
    test('a filing that names no plant is refused, not judged by nothing', async () => {
        const app = { id: 'app-no-plant', entity: { type: 'INDIVIDUAL' }, formData: { requestType: 'NEW' } };
        const payload = await resolveApplicationRequirements(app, []);
        expect(payload.dims.plantCode).toBeNull();
        expect(payload.blockingIssues).toEqual([
            expect.objectContaining({ code: 'PLANT_NOT_DECLARED' }),
        ]);
        expect(payload.complete).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('names no plant'));
        // and a filing that does name one the register has law for is not warned about
        jest.clearAllMocks();
        mockPlantCodes.mockResolvedValue(['cannabis']);
        const judged = await resolveApplicationRequirements(communityRentedIndoor(), []);
        expect(judged.blockingIssues).toEqual([]);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('the plant is read from the filing, not assumed', () => {
        expect(deriveDimensions({ formData: { plantId: 'cannabis' } }).plantCode).toBe('cannabis');
        expect(deriveDimensions({ formData: { plantId: 'kratom' } }).plantCode).toBe('kratom');
        // The vocabulary is every plant the platform can name (config/plant-species-slugs.js),
        // so 'turmeric' is RECOGNISED — and then refused separately, by
        // resolveApplicationRequirements, because the register holds no law for it.
        // Recognising a plant and being able to judge it are two different questions.
        expect(deriveDimensions({ formData: { plantId: 'turmeric' } }).plantCode).toBe('turmeric');
        expect(deriveDimensions({ formData: {} }).plantCode).toBeNull();
        expect(deriveDimensions({ formData: { plantId: 'ผักบุ้ง' } }).plantCode).toBeNull();
    });

    // Changed 2026-09-05. This used to assert the MOST CONTROLLED single value, on the
    // argument that a stricter environment cannot under-ask. The live register
    // falsifies it: the areaType rows demand disjoint slots, so collapsing กลางแจ้ง +
    // โรงเรือน to GREENHOUSE deleted field_surround_photos instead of adding to it.
    test('every ลักษณะพื้นที่ the filing ticks is carried, in vocabulary order', () => {
        const at = (methods) => deriveDimensions({ formData: { cultivationMethods: methods } }).areaTypes;
        expect(at(['outdoor', 'indoor'])).toEqual(['OUTDOOR', 'INDOOR']);
        expect(at(['outdoor', 'greenhouse'])).toEqual(['OUTDOOR', 'GREENHOUSE']);
        expect(at(['indoor_controlled'])).toEqual(['INDOOR']);
        expect(at(['outdoor'])).toEqual(['OUTDOOR']);
        expect(at([])).toEqual([]);
        // the application column answers only when the filing states nothing itself
        expect(deriveDimensions({ areaType: 'GREENHOUSE', formData: {} }).areaTypes).toEqual(['GREENHOUSE']);
    });

    test('the wizard’s third land option asks for the consent letter', () => {
        // 'ได้รับอนุญาต (ต้องมีหนังสือยินยอม)' — options.ts:46
        expect(deriveDimensions({ formData: { farmData: { landOwnership: 'CONSENT' } } }).landTenure).toBe('RENTED');
        expect(deriveDimensions({ formData: { farmData: { landOwnership: 'RENT' } } }).landTenure).toBe('RENTED');
        expect(deriveDimensions({ formData: { farmData: { landOwnership: 'OWN' } } }).landTenure).toBe('OWNED');
    });

    test('if the engine still refuses a word, the applicant sees an internal error, not rule vocabulary', async () => {
        const refusal = Object.assign(
            new Error('มิติกติกาไม่อยู่ในชุดค่าที่ระบบรู้จัก: landTenure=LEASE กรุณาแก้เป็นค่าใดค่าหนึ่งใน OWNED / STATE_PERMITTED / RENTED แล้วทำรายการอีกครั้ง'),
            { code: 'INVALID_RULE_DIMENSION', status: 422, statusCode: 422 },
        );
        mockRulesAt.mockRejectedValue(refusal);

        const shown = await resolveApplicationRequirements(communityRentedIndoor(), []).then(
            () => { throw new Error('expected the lens to refuse'); },
            (error) => error,
        );
        expect(shown).toMatchObject({ code: 'REQUIREMENTS_RESOLUTION_FAILED', statusCode: 500 });
        // The applicant is not shown the admin vocabulary the rule engine refused on.
        expect(shown.message).not.toMatch(/OWNED|STATE_PERMITTED|RENTED|landTenure/);
        expect(shown.message).toMatch(/[ก-๙]/);
        // ...but the defect is recorded where an engineer will see it.
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('INVALID_RULE_DIMENSION') );
    });
});
