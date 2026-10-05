'use strict';

/**
 * fix round 1 (2026-10-05) — ใบอนุญาต ภ.ท. ที่มาจากวัตถุประสงค์ต้องอยู่ใน serverRequirementSnapshot
 * ไม่งั้นการยื่นแก้ไข (resubmit) ที่ตัดใบอนุญาตออกจะผ่าน
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

const ROWS = buildHerbRuleRows('cannabis', { effectiveFrom: '2026-09-02T00:00:00Z' });
let DOC_TYPES = [];

beforeEach(() => {
    mockPlantCodes.mockResolvedValue(['cannabis']);
    mockRulesAt.mockImplementation(async (asked) => ROWS
        .filter((row) => ['holderType', 'requestType', 'landTenure', 'areaType', 'certScope'].every((c) => {
            const wanted = asked[c] === undefined ? null : asked[c];
            if (row[c] === null || row[c] === undefined) { return true; }
            return Array.isArray(wanted) ? wanted.includes(row[c]) : wanted === row[c];
        }))
        .map((row, i) => ({ id: `r-${i}`, ...row })));
    prisma.entity.findUnique.mockResolvedValue({ type: 'INDIVIDUAL' });
});

// attach every slot the lens asks for, so only the licence is ever the variable
beforeEach(async () => {
    const payload = await resolveApplicationRequirements({ ...app(), entity: { type: 'INDIVIDUAL' } }, []);
    DOC_TYPES = payload.requiredSlotIds;
});

const app = (extra = {}) => ({
    id: 'app-1',
    entityId: 'e-1',
    formData: {
        plantId: 'cannabis', requestType: 'NEW', certScope: 'PROCESSING', certificationPurposes: ['PROCESSING'],
        cultivationMethods: ['outdoor'], farmData: { landOwnership: 'OWNED' }, ...extra,
    },
});
const rows = (types) => types.map((documentType) => ({ documentType, supersededAt: null }));

describe('purpose-derived slots travel through the one stamp', () => {
    test('first submit: the stamp built from appliedRules carries licence_pt11', async () => {
        prisma.applicationDocument.findMany.mockResolvedValue(rows(DOC_TYPES));
        const { appliedRules } = await svc.assertRequiredDocumentsPresent({ application: app(), mode: svc.MODE_FIRST_SUBMIT });
        expect(svc.buildRequirementSnapshot(appliedRules).slotIds).toContain('licence_pt11');
    });

    test('resubmit without licence_pt11 is refused (purpose PROCESSING, cannabis)', async () => {
        prisma.applicationDocument.findMany.mockResolvedValue(rows(DOC_TYPES));
        const first = await svc.assertRequiredDocumentsPresent({ application: app(), mode: svc.MODE_FIRST_SUBMIT });
        const stamp = svc.buildRequirementSnapshot(first.appliedRules);
        // applicant drops the licence during the revision
        prisma.applicationDocument.findMany.mockResolvedValue(rows(DOC_TYPES.filter((t) => t !== 'licence_pt11')));
        await expect(svc.assertRequiredDocumentsPresent({
            application: app({ serverRequirementSnapshot: stamp }), mode: svc.MODE_RESUBMIT,
        })).rejects.toMatchObject({
            code: 'APPLICATION_INCOMPLETE',
            missingSlots: [expect.objectContaining({ slotId: 'licence_pt11' })],
        });
    });
});
