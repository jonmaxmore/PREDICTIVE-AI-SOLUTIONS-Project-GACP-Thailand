'use strict';

/**
 * fix round 3 (2026-10-05) — เอกสารตามกฎหมาย ไม่ใช่ตามแถวเก่าในทะเบียน
 * ทะเบียนยังมีแถว controlled_herb_license แบบ "บังคับ" (กัญชา+กระท่อม x ปลูก+แปรรูป) ที่ seed รุ่นเก่าไว้
 * เลนส์ต้องตอบตามกฎหมายอยู่ดี: ปลูกกัญชา = ไม่บังคับ · กระท่อม/อีกสี่ชนิด = ไม่มี · แปรรูปกัญชา = licence_pt11
 * และตราประทับเก่าที่ขอช่องนี้ไว้เกิน ต้องไม่บล็อกการยื่นซ้ำ
 */
const { buildHerbRuleRows, findObsoleteControlledHerbRules } = require('../../scripts/seed-herb-requirement-rules');

const mockRulesAt = jest.fn();
const mockPlantCodes = jest.fn();
jest.mock('../../services/requirement-rule-service', () => ({
    rulesAt: (...a) => mockRulesAt(...a),
    plantCodesWithRulesAt: (...a) => mockPlantCodes(...a),
    RULE_DIMENSIONS: {
        landTenure: ['OWNED', 'STATE_PERMITTED', 'RENTED'],
        areaType: ['OUTDOOR', 'GREENHOUSE', 'INDOOR'],
        certScope: ['PLANTING', 'PROCESSING'],
    },
}));
jest.mock('../../services/prisma-database', () => ({
    prisma: { entity: { findUnique: jest.fn() }, applicationDocument: { findMany: jest.fn() } },
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { prisma } = require('../../services/prisma-database');
const svc = require('../../services/application-document-requirements');
const { resolveApplicationRequirements } = require('../../services/application-requirements-service');

// the register as it stood BEFORE this change: no licence_pt11 row, four required controlled_herb_license rows
const oldRows = (plant) => [
    ...buildHerbRuleRows(plant, { effectiveFrom: '2026-09-02T00:00:00Z' }).filter((r) => r.slotId !== 'licence_pt11'),
    ...(['cannabis', 'kratom'].includes(plant)
        ? ['PLANTING', 'PROCESSING'].map((certScope) => ({
            holderType: null, requestType: 'NEW', plantCode: plant, landTenure: null, areaType: null, certScope,
            slotId: 'controlled_herb_license', isRequired: true, effectiveFrom: '2026-09-02T00:00:00Z',
        }))
        : []),
];

const app = (plantId, certScope, extra = {}) => ({
    id: 'app-1', entityId: 'e-1',
    formData: {
        plantId, requestType: 'NEW', certScope, certificationPurposes: ['RESEARCH'],
        cultivationMethods: ['outdoor'], farmData: { landOwnership: 'OWNED' }, ...extra,
    },
});
const seedRegister = (plant) => {
    const rows = oldRows(plant);
    mockPlantCodes.mockResolvedValue([plant]);
    mockRulesAt.mockImplementation(async (asked) => rows
        .filter((row) => ['holderType', 'requestType', 'landTenure', 'areaType', 'certScope'].every((c) => {
            const wanted = asked[c] === undefined ? null : asked[c];
            if (row[c] === null || row[c] === undefined) { return true; }
            return Array.isArray(wanted) ? wanted.includes(row[c]) : wanted === row[c];
        }))
        .map((row, i) => ({ id: `old-${i}`, ...row })));
};
beforeEach(() => { prisma.entity.findUnique.mockResolvedValue({ type: 'INDIVIDUAL' }); });

describe('the lens answers by law even when the register still holds the old rows', () => {
    test('cannabis PLANTING: controlled_herb_license is shown but optional', async () => {
        seedRegister('cannabis');
        const r = await resolveApplicationRequirements(app('cannabis', 'PLANTING'), []);
        expect(r.requiredSlotIds).not.toContain('controlled_herb_license');
        expect(r.missingRequired).not.toContain('controlled_herb_license');
        expect(r.slots.find((s) => s.slotId === 'controlled_herb_license')).toMatchObject({ required: false });
        expect(r.appliedRules.map((x) => x.slotId)).not.toContain('controlled_herb_license');
    });

    test.each(['PLANTING', 'PROCESSING'])('kratom %s: the slot is not there at all', async (scope) => {
        seedRegister('kratom');
        const r = await resolveApplicationRequirements(app('kratom', scope), []);
        expect(r.requiredSlotIds).not.toContain('controlled_herb_license');
        expect(r.slots.map((s) => s.slotId)).not.toContain('controlled_herb_license');
    });

    test('cannabis PROCESSING: licence_pt11 instead, once, with no pt11 row on the register', async () => {
        seedRegister('cannabis');
        const r = await resolveApplicationRequirements(app('cannabis', 'PROCESSING'), []);
        expect(r.requiredSlotIds).toContain('licence_pt11');
        expect(r.requiredSlotIds).not.toContain('controlled_herb_license');
        expect(r.appliedRules.filter((x) => x.slotId === 'licence_pt11')).toHaveLength(1);
        expect(r.slots.find((s) => s.slotId === 'controlled_herb_license')).toBeUndefined();
    });
});

const rowsFor = (types) => types.map((documentType) => ({ documentType, supersededAt: null }));
describe('an old stamp that over-asks does not block a resubmit', () => {
    test.each([['cannabis', 'PLANTING'], ['kratom', 'PLANTING'], ['cannabis', 'PROCESSING']])(
        '%s %s stamped with controlled_herb_license, never attached -> resubmit passes',
        async (plant, scope) => {
            const stamp = { stampedAt: 'x', ruleIds: [], slotIds: ['controlled_herb_license', 'land_title_deed'] };
            prisma.applicationDocument.findMany.mockResolvedValue(rowsFor(['land_title_deed']));
            await expect(svc.assertRequiredDocumentsPresent({
                application: app(plant, scope, { serverRequirementSnapshot: stamp }), mode: svc.MODE_RESUBMIT,
            })).resolves.toBeDefined();
        },
    );
    test('other stamped slots still bind', async () => {
        const stamp = { stampedAt: 'x', ruleIds: [], slotIds: ['controlled_herb_license', 'land_title_deed'] };
        prisma.applicationDocument.findMany.mockResolvedValue(rowsFor([]));
        await expect(svc.assertRequiredDocumentsPresent({
            application: app('cannabis', 'PLANTING', { serverRequirementSnapshot: stamp }), mode: svc.MODE_RESUBMIT,
        })).rejects.toMatchObject({ code: 'APPLICATION_INCOMPLETE' });
    });
});

describe('the seed closes the obsolete rows itself', () => {
    test('picks the open controlled_herb_license rows of the four, in any spelling, and nothing else', () => {
        const open = [
            { id: 'a', slotId: 'controlled_herb_license', plantCode: 'cannabis', certScope: 'PLANTING', effectiveTo: null },
            { id: 'b', slotId: 'CONTROLLED_HERB_LICENSE', plantCode: 'kratom', certScope: 'PROCESSING', effectiveTo: null },
            { id: 'c', slotId: 'LICENSE_BT11', plantCode: 'kratom', certScope: 'PLANTING', effectiveTo: null },
            { id: 'd', slotId: 'licence_pt11', plantCode: 'cannabis', certScope: 'PROCESSING', effectiveTo: null },
            { id: 'e', slotId: 'controlled_herb_license', plantCode: 'cannabis', certScope: 'PROCESSING', effectiveTo: new Date() },
        ];
        expect(findObsoleteControlledHerbRules(open).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    });
    test('idempotent: once everything is closed a second run picks nothing', () => {
        expect(findObsoleteControlledHerbRules([
            { id: 'a', slotId: 'controlled_herb_license', effectiveTo: new Date() },
        ])).toEqual([]);
        expect(findObsoleteControlledHerbRules(undefined)).toEqual([]);
    });
});

describe('fix round 4: the picker closes exactly the four rows the old seed filed', () => {
    const row = (id, plantCode, certScope, extra = {}) => ({
        id, slotId: 'controlled_herb_license', plantCode, certScope, effectiveTo: null, ...extra,
    });
    test('exactly cannabis/kratom x PLANTING/PROCESSING', () => {
        const four = [row('1', 'cannabis', 'PLANTING'), row('2', 'cannabis', 'PROCESSING'),
            row('3', 'kratom', 'PLANTING'), row('4', 'kratom', 'PROCESSING')];
        expect(findObsoleteControlledHerbRules(four).map((r) => r.id)).toEqual(['1', '2', '3', '4']);
    });
    test('does not over-match: other plants, other scopes, null dimensions, already closed', () => {
        const others = [
            row('g', 'ginger', 'PLANTING'), row('t', 'turmeric', 'PROCESSING'),
            row('n1', null, 'PLANTING'), row('n2', 'cannabis', null),
            row('x', 'cannabis', 'EXPORT'), row('y', 'kratom', 'SOMETHING'),
            row('c', 'cannabis', 'PLANTING', { effectiveTo: new Date() }),
        ];
        expect(findObsoleteControlledHerbRules(others)).toEqual([]);
    });
});
