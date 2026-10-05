'use strict';

/**
 * `catalog.js` — the single source for what the 7 in-scope document-precheck
 * slots expect: which phrases prove a doc-type match, how many pages are
 * expected (never sourced today, see below), the one validity rule, and
 * which reference fields cross-match compares against.
 *
 * Scope: exactly the 7 canonical slot ids named in
 * design note 2026-09-27-document-precheck-design §1, read
 * from `apps/backend/constants/document-slots.js` rather than retyped here.
 *
 * SOURCING RULE (operator, task-3-brief.md decision 5): every phrase and
 * every rule below carries a `source`. A rule this file cannot ground in
 * `กทล.1` or `reports/research/2026-09-01-dtam-application-baseline/facts.md`
 * (file:line) is left out — not guessed. Two consequences that follow from
 * that rule, both deliberate and both noted in task-3-report.md:
 *
 * 1. `expectedPages` is unset for all 7 slots. No source (กทล.1 or facts.md)
 *    states a required page count for any of these document types, so the
 *    PAGE_COUNT branch of `rules/readability.js` is implemented and unit
 *    tested directly (with a synthetic catalog entry), but never fires in
 *    production against this CATALOG.
 * 2. `land_lease` has an empty `phrases` list. `census/backend-slots.md:56`
 *    (same research folder as facts.md) is explicit that DTAM's กทล.1 A2
 *    row (facts.md:36) asks for the *consent letter* from a lessor/land-giver
 *    (covered by `land_consent`), never a lease *contract* — "No ส่วนที่ ๓
 *    row asks for the contract." With no sourced phrase, `doc-type` for this
 *    slot always returns `NOT_FOUND` (see `rules/doc-type.js`), never a
 *    guessed `MATCH`.
 *
 * The `reference` list (which fields cross-match compares) is a structural
 * choice, not a wording rule: it is grounded in
 * design note 2026-09-27-document-precheck-design §8, which
 * is itself the record of which `Entity`/applicant fields actually exist to
 * compare (there is no deed-number column, so land documents compare names
 * only — never a deed number).
 */

const { DOCUMENT_SLOTS } = require('../../constants/document-slots');
const { NAME_SIMILARITY_MIN } = require('./normalize');

/**
 * OCR confidence (0-100) below which a page is treated as unreadable rather
 * than trusted for doc-type/cross-match/validity.
 *
 * Set from the Task 9 corpus sweep (40..80 step 5, with NAME_SIMILARITY_MIN):
 * every value 50..80 scores the same — no page in the corpus reads between 50
 * and 89 — and 40/45 let illegible scans through, so 60 stays (the pick rule's
 * tie-break: do not move further than the data asks). The corpus is
 * synthetic: its floors guard against regressions only, they are not a
 * measure of production accuracy. Floors:
 * `__tests__/fixtures/document-precheck/thresholds.json`; sweep and reasoning:
 * `evidence/document-precheck-task-9/INDEX.md`.
 */
const OCR_CONFIDENCE_MIN = 60;

const FACTS = 'reports/research/2026-09-01-dtam-application-baseline/facts.md';
const CENSUS = 'reports/research/2026-09-01-dtam-application-baseline/census/backend-slots.md';
const DESIGN_8 = 'design note 2026-09-27-document-precheck-design §8';

const CATALOG = {
    [DOCUMENT_SLOTS.LAND_DEED.slotId]: {
        source: `${FACTS}:35 (A1) — wording per ${CENSUS}:55`,
        // A1: "สำเนาหนังสือแสดงกรรมสิทธิ์/สิทธิครอบครองที่ดิน หรือหนังสืออนุญาตใช้ที่ดินรัฐ".
        // "โฉนดที่ดิน" / "น.ส.3" / "น.ส.4" are the slot's own official label
        // (document-slots.js:120), verdicted KEEP against A1 by the census.
        phrases: [
            ['โฉนดที่ดิน'],
            ['น.ส.3'],
            ['น.ส.4'],
            ['สิทธิครอบครองที่ดิน'],
            ['หนังสืออนุญาตใช้ที่ดินรัฐ'],
        ],
        // Fix round 1 (task-3-review.md, Important #1): §8 says a land
        // document's holder name is compared with the applicant's name OR
        // the company's name — any-of. Companies always hold the
        // certificate (operator ruling), so an entity is almost always on
        // file; all-of (the pre-fix default) false-MISMATCHed every land
        // document whose applicant person is not the name printed on it.
        reference: ['APPLICANT_NAME', 'ENTITY_NAME'],
        referenceCombine: 'ANY',
        referenceSource: DESIGN_8,
    },

    // No sourced phrase — see the module doc comment, point 2. `reference`
    // is still populated: cross-match does not depend on doc-type having
    // confirmed the document's type.
    [DOCUMENT_SLOTS.LAND_LEASE.slotId]: {
        source: `${CENSUS}:56 — no กทล.1 ส่วนที่ ๓ row for a lease contract (only the A2 consent letter, which is land_consent)`,
        phrases: [],
        reference: ['APPLICANT_NAME', 'ENTITY_NAME'],
        referenceCombine: 'ANY', // see LAND_DEED's comment above
        referenceSource: DESIGN_8,
    },

    [DOCUMENT_SLOTS.LAND_CONSENT.slotId]: {
        source: `${FACTS}:36 (A2)`,
        // A2: "หนังสือยินยอมจากผู้ให้เช่า/ผู้ให้ใช้ที่ดิน" — the slot's own label
        // (document-slots.js:162) is "หนังสือยินยอมให้ใช้ที่ดิน".
        phrases: [['หนังสือยินยอมให้ใช้ที่ดิน'], ['หนังสือยินยอมจากผู้ให้เช่า']],
        reference: ['APPLICANT_NAME', 'ENTITY_NAME'],
        referenceCombine: 'ANY', // see LAND_DEED's comment above
        referenceSource: DESIGN_8,
    },

    [DOCUMENT_SLOTS.COMPANY_REG.slotId]: {
        source: `${FACTS}:50 (กลุ่มคุณสมบัติ นิติบุคคล)`,
        // "สำเนาหนังสือรับรองการจดทะเบียนนิติบุคคล ... หรือหนังสือจดทะเบียนวิสาหกิจ/
        // วิสาหกิจเพื่อสังคม/สหกรณ์การเกษตร".
        phrases: [
            ['หนังสือรับรองการจดทะเบียนนิติบุคคล'],
            ['หนังสือรับรอง'],
            ['หนังสือจดทะเบียนวิสาหกิจ'],
            ['สหกรณ์การเกษตร'],
        ],
        // Only company_reg carries a validity rule — the exact literal value
        // the brief specifies.
        validity: { maxAgeMonths: 6, source: 'facts.md:50' },
        reference: ['ENTITY_NAME', 'JURISTIC_ID', 'DIRECTOR_NAME'],
        referenceSource: DESIGN_8,
    },

    [DOCUMENT_SLOTS.ID_CARD.slotId]: {
        source: `${FACTS}:56 (ส่วน จนท. 1.1) — "บัตร ปชช." expanded to its one unambiguous full form`,
        phrases: [['บัตรประจำตัวประชาชน'], ['บัตรประชาชน']],
        reference: ['APPLICANT_NAME', 'CITIZEN_ID'],
        referenceSource: `${FACTS}:56 (ส่วน จนท. 1.1) + ส่วนที่ ๑ เลขบัตร ปชช.`,
    },

    [DOCUMENT_SLOTS.HOUSE_REG.slotId]: {
        source: `${FACTS}:56 (ส่วน จนท. 1.1)`,
        phrases: [['ทะเบียนบ้าน']],
        reference: ['APPLICANT_NAME'],
        referenceSource: `${FACTS}:56 (ส่วน จนท. 1.1 — ทะเบียนบ้านผู้ยื่น)`,
    },

    [DOCUMENT_SLOTS.PREVIOUS_CERT.slotId]: {
        source: `${FACTS}:52 (กรณีต่ออายุ)`,
        // "ต้นฉบับใบรับรองเก่า" — facts.md never describes the certificate's own
        // printed wording (it is our own document, not a DTAM-external one), so
        // only the one grounded word survives as a phrase.
        phrases: [['ใบรับรอง']],
        // No source states what field a prior GACP certificate's content
        // should be compared against — left empty rather than guessed.
        // cross-match on this slot always returns NOT_FOUND (see report).
        reference: [],
    },
};

module.exports = {
    CATALOG,
    OCR_CONFIDENCE_MIN,
    NAME_SIMILARITY_MIN,
};
