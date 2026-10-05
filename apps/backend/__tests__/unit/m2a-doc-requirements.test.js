'use strict';

/**
 * M2a Task 4 — the document law, applied to ONE application.
 *
 * This suite drives services/application-document-requirements.js: the piece
 * that turns dated rows in `requirement_rules` into a yes/no about a specific
 * filing. Three things are proven here that no door-level test can prove as
 * sharply:
 *
 *   1. EVIDENCE IS SERVER-SIDE (AC2). `formData.documents[].uploaded = true` is
 *      a client flag; a submit that carries nothing else is still incomplete.
 *   2. BOTH SIDES CANONICALIZE (review M4/M5). A rule filed as 'COMPANY_REG'
 *      and a document recorded as 'company_reg' are the same requirement, and
 *      an ApplicationDocument row is read through its `documentType` — never
 *      through the raw row, whose `id` is a UUID that would otherwise be
 *      mistaken for a slot.
 *   3. THE LAW IS FROZEN AT FIRST SUBMIT (AC3). A resubmit is judged by the
 *      snapshot stamped on the application, so a rule filed afterwards cannot
 *      422 an application that was compliant on the day it was filed.
 *
 * `rulesAt` is NOT mocked: the real query from requirement-rule-service runs
 * against an in-memory matcher below, so the dimension semantics ("NULL means
 * every value") are proven end-to-end rather than assumed.
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        entity: { findUnique: jest.fn() },
        requirementRule: { findMany: jest.fn() },
        applicationDocument: { findMany: jest.fn() },
    },
}));

jest.mock('../../middleware/audit-logger', () => {
    const actual = jest.requireActual('../../middleware/audit-logger');
    return {
        ...actual,
        auditLogger: { log: jest.fn().mockResolvedValue({ id: 'audit-1' }), logWithin: jest.fn(() => jest.fn()) },
    };
});

const { prisma: prismaMock } = require('../../services/prisma-database');
const logger = require('../../shared/logger');
const svc = require('../../services/application-document-requirements');

// ── an in-memory `requirementRule.findMany` ─────────────────────────────────
//
// Small enough to read, faithful to the exact `where` shapes rulesAt builds
// (requirement-rule-service.js:101-109): a scalar equality, `null`,
// `{ lte } / { gt }`, and nested OR / AND. If the service ever stops asking the
// question it asks today, these tests stop passing for the right reason.

function matchesCondition(value, condition) {
    if (condition === null) { return value === null || value === undefined; }
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
        if ('in' in condition) { return condition.in.includes(value); }
        if ('lte' in condition) { return new Date(value) <= new Date(condition.lte); }
        if ('gt' in condition) { return value !== null && value !== undefined && new Date(value) > new Date(condition.gt); }
    }
    return value === condition;
}

function matchesWhere(row, where) {
    return Object.entries(where || {}).every(([key, condition]) => {
        if (key === 'AND') { return condition.every((sub) => matchesWhere(row, sub)); }
        if (key === 'OR') { return condition.some((sub) => matchesWhere(row, sub)); }
        if (key === 'NOT') { return !matchesWhere(row, condition); }
        return matchesCondition(row[key], condition);
    });
}

const YESTERDAY = new Date(Date.now() - 86400000);

function rule(overrides) {
    return {
        id: `rule-${overrides.slotId}-${overrides.holderType || 'any'}`,
        holderType: null,
        requestType: null,
        plantCode: null,
        isRequired: true,
        maxDocumentAgeMonths: null,
        effectiveFrom: YESTERDAY,
        effectiveTo: null,
        createdBy: 'SYSTEM-M2A-SEED',
        ...overrides,
    };
}

const JURISTIC_COMPANY_REG = rule({ holderType: 'JURISTIC', slotId: 'company_reg' });
const COMMUNITY_CERT = rule({ holderType: 'COMMUNITY_ENTERPRISE', slotId: 'community_cert' });

function lawOfTheLand(rows) {
    prismaMock.requirementRule.findMany.mockImplementation(async ({ where }) => rows.filter((r) => matchesWhere(r, where)));
}

function application(overrides = {}) {
    return {
        id: 'app-1',
        entityId: 'ent-1',
        ...overrides,
        // Every filing names what it grows. Since 2026-09-05 a filing that does not is
        // refused rather than judged by whatever law happens to bind every plant — the
        // M2A rows here are all plant-agnostic, so this suite's register still judges it.
        // Merged AFTER the overrides so a case that supplies its own formData keeps both.
        // ขมิ้นชัน + ส่งออก = ไม่มีใบอนุญาตตามกฎหมาย (fix round 3: ยื่นแล้วต้องมีวัตถุประสงค์อย่างน้อยหนึ่งข้อ)
        formData: { plantId: 'turmeric', certificationPurposes: ['EXPORT'], ...(overrides.formData || {}) },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.entity.findUnique.mockResolvedValue({ type: 'JURISTIC' });
    prismaMock.applicationDocument.findMany.mockResolvedValue([]);
    lawOfTheLand([JURISTIC_COMPANY_REG, COMMUNITY_CERT]);
});

// ── AC1: the per-holder-type demand ─────────────────────────────────────────

describe('first-submit — the law as of today, per holder type (AC1)', () => {
    it('JURISTIC with no server-side COMPANY_REG → 422 APPLICATION_INCOMPLETE naming the slot', async () => {
        expect.assertions(4);
        try {
            await svc.assertRequiredDocumentsPresent({ application: application(), mode: 'first-submit' });
        } catch (error) {
            expect(error.status).toBe(422);
            expect(error.code).toBe('APPLICATION_INCOMPLETE');
            // v2 canon (spec 2026-09-01): a rule filed as 'company_reg' is the
            // same law about the same paper, and it now names the กทล.1 slot and
            // carries the ministry's own words for it.
            expect(error.missingSlots).toEqual([{
                slotId: 'juristic_reg_6m',
                labelTH: 'สำเนาหนังสือรับรองการจดทะเบียนนิติบุคคล (ออกให้ไม่เกิน 6 เดือน)',
            }]);
            // The label is the ministry's own words from the slot catalog, not a
            // string invented here — an applicant must be able to act on it.
            expect(error.missingSlots[0].labelTH).not.toBe('juristic_reg_6m');
        }
    });

    it('COMMUNITY_ENTERPRISE is asked for its own document, not the company one', async () => {
        prismaMock.entity.findUnique.mockResolvedValue({ type: 'COMMUNITY_ENTERPRISE' });
        await expect(
            svc.assertRequiredDocumentsPresent({ application: application(), mode: 'first-submit' }),
        // Filed as 'community_cert' (the M2a seed's own spelling), answered as the
        // กทล.1 slot: one paper, one slot, and the หนังสือจดทะเบียนวิสาหกิจชุมชน
        // already on file keeps counting (spec §2.1, §7).
        ).rejects.toMatchObject({ status: 422, missingSlots: [{ slotId: 'community_reg_members' }] });
    });

    it('INDIVIDUAL is asked for nothing extra — no rule of theirs is in force', async () => {
        prismaMock.entity.findUnique.mockResolvedValue({ type: 'INDIVIDUAL' });

        const { appliedRules } = await svc.assertRequiredDocumentsPresent({
            application: application(), mode: 'first-submit',
        });

        expect(appliedRules).toEqual([]);
    });

    it('a rule with every dimension NULL binds even the INDIVIDUAL filing', async () => {
        prismaMock.entity.findUnique.mockResolvedValue({ type: 'INDIVIDUAL' });
        lawOfTheLand([rule({ slotId: 'id_card' })]);

        await expect(
            svc.assertRequiredDocumentsPresent({ application: application(), mode: 'first-submit' }),
        ).rejects.toMatchObject({ missingSlots: [{ slotId: 'id_house_reg' }] });
    });

    it('a rule that is not yet in force does not fire, a closed one stops firing', async () => {
        lawOfTheLand([
            rule({ slotId: 'company_reg', holderType: 'JURISTIC', effectiveFrom: new Date(Date.now() + 86400000) }),
            rule({ slotId: 'id_card', effectiveTo: YESTERDAY }),
        ]);

        const { appliedRules } = await svc.assertRequiredDocumentsPresent({
            application: application(), mode: 'first-submit',
        });

        expect(appliedRules).toEqual([]);
    });

    it('isRequired:false is a rule on the books that demands nothing', async () => {
        lawOfTheLand([rule({ slotId: 'company_reg', holderType: 'JURISTIC', isRequired: false })]);

        const { appliedRules } = await svc.assertRequiredDocumentsPresent({
            application: application(), mode: 'first-submit',
        });

        expect(appliedRules).toEqual([]);
    });

    it('a renewal is judged by the RENEWAL law, never by a word this codebase does not speak', async () => {
        lawOfTheLand([
            rule({ slotId: 'company_reg', holderType: 'JURISTIC', requestType: 'RENEWAL' }),
            rule({ slotId: 'id_card', holderType: 'JURISTIC', requestType: 'NEW' }),
        ]);

        await expect(svc.assertRequiredDocumentsPresent({
            application: application({ formData: { renewalOf: 'cert-1' } }), mode: 'first-submit',
        })).rejects.toMatchObject({ missingSlots: [{ slotId: 'juristic_reg_6m' }] });

        // and the plain filing gets the NEW rule instead
        await expect(svc.assertRequiredDocumentsPresent({
            application: application(), mode: 'first-submit',
        })).rejects.toMatchObject({ missingSlots: [{ slotId: 'id_house_reg' }] });
    });
});

// ── AC2: what counts as evidence ────────────────────────────────────────────

describe('evidence is what the SERVER holds (AC2)', () => {
    it('a draftDocuments entry recorded under an old alias satisfies the rule', async () => {
        const app = application({
            formData: { draftDocuments: [{ documentId: 'd1', slotId: 'COMPANY_REG', fileUrl: '/u/1.pdf' }] },
        });

        const { appliedRules } = await svc.assertRequiredDocumentsPresent({ application: app, mode: 'first-submit' });

        expect(appliedRules.map((r) => r.slotId)).toEqual(['company_reg']);
    });

    it('an ApplicationDocument row satisfies it through documentType — the row id is NOT a slot', async () => {
        prismaMock.applicationDocument.findMany.mockResolvedValue([
            { id: '2b0f1e6a-0000-4000-8000-000000000001', documentType: 'COMPANY_REG' },
        ]);

        await expect(
            svc.assertRequiredDocumentsPresent({ application: application(), mode: 'first-submit' }),
        ).resolves.toMatchObject({ appliedRules: [expect.objectContaining({ slotId: 'company_reg' })] });

        const evidence = svc.collectServerDocumentEvidence(application(), [
            { id: '2b0f1e6a-0000-4000-8000-000000000001', documentType: 'COMPANY_REG' },
        ]);
        expect([...evidence]).toEqual(['juristic_reg_6m']);
        expect(evidence.has('2b0f1e6a-0000-4000-8000-000000000001')).toBe(false);
    });

    it('a client flag alone is worth nothing — documents[].uploaded = true still 422s', async () => {
        const app = application({
            formData: {
                documents: [
                    { slotId: 'company_reg', uploaded: true },
                    { slotId: 'COMPANY_REG', uploaded: true, fileUrl: '/fake' },
                ],
            },
        });

        await expect(
            svc.assertRequiredDocumentsPresent({ application: app, mode: 'first-submit' }),
        ).rejects.toMatchObject({ status: 422, missingSlots: [{ slotId: 'juristic_reg_6m' }] });
        // and the flag never even enters the evidence set
        expect([...svc.collectServerDocumentEvidence(app, [])]).toEqual([]);
    });

    it('reads the rows of THIS application only', async () => {
        await svc.assertRequiredDocumentsPresent({
            application: application({ formData: { draftDocuments: [{ slotId: 'company_reg' }] } }),
            mode: 'first-submit',
        });

        expect(prismaMock.applicationDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { applicationId: 'app-1' },
        }));
    });
});

// ── AC3: the law is frozen at first submit ──────────────────────────────────

describe('resubmit is judged by the stamp, not by todays law (AC3)', () => {
    const STAMPED = {
        stampedAt: '2026-08-15T00:00:00.000Z',
        ruleIds: ['m2a-seed-juristic-company-reg'],
        slotIds: ['company_reg'],
    };

    it('a rule filed after the first submit cannot 422 the resubmit', async () => {
        // today the law also demands a site map …
        lawOfTheLand([JURISTIC_COMPANY_REG, rule({ slotId: 'site_map' })]);
        const app = application({
            formData: {
                serverRequirementSnapshot: STAMPED,
                draftDocuments: [{ slotId: 'company_reg' }],
            },
        });

        await expect(
            svc.assertRequiredDocumentsPresent({ application: app, mode: 'resubmit' }),
        ).resolves.toMatchObject({ appliedRules: [] });
        // … and the table was not even consulted: the answer is on the application
        expect(prismaMock.requirementRule.findMany).not.toHaveBeenCalled();
    });

    it('the stamped set is still enforced — a stamped slot gone missing is a 422', async () => {
        const app = application({ formData: { serverRequirementSnapshot: STAMPED } });

        await expect(
            svc.assertRequiredDocumentsPresent({ application: app, mode: 'resubmit' }),
        ).rejects.toMatchObject({ status: 422, missingSlots: [{ slotId: 'juristic_reg_6m' }] });
    });

    it('a stamped slot written in an old spelling is compared canonically', async () => {
        const app = application({
            formData: {
                serverRequirementSnapshot: { ...STAMPED, slotIds: ['LAND_TITLE'] },
                draftDocuments: [{ slotId: 'land_deed' }],
            },
        });

        await expect(
            svc.assertRequiredDocumentsPresent({ application: app, mode: 'resubmit' }),
        ).resolves.toBeDefined();
    });

    it('an application filed before M2a has no stamp — it is grandfathered, and the warn says so', async () => {
        const app = application({ formData: { draftDocuments: [] } });

        const result = await svc.assertRequiredDocumentsPresent({ application: app, mode: 'resubmit' });

        expect(result).toMatchObject({ appliedRules: [], grandfathered: true });
        expect(prismaMock.requirementRule.findMany).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('app-1'));
    });

    it('the mode is the DOORs word — the service never guesses it from a status', async () => {
        await expect(svc.assertRequiredDocumentsPresent({
            application: application({ status: 'DRAFT' }), mode: 'nonsense',
        })).rejects.toThrow(/mode/i);
    });
});

// ── the stamp itself ────────────────────────────────────────────────────────

describe('buildRequirementSnapshot — what gets written on the application', () => {
    it('records the rules consulted and the slots they demanded, canonically', () => {
        const snapshot = svc.buildRequirementSnapshot([
            { id: 'r-1', slotId: 'COMPANY_REG' },
            { id: 'r-2', slotId: 'LAND_TITLE' },
        ]);

        expect(snapshot.ruleIds).toEqual(['r-1', 'r-2']);
        // v2 canon (spec 2026-09-01): both old spellings name กทล.1 slots now.
        expect(snapshot.slotIds).toEqual(['juristic_reg_6m', 'land_rights']);
        expect(Date.parse(snapshot.stampedAt)).not.toBeNaN();
    });

    it('an empty law still produces a stamp — "nothing was demanded" is an answer worth keeping', () => {
        const snapshot = svc.buildRequirementSnapshot([]);

        expect(snapshot.slotIds).toEqual([]);
        expect(snapshot.ruleIds).toEqual([]);
    });

    it('is pure — the same rules stamp the same slots twice', () => {
        const rules = [{ id: 'r-1', slotId: 'company_reg' }];
        expect(svc.buildRequirementSnapshot(rules).slotIds).toEqual(svc.buildRequirementSnapshot(rules).slotIds);
    });
});
