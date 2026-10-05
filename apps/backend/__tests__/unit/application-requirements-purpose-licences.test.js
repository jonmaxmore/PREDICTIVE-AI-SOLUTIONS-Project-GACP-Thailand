'use strict';

/**
 * มติ operator 2026-10-05 — วัตถุประสงค์ต้องมีใบอนุญาต ภ.ท. ที่ออกให้แล้วรองรับ
 *
 *   RESEARCH   -> licence_pt09     EXPORT -> licence_pt10     PROCESSING -> licence_pt11
 *
 * บังคับเฉพาะสมุนไพรควบคุม (กัญชา กระท่อม) · ชนิดอื่นไม่มีใบอนุญาตให้แนบ
 * แทนที่เงื่อนไขเดิม "EXPORT -> controlled_herb_license" ที่อยู่นอกทะเบียนกฎ
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

const { resolveApplicationRequirements } = require('../../services/application-requirements-service');
const { DOCUMENT_SLOTS } = require('../../constants/document-slots');
const { CERTIFICATION_PURPOSES } = require('../../shared/certification-purposes');

const ROWS = {
    cannabis: buildHerbRuleRows('cannabis', { effectiveFrom: '2026-09-02T00:00:00Z' }),
    kratom: buildHerbRuleRows('kratom', { effectiveFrom: '2026-09-02T00:00:00Z' }),
    ginger: buildHerbRuleRows('ginger', { effectiveFrom: '2026-09-02T00:00:00Z' }),
};

beforeEach(() => {
    mockRulesAt.mockImplementation(async (asked) => {
        const rows = ROWS[asked.plantCode] || [];
        const matches = (column, value) => {
            const wanted = asked[column] === undefined ? null : asked[column];
            if (value === null || value === undefined) { return true; }
            return Array.isArray(wanted) ? wanted.includes(value) : wanted === value;
        };
        return rows
            .filter((row) => ['holderType', 'requestType', 'landTenure', 'areaType', 'certScope']
                .every((c) => matches(c, row[c])))
            .map((row, i) => ({ id: `r-${i}`, ...row }));
    });
    mockPlantCodes.mockResolvedValue(['cannabis', 'kratom', 'ginger']);
});

const filing = (plantId, certificationPurposes) => ({
    id: 'app-1',
    entity: { type: 'INDIVIDUAL' },
    formData: {
        plantId, requestType: 'NEW', certScope: 'PLANTING', certificationPurposes,
        cultivationMethods: ['outdoor'], farmData: { landOwnership: 'OWNED' },
    },
});
const slotOf = (payload, id) => payload.slots.find((s) => s.slotId === id);

describe('one licence slot per purpose, named for the ISSUED licence', () => {
    test.each(Object.values(CERTIFICATION_PURPOSES))('$slotId is in the catalogue under the operator name', (p) => {
        const slot = Object.values(DOCUMENT_SLOTS).find((s) => s.slotId === p.slotId);
        expect(slot).toBeDefined();
        expect(slot.name).toContain(p.licenceName);
        expect(slot.name).toContain(p.licenceCode);
        // ใบอนุญาตที่ออกให้แล้ว ไม่ใช่แบบคำขอ
        expect(slot.description).toMatch(/ออกให้แล้ว/);
        expect(slot.description).toMatch(/ไม่ใช่แบบคำขอ/);
    });

    test.each([
        ['RESEARCH', 'licence_pt09'], ['EXPORT', 'licence_pt10'], ['PROCESSING', 'licence_pt11'],
    ])('cannabis + %s requires exactly %s', async (purpose, slotId) => {
        const payload = await resolveApplicationRequirements(filing('cannabis', [purpose]), []);
        expect(slotOf(payload, slotId)).toMatchObject({ required: true, satisfied: false, requiredReason: 'PURPOSE' });
        const others = ['licence_pt09', 'licence_pt10', 'licence_pt11'].filter((id) => id !== slotId);
        others.forEach((id) => expect(slotOf(payload, id)).toBeUndefined());
        expect(payload.missingRequired).toContain(slotId);
    });

    test('kratom is NOT under the ภ.ท. licences (its own act) — see licence-slots-by-law.test.js', async () => {
        const payload = await resolveApplicationRequirements(filing('kratom', ['EXPORT']), []);
        expect(slotOf(payload, 'licence_pt10')).toBeUndefined();
    });

    test('several purposes ask for several licences', async () => {
        const payload = await resolveApplicationRequirements(filing('cannabis', ['RESEARCH', 'PROCESSING']), []);
        expect(slotOf(payload, 'licence_pt09')).toMatchObject({ required: true });
        expect(slotOf(payload, 'licence_pt11')).toMatchObject({ required: true });
        expect(slotOf(payload, 'licence_pt10')).toBeUndefined();
    });

    test('a non-controlled herb needs no licence slot whatever the purpose', async () => {
        const payload = await resolveApplicationRequirements(filing('ginger', ['RESEARCH', 'EXPORT', 'PROCESSING']), []);
        ['licence_pt09', 'licence_pt10', 'licence_pt11', 'controlled_herb_license'].forEach((id) => {
            expect(slotOf(payload, id)).toBeUndefined();
        });
    });

    test('a filing with no purpose owes no purpose licence', async () => {
        const payload = await resolveApplicationRequirements(filing('cannabis', []), []);
        ['licence_pt09', 'licence_pt10', 'licence_pt11'].forEach((id) => expect(slotOf(payload, id)).toBeUndefined());
    });

    test('attaching the issued licence satisfies its slot, and only its slot', async () => {
        const payload = await resolveApplicationRequirements(
            filing('cannabis', ['EXPORT', 'PROCESSING']),
            [{ documentType: 'LICENCE_PT10' }],
        );
        expect(slotOf(payload, 'licence_pt10')).toMatchObject({ satisfied: true });
        expect(slotOf(payload, 'licence_pt11')).toMatchObject({ satisfied: false });
    });
});

describe('the retired EXPORT override is gone', () => {
    test('EXPORT no longer manufactures the scope licence reason', async () => {
        const app = filing('cannabis', ['EXPORT']);
        const payload = await resolveApplicationRequirements(app, []);
        // controlled_herb_license is the optional planting licence now: never required, never EXPORT.
        expect(slotOf(payload, 'controlled_herb_license')).toMatchObject({ required: false, requiredReason: null });
        expect(slotOf(payload, 'licence_pt10').requiredReason).toBe('PURPOSE');
    });

    test('controlled_herb_license no longer sends the applicant to ภท.10 / ภท.11', () => {
        expect(DOCUMENT_SLOTS.CONTROLLED_HERB_LICENSE.sourceHint).not.toMatch(/ภท\.?\s?1[01]|ภ\.ท\.\s?1[01]/);
    });
});

describe('a word outside the vocabulary cannot be judged', () => {
    test.each([['MEDICAL'], ['COMMERCIAL']])('%s blocks the filing with the purpose refusal', async (word) => {
        const payload = await resolveApplicationRequirements(filing('cannabis', [word]), []);
        expect(payload.blockingIssues.map((b) => b.code)).toContain('CERTIFICATION_PURPOSE_INVALID');
        expect(payload.complete).toBe(false);
    });
});
