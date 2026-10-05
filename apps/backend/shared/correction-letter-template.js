'use strict';

/**
 * Correction-decision official letter — template SSOT.
 *
 * R2 M2 (operator decision D-8, 2026-08-03 — evidence/R2-special-reopen/
 * decisions-final.md; requirement verbatim: final-requirements.md ข้อ 3):
 * every "ผลไม่ผ่าน" decision on the correction loop must reach the farmer as
 * a จดหมายราชการในระบบ (Notification official-letter kind, M1) carrying ALL
 * FIVE mandatory elements:
 *
 *   1. ผลไม่ผ่าน (ระบุขั้นตอนที่ตก)
 *   2. รายการประเด็นที่ต้องแก้ไข
 *   3. กำหนดส่งการแก้ไข (วันที่ไทย ปี พ.ศ.)
 *   4. ช่องทางการส่งการแก้ไข (ระบบออนไลน์)
 *   5. เลขครั้งของการแก้ไขต่อ stage (R2 M3, FINAL ข้อ 2: "นับเลขครั้งต่อ
 *      stage — reset ทุกรอบ วนไม่จำกัดครั้ง") — the per-stage round number
 *      counted by decision-letter-service inside the decision transaction.
 *
 * ONE defining file for the Thai copy (the project rules Law 3.5/3.6) — the three
 * decision surfaces (canonical workflow-transitions, auditor audit-decision,
 * PATCH /applications/:id/reject) consume it via
 * services/decision-letter-service; none may re-spell the wording.
 * Grep-pinned by __tests__/unit/atomic-decision-letter.test.js.
 *
 * A letter that cannot carry all five elements is REFUSED (throw): under
 * D-8 the decision transaction must then fail — an unnotifiable decision
 * must not start the correction clock. Copy follows the Thai UI copy
 * guideline (ท่าน = legal/official surface register; no em dash in Thai
 * copy; Buddhist-era dates via the shared utils/thai-format helper).
 */

const { formatThaiDateFull } = require('../utils/thai-format');

/** Stage vocabulary — which checkpoint the application failed. */
const CORRECTION_LETTER_STAGE = Object.freeze({
    DOC_REVIEW: 'DOC_REVIEW',
    FIELD_AUDIT_CAR: 'FIELD_AUDIT_CAR',
});

const STAGE_LABEL_TH = Object.freeze({
    [CORRECTION_LETTER_STAGE.DOC_REVIEW]: 'การตรวจสอบเอกสาร',
    [CORRECTION_LETTER_STAGE.FIELD_AUDIT_CAR]: 'การตรวจประเมินสถานที่ (ข้อบกพร่องที่ต้องแก้ไข)',
});

/** Machine identifier for the resubmission channel (element 4). */
const CORRECTION_LETTER_CHANNEL = 'ONLINE_SYSTEM';

/**
 * Build the official correction letter (title/message/metadata).
 *
 * @param {object} args
 * @param {string} args.applicationNumber
 * @param {string} args.stage One of CORRECTION_LETTER_STAGE.
 * @param {Array<string>} [args.items] Structured issue list; when the surface
 *   has none, the decision comment/message becomes the single item.
 * @param {string} [args.message] Decision comment/notes (fallback item).
 * @param {Date|string} args.dueAt Resubmission deadline (already computed by
 *   the caller with the canonical Thai-holiday engine — NOT computed here).
 * @param {number} args.roundNo Per-stage correction round number (>= 1),
 *   counted by decision-letter-service inside the decision transaction
 *   (R2 M3, FINAL ข้อ 2). Mandatory element 5 — a letter without it is
 *   refused.
 * @returns {{ title: string, message: string, metadata: object }}
 */
function buildCorrectionLetter({ applicationNumber, stage, items, message, dueAt, roundNo }) {
    const stageLabel = STAGE_LABEL_TH[stage];
    if (!stageLabel) {
        throw new Error(`[CorrectionLetter] unknown stage "${stage}" — letter refused (D-8: no letter, no transition)`);
    }

    if (!Number.isInteger(roundNo) || roundNo < 1) {
        // English only, like every other throw here: the thai-copy-style gate
        // reads any literal containing Thai as copy the applicant will see, and
        // an em dash is not how Thai separates clauses. This string is an
        // operator-facing failure, not copy — so it says FINAL item 2 rather
        // than FINAL ข้อ 2 and keeps the dash.
        throw new Error('[CorrectionLetter] missing/invalid roundNo — a letter without its per-stage round number is refused (FINAL item 2 + D-8: no letter, no transition)');
    }

    const due = dueAt instanceof Date ? dueAt : new Date(dueAt || NaN);
    if (Number.isNaN(due.getTime())) {
        throw new Error('[CorrectionLetter] missing/invalid dueAt — a letter without its deadline is refused (D-8: no letter, no transition)');
    }

    const normalizedItems = (Array.isArray(items) ? items : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    const fallbackMessage = String(message || '').trim();
    const issueList = normalizedItems.length > 0
        ? normalizedItems
        : (fallbackMessage ? [fallbackMessage] : []);
    if (issueList.length === 0) {
        throw new Error('[CorrectionLetter] no issue items and no decision message — a letter without its issue list is refused (D-8: no letter, no transition)');
    }

    const dueThai = formatThaiDateFull(due);
    const numberedIssues = issueList
        .map((item, index) => `${index + 1}. ${item}`)
        .join('\n');

    const title = `หนังสือแจ้งผลการพิจารณา คำขอเลขที่ ${applicationNumber}`;
    const body = [
        'เรียน ผู้ยื่นคำขอ',
        '',
        `ตามที่ท่านได้ยื่นคำขอรับรองมาตรฐาน GACP คำขอเลขที่ ${applicationNumber} นั้น ` +
        `ผลการพิจารณาขั้นตอน${stageLabel} สรุปว่า ไม่ผ่านการพิจารณา`,
        '',
        `การแก้ไขครั้งที่ ${roundNo} ของขั้นตอน${stageLabel}`,
        '',
        'รายการประเด็นที่ต้องแก้ไข',
        numberedIssues,
        '',
        `กำหนดส่งการแก้ไข: ภายในวันที่ ${dueThai}`,
        'ช่องทางการส่งการแก้ไข: ดำเนินการแก้ไขและส่งผ่านระบบออนไลน์ GACP ในเมนูคำขอของท่าน',
        '',
        'หากไม่ดำเนินการภายในกำหนด ระบบจะปิดคำขอโดยอัตโนมัติ',
    ].join('\n');

    return {
        title,
        message: body,
        metadata: {
            applicationNumber,
            stage,
            result: 'FAIL',
            items: issueList,
            dueAt: due.toISOString(),
            channel: CORRECTION_LETTER_CHANNEL,
            roundNo,
        },
    };
}

module.exports = {
    CORRECTION_LETTER_STAGE,
    CORRECTION_LETTER_CHANNEL,
    buildCorrectionLetter,
};
