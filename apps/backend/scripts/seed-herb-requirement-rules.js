#!/usr/bin/env node
'use strict';
/**
 * File each herb's กทล.1 attachment law into `requirement_rules` as DATED DATA.
 *
 * หกชนิด หกชุด (มติ operator 2026-09-11 "สินค้า หรือสมุนไพรต้องมี 6 อย่าง ไม่ใช่แค่กัญชา"
 * และ "จริงๆ คนละใบ") — ทุกแถวผูก plantCode เสมอ กรมจึงแก้กฎหมายของขิงได้โดยไม่แตะของกัญชา
 *
 * WHY THIS EXISTS (spec 2026-09-01 §2.1, operator ruling 1)
 *   "แบบกัญชา กทล 1" ส่วนที่ ๓ lists what a cannabis case must attach, and which
 *   papers those are depends on the case: how it holds its land, what kind of
 *   area it is, which scope it asks for, what kind of holder is asking, and
 *   whether this is a new application, a renewal or a replacement. That is a
 *   LAW, and the platform already has a table for laws — dated, append-only,
 *   editable by the ministry without a deploy (operator ruling G2). So the row
 *   set below is data written through the same door an admin types through
 *   (services/requirement-rule-service.js createRule), not a constant in a
 *   service that a deploy would have to change.
 *
 * WHAT IS PURE AND WHY
 *   buildHerbRuleRows() and findExistingOpenRule() take no clock, no
 *   database and no client, and requiring this module builds NOTHING: the
 *   register read and the writer are required inside the --apply branch. The law
 *   is the part worth pinning in a test — a missing row means a farmer is never
 *   asked for a paper the ministry requires — and a test that needed Postgres to
 *   read the law back would not run on every commit.
 *
 * SAFETY CONTRACT (mirrors scripts/close-quotations-settled-before-gate.js)
 *   - dry run is the DEFAULT and touches no database at all: it prints the law
 *     it would file and exits;
 *   - --apply refuses under NODE_ENV=production without --i-know;
 *   - --apply is idempotent by SUBSTANCE: before filing a row it asks the
 *     register which rules are in force for that row's own dimensions at its
 *     effectiveFrom, and skips when one of them is the same rule. The table is
 *     append-only, so a second run that files the law twice cannot be undone by
 *     an edit — both copies stay in force and every reader has to guess which
 *     one the ministry meant;
 *   - no connection string and no personal data is ever printed (L2). Rules are
 *     national policy; there is nothing else here to redact.
 *
 * WHAT THIS SCRIPT DELIBERATELY DOES NOT DO
 *   It does not CLOSE anything. Two founding rules from M2a
 *   (`m2a-seed-juristic-company-reg` → company_reg, `m2a-seed-community-cert` →
 *   community_cert) now fold onto the v2 slots juristic_reg_6m /
 *   community_reg_members and bind every plant, so they overlap the two cannabis
 *   rows below. Closing a rule is a different act with a different audit row
 *   (closeRule), it needs the operator's instruction naming those ids, and this
 *   seed has none — so the overlap is REPORTED at the end of an --apply run
 *   instead of resolved by a script that was not told to resolve it.
 *
 * Usage (from apps/backend):
 *   node scripts/seed-herb-requirement-rules.js                    # dry run (default)
 *   node scripts/seed-herb-requirement-rules.js --apply            # file the law
 *   ... [--effective-from=2026-09-02T00:00:00Z] [--i-know]
 */

// Both requires are pure: the slot catalog is a constant table, and the
// canonicaliser re-exports @gacp/validation/upload-rules. Neither reaches a
// database, which is what keeps `require(this file)` free of a Prisma client.
const { DOCUMENT_SLOTS } = require('../constants/document-slots');
const { getCanonicalSlotId } = require('../routes/api/applications/validation-slot-utils');

const SCRIPT_REL = 'scripts/seed-herb-requirement-rules.js';

/**
 * ทุกชนิดที่แพลตฟอร์มรับรอง — อ่านจากสะพานคำศัพท์ ไม่ได้พิมพ์ซ้ำที่นี่
 *
 * มติ operator 2026-09-11: "สินค้า หรือสมุนไพรต้องมี 6 อย่าง ไม่ใช่แค่กัญชา" กลับทิศ
 * ข้อ cannabis-only ของ baseline 2026-09-01
 *
 * ทุกแถวยังผูก plantCode เสมอ ไม่มี NULL — เพราะ NULL แปลว่า "ทุกชนิด" และกฎหมาย
 * เอกสารของแต่ละชนิดคนละฉบับกัน (operator: "จริงๆ คนละใบ") การเขียนชุดเดียวให้ทุกชนิด
 * คือการประกาศว่ามันเป็นฉบับเดียวกัน ซึ่งไม่จริง และทำให้กรมแก้ของขิงโดยไม่แตะของกัญชาไม่ได้
 */
const { PLANT_SLUG_TO_CODE } = require('../config/plant-species-slugs');

const HERB_SLUGS = Object.freeze(Object.keys(PLANT_SLUG_TO_CODE));

/**
 * ชนิดที่กฎหมายจัดเป็น "สมุนไพรควบคุม" — มีแค่สองชนิด
 *
 * ตัวที่ต่างกันจริงระหว่างหกชนิดมีอย่างเดียว: ใบอนุญาตสมุนไพรควบคุม ที่เหลือเป็นเอกสาร
 * GACP ทั่วไป (สิทธิที่ดิน แผนที่ แผนผลิต SOP ภาพถ่าย ตัวตนผู้ยื่น) ซึ่งทุกชนิดยื่นเหมือนกัน
 *
 * การ copy ชุดกัญชาไปทั้งดุ้นจะไปขอ "ใบอนุญาตสมุนไพรควบคุม" จากคนปลูกขิง ซึ่งเป็นเอกสาร
 * ที่ไม่มีอยู่สำหรับขิง — ด่านเอกสารจะกันเขาไว้ตลอดกาลโดยที่เขาหาไฟล์มาแนบไม่ได้เลย
 *
 * อ่านจากไฟล์สะพานคำศัพท์ ไม่ได้ประกาศเองที่นี่ — เลนส์เอกสาร กทล.1 ถามคำถามเดียวกันนี้
 * (เงื่อนไขส่งออก) และสองที่ต้องตอบเหมือนกัน · ตัวจริงบนฐานข้อมูลคือ HerbSpecies.isControlled
 * กับ PlantSpecies.requiresLicense ซึ่งเทสผูกไว้ให้ตรงกันทั้งสาม
 */

/** Provenance stamped on every row this seed files (requirement_rules.createdBy). */
const CREATED_BY = 'seed-herb-v1';

/** Why the rule exists, kept on the row itself so a closed rule still explains itself. */
const SEED_REASON = 'spec 2026-09-01 §2.1 (กทล.1 ส่วนที่ ๓)';

/**
 * When this law starts to bind. It is an argument with a default rather than
 * `new Date()`: the dry run the operator approves and the --apply run that
 * follows it must file the SAME dated law, and "now" would give them two
 * different ones.
 */
const DEFAULT_EFFECTIVE_FROM = '2026-09-02T00:00:00Z';

/**
 * Every dimension column of a rule. A rule's identity is its slot plus this
 * tuple: two rows that agree on all seven are the same law said twice.
 */
const DIMENSIONS = Object.freeze([
    'holderType',
    'requestType',
    'plantCode',
    'landTenure',
    'areaType',
    'certScope',
]);

/**
 * The case dimensions whose vocabulary is CLOSED. The words themselves are not
 * copied here — they are read from RULE_DIMENSIONS in the service that owns them
 * (requirement-rule-service.js:55-59) at --apply time, because two lists of the
 * same words drift and a drifted word is a rule that never fires.
 */
const CASE_DIMENSIONS = Object.freeze(['landTenure', 'areaType', 'certScope']);

/** requestType vocabulary (never 'RENEW' — routes/api/admin/requirement-rules.js:67). */
const NEW = 'NEW';
const RENEWAL = 'RENEWAL';
const REPLACEMENT = 'REPLACEMENT';

/**
 * THE LAW, one entry per rule (spec §2.1, กทล.1 ส่วนที่ ๓).
 *
 * `slot` names a key of the SSOT slot catalog rather than a string, so a slot
 * that does not exist is a crash at load instead of a rule pointing at a paper
 * no upload surface offers. Anything left out of an entry is NULL, and NULL is
 * the engine's "every value of this dimension" (requirement-rule-service.js:77-85);
 * requestType defaults to NEW because ส่วนที่ ๓ is the new-application list and
 * the renewal / replacement sets are named explicitly below.
 */
const BASE_RULE_SET = Object.freeze([
    // ── A1-A8: what a new cannabis case attaches, by its case ────────────────
    { slot: 'LAND_RIGHTS' },
    { slot: 'SITE_MAP_COORDS' },
    { slot: 'PRODUCTION_UTIL_PLAN' },
    { slot: 'SECURITY_RESIDUE_PLAN' },
    { slot: 'SITE_PHOTOS' },
    { slot: 'SOP_MANUAL' },

    // Renting the land is what creates the consent letter: an owner consenting
    // to themselves is not a document anyone can produce.
    { slot: 'LANDLORD_CONSENT', landTenure: 'RENTED' },

    // A building plan is asked of the two area types that HAVE a building. Two
    // rows rather than one because the engine's dimensions are single-valued;
    // a rule cannot say "INDOOR or GREENHOUSE" in one row, and the honest way
    // to write "either" is to write both.
    { slot: 'BUILDING_PLAN_PHOTOS', areaType: 'INDOOR' },
    { slot: 'BUILDING_PLAN_PHOTOS', areaType: 'GREENHOUSE' },

    // The photographs of the surrounding land are the outdoor case's answer to
    // the same question the building plan answers indoors.
    { slot: 'FIELD_SURROUND_PHOTOS', areaType: 'OUTDOOR' },

    // ── Who is asking ────────────────────────────────────────────────────────
    // The ID card + house registration is asked of EVERY holder type, so the
    // holder dimension stays open: วิสาหกิจชุมชน attaches its president's,
    // a นิติบุคคล its authorised signatory's, a บุคคลธรรมดา their own.
    { slot: 'ID_HOUSE_REG' },
    { slot: 'COMMUNITY_REG_MEMBERS', holderType: 'COMMUNITY_ENTERPRISE' },
    { slot: 'COMMUNITY_ASSIGNMENT', holderType: 'COMMUNITY_ENTERPRISE' },
    { slot: 'PRODUCER_SUPERVISION_LETTER', holderType: 'INDIVIDUAL' },
    { slot: 'JURISTIC_REG_6M', holderType: 'JURISTIC' },
    { slot: 'JURISTIC_AUTHORITY', holderType: 'JURISTIC' },

    // ── Identity on a SUCCEEDING request (operator approval 2026-09-06, proposal P1/P2) ──
    // The rules above bind requestType NEW, which left a renewal — and worse, a replacement —
    // owing NO paper at all: the officer could accept a filing evidenced by nothing while the
    // checklist printed ครบถ้วน. กทล.1 exempts a succeeding request from filling ส่วนที่ ๑-๒ of
    // the FORM; the ministry's intake checklist still lists "บัตร ปชช.+ทะเบียนบ้านผู้ยื่น" for
    // every คำขอ without splitting by type. So identity is asked again, and a RENEWAL also
    // re-proves the holder's standing (a company can dissolve, a community enterprise can lapse,
    // a supervising producer can end the arrangement between one certificate and the next).
    // A REPLACEMENT re-proves identity only: it replaces a lost paper, it does not re-open the
    // question of whether the holder still qualifies.
    { slot: 'ID_HOUSE_REG', requestType: RENEWAL },
    { slot: 'ID_HOUSE_REG', requestType: REPLACEMENT },
    { slot: 'JURISTIC_REG_6M', holderType: 'JURISTIC', requestType: RENEWAL },
    { slot: 'JURISTIC_AUTHORITY', holderType: 'JURISTIC', requestType: RENEWAL },
    { slot: 'COMMUNITY_REG_MEMBERS', holderType: 'COMMUNITY_ENTERPRISE', requestType: RENEWAL },
    { slot: 'COMMUNITY_ASSIGNMENT', holderType: 'COMMUNITY_ENTERPRISE', requestType: RENEWAL },
    { slot: 'PRODUCER_SUPERVISION_LETTER', holderType: 'INDIVIDUAL', requestType: RENEWAL },

    // ── Renewal ──────────────────────────────────────────────────────────────
    { slot: 'PREV_CERT_ORIGINAL', requestType: RENEWAL },
    { slot: 'RENEWAL_PLAN', requestType: RENEWAL },
    { slot: 'RENEWAL_UTIL_PLAN', requestType: RENEWAL },
    { slot: 'OPERATION_SUMMARY_REPORT', requestType: RENEWAL },

    // ── Replacement ──────────────────────────────────────────────────────────
    // The form takes the police report OR the damaged certificate, never both.
    // "Either of these two" is not something one rule row can say, and inventing
    // a dimension for it would put a fact about ONE slot pair into the
    // vocabulary of every rule; the door that reads the rules resolves the pair
    // (spec §2.1, application side).
    { slot: 'POLICE_REPORT', requestType: REPLACEMENT },
    { slot: 'DAMAGED_CERT', requestType: REPLACEMENT },
]);

/**
 * สิ่งเดียวที่ต่างกันระหว่างหกชนิดในทะเบียน — ใบอนุญาตภ.ท. 11 ของกัญชาที่ขอแปรรูป
 *
 * มติ operator 2026-10-05 (fix round 2): ไม่ขอเอกสารที่กฎหมายไม่ได้บังคับ
 *   - ภ.ท. 09/10/11 เป็นใบอนุญาตสมุนไพรควบคุม (กฎกระทรวง 2559) ใช้กับกัญชา **ไม่ใช่กระท่อม**
 *     (กระท่อมมี พ.ร.บ.พืชกระท่อม 2565 ของตนเอง: ปลูกและขายใบไม่ต้องมีใบอนุญาต)
 *   - ใบอนุญาตปลูกกัญชา ไม่มีตามกฎหมายที่ใช้บังคับ — มีแต่การแจ้งปลูก "ปลูกกัญ" และรายการแนบของ
 *     คำขอ ภ.ท. ก็ระบุ "(ถ้ามี)" จึงเป็นช่องไม่บังคับที่เอนจินแสดงเอง ไม่อยู่ในทะเบียน
 *     (ทะเบียนมีแต่แถว isRequired=true)
 *   - ขอบข่ายแปรรูป (PROCESSING) ของกัญชา = ภ.ท. 11 ช่อง id เดียวกับที่วัตถุประสงค์ PROCESSING ขอ
 *     เอนจินรวมตาม slot id ผู้ยื่นแนบ ภ.ท. 11 ครั้งเดียว
 *   - กระท่อมและอีกสี่ชนิด ไม่มีแถวใบอนุญาตในทะเบียนเลย
 *
 * 'purpose' (วัตถุประสงค์) ไม่ใช่มิติของตารางนี้ — ฟอร์มถาม และประตูที่อ่านกฎเป็นคนเติมช่อง
 * ใบอนุญาตของวัตถุประสงค์ที่เลือก ตาม spec §2.1
 *
 * แถว controlled_herb_license เดิม (กัญชา+กระท่อม · PLANTING+PROCESSING) ที่ seed ไว้แล้วในทะเบียนต้อง
 * **ปิด** (closeRule) ก่อน seed ใหม่ — ทะเบียนเป็น append-only seed ไม่ลบให้
 */
const OBSOLETE_SLOT = 'controlled_herb_license';
const OBSOLETE_PLANTS = Object.freeze(['cannabis', 'kratom']);
const OBSOLETE_SCOPES = Object.freeze(['PLANTING', 'PROCESSING']);
const CANNABIS_SLUG = 'cannabis';
const CANNABIS_RULE_SET = Object.freeze([
    { slot: 'LICENCE_PT11', certScope: 'PROCESSING' },
]);

/**
 * แถว controlled_herb_license ที่ยังเปิดอยู่ = กฎเก่าที่ขัดกับกฎหมายปัจจุบัน (มติ operator 2026-10-05:
 * ไม่ขอเอกสารเกินจริง) — ปิดเฉพาะ 4 แถวที่ seed รุ่นก่อนลงไว้: กัญชา/กระท่อม × PLANTING/PROCESSING (แถวอื่นไม่แตะ)
 * PURE: ผู้เรียกอ่านทะเบียนเอง · idempotent เพราะแถวที่ปิดแล้ว (effectiveTo != null) ไม่ถูกเลือก
 *
 * @param {Array<object>} openRows
 * @returns {Array<object>}
 */
function findObsoleteControlledHerbRules(openRows) {
    return (Array.isArray(openRows) ? openRows : []).filter((row) => row
        && !row.effectiveTo
        && getCanonicalSlotId(row.slotId) === OBSOLETE_SLOT
        && OBSOLETE_PLANTS.includes(row.plantCode)
        && OBSOLETE_SCOPES.includes(row.certScope));
}

/**
 * The rule set as rows, ready for createRule. PURE: no clock, no database.
 *
 * @param {{effectiveFrom?: string}} [options] when this law starts to bind
 * @returns {Array<object>} one row per rule, slot ids in canonical form
 */
/**
 * กฎหมายเอกสารของ **หนึ่งชนิด**
 *
 * ทุกชนิดได้ชุดพื้นฐานเหมือนกัน เพราะเอกสาร GACP (สิทธิที่ดิน แผนที่ แผนผลิต SOP ภาพถ่าย
 * ตัวตนผู้ยื่น) ไม่ได้ขึ้นกับว่าปลูกอะไร · กัญชาได้ ภ.ท. 11 เพิ่มหนึ่งแถว (ขอบข่ายแปรรูป)
 *
 * ผลลัพธ์คือ 6 ชุดที่แยกจากกันจริงในทะเบียน แก้ของชนิดหนึ่งไม่กระทบอีกห้าชนิด ตามมติ
 * operator ว่าแต่ละชนิด "คนละใบ"
 */
function buildHerbRuleRows(plantSlug, { effectiveFrom = DEFAULT_EFFECTIVE_FROM } = {}) {
    if (!HERB_SLUGS.includes(plantSlug)) {
        throw new Error(
            `[${SCRIPT_REL}] '${plantSlug}' ไม่ใช่ชนิดที่แพลตฟอร์มตั้งชื่อได้ — `
            + `มีอยู่: ${HERB_SLUGS.join(', ')}`,
        );
    }
    const ruleSet = plantSlug === CANNABIS_SLUG
        ? [...BASE_RULE_SET, ...CANNABIS_RULE_SET]
        : BASE_RULE_SET;

    return ruleSet.map((entry) => {
        const slot = DOCUMENT_SLOTS[entry.slot];
        if (!slot) {
            throw new Error(
                `[${SCRIPT_REL}] no slot '${entry.slot}' in constants/document-slots.js — `
                + 'a rule may not point at a paper the platform cannot offer',
            );
        }
        return {
            // Canonicalised here as well as inside createRule: the rows are
            // printed for an operator to approve BEFORE anything is written, and
            // a table showing a spelling different from the one that lands in
            // the register is a table that was approved for a different law.
            slotId: getCanonicalSlotId(slot.slotId),
            holderType: entry.holderType || null,
            requestType: entry.requestType || NEW,
            plantCode: plantSlug,
            landTenure: entry.landTenure || null,
            areaType: entry.areaType || null,
            certScope: entry.certScope || null,
            isRequired: true,
            effectiveFrom,
            reason: SEED_REASON,
        };
    });
}

/** กฎหมายของทั้งหกชนิด เรียงตามลำดับทะเบียน */
function buildAllHerbRuleRows({ effectiveFrom = DEFAULT_EFFECTIVE_FROM } = {}) {
    return HERB_SLUGS.flatMap((slug) => buildHerbRuleRows(slug, { effectiveFrom }));
}

/** '' / null / undefined all say the same thing about a dimension: every value. */
function dimensionValue(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value).trim();
    return text === '' ? null : text;
}

/**
 * Is `existing` the same law as `row`?
 *
 * Slot ids are compared through the fold on BOTH sides. A rule filed before the
 * v2 fold carries yesterday's spelling and nothing rewrites stored rows (spec
 * §7), so a raw string comparison would call an old rule a different rule and
 * file a second copy of a law already in force.
 */
function isSameRule(row, existing) {
    if (!existing || !existing.slotId) {
        return false;
    }
    if (getCanonicalSlotId(existing.slotId) !== getCanonicalSlotId(row.slotId)) {
        return false;
    }
    return DIMENSIONS.every((field) => dimensionValue(row[field]) === dimensionValue(existing[field]));
}

/**
 * The rule among `openRules` that already says what `row` says, or null.
 *
 * PURE — the caller does the register read, so this decision is testable without
 * a database.
 *
 * @param {object} row a row from buildHerbRuleRows
 * @param {Array<object>} openRules rules in force at that row's effectiveFrom
 * @returns {object|null}
 */
function findExistingOpenRule(row, openRules) {
    if (!Array.isArray(openRules)) {
        return null;
    }
    return openRules.find((existing) => isSameRule(row, existing)) || null;
}

/**
 * Refuse the whole run when a row names a word outside the closed vocabulary.
 *
 * createRule checks this too, and would throw on the offending row — but by then
 * the rows before it are already filed, and requirement_rules cannot be edited
 * back. So the check runs over the whole set before the first write.
 */
function assertKnownDimensions(rows, ruleDimensions) {
    rows.forEach((row) => {
        CASE_DIMENSIONS.forEach((field) => {
            const value = dimensionValue(row[field]);
            const allowed = ruleDimensions[field];
            if (value !== null && !allowed.includes(value)) {
                throw new Error(
                    `[${SCRIPT_REL}] rule for slot '${row.slotId}' names ${field}=${value}, `
                    + `which is not one of ${allowed.join(' / ')} — refusing to file any row`,
                );
            }
        });
    });
}

function parseArgs(argv) {
    const args = {
        apply: false, effectiveFrom: DEFAULT_EFFECTIVE_FROM, iKnow: false,
        // ไม่ระบุ = ทั้งหกชนิด · ระบุได้เมื่อกรมแก้กฎหมายของชนิดเดียว แล้วอีกห้าชนิดต้องไม่ขยับ
        plant: null,
    };
    argv.forEach((arg) => {
        if (arg === '--apply') {
            args.apply = true;
        } else if (arg === '--i-know') {
            args.iKnow = true;
        } else if (arg.startsWith('--effective-from=')) {
            args.effectiveFrom = arg.slice('--effective-from='.length);
        } else if (arg.startsWith('--plant=')) {
            args.plant = arg.slice('--plant='.length).trim().toLowerCase();
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    });
    return args;
}

/** One printable line per rule: the slot, its dimensions, and what will happen to it. */
function toTableRow(row, decision) {
    return {
        slot: row.slotId,
        holder: row.holderType,
        request: row.requestType,
        landTenure: row.landTenure,
        areaType: row.areaType,
        certScope: row.certScope,
        decision,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    // Read the same .env the app reads, before anything looks at NODE_ENV or
    // requires the Prisma-backed writer. Nothing from it is printed (L2).
    require('dotenv').config({ quiet: true });

    if (Number.isNaN(new Date(args.effectiveFrom).getTime())) {
        console.error(`FATAL: --effective-from=${args.effectiveFrom} is not a date — refusing`);
        process.exit(2);
    }

    if (args.plant && !HERB_SLUGS.includes(args.plant)) {
        console.error(`FATAL: --plant=${args.plant} ไม่ใช่ชนิดที่แพลตฟอร์มตั้งชื่อได้ — `
            + `มีอยู่: ${HERB_SLUGS.join(', ')}`);
        process.exit(2);
    }

    const rows = args.plant
        ? buildHerbRuleRows(args.plant, { effectiveFrom: args.effectiveFrom })
        : buildAllHerbRuleRows({ effectiveFrom: args.effectiveFrom });

    console.log(`script:        ${SCRIPT_REL}`);
    console.log(`plant:         ${args.plant || `ทั้งหมด (${HERB_SLUGS.join(', ')})`}`);
    console.log(`effectiveFrom: ${args.effectiveFrom}`);
    console.log(`createdBy:     ${CREATED_BY}`);
    console.log(`reason:        ${SEED_REASON}`);
    console.log(`mode:          ${args.apply ? 'APPLY (rules will be filed)' : 'DRY RUN (nothing will be written)'}`);
    console.log(`rows:          ${rows.length}\n`);

    if (!args.apply) {
        // No database is touched in this mode — not even a read. The register
        // check belongs to --apply, where it decides a write; here it would only
        // add a way for the run that prints the law to fail.
        console.table(rows.map((row) => toTableRow(row, 'INSERT')));
        // fix round 4: the dry run also says what --apply WOULD close. One read-only query;
        // if the register cannot be read the run still prints the law and says so.
        try {
            const { prisma: readPrisma } = require('../services/prisma-database');
            const open = await readPrisma.requirementRule.findMany({
                where: { effectiveTo: null },
                select: { id: true, slotId: true, plantCode: true, certScope: true, effectiveTo: true },
            });
            const wouldClose = findObsoleteControlledHerbRules(open);
            console.log(`\nWOULD CLOSE ${wouldClose.length} obsolete controlled_herb_license rule(s):`);
            wouldClose.forEach((r) => console.log(`  ${r.id}  plant=${r.plantCode}  scope=${r.certScope}`));
            await readPrisma.$disconnect();
        } catch (error) {
            console.log(`\nWOULD CLOSE: unknown — register not readable (${error.code || error.name})`);
        }
        console.log('\nDRY RUN — no rows written. To file this law:');
        console.log(`  node ${SCRIPT_REL} --apply`
            + (args.plant ? ` --plant=${args.plant}` : '')
            + (args.effectiveFrom === DEFAULT_EFFECTIVE_FROM ? '' : ` --effective-from=${args.effectiveFrom}`));
        return;
    }

    // The production refusal guards the WRITE, not the printout. This box runs
    // with NODE_ENV=production in apps/backend/.env, so refusing the dry run too
    // would teach the operator to type --i-know as a matter of routine — and the
    // next run they type it in front of is this one.
    if (process.env.NODE_ENV === 'production' && !args.iKnow) {
        console.error('FATAL: NODE_ENV=production. Filing national policy on the production register is');
        console.error('       an operator act — re-run with --apply --i-know if that is exactly what you mean.');
        console.error('       The dry run above needs no flag: it writes nothing and reads nothing.');
        process.exit(2);
    }

    // Required lazily: requiring the writer builds the shared Prisma client, and
    // the dry run above must stay free of one.
    const { createRule, closeRule, rulesAt, RULE_DIMENSIONS } = require('../services/requirement-rule-service');
    const { prisma } = require('../services/prisma-database');

    assertKnownDimensions(rows, RULE_DIMENSIONS);

    const decisions = [];
    const closedRows = [];
    let filed = 0;
    let skipped = 0;
    const overlapping = [];

    // ALL OR NOTHING. requirement_rules is append-only: a row filed by mistake cannot
    // be edited or deleted, only closed by a second row. So a run that died halfway —
    // a dropped connection, one refused row — used to leave a partial law in force,
    // with no way back except closing rows one by one. Inside one transaction the
    // ministry either has the whole rule set or exactly what it had before.
    await prisma.$transaction(async (tx) => {
        // ปิดแถว controlled_herb_license เก่าก่อน (ไม่ต้องมีขั้นตอนมือ) — ไม่แตะแถวที่ปิดแล้ว
        const openSlotRows = await tx.requirementRule.findMany({
            where: { effectiveTo: null },
            select: { id: true, slotId: true, plantCode: true, certScope: true, effectiveTo: true },
        });
        for (const obsolete of findObsoleteControlledHerbRules(openSlotRows)) {
            await closeRule(obsolete.id, CREATED_BY, 'ปิดโดย seed: ใบอนุญาตปลูก/แปรรูปไม่ใช่เอกสารบังคับตามกฎหมาย (มติ operator 2026-10-05)', tx);
            closedRows.push(obsolete);
        }
        for (const row of rows) {
            // Ask the register what is in force for THIS row's own dimensions at the
            // instant the row would start binding. rulesAt returns the rules that do
            // not care about a dimension as well as the ones that name it, so the
            // tuple match below is what decides "the same law", not the query.
            const inForce = await rulesAt({
                at: row.effectiveFrom,
                holderType: row.holderType,
                requestType: row.requestType,
                plantCode: row.plantCode,
                landTenure: row.landTenure,
                areaType: row.areaType,
                certScope: row.certScope,
            }, tx);

            const existing = findExistingOpenRule(row, inForce);
            if (existing) {
                skipped += 1;
                decisions.push(toTableRow(row, `SKIP ${existing.id}`));
                if (existing.isRequired !== row.isRequired) {
                    // Same case, same paper, opposite answer. The seed may not
                    // resolve that by writing a second contradicting rule, so it
                    // says so and leaves it to the ministry.
                    overlapping.push(
                        `${row.slotId}: rule ${existing.id} is already in force with isRequired=${existing.isRequired}`,
                    );
                }
                continue;
            }

            const created = await createRule(row, CREATED_BY, tx);
            filed += 1;
            decisions.push(toTableRow(row, `FILED ${created.id}`));
        }
    }, { maxWait: 15000, timeout: 60000 });

    console.table(decisions);
    console.log(`\nCLOSED ${closedRows.length} obsolete controlled_herb_license rule(s):`);
    closedRows.forEach((r) => console.log(`  ${r.id}  plant=${r.plantCode || '*'}  scope=${r.certScope || '*'}`));
    console.log(`\nFILED ${filed} rule(s), SKIPPED ${skipped} already in force.`);
    if (overlapping.length > 0) {
        console.log('\nRules that say something different about the same case — review by hand:');
        overlapping.forEach((line) => console.log(`  ${line}`));
    }
}

module.exports = {
    buildHerbRuleRows,
    buildAllHerbRuleRows,
    findExistingOpenRule,
    findObsoleteControlledHerbRules,
    assertKnownDimensions,
    parseArgs,
    BASE_RULE_SET,
    CANNABIS_RULE_SET,
    HERB_SLUGS,
    CANNABIS_SLUG,
    CREATED_BY,
    SEED_REASON,
    DEFAULT_EFFECTIVE_FROM,
};

if (require.main === module) {
    main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}
