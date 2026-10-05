// M2a Task 2 — the requirement engine reads the law AS OF the filing date, and
// the law is append-only.
// Spec: design note 2026-08-15-membership-m2-documents-and-poa-design §3
// Plan: design note 2026-08-15-m2a-requirement-engine Task 2
//
// Three things this file exists to hold down:
//   (1) the WINDOW — effectiveFrom <= at AND (effectiveTo IS NULL OR effectiveTo > at)
//       and the dimensions (NULL = every value). Asserted on the `where` object
//       actually handed to findMany, and — more importantly — evaluated against
//       sample rows by a miniature Prisma-where interpreter below, so a where
//       that is merely SHAPED right but semantically wrong still fails.
//   (2) closeRule touches THREE columns and no others (effectiveTo/closedBy/
//       closedAt). The close reason is audit evidence, never row body.
//   (3) there is NO way to edit a rule body: the module exports exactly three
//       functions and closeRule's signature has nowhere to put a slotId.

jest.mock('../../services/prisma-database', () => {
    const mockPrisma = {
        requirementRule: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            update: jest.fn(),
        },
    };
    mockPrisma.$transaction = jest.fn(async (fn) => fn(mockPrisma));
    return { prisma: mockPrisma };
});

// Pattern: entity-claim-guard.test.js:52 — keep every real constant
// (AuditCategory / AuditSeverity / ResourceType) so the module under test still
// resolves them; stub only the writer.
jest.mock('../../middleware/audit-logger', () => {
    const actual = jest.requireActual('../../middleware/audit-logger');
    return {
        ...actual,
        auditLogger: {
            log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
            logWithin: jest.fn().mockResolvedValue({ id: 'audit-1' }),
        },
    };
});

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { prisma } = require('../../services/prisma-database');
const { auditLogger, AuditCategory, ResourceType } = require('../../middleware/audit-logger');
const svc = require('../../services/requirement-rule-service');

// ---------------------------------------------------------------------------
// A miniature interpreter for the subset of Prisma `where` this service may
// legitimately use. Unknown operators THROW: if the implementation reaches for
// `not` / `notIn` / raw SQL, this test fails loudly instead of quietly agreeing.
// ---------------------------------------------------------------------------
function matchesCondition(value, cond) {
    if (cond === null) { return value === null || value === undefined; }
    if (cond instanceof Date) { return value instanceof Date && value.getTime() === cond.getTime(); }
    if (typeof cond === 'object') {
        return Object.entries(cond).every(([op, operand]) => {
            if (op === 'equals') { return matchesCondition(value, operand); }
            if (value === null || value === undefined) { return false; }
            if (op === 'lte') { return value <= operand; }
            if (op === 'lt') { return value < operand; }
            if (op === 'gt') { return value > operand; }
            if (op === 'gte') { return value >= operand; }
            throw new Error(`unsupported operator in requirement-rule where: ${op}`);
        });
    }
    return value === cond;
}

function matchesWhere(where, row) {
    return Object.entries(where).every(([key, cond]) => {
        if (key === 'AND') { return cond.every((c) => matchesWhere(c, row)); }
        if (key === 'OR') { return cond.some((c) => matchesWhere(c, row)); }
        if (key === 'NOT') { throw new Error('unsupported NOT in requirement-rule where'); }
        return matchesCondition(row[key], cond);
    });
}

const AT = new Date('2026-08-15T03:00:00.000Z');
const YESTERDAY = new Date('2026-08-14T00:00:00.000Z');
const TWO_DAYS_AGO = new Date('2026-08-13T00:00:00.000Z');
const TOMORROW = new Date('2026-08-16T00:00:00.000Z');

// A row as Prisma would hand it back. Dimensions default to NULL = "every value".
function row(overrides = {}) {
    return {
        id: 'rule-x',
        holderType: null,
        requestType: null,
        plantCode: null,
        slotId: 'company_reg',
        isRequired: true,
        maxDocumentAgeMonths: 6,
        effectiveFrom: YESTERDAY,
        effectiveTo: null,
        createdBy: 'SYSTEM-M2A-SEED',
        reason: null,
        closedBy: null,
        closedAt: null,
        ...overrides,
    };
}

const ACTOR = Object.freeze({
    id: 'user-admin-1',
    role: 'ADMIN',
    organizationId: 'org-1',
});

beforeEach(() => {
    jest.clearAllMocks();
    prisma.requirementRule.findMany.mockResolvedValue([]);
    prisma.requirementRule.findUnique.mockResolvedValue(null);
    prisma.requirementRule.create.mockImplementation(async ({ data }) => ({ id: 'rule-new-1', ...data }));
    prisma.requirementRule.update.mockImplementation(async ({ where, data }) => ({ ...row(), id: where.id, ...data }));
});

describe('rulesAt — the law in force on the day asked about', () => {
    it('a rule effective yesterday..open applies today; effective tomorrow does not; closed yesterday does not', async () => {
        const open = row({ id: 'r-open', effectiveFrom: YESTERDAY, effectiveTo: null });
        prisma.requirementRule.findMany.mockResolvedValue([open]);

        const out = await svc.rulesAt({
            at: AT, holderType: 'JURISTIC', requestType: 'NEW', plantCode: 'cannabis',
        });
        expect(out).toEqual([open]);

        expect(prisma.requirementRule.findMany).toHaveBeenCalledTimes(1);
        const { where } = prisma.requirementRule.findMany.mock.calls[0][0];

        // The lower bound is derived from the argument, never from now(): the caller
        // states the instant and the service asks for the law of the Thai calendar
        // DAY that instant falls in — ณ วันยื่น (G2). AT is 10:00 ICT on 2026-08-15,
        // whose day ends at 16:59:59.999Z.
        expect(where.effectiveFrom).toEqual({ lte: new Date('2026-08-15T16:59:59.999Z') });

        // The upper bound is a semantic claim, so evaluate it against rows.
        expect(matchesWhere(where, open)).toBe(true);
        expect(matchesWhere(where, row({ id: 'r-future', effectiveFrom: TOMORROW }))).toBe(false);
        expect(matchesWhere(where, row({
            id: 'r-closed', effectiveFrom: TWO_DAYS_AGO, effectiveTo: YESTERDAY,
        }))).toBe(false);
        // Boundaries: starts exactly at `at` = in force; closed exactly at `at` = out.
        expect(matchesWhere(where, row({ id: 'r-starts-now', effectiveFrom: AT }))).toBe(true);
        expect(matchesWhere(where, row({
            id: 'r-closed-now', effectiveFrom: TWO_DAYS_AGO, effectiveTo: AT,
        }))).toBe(false);
        // A rule closed in the future is still in force today (AC3: an
        // application filed now is judged by it).
        expect(matchesWhere(where, row({ id: 'r-closes-later', effectiveTo: TOMORROW }))).toBe(true);
    });

    // F-QA-05. The register's dates are Thai calendar days written as midnights, and
    // a midnight written UTC is 07:00 in Bangkok. Asked with the raw instant, a rule
    // announced for วันที่ ๗ did not bind a filing made at 01:30 on วันที่ ๗ — the
    // filing was judged by the previous day's law, silently, and a RENEWAL that owed
    // an identity paper was told it owed nothing.
    it('law announced for today binds a filing made in the first hours of today, and tomorrow\'s does not', async () => {
        const EARLY = new Date('2026-08-14T18:30:00.000Z'); // 01:30 ICT on 2026-08-15
        await svc.rulesAt({ at: EARLY, holderType: 'JURISTIC', requestType: 'NEW' });
        const { where } = prisma.requirementRule.findMany.mock.calls[0][0];

        // announced for 2026-08-15, stored as every writer stores a day
        expect(matchesWhere(where, row({
            id: 'r-announced-today', effectiveFrom: new Date('2026-08-15T00:00:00.000Z'),
        }))).toBe(true);
        // an announcement for the NEXT Thai day is still ahead of this filing
        expect(matchesWhere(where, row({
            id: 'r-announced-tomorrow', effectiveFrom: new Date('2026-08-16T00:00:00.000Z'),
        }))).toBe(false);
        // and the closing edge keeps its instant — a rule retired at 01:00 ICT is out
        // for a filing at 01:30, not in force until midnight
        expect(matchesWhere(where, row({
            id: 'r-retired-this-morning',
            effectiveFrom: new Date('2026-08-14T00:00:00.000Z'),
            effectiveTo: new Date('2026-08-14T18:00:00.000Z'),
        }))).toBe(false);
    });

    it('dimension null matches everything; a JURISTIC rule never fires for COMMUNITY_ENTERPRISE', async () => {
        await svc.rulesAt({ at: AT, holderType: 'COMMUNITY_ENTERPRISE', requestType: 'RENEWAL' });
        const { where } = prisma.requirementRule.findMany.mock.calls[0][0];

        expect(matchesWhere(where, row({ holderType: null }))).toBe(true);
        expect(matchesWhere(where, row({ holderType: 'COMMUNITY_ENTERPRISE' }))).toBe(true);
        expect(matchesWhere(where, row({ holderType: 'JURISTIC' }))).toBe(false);
        expect(matchesWhere(where, row({ holderType: 'INDIVIDUAL' }))).toBe(false);

        expect(matchesWhere(where, row({ requestType: null }))).toBe(true);
        expect(matchesWhere(where, row({ requestType: 'RENEWAL' }))).toBe(true);
        expect(matchesWhere(where, row({ requestType: 'NEW' }))).toBe(false);
        expect(matchesWhere(where, row({ requestType: 'REPLACEMENT' }))).toBe(false);
        // ONE vocabulary (document-slots.js): a row typed 'RENEW' is not a
        // synonym — it is a rule that never fires. Pinned so nobody "fixes" the
        // engine by teaching it a fifth word.
        expect(matchesWhere(where, row({ requestType: 'RENEW' }))).toBe(false);

        // plantCode was not asked about → only plant-agnostic rules may bind.
        expect(matchesWhere(where, row({ plantCode: null }))).toBe(true);
        expect(matchesWhere(where, row({ plantCode: 'cannabis' }))).toBe(false);
    });

    it('runs on the caller-supplied client when given one (submit gate passes its tx)', async () => {
        const tx = { requirementRule: { findMany: jest.fn().mockResolvedValue([row()]) } };
        const out = await svc.rulesAt({ at: AT, holderType: 'JURISTIC' }, tx);

        expect(out).toHaveLength(1);
        expect(tx.requirementRule.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.requirementRule.findMany).not.toHaveBeenCalled();
    });
});

describe('createRule — a new row is the only way to change the law', () => {
    it('stores the slot in canonical form, so a rule written through an alias still fires', async () => {
        await svc.createRule({
            holderType: 'JURISTIC',
            slotId: 'COMPANY_REG',
            effectiveFrom: AT,
            maxDocumentAgeMonths: 6,
            reason: 'ministry ruling',
        }, ACTOR);
        // v2 canon (spec 2026-09-01): COMPANY_REG and LAND_TITLE are two of the
        // spellings the กทล.1 slot fold retired, so the canonical form a rule is
        // stored under is now the กทล.1 slot, not the old wizard id. That is the
        // point of storing canonically at all: a rule typed in either spelling
        // still matches evidence recorded in either spelling.
        expect(prisma.requirementRule.create.mock.calls[0][0].data.slotId).toBe('juristic_reg_6m');

        await svc.createRule({ slotId: 'LAND_TITLE', effectiveFrom: AT }, ACTOR);
        expect(prisma.requirementRule.create.mock.calls[1][0].data.slotId).toBe('land_rights');
    });

    it('writes only whitelisted columns — a caller cannot choose the id or forge the closing stamps', async () => {
        await svc.createRule({
            slotId: 'company_reg',
            effectiveFrom: AT,
            id: 'attacker-chosen-id',
            createdAt: TWO_DAYS_AGO,
            createdBy: 'somebody-else',
            closedBy: 'ghost',
            closedAt: TWO_DAYS_AGO,
        }, ACTOR);

        const { data } = prisma.requirementRule.create.mock.calls[0][0];
        expect(data.id).toBeUndefined();
        expect(data.createdAt).toBeUndefined();
        expect(data.closedBy).toBeUndefined();
        expect(data.closedAt).toBeUndefined();
        expect(data.createdBy).toBe(ACTOR.id);
        expect(data.isRequired).toBe(true);
    });

    it('refuses a rule with no slot and a rule with no actor — createdBy/slotId are NOT NULL', async () => {
        await expect(svc.createRule({ effectiveFrom: AT }, ACTOR)).rejects.toMatchObject({ status: 400 });
        await expect(svc.createRule({ slotId: 'company_reg', effectiveFrom: AT }, null))
            .rejects.toMatchObject({ status: 400 });
        expect(prisma.requirementRule.create).not.toHaveBeenCalled();
    });

    it('writes an audit row carrying the substance of the rule', async () => {
        // The mocked create echoes the persisted row (beforeEach) — metadata is
        // read off the ROW, so what the audit says is what the table holds.
        const created = await svc.createRule({
            holderType: 'JURISTIC',
            requestType: 'NEW',
            slotId: 'COMPANY_REG',
            effectiveFrom: AT,
            maxDocumentAgeMonths: 6,
            reason: 'ministry ruling 2026',
        }, ACTOR);
        expect(created.id).toBe('rule-new-1');

        expect(auditLogger.log).toHaveBeenCalledTimes(1);
        const event = auditLogger.log.mock.calls[0][0];
        expect(event.action).toBe('REQUIREMENT_RULE_CREATED');
        expect(event.category).toBe(AuditCategory.ADMIN);
        expect(event.resourceType).toBe(ResourceType.SYSTEM);
        expect(event.resourceId).toBe('rule-new-1');
        expect(event.actorId).toBe(ACTOR.id);
        expect(event.actorRole).toBe(ACTOR.role);
        expect(event.organizationId).toBe(ACTOR.organizationId);
        expect(event.result).toBe('SUCCESS');
        expect(event.metadata).toMatchObject({
            holderType: 'JURISTIC',
            requestType: 'NEW',
            plantCode: null,
            slotId: 'juristic_reg_6m',
            isRequired: true,
            maxDocumentAgeMonths: 6,
            reason: 'ministry ruling 2026',
        });
    });

    // review r0 F2 — the three กทล.1 case dimensions are the whole point of the
    // 2026-09-01 change, and until this test existed, deleting the three lines
    // that persist them left every suite green: the seed would then file every
    // case rule with NULL dims, and NULL binds EVERY application, so an
    // OWNED-land farmer would be refused at submit for a landlord consent letter
    // that cannot exist. Asserted on the create ARGUMENT (what the table gets)
    // and on the audit metadata (what an auditor can read back) together.
    it('persists landTenure/areaType/certScope onto the row AND into the audit row', async () => {
        await svc.createRule({
            slotId: 'landlord_consent',
            effectiveFrom: AT,
            landTenure: 'RENTED',
            areaType: 'INDOOR',
            certScope: 'PLANTING',
        }, ACTOR);

        const { data } = prisma.requirementRule.create.mock.calls[0][0];
        expect(data.landTenure).toBe('RENTED');
        expect(data.areaType).toBe('INDOOR');
        expect(data.certScope).toBe('PLANTING');

        const { metadata } = auditLogger.log.mock.calls[0][0];
        expect(metadata.landTenure).toBe('RENTED');
        expect(metadata.areaType).toBe('INDOOR');
        expect(metadata.certScope).toBe('PLANTING');
    });

    it('a rule that names no case dimension binds every case (all three stored NULL)', async () => {
        await svc.createRule({ slotId: 'id_card', effectiveFrom: AT }, ACTOR);

        const { data } = prisma.requirementRule.create.mock.calls[0][0];
        expect(data.landTenure).toBeNull();
        expect(data.areaType).toBeNull();
        expect(data.certScope).toBeNull();
    });

    // review r0 F4 — the admin route trims before it validates
    // (routes/api/admin/requirement-rules.js:70-76); the service did not, so a
    // seed row or CSV cell holding 'RENTED ' was refused with a message naming a
    // word that looks identical to an allowed one. Whitespace is not a different
    // law.
    it('trims a dimension value, so a stray space in a seed row is not a different word', async () => {
        await svc.createRule({
            slotId: 'landlord_consent',
            effectiveFrom: AT,
            holderType: ' JURISTIC ',
            landTenure: 'RENTED ',
            areaType: ' INDOOR',
        }, ACTOR);

        const { data } = prisma.requirementRule.create.mock.calls[0][0];
        expect(data.holderType).toBe('JURISTIC');
        expect(data.landTenure).toBe('RENTED');
        expect(data.areaType).toBe('INDOOR');
        // A value that is ONLY whitespace says nothing, so it means "every value".
        await svc.createRule({ slotId: 'id_card', effectiveFrom: AT, certScope: '   ' }, ACTOR);
        expect(prisma.requirementRule.create.mock.calls[1][0].data.certScope).toBeNull();
    });
});

describe('closeRule — retiring a rule is the only touch an existing row ever gets', () => {
    const OPEN_ROW = row({ id: 'rule-1', holderType: 'JURISTIC', reason: 'the original reason' });

    it('updates exactly effectiveTo/closedBy/closedAt and nothing else', async () => {
        prisma.requirementRule.findUnique.mockResolvedValue(OPEN_ROW);

        await svc.closeRule('rule-1', ACTOR, 'superseded by ministry order 12/2569');

        expect(prisma.requirementRule.update).toHaveBeenCalledTimes(1);
        const call = prisma.requirementRule.update.mock.calls[0][0];
        expect(Object.keys(call.data).sort()).toEqual(['closedAt', 'closedBy', 'effectiveTo']);
        expect(call.data.closedBy).toBe(ACTOR.id);
        expect(call.data.effectiveTo).toBeInstanceOf(Date);
        expect(call.data.closedAt).toBeInstanceOf(Date);
        expect(call.data.effectiveTo.getTime()).toBe(call.data.closedAt.getTime());
        // The close reason is evidence in the audit row — writing it onto the
        // row would overwrite WHY the rule was created.
        expect(call.data.reason).toBeUndefined();
        // Concurrency guard: only a still-open row may be closed, so two racing
        // closes cannot rewrite effectiveTo.
        expect(call.where).toEqual({ id: 'rule-1', effectiveTo: null });
    });

    it('writes the REQUIREMENT_RULE_CLOSED audit row with the reason', async () => {
        prisma.requirementRule.findUnique.mockResolvedValue(OPEN_ROW);

        await svc.closeRule('rule-1', ACTOR, 'superseded by ministry order 12/2569');

        expect(auditLogger.log).toHaveBeenCalledTimes(1);
        const event = auditLogger.log.mock.calls[0][0];
        expect(event.action).toBe('REQUIREMENT_RULE_CLOSED');
        expect(event.category).toBe(AuditCategory.ADMIN);
        expect(event.resourceType).toBe(ResourceType.SYSTEM);
        expect(event.resourceId).toBe('rule-1');
        expect(event.actorId).toBe(ACTOR.id);
        expect(event.metadata).toMatchObject({
            reason: 'superseded by ministry order 12/2569',
            slotId: 'company_reg',
            holderType: 'JURISTIC',
        });
    });

    it('refuses to re-close a closed rule, and refuses a rule that does not exist', async () => {
        prisma.requirementRule.findUnique.mockResolvedValue(row({ id: 'rule-1', effectiveTo: YESTERDAY }));
        await expect(svc.closeRule('rule-1', ACTOR, 'again')).rejects.toMatchObject({ status: 409 });

        prisma.requirementRule.findUnique.mockResolvedValue(null);
        await expect(svc.closeRule('rule-missing', ACTOR, 'nope')).rejects.toMatchObject({ status: 404 });

        expect(prisma.requirementRule.update).not.toHaveBeenCalled();
        expect(auditLogger.log).not.toHaveBeenCalled();
    });
});

describe('the service exposes NO way to edit a rule body', () => {
    it('exports exactly rulesAt/createRule/closeRule + the vocabulary — no updateRule, no deleteRule', () => {
        expect(svc.updateRule).toBeUndefined();
        expect(svc.deleteRule).toBeUndefined();
        // Grew on 2026-09-01 (กทล.1 case dimensions): RULE_DIMENSIONS is the
        // closed vocabulary. Grew again on 2026-09-05: plantCodesWithRulesAt is a
        // READER — it answers "which plants has law been filed for", which the
        // lens asks before it agrees to judge a filing at all. Both additions are
        // read doors; the list stays exhaustive, which is what makes a
        // smuggled-in updateRule fail here.
        expect(Object.keys(svc).sort()).toEqual([
            'RULE_DIMENSIONS', 'closeRule', 'createRule', 'plantCodesWithRulesAt', 'rulesAt',
        ]);
        // ONE name for the write door (review r0 F5). While both `insertRule`
        // and `createRule` were exported, a later hardening of one name would
        // have left every caller of the other on the unhardened path — the pin
        // above only blocks a THIRD name, so the second name is pinned dead here.
        expect(svc.insertRule).toBeUndefined();
    });

    it('closeRule has nowhere to put a slotId — the signature is (id, actor, reason)', () => {
        expect(svc.closeRule.length).toBe(3);
        expect(svc.createRule.length).toBe(2);
    });
});

describe('fix round 4 — audit rows follow the transaction client', () => {
    const txClient = () => ({
        requirementRule: {
            findUnique: jest.fn().mockResolvedValue({ id: 'r1', slotId: 'x', effectiveTo: null, effectiveFrom: new Date() }),
            update: jest.fn().mockResolvedValue({ id: 'r1' }),
            create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'n1', ...data })),
        },
        auditLog: { create: jest.fn() },
        $executeRaw: jest.fn(),
    });
    const WHO = { id: 'u1', role: 'admin', organizationId: 'org-1' };

    beforeEach(() => { auditLogger.log.mockClear(); auditLogger.logWithin.mockClear(); });

    it('closeRule with a tx writes REQUIREMENT_RULE_CLOSED through logWithin(tx), not the global logger', async () => {
        const tx = txClient();
        await svc.closeRule('r1', WHO, 'why', tx);
        expect(auditLogger.log).not.toHaveBeenCalled();
        expect(auditLogger.logWithin).toHaveBeenCalledTimes(1);
        expect(auditLogger.logWithin.mock.calls[0][0].action).toBe('REQUIREMENT_RULE_CLOSED');
        expect(auditLogger.logWithin.mock.calls[0][1]).toBe(tx);
    });

    it('createRule with a tx writes REQUIREMENT_RULE_CREATED through logWithin(tx)', async () => {
        const tx = txClient();
        await svc.createRule({ slotId: 'id_card' }, WHO, tx);
        expect(auditLogger.log).not.toHaveBeenCalled();
        expect(auditLogger.logWithin.mock.calls[0][0].action).toBe('REQUIREMENT_RULE_CREATED');
        expect(auditLogger.logWithin.mock.calls[0][1]).toBe(tx);
    });

    it('createRule refuses controlled_herb_license in any spelling, before any write', async () => {
        for (const slotId of ['controlled_herb_license', 'CONTROLLED_HERB_LICENSE', 'LICENSE_BT11']) {
            await expect(svc.createRule({ slotId, plantCode: 'cannabis' }, WHO, txClient()))
                .rejects.toMatchObject({ status: 400, code: 'REQUIREMENT_RULE_SLOT_LAW_DECIDED' });
        }
    });
});
