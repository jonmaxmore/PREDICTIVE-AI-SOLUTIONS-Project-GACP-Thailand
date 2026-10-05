'use strict';

/**
 * Correction-round stage vocabulary — SSOT (R2 M3, operator 2026-08-03;
 * evidence/R2-special-reopen/final-requirements.md ข้อ 2 verbatim: "นับเลขครั้ง
 * ต่อ stage — reset ทุกรอบ วนไม่จำกัดครั้ง").
 *
 * ONE defining file for the two correction-loop stages a CorrectionRound row
 * can belong to (the project rules Law 3.5/3.6). The DB carries a matching CHECK
 * (String + CHECK idiom, migration 20260803122000_add_correction_rounds) —
 * the DB refuses what this vocabulary refuses.
 *
 * Distinct from CORRECTION_LETTER_STAGE (shared/correction-letter-template.js,
 * M2): that vocabulary names which checkpoint a LETTER reports on
 * (DOC_REVIEW | FIELD_AUDIT_CAR); this one names the round LEDGER dimension
 * (DOC_REVIEW | FIELD_AUDIT). The single sanctioned bridge between the two is
 * roundStageForLetterStage below — no caller may map by hand.
 */

const { CORRECTION_LETTER_STAGE } = require('./correction-letter-template');

const CORRECTION_ROUND_STAGE = Object.freeze({
    DOC_REVIEW: 'DOC_REVIEW',
    FIELD_AUDIT: 'FIELD_AUDIT',
});

const CORRECTION_ROUND_STAGES = Object.freeze(Object.values(CORRECTION_ROUND_STAGE));

/**
 * Letter stage (M2) → round stage (M3), per แผน M3 (decisions-final.md):
 *   - canonical doc-review + reject(DOC_REVISION)  → DOC_REVIEW
 *   - CAR / auditor decision + reject(FIELD_CAR)   → FIELD_AUDIT
 */
const LETTER_STAGE_TO_ROUND_STAGE = Object.freeze({
    [CORRECTION_LETTER_STAGE.DOC_REVIEW]: CORRECTION_ROUND_STAGE.DOC_REVIEW,
    [CORRECTION_LETTER_STAGE.FIELD_AUDIT_CAR]: CORRECTION_ROUND_STAGE.FIELD_AUDIT,
});

/**
 * @param {string} letterStage One of CORRECTION_LETTER_STAGE.
 * @returns {string} One of CORRECTION_ROUND_STAGE.
 * @throws when the letter stage is unknown — an unclassifiable decision must
 *   not mint a round (fails the decision transaction, D-8 discipline).
 */
function roundStageForLetterStage(letterStage) {
    const stage = LETTER_STAGE_TO_ROUND_STAGE[letterStage];
    if (!stage) {
        throw new Error(
            `[CorrectionRoundStage] unknown letter stage "${letterStage}" — round refused (D-8: no round, no transition)`,
        );
    }
    return stage;
}

/**
 * Resubmit-from workflow state → round stage (R2 M7, D-6). The correction
 * resubmit paths leave a workflow state, not a letter stage; this is the single
 * sanctioned bridge so the append-only snapshot service never maps by hand:
 *   - REVISION_REQUESTED (doc-review correction) → DOC_REVIEW
 *   - CAR_PENDING        (field-audit correction) → FIELD_AUDIT
 * Any other status (e.g. DRAFT initial submit) is NOT a correction resubmit and
 * maps to null — the snapshot service treats that as a no-op (no round to
 * attribute the submission to).
 */
const RESUBMIT_STATUS_TO_ROUND_STAGE = Object.freeze({
    REVISION_REQUESTED: CORRECTION_ROUND_STAGE.DOC_REVIEW,
    CAR_PENDING: CORRECTION_ROUND_STAGE.FIELD_AUDIT,
});

/**
 * @param {string} fromStatus The Application.status the resubmit departs from.
 * @returns {string|null} One of CORRECTION_ROUND_STAGE, or null when the status
 *   is not a correction-resubmit state.
 */
function roundStageForResubmitStatus(fromStatus) {
    return RESUBMIT_STATUS_TO_ROUND_STAGE[fromStatus] || null;
}

module.exports = {
    CORRECTION_ROUND_STAGE,
    CORRECTION_ROUND_STAGES,
    roundStageForLetterStage,
    roundStageForResubmitStatus,
};
