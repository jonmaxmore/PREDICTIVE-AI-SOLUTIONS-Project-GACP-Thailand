// Domain: Requirement Engine — read the document law AS OF the filing date.
// Spec: design note 2026-08-15-membership-m2-documents-and-poa-design §3
// (operator ruling G2). Table + migration: prisma/schema/requirement-rule.prisma (M2a Task 1).
//
// APPEND-ONLY IS ENFORCED HERE, not merely documented. The table has no
// updatedAt and this module has no updateRule: changing the law means closing
// the old row and inserting a new one. That is not bureaucracy — a rule that has
// ever been in force is the law an application was judged by on the day it was
// filed (AC3, ตรวจย้อนได้); editing it would silently rewrite the past for every
// application already decided under it.
//
// The ONLY write that ever touches an existing row is closeRule, and it may set
// exactly three columns: effectiveTo / closedBy / closedAt. Note what is NOT in
// that list: `reason`. The reason a rule was CREATED stays on the row; the reason
// it was RETIRED lives in the REQUIREMENT_RULE_CLOSED audit row.
//
// Every dimension is NULL-means-all: a rule with every dimension NULL binds
// every application. Since the 2026-09-01 กทล.1 spec (§2.1) the dimensions are
// holderType / requestType / plantCode plus the three case dimensions the form
// itself asks about — landTenure / areaType / certScope (RULE_DIMENSIONS below).

'use strict';

const { prisma } = require('./prisma-database');
// Audit rows are the point of a governance table, so they are written through
// the same chokepoint every other privileged write uses (pattern:
// services/entity-service.js:27-32).
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../middleware/audit-logger');
// SSOT for slot aliases. Rules are STORED canonical and COMPARED canonical on
// both sides, so a rule typed 'COMPANY_REG' or 'LAND_TITLE' is not a silent
// no-op against evidence recorded as 'company_reg' / 'land_deed'.
const { getCanonicalSlotId } = require('../routes/api/applications/validation-slot-utils');
// The register is dated law and the platform's day is the Thai day — same engine
// the revision deadlines are measured with, so there is one answer to "which
// calendar day is this instant in".
const { endOfLocalDay, DEFAULT_TIME_ZONE } = require('../utils/working-days');

const REQUIREMENT_RULE_CREATED = 'REQUIREMENT_RULE_CREATED';
const REQUIREMENT_RULE_CLOSED = 'REQUIREMENT_RULE_CLOSED';

/**
 * The CLOSED vocabulary of the three กทล.1 case dimensions (spec 2026-09-01
 * §2.1). กทล.1 ส่วนที่ ๓ does not ask for one fixed pile of documents: what a
 * case must attach depends on how it holds its land, what kind of area it is,
 * and which scope it asks to be certified for. Those three answers are
 * therefore dimensions of the law, exactly like holderType and requestType.
 *
 * The set is closed and lives here, next to the writer, rather than only at the
 * admin route: a misspelled dimension is not a stricter rule, it is a rule that
 * never fires — silent, and invisible until an application slips through
 * (same reasoning as routes/api/admin/requirement-rules.js:28-31). The seed job
 * that files the spec's row set writes through this door too, so the check has
 * to sit where EVERY writer passes.
 *
 * holderType / requestType are deliberately not listed here: their vocabulary
 * is already owned by routes/api/admin/requirement-rules.js:59-67, and a second
 * copy would be a second source of truth for the same words.
 */
const { AREA_TYPES } = require('../validation/canonical-application-validator');

const RULE_DIMENSIONS = Object.freeze({
    landTenure: Object.freeze(['OWNED', 'STATE_PERMITTED', 'RENTED']),
    // อ่านจากประตูยื่น ไม่พิมพ์ซ้ำ — ทะเบียนกับประตูต้องไม่คนละชุด
    // ('OTHER' ถูกถอดออก 2026-09-11 ตามมติ operator · ไม่มีกฎใดในฐานผูกกับคำนั้น:
    //  นับ requirement_rules 2026-09-11 ได้ areaType = NULL ทุกแถว)
    areaType: AREA_TYPES,
    certScope: Object.freeze(['PLANTING', 'PROCESSING']),
});

/**
 * The last instant of the Asia/Bangkok calendar day an instant falls in.
 *
 * WHY THE READ IS DAY-GRANULAR AT ALL. Operator ruling G2, verbatim: "รายการเอกสาร
 * บังคับ = ข้อมูลในฐานข้อมูล มีผลตามวันที่ ... คำขอถูกตัดสินด้วยชุดกติกา ณ วันยื่น"
 * (prisma/schema/requirement-rule.prisma:5-7). ณ วันยื่น is the DAY of filing, not
 * the second: the ministry announces "ประกาศนี้มีผลตั้งแต่วันที่ ๗ กันยายน" and every
 * writer stores that announcement as a midnight — the M2a migration, an admin body,
 * and `--effective-from=2026-09-07T00:00:00Z` in scripts/seed-herb-requirement-rules.js.
 *
 * A midnight written in UTC is 07:00 in Bangkok. Comparing it against a raw instant
 * therefore judged every filing made between 00:00 and 07:00 ICT on the day a rule
 * took effect by YESTERDAY's law, silently — F-QA-05: seven identity rules the
 * operator approved for 2026-09-07 (2a7ab531) were filed, present, un-closed, and
 * still absent from a resolve run on the morning of the 7th, so a RENEWAL and a
 * REPLACEMENT were asked for no identity paper at all. Nothing in the answer said
 * "this law starts in six hours"; it read as a filing that owed nothing.
 *
 * `effectiveFrom <= endOfLocalDay(asOf)` is exactly "the rule's Bangkok day is on or
 * before the filing's Bangkok day", written so the database can still do the
 * filtering. The CLOSING edge deliberately keeps its instant (`effectiveTo > asOf`):
 * retiring a rule is an act with a time on it, not an announcement for a date, and a
 * rule closed at 10:00 must stop being demanded at 10:00 rather than at midnight.
 * Both halves are pinned by __tests__/integration/requirement-rules-as-of-filing-day.test.js.
 */
function asOfFilingDayEnd(asOf) {
    return endOfLocalDay(asOf, DEFAULT_TIME_ZONE);
}

function ruleError(message, code, status) {
    const err = new Error(message);
    err.status = status;
    err.statusCode = status;
    err.code = code;
    return err;
}

function toDate(value, field) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw ruleError(`requirement rule: ${field} is not a valid date`, 'REQUIREMENT_RULE_INVALID', 400);
    }
    return date;
}

// A dimension the caller left unspecified may only be matched by rules that do
// not care about it. Asking "which rules bind an application whose plant I did
// not name" must NOT drag in a cannabis-only rule.
//
// An ARRAY is a dimension the filing answered with several words at once — กทล.1
// ส่วนที่ ๒ prints ลักษณะพื้นที่ as checkboxes, so a farm with a greenhouse standing
// in an open field ticks two of them and owes the papers of both. `IN` is what
// "any of the ticked values, plus the rules that bind everybody" means in one
// query, which keeps the result a single ordered list — the property the stamped
// snapshot depends on. An empty array is not a tick: it says nothing, and saying
// nothing is what NULL already means.
function dimensionClause(field, value) {
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return { [field]: null };
        }
        if (value.length === 1) {
            return { OR: [{ [field]: null }, { [field]: value[0] }] };
        }
        return { OR: [{ [field]: null }, { [field]: { in: value } }] };
    }
    if (value === null || value === undefined || value === '') {
        return { [field]: null };
    }
    return { OR: [{ [field]: null }, { [field]: value }] };
}

// Whitespace is not a different law: 'RENTED ' out of a CSV cell or a seed row
// is the word RENTED, and a value that is only spaces says nothing at all, which
// is what NULL already means. The admin route trims before it validates
// (routes/api/admin/requirement-rules.js:70-76); the service is the door every
// OTHER writer (seed jobs, migrations) comes through, so it trims too.
function normalizeDimension(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value).trim();
    return text === '' ? null : text;
}

// A case dimension is either absent (NULL = every value) or one of the words in
// RULE_DIMENSIONS. Anything else is refused with the value that is wrong and the
// set that is right, because the writer is a human typing national policy and a
// generic "invalid" would leave them guessing. Both doors use it: the writer so
// a mistyped rule is never filed, the reader so a mistyped question is never
// answered with "no rule binds you".
function normalizeCaseDimension(field, value) {
    const normalized = normalizeDimension(value);
    if (normalized === null) {
        return null;
    }
    const allowed = RULE_DIMENSIONS[field];
    if (!allowed.includes(normalized)) {
        throw ruleError(
            `มิติกติกาไม่อยู่ในชุดค่าที่ระบบรู้จัก: ${field}=${normalized} `
            + `กรุณาแก้เป็นค่าใดค่าหนึ่งใน ${allowed.join(' / ')} แล้วทำรายการอีกครั้ง`,
            'INVALID_RULE_DIMENSION',
            422,
        );
    }
    return normalized;
}

/**
 * The reader's half of normalizeCaseDimension: a QUESTION may name several words.
 *
 * A rule ROW still states one word — one row is one sentence of law, and createRule
 * keeps using the single-valued normalizer above. But a FILING can be several things
 * at once on the same dimension, and the reader has to be able to say so or the law
 * of every tick but one is silently dropped.
 *
 * One bad word refuses the whole ask, exactly as a single bad word does. Answering
 * "OUTDOOR plus a word that is not law" with only the OUTDOOR half would be the
 * quiet, wrong answer this vocabulary exists to prevent.
 *
 * @returns {string|string[]|null} null (nothing asked), one word, or the deduplicated ticks
 */
function normalizeCaseDimensionAsk(field, value) {
    if (!Array.isArray(value)) {
        return normalizeCaseDimension(field, value);
    }
    const ticks = [];
    for (const entry of value) {
        const word = normalizeCaseDimension(field, entry);
        if (word !== null && !ticks.includes(word)) {
            ticks.push(word);
        }
    }
    return ticks;
}

// Accepts a req.user-shaped object or a bare id string (migrations/seed jobs).
function normalizeActor(actor) {
    if (typeof actor === 'string' && actor.trim()) {
        return { id: actor.trim(), role: 'SYSTEM', type: 'SYSTEM', organizationId: null };
    }
    const id = actor?.id || actor?.userId || null;
    if (!id) {
        // createdBy / closedBy are NOT NULL-in-spirit provenance columns: an
        // anonymous edit of national policy is not a thing.
        throw ruleError('requirement rule: an identified actor is required', 'REQUIREMENT_RULE_INVALID', 400);
    }
    return {
        id,
        role: actor.role || actor.canonicalRole || 'UNKNOWN',
        type: 'USER',
        organizationId: actor.organizationId || null,
    };
}

/**
 * The rules in force at a given instant, for a given holder/request/plant.
 *
 * where: effectiveFrom <= at AND (effectiveTo IS NULL OR effectiveTo > at)
 * — a rule closed exactly AT the asked instant is already out; a rule starting
 * exactly at it is already in.
 *
 * The three case dimensions (landTenure / areaType / certScope) obey the same
 * NULL-as-wildcard rule as the older three: a caller who does not name them gets
 * only the rules that do not care about them, so a rented-land rule never binds
 * an application that never said its land was rented.
 *
 * They are checked against RULE_DIMENSIONS on the way IN, and a word outside the
 * set is refused before any query runs. This half is where a typo costs an
 * application: 'LEASE' instead of 'RENTED' would quietly match only the
 * NULL-dimension rules, so landlord_consent would never be demanded and the
 * application would be submitted without the consent letter, with nothing said.
 * Refusing is the loud direction, and the caller that derives these words derives
 * them from this same vocabulary.
 *
 * The three case dimensions also accept an ARRAY, for a filing that answered one of
 * them with several ticks (ลักษณะพื้นที่ is a checkbox group on the paper form). The
 * older three stay single-valued: a filing has one holder, one request type, one plant.
 *
 * @param {{at?: Date|string, holderType?: string|null, requestType?: string|null, plantCode?: string|null, landTenure?: string|string[]|null, areaType?: string|string[]|null, certScope?: string|string[]|null}} query
 * @param {object} [client] Prisma client or tx (the submit gate passes its tx)
 * @returns {Promise<object[]>}
 */
async function rulesAt(
    { at, holderType, requestType, plantCode, landTenure, areaType, certScope } = {},
    client = prisma,
) {
    const asOf = at === undefined || at === null ? new Date() : toDate(at, 'at');
    const asked = {
        landTenure: normalizeCaseDimensionAsk('landTenure', landTenure),
        areaType: normalizeCaseDimensionAsk('areaType', areaType),
        certScope: normalizeCaseDimensionAsk('certScope', certScope),
    };

    const where = {
        // The filing's DAY, not its second — see asOfFilingDayEnd.
        effectiveFrom: { lte: asOfFilingDayEnd(asOf) },
        AND: [
            { OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }] },
            // All six dimensions get the SAME laundering on the way in. The three
            // older ones used to go through raw, so a value carrying a stray space —
            // and wizard-store data is where holderType comes from — queried for a
            // word no stored row has: createRule trims before it writes, so
            // 'JURISTIC ' matched only the rules that bind everybody, and the company
            // documents were never demanded. Silently, which is the failure this
            // engine exists to prevent.
            dimensionClause('holderType', normalizeDimension(holderType)),
            dimensionClause('requestType', normalizeDimension(requestType)),
            dimensionClause('plantCode', normalizeDimension(plantCode)),
            dimensionClause('landTenure', asked.landTenure),
            dimensionClause('areaType', asked.areaType),
            dimensionClause('certScope', asked.certScope),
        ],
    };

    return client.requirementRule.findMany({
        where,
        // Deterministic order so the snapshot stamped on an application is
        // byte-stable for the same set of rules.
        orderBy: [{ slotId: 'asc' }, { effectiveFrom: 'asc' }],
    });
}

/**
 * Which plants the register actually holds กทล.1 law for, at a given instant.
 *
 * NOT the same question as "which plants exist". `plant_species` lists six; the
 * register today carries rules for one. The difference matters because a missing
 * plant dimension does not mean "judge this filing leniently", it means the law
 * that judges it has not been written down yet — and the requirement engine, asked
 * about a plant it has no rules for, answers with the plant-agnostic rows alone.
 * Those two rows are company_reg and community_cert: an INDIVIDUAL filing for a
 * plant with no filed law is asked for NOTHING AT ALL, and passes the submit gate.
 *
 * So the lens asks this first and refuses to judge what the law cannot reach. A
 * plant enters this list the moment its rules are seeded — it is data, not a
 * constant, and nobody has to remember to widen a list when kratom is filed.
 *
 * @param {{at?: Date|string}} [query]
 * @param {object} [client]
 * @returns {Promise<string[]>} distinct plantCodes with at least one open rule
 */
async function plantCodesWithRulesAt({ at } = {}, client = prisma) {
    const asOf = at === undefined || at === null ? new Date() : toDate(at, 'at');
    const rows = await client.requirementRule.findMany({
        where: {
            // The SAME window rulesAt uses, for the same reason: a plant whose law
            // starts today would otherwise be reported as having none, and the lens
            // would refuse the filing as unjudgeable while the rules that judge it sat
            // in the table (see asOfFilingDayEnd).
            effectiveFrom: { lte: asOfFilingDayEnd(asOf) },
            AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }] }],
            NOT: { plantCode: null },
            // "Law that demands nothing" (isRequired:false) is law on the books, but it is
            // not a document list. Counting it would report the plant as open, the lens
            // would skip its refusal, and the filing would be told it needs nothing — the
            // same hole one level deeper.
            isRequired: true,
        },
        select: { plantCode: true },
        orderBy: [{ plantCode: 'asc' }],
    });
    const codes = [];
    rows.forEach((row) => {
        const code = normalizeDimension(row?.plantCode);
        if (code !== null && !codes.includes(code)) {
            codes.push(code);
        }
    });
    return codes;
}

/**
 * Audit row for a rule write. When the caller hands a transaction client (the
 * seed does) the row is written THROUGH it (auditLogger.logWithin) so a
 * rollback takes the audit row with the rule; with the default global client
 * the row goes through the normal logger, as before.
 */
async function writeRuleAudit(client, event) {
    if (client && client !== prisma) {
        return auditLogger.logWithin(event, client);
    }
    return auditLogger.log(event);
}

/**
 * Add a rule. This is the ONLY way new law enters the table.
 *
 * The column list below is a whitelist on purpose: `data` comes from an admin
 * HTTP body, and spreading it would let a caller choose the primary key or forge
 * the closing stamps (making a rule look retired without an audit row).
 *
 * @param {object} data
 * @param {object|string} actor req.user, or an id string for system jobs
 * @param {object} [client]
 */
async function createRule(data, actor, client = prisma) {
    const body = data || {};

    const rawSlotId = body.slotId === null || body.slotId === undefined ? '' : String(body.slotId).trim();
    if (!rawSlotId) {
        throw ruleError('requirement rule: slotId is required', 'REQUIREMENT_RULE_INVALID', 400);
    }

    // The words of the rule are judged before its author: a dimension outside
    // the closed vocabulary is wrong no matter who files it, and the writer is
    // better served by being told which word is wrong than which credential is
    // missing. Both refusals happen before anything is written either way.
    const caseDimensions = {
        landTenure: normalizeCaseDimension('landTenure', body.landTenure),
        areaType: normalizeCaseDimension('areaType', body.areaType),
        certScope: normalizeCaseDimension('certScope', body.certScope),
    };

    // กฎหมายเป็นผู้ตัดสินช่องนี้ ไม่ใช่ทะเบียน (มติ operator 2026-10-05: ไม่ขอเอกสารเกินจริง) —
    // เลนส์ข้ามแถว controlled_herb_license ทุกแถว จึงไม่รับแถวที่จะถูกเมินเงียบ ๆ
    if (getCanonicalSlotId(rawSlotId) === 'controlled_herb_license') {
        throw ruleError(
            'ช่องเอกสาร controlled_herb_license กฎหมายเป็นผู้กำหนด ไม่รับกฎในทะเบียน — ระบบจะไม่นำแถวนี้ไปใช้',
            'REQUIREMENT_RULE_SLOT_LAW_DECIDED',
            400,
        );
    }

    const who = normalizeActor(actor);

    const created = await client.requirementRule.create({
        data: {
            holderType: normalizeDimension(body.holderType),
            requestType: normalizeDimension(body.requestType),
            plantCode: normalizeDimension(body.plantCode),
            landTenure: caseDimensions.landTenure,
            areaType: caseDimensions.areaType,
            certScope: caseDimensions.certScope,
            slotId: getCanonicalSlotId(rawSlotId),
            isRequired: body.isRequired === undefined || body.isRequired === null ? true : Boolean(body.isRequired),
            maxDocumentAgeMonths: body.maxDocumentAgeMonths === undefined || body.maxDocumentAgeMonths === null
                ? null
                : Number(body.maxDocumentAgeMonths),
            // Omitted = in force from this instant. A rule may also be filed to
            // start later, which is how a ministry announces a change ahead of
            // its effective date.
            effectiveFrom: body.effectiveFrom === undefined || body.effectiveFrom === null
                ? new Date()
                : toDate(body.effectiveFrom, 'effectiveFrom'),
            effectiveTo: body.effectiveTo === undefined || body.effectiveTo === null
                ? null
                : toDate(body.effectiveTo, 'effectiveTo'),
            createdBy: who.id,
            reason: body.reason === undefined || body.reason === null ? null : String(body.reason),
        },
    });

    await writeRuleAudit(client, {
        category: AuditCategory.ADMIN,
        action: REQUIREMENT_RULE_CREATED,
        severity: AuditSeverity.INFO,
        actorId: who.id,
        actorType: who.type,
        // actorRole / resourceType / resourceId are NOT NULL on AuditLog
        // (prisma/schema/audit.prisma) — ResourceType has no RULE member, so
        // SYSTEM + resourceId = rule id stays inside the documented vocabulary.
        actorRole: who.role,
        resourceType: ResourceType.SYSTEM,
        resourceId: created.id,
        organizationId: who.organizationId,
        result: 'SUCCESS',
        metadata: {
            holderType: created.holderType,
            requestType: created.requestType,
            plantCode: created.plantCode,
            landTenure: created.landTenure,
            areaType: created.areaType,
            certScope: created.certScope,
            slotId: created.slotId,
            isRequired: created.isRequired,
            maxDocumentAgeMonths: created.maxDocumentAgeMonths,
            effectiveFrom: created.effectiveFrom,
            effectiveTo: created.effectiveTo,
            reason: created.reason,
        },
    });

    return created;
}

/**
 * Retire a rule: stamp effectiveTo / closedBy / closedAt and nothing else.
 *
 * Deliberately takes no rule body — there is no argument here through which a
 * slotId or a dimension could be changed. Superseding a rule = closeRule + a
 * fresh createRule, which leaves both rows readable side by side.
 *
 * @param {string} id
 * @param {object|string} actor
 * @param {string} reason why it is being retired (goes to the audit row)
 * @param {object} [client]
 */
async function closeRule(id, actor, reason, client = prisma) {
    const who = normalizeActor(actor);
    if (!id) {
        throw ruleError('requirement rule: id is required to close a rule', 'REQUIREMENT_RULE_INVALID', 400);
    }

    const existing = await client.requirementRule.findUnique({ where: { id } });
    if (!existing) {
        throw ruleError(`requirement rule ${id} not found`, 'REQUIREMENT_RULE_NOT_FOUND', 404);
    }
    if (existing.effectiveTo) {
        // Re-closing would move effectiveTo — i.e. edit the window a past
        // application was judged by. That is the mutation this table exists to
        // prevent, so it is a conflict, not an idempotent no-op.
        throw ruleError(
            `requirement rule ${id} was already closed at ${new Date(existing.effectiveTo).toISOString()}`,
            'REQUIREMENT_RULE_ALREADY_CLOSED',
            409,
        );
    }

    const closedAt = new Date();
    let updated;
    try {
        updated = await client.requirementRule.update({
            // `effectiveTo: null` in the where is the concurrency guard: two
            // racing closes cannot both stamp a window.
            where: { id, effectiveTo: null },
            data: { effectiveTo: closedAt, closedBy: who.id, closedAt },
        });
    } catch (error) {
        if (error?.code === 'P2025') {
            throw ruleError(
                `requirement rule ${id} was closed concurrently`,
                'REQUIREMENT_RULE_ALREADY_CLOSED',
                409,
            );
        }
        throw error;
    }

    await writeRuleAudit(client, {
        category: AuditCategory.ADMIN,
        action: REQUIREMENT_RULE_CLOSED,
        severity: AuditSeverity.INFO,
        actorId: who.id,
        actorType: who.type,
        actorRole: who.role,
        resourceType: ResourceType.SYSTEM,
        resourceId: id,
        organizationId: who.organizationId,
        result: 'SUCCESS',
        metadata: {
            // The retired rule's substance, so the audit row explains what
            // stopped applying without a join.
            holderType: existing.holderType,
            requestType: existing.requestType,
            plantCode: existing.plantCode,
            landTenure: existing.landTenure,
            areaType: existing.areaType,
            certScope: existing.certScope,
            slotId: existing.slotId,
            isRequired: existing.isRequired,
            effectiveFrom: existing.effectiveFrom,
            effectiveTo: closedAt,
            reason: reason === undefined || reason === null ? null : String(reason),
        },
    });

    return updated;
}

// NO updateRule / deleteRule — see the header. The export list is pinned by
// __tests__/unit/requirement-rule-service.test.js.
module.exports = {
    rulesAt,
    plantCodesWithRulesAt,
    // ONE name for the write door. It was briefly exported under two
    // (insertRule + createRule) during the 2026-09-01 กทล.1 change; two names
    // for one door invite a later fix that hardens one of them and leaves the
    // callers of the other on the unhardened path, so the second name is gone
    // and the export list above is pinned by the test named below.
    createRule,
    closeRule,
    RULE_DIMENSIONS,
};
