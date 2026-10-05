'use strict';

/**
 * Decision-letter service — R2 M2 (operator decision D-8, 2026-08-03;
 * evidence/R2-special-reopen/decisions-final.md).
 *
 * D-8 verbatim: "นาฬิกา 5 วันทำการเริ่มที่ transaction บันทึกผล+ออกจดหมาย
 * (atomic — ออกจดหมายไม่ได้ = transition ไม่สำเร็จ)".
 *
 * The ONE place the three correction-decision surfaces mint their official
 * letter (จดหมายราชการในระบบ, M1 official-letter kind):
 *   - routes/api/provider/handlers/workflow-transitions-handler.js
 *     (REVISION_REQUESTED + CAR_PENDING)
 *   - routes/api/provider/handlers/auditor-audit-decision-handler.js
 *     (MINOR/MAJOR → CAR_PENDING)
 *   - routes/api/applications/application-workflow-handlers.js
 *     (PATCH /:id/reject — DOC_REVISION + FIELD_CAR)
 *
 * Contract:
 *   - MUST be called with the SAME transaction client `tx` as the status
 *     write (createOfficialLetter enforces the tx handle) — commit/rollback
 *     is shared.
 *   - NEVER swallows errors. Unresolvable recipient, incomplete letter
 *     content, or a failed row write all throw → the caller's transaction
 *     fails → the decision is NOT recorded and the correction clock does
 *     not start. Do not wrap calls in catch-and-continue.
 *   - Letter copy comes from shared/correction-letter-template.js (SSOT,
 *     Law 3.5/3.6); this service adds no wording.
 *   - R2 M3 (FINAL ข้อ 2): every mint also APPENDS one CorrectionRound row
 *     (per-stage round ledger) through the same tx — roundNo counted here,
 *     stamped into the letter as mandatory element 5. Append-only: no code
 *     path may update or delete a round row (FINAL ข้อ 4).
 *   - Best-effort side channels (plain in-app notice, email, SMS) stay with
 *     the existing post-commit pipelines — deliberately NOT fired here.
 *
 * R2 M3b extends the SAME service with the terminal branch
 * (mintTerminalDecisionLetter): a REJECT is an administrative order, not a
 * correction round, so it carries the separate terminal template and writes NO
 * round row. The surfaces are:
 *   - routes/api/provider/handlers/auditor-audit-decision-handler.js
 *     (decision REJECT: AUDIT_CONFIRMED -> REJECTED)
 *   - routes/api/provider/handlers/workflow-transitions-handler.js
 *     (any transition landing on REJECTED, including an admin force)
 *   - routes/api/provider/handlers/admin.js
 *     (legacy admin status-override targeting REJECTED)
 */

const { findUserByHealthIdSecurely } = require('./user-lookup-service');
const { createOfficialLetter } = require('./notification-service');
const {
    buildCorrectionLetter,
    CORRECTION_LETTER_STAGE,
} = require('../shared/correction-letter-template');
const { buildTerminalDecisionLetter } = require('../shared/terminal-letter-template');
const { roundStageForLetterStage } = require('../shared/correction-round-stage');

/**
 * Resolve the letter recipient, or fail the caller's decision transaction.
 *
 * Shared by both mints (M2 correction + M3b terminal) so the D-8 refusal rule
 * has ONE implementation: the letter row requires a real user AND a tenant
 * (transaction clients bypass the tenant extension, so nothing can inject it
 * later). No recipient means no letter, which under D-8 means no transition.
 *
 * @param {string} healthId Applicant identifier carried on the application.
 * @param {string} applicationId Only for the error message.
 * @returns {Promise<{ id: string, organizationId: string }>}
 */
async function resolveLetterRecipient(healthId, applicationId) {
    const recipient = await findUserByHealthIdSecurely(healthId, {
        select: { id: true, organizationId: true },
    });
    if (!recipient?.id || !recipient.organizationId) {
        throw new Error(
            `[DecisionLetter] cannot resolve letter recipient for application ${applicationId} — D-8: no letter, no transition`,
        );
    }
    return recipient;
}

/**
 * Mint the official correction letter inside the caller's decision
 * transaction.
 *
 * @param {object} args
 * @param {object} args.tx Prisma transaction client of the decision write.
 * @param {string} args.healthId Applicant's healthId (recipient lookup).
 * @param {string} args.applicationId
 * @param {string} args.applicationNumber
 * @param {string} args.stage One of CORRECTION_LETTER_STAGE.
 * @param {Array<string>} [args.items] Structured issue list of the surface.
 * @param {string} [args.message] Decision comment/notes (fallback item).
 * @param {Date|string} args.dueAt Resubmission deadline (computed by the
 *   caller with the canonical Thai-holiday engine).
 * @returns {Promise<object>} The created Notification (letter) row.
 */
async function mintCorrectionLetter({
    tx,
    healthId,
    applicationId,
    applicationNumber,
    stage,
    items,
    message,
    dueAt,
}) {
    // Recipient must resolve to a real user WITH a tenant — the letter row
    // requires both. Failing here fails the decision (D-8).
    const recipient = await resolveLetterRecipient(healthId, applicationId);

    // R2 M3 (FINAL ข้อ 2: "นับเลขครั้งต่อ stage — reset ทุกรอบ วนไม่จำกัด
    // ครั้ง"): per-stage round number = prior rounds of this (application,
    // stage) + 1, counted INSIDE the decision transaction. No cap — the
    // 3-strike rule was revoked (decisions-final.md D-2). The count and the
    // append below run through the SAME tx as the status write + letter, so
    // the round can never exist without its decision or vice versa.
    const roundStage = roundStageForLetterStage(stage);
    const priorRounds = await tx.correctionRound.count({
        where: { applicationId, stage: roundStage },
    });
    const roundNo = priorRounds + 1;

    const letter = buildCorrectionLetter({ applicationNumber, stage, items, message, dueAt, roundNo });

    const letterRow = await createOfficialLetter({
        tx,
        userId: recipient.id,
        organizationId: recipient.organizationId,
        type: 'WARNING',
        priority: 'HIGH',
        title: letter.title,
        message: letter.message,
        metadata: { ...letter.metadata, applicationId },
    });

    // Append-only round ledger (FINAL ข้อ 4: record ใหม่มีเลขครั้ง ของเก่าคง
    // อยู่) — one row per decision, NEVER updated or deleted. organizationId
    // mirrors the letter row's tenant (M1 idiom: tx clients bypass the tenant
    // extension, so the tenant is stamped explicitly from the resolved
    // recipient). Two concurrent decisions that computed the same roundNo hit
    // the (applicationId, stage, roundNo) unique key; Postgres aborts the
    // transaction on the violation, so an in-tx retry is impossible BY DESIGN
    // — fail loudly, the whole decision rolls back, the caller re-issues it.
    try {
        await tx.correctionRound.create({
            data: {
                applicationId,
                stage: roundStage,
                roundNo,
                decidedAt: new Date(),
                dueAt: new Date(letter.metadata.dueAt),
                letterId: letterRow.id,
                organizationId: recipient.organizationId,
            },
        });
    } catch (error) {
        if (error?.code === 'P2002') {
            throw new Error(
                `[DecisionLetter] correction round ${roundNo} (${roundStage}) already recorded for application ${applicationId} — concurrent decision detected, transaction refused (retry the decision)`,
            );
        }
        throw error;
    }

    return letterRow;
}

/**
 * Mint the terminal-decision official letter inside the caller's REJECT
 * transaction (R2 M3b).
 *
 * Same D-8 contract as the correction mint: called with the SAME `tx` as the
 * status write, never swallows an error, adds no wording of its own. Two
 * deliberate differences from the correction branch:
 *
 *   - NO round row. A terminal decision is not a correction round, so the
 *     append-only ledger is untouched (grep-pinned by
 *     __tests__/unit/terminal-decision-letter.test.js).
 *   - NO deadline. Nothing is owed by anyone after this letter, so the
 *     template neither takes nor prints one.
 *
 * @param {object} args
 * @param {object} args.tx Prisma transaction client of the REJECT write.
 * @param {string} args.healthId Applicant's healthId (recipient lookup).
 * @param {string} args.applicationId
 * @param {string} args.applicationNumber
 * @param {string} args.stage Canonical workflow state the decision was taken
 *   in (the FROM state of the REJECT transition).
 * @param {string} args.reason เหตุผลประกอบ from the officer's decision record.
 *   Mandatory — a blank one refuses the letter and so fails the transition.
 * @returns {Promise<object>} The created Notification (letter) row.
 */
async function mintTerminalDecisionLetter({
    tx,
    healthId,
    applicationId,
    applicationNumber,
    stage,
    reason,
}) {
    const recipient = await resolveLetterRecipient(healthId, applicationId);

    const letter = buildTerminalDecisionLetter({ applicationNumber, stage, reason });

    return createOfficialLetter({
        tx,
        userId: recipient.id,
        organizationId: recipient.organizationId,
        type: 'ERROR',
        priority: 'HIGH',
        title: letter.title,
        message: letter.message,
        metadata: { ...letter.metadata, applicationId },
    });
}

module.exports = {
    mintCorrectionLetter,
    mintTerminalDecisionLetter,
    CORRECTION_LETTER_STAGE,
};
