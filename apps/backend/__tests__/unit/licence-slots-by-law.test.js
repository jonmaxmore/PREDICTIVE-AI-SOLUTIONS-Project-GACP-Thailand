'use strict';

/**
 * Fix round 2 — มติ operator 2026-10-05: ไม่ขอเอกสารที่กฎหมายไม่ได้บังคับ
 * ทุกชนิดใช้ชุดเอกสารเดียวกัน ต่างกันแค่ใบอนุญาตที่กฎหมายบังคับจริง:
 *   กัญชา   : ภ.ท. 09/10/11 ตามวัตถุประสงค์ · ใบอนุญาตปลูก/หลักฐานแจ้งปลูก = ไม่บังคับ
 *   กระท่อม : ส่งออก = ใบอนุญาตตามมาตรา 10 พ.ร.บ.พืชกระท่อม 2565 · วิจัย/แปรรูป ไม่มีใบอนุญาต
 *   อีกสี่ชนิด : ไม่มีใบอนุญาตใด
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
const { buildRequirementSnapshot } = require('../../services/application-document-requirements');
const { DOCUMENT_SLOTS } = require('../../constants/document-slots');
const { getCanonicalSlotId } = require('../../routes/api/applications/validation-slot-utils');

const HERBS = ['cannabis', 'kratom', 'turmeric', 'ginger', 'plai', 'black_galangal'];
const ROWS = Object.fromEntries(
    HERBS.map((h) => [h, buildHerbRuleRows(h, { effectiveFrom: '2026-09-02T00:00:00Z' })]),
);
const ALL_LICENCES = ['licence_pt09', 'licence_pt10', 'licence_pt11', 'kratom_export_licence'];

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
    mockPlantCodes.mockResolvedValue(HERBS);
});

const filing = (plantId, purposes, certScope = 'PLANTING') => ({
    id: 'app-1',
    entity: { type: 'INDIVIDUAL' },
    formData: {
        plantId, requestType: 'NEW', certScope, certificationPurposes: purposes,
        cultivationMethods: ['outdoor'], farmData: { landOwnership: 'OWNED' },
    },
});
const slotOf = (payload, id) => payload.slots.find((s) => s.slotId === id);
const present = (payload) => ALL_LICENCES.filter((id) => slotOf(payload, id));

describe('cannabis: ภ.ท. by purpose', () => {
    test('EXPORT requires licence_pt10', async () => {
        const p = await resolveApplicationRequirements(filing('cannabis', ['EXPORT']), []);
        expect(slotOf(p, 'licence_pt10')).toMatchObject({ required: true, satisfied: false });
        expect(p.missingRequired).toContain('licence_pt10');
    });
});

describe('kratom: no ภ.ท., one export licence under the kratom act', () => {
    test('EXPORT requires kratom_export_licence and no licence_pt10', async () => {
        const p = await resolveApplicationRequirements(filing('kratom', ['EXPORT']), []);
        expect(slotOf(p, 'kratom_export_licence')).toMatchObject({ required: true, satisfied: false, requiredReason: 'PURPOSE' });
        expect(p.missingRequired).toContain('kratom_export_licence');
        expect(slotOf(p, 'licence_pt10')).toBeUndefined();
        expect(present(p)).toEqual(['kratom_export_licence']);
    });

    test('the slot is named for section 10 of the kratom act, with no invented form number', () => {
        const slot = Object.values(DOCUMENT_SLOTS).find((s) => s.slotId === 'kratom_export_licence');
        expect(slot.name).toContain('ใบอนุญาตส่งออกพืชกระท่อม');
        expect(`${slot.name} ${slot.description}`).toMatch(/มาตรา 10/);
        expect(`${slot.name} ${slot.description}`).toMatch(/พืชกระท่อม พ.ศ. 2565/);
        expect(`${slot.name} ${slot.description}`).not.toMatch(/ภ\.?ท\.?\s?\d/);
        expect(getCanonicalSlotId('kratom_export_licence')).toBe('kratom_export_licence');
    });

    test.each([['PROCESSING'], ['RESEARCH']])('%s asks for no licence slot, in either scope', async (purpose) => {
        for (const scope of ['PLANTING', 'PROCESSING']) {
            const p = await resolveApplicationRequirements(filing('kratom', [purpose], scope), []);
            expect(present(p)).toEqual([]);
            expect(slotOf(p, 'controlled_herb_license')).toBeUndefined();
        }
    });

    test('the controlled_herb_license scope rule is gone for kratom', () => {
        const slots = ROWS.kratom.map((r) => r.slotId);
        expect(slots).not.toContain('controlled_herb_license');
        expect(slots).not.toContain('licence_pt11');
    });
});

describe('turmeric, ginger, plai, black galangal: no licence of any kind', () => {
    test.each(['turmeric', 'ginger', 'plai', 'black_galangal'])('%s', async (herb) => {
        for (const scope of ['PLANTING', 'PROCESSING']) {
            const p = await resolveApplicationRequirements(
                filing(herb, ['RESEARCH', 'EXPORT', 'PROCESSING'], scope), []);
            expect(present(p)).toEqual([]);
            expect(slotOf(p, 'controlled_herb_license')).toBeUndefined();
        }
    });
});

describe('cannabis scope PROCESSING + purpose PROCESSING: one ภ.ท. 11', () => {
    test('licence_pt11 appears exactly once, in slots, required list and stamp', async () => {
        const p = await resolveApplicationRequirements(filing('cannabis', ['PROCESSING'], 'PROCESSING'), []);
        expect(p.slots.filter((s) => s.slotId === 'licence_pt11')).toHaveLength(1);
        expect(p.requiredSlotIds.filter((id) => id === 'licence_pt11')).toHaveLength(1);
        expect(p.missingRequired.filter((id) => id === 'licence_pt11')).toHaveLength(1);
        expect(p.appliedRules.filter((r) => r.slotId === 'licence_pt11')).toHaveLength(1);
        expect(buildRequirementSnapshot(p.appliedRules).slotIds.filter((id) => id === 'licence_pt11')).toHaveLength(1);
    });

    test('scope PROCESSING alone (purpose RESEARCH) still requires licence_pt11', async () => {
        const p = await resolveApplicationRequirements(filing('cannabis', ['RESEARCH'], 'PROCESSING'), []);
        expect(slotOf(p, 'licence_pt11')).toMatchObject({ required: true });
    });

    test('one upload satisfies it', async () => {
        const p = await resolveApplicationRequirements(
            filing('cannabis', ['PROCESSING'], 'PROCESSING'), [{ documentType: 'LICENCE_PT11' }]);
        expect(slotOf(p, 'licence_pt11')).toMatchObject({ satisfied: true });
        expect(p.missingRequired).not.toContain('licence_pt11');
    });
});

describe('cannabis scope PLANTING: the planting licence is shown, never blocking', () => {
    test('present, optional, and the filing is not held for it', async () => {
        const p = await resolveApplicationRequirements(filing('cannabis', ['RESEARCH'], 'PLANTING'), []);
        const slot = slotOf(p, 'controlled_herb_license');
        expect(slot).toMatchObject({ required: false, satisfied: false });
        expect(slot.labelTH).toBe('ใบอนุญาตปลูกหรือหลักฐานการแจ้งปลูก (ถ้ามี)');
        expect(p.missingRequired).not.toContain('controlled_herb_license');
        expect(p.requiredSlotIds).not.toContain('controlled_herb_license');
        expect(p.appliedRules.map((r) => r.slotId)).not.toContain('controlled_herb_license');
    });

    test('submit-style judgement: only the purpose licence is missing, not the planting one', async () => {
        const p = await resolveApplicationRequirements(filing('cannabis', [], 'PLANTING'), []);
        expect(p.missingRequired).not.toContain('controlled_herb_license');
    });

    test('other herbs do not even show it', async () => {
        for (const herb of ['kratom', 'ginger']) {
            const p = await resolveApplicationRequirements(filing(herb, [], 'PLANTING'), []);
            expect(slotOf(p, 'controlled_herb_license')).toBeUndefined();
        }
    });
});
