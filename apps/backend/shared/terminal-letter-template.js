'use strict';

/**
 * Terminal-decision official letter — template SSOT.
 *
 * R2 M3b (operator ruling, evidence/R2-special-reopen/decisions-final.md
 * §"คำตัดสินเพิ่ม ... TERMINAL_DECISION letter", verbatim): a terminal REJECT is
 * an administrative order (คำสั่งทางปกครอง), so it must reach the applicant as a
 * letter of its OWN kind. Deliberately a different element set from the M2
 * correction letter (shared/correction-letter-template.js) — a terminal case has
 * nothing to correct and no clock:
 *
 *   1. ผลการพิจารณา (ไม่ผ่าน / ไม่รับรอง) + stage ที่ตัดสิน
 *   2. เหตุผลประกอบ — จากบันทึกผลของเจ้าหน้าที่. A MANDATORY field, not an
 *      optional one: an order with no stated ground is refused (throw).
 *   3. สิทธิ์ของผู้ยื่น: ยื่นคำขอใหม่ได้ตาม flow ปกติ (จ่ายใหม่ตาม D-1).
 *   4. สิทธิ์โต้แย้ง/อุทธรณ์ — the operator-supplied placeholder sentence,
 *      reproduced verbatim. The appeal WINDOW and the appeal CHANNEL both
 *      depend on the certification-specific law and are still with the
 *      department's legal officer (คำถามชุดนิติกร ข้อ 4), so neither a number of
 *      days nor a channel may be invented here. Until that answer lands, the
 *      angle-bracket placeholder is filled with the department contact that
 *      ALREADY exists in this repository (shared/ministry-contact.js) and
 *      nothing else.
 *
 * Three negative constraints from the same ruling:
 *   - ไม่มีกำหนดส่ง — this template neither accepts nor prints a deadline.
 *   - Atomic (D-8) — enforced at the mint point (services/decision-letter-
 *     service.js): a letter that cannot be built fails the REJECT transaction.
 *   - ไม่มี round — terminal is not a correction round, so no round ledger row.
 *
 * ONE defining file for the Thai copy (the project rules Law 3.5/3.6): the three
 * surfaces that write the terminal status (auditor audit-decision REJECT, the
 * canonical workflow transition, the legacy admin status-override) consume it
 * through services/decision-letter-service and never re-spell a word of it.
 * Grep-pinned by __tests__/unit/terminal-decision-letter.test.js.
 *
 * Vocabulary reuse (Law 3.6): the "stage ที่ตัดสิน" is the canonical workflow
 * state the application was decided in, and its Thai label comes from the
 * existing total status contract (shared/status-machine-contract.js) — no
 * second stage vocabulary is introduced, and a state with no presentation entry
 * is impossible there (assertContractIsTotal runs at require time). Copy follows
 * the thai-ui-copy guideline (ท่าน = legal/official register; no em dash in
 * Thai copy).
 */

const { STATUS_PRESENTATION } = require('./status-machine-contract');
const { MINISTRY_CONTACT, MINISTRY_CONTACT_LINE } = require('./ministry-contact');

/** Machine identifier for this letter class (metadata discriminator). */
const TERMINAL_DECISION_LETTER_TYPE = 'TERMINAL_DECISION';

/**
 * The `<ช่องทางติดต่อกรม>` slot of element 4, resolved from the existing
 * contact SSOT. NOT a new constant: both halves come from
 * shared/ministry-contact.js, so a change there follows through to every
 * administrative order the system issues.
 */
const TERMINAL_DECISION_CONTACT = `${MINISTRY_CONTACT.ministry} ${MINISTRY_CONTACT_LINE}`;

/**
 * Element 4, verbatim. The prefix is the operator's wording character for
 * character; only the placeholder is substituted.
 */
const TERMINAL_DECISION_APPEAL_NOTICE =
    `ทั้งนี้ ท่านมีสิทธิ์โต้แย้งคำสั่งตามที่กฎหมายกำหนด สอบถามรายละเอียดได้ที่ ${TERMINAL_DECISION_CONTACT}`;

/**
 * Build the terminal-decision official letter (title/message/metadata).
 *
 * @param {object} args
 * @param {string} args.applicationNumber
 * @param {string} args.stage Canonical workflow state the decision was taken
 *   in (the FROM state of the REJECT transition) — element 1.
 * @param {string} args.reason เหตุผลประกอบ from the officer's decision record.
 *   MANDATORY — element 2. Blank/whitespace is treated as absent.
 * @returns {{ title: string, message: string, metadata: object }}
 * @throws when element 1 or element 2 cannot be produced. Under D-8 the caller's
 *   REJECT transaction must then fail: an order that cannot be served must not
 *   be recorded.
 */
function buildTerminalDecisionLetter({ applicationNumber, stage, reason }) {
    // hasOwnProperty, not a bare lookup: a caller passing "constructor" must not
    // resolve to a prototype member and slip past this gate.
    const known = typeof stage === 'string'
        && Object.prototype.hasOwnProperty.call(STATUS_PRESENTATION, stage);
    if (!known) {
        // English only, like every throw in the sibling template: the
        // thai-copy-style gate reads any literal containing Thai as applicant
        // copy, and these strings are operator-facing failures, not copy.
        throw new Error(`[TerminalDecisionLetter] unknown decision stage "${stage}" — letter refused (D-8: no letter, no transition)`);
    }

    const decisionReason = String(reason || '').trim();
    if (!decisionReason) {
        throw new Error('[TerminalDecisionLetter] missing decision reason — a terminal order without its stated ground is refused (D-8: no letter, no transition)');
    }

    const stageLabel = STATUS_PRESENTATION[stage].label;

    const title = `หนังสือแจ้งคำสั่งไม่รับรองมาตรฐาน GACP คำขอเลขที่ ${applicationNumber}`;
    const body = [
        'เรียน ผู้ยื่นคำขอ',
        '',
        `ตามที่ท่านได้ยื่นคำขอรับรองมาตรฐาน GACP คำขอเลขที่ ${applicationNumber} นั้น ` +
        `ผลการพิจารณาในขั้นตอน${stageLabel} สรุปว่า ไม่ผ่านการพิจารณา ` +
        'จึงมีคำสั่งไม่รับรองคำขอดังกล่าว และคำขอนี้เป็นอันสิ้นสุด',
        '',
        'เหตุผลประกอบคำสั่ง',
        decisionReason,
        '',
        'สิทธิ์ของผู้ยื่นคำขอ',
        'ท่านสามารถยื่นคำขอรับรองใหม่ได้ตามขั้นตอนปกติ โดยกรอกข้อมูลใหม่และชำระค่าธรรมเนียมตามอัตราที่กำหนด',
        '',
        TERMINAL_DECISION_APPEAL_NOTICE,
    ].join('\n');

    return {
        title,
        message: body,
        metadata: {
            applicationNumber,
            stage,
            letterType: TERMINAL_DECISION_LETTER_TYPE,
            reason: decisionReason,
        },
    };
}

module.exports = {
    TERMINAL_DECISION_LETTER_TYPE,
    TERMINAL_DECISION_APPEAL_NOTICE,
    buildTerminalDecisionLetter,
};
