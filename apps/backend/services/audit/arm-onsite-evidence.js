'use strict';

/**
 * Arm the evidence chain for a confirmed audit.
 *
 * A certificate cannot be issued without an AuditChecklist row. The onsite evidence gate
 * (services/onsite-evidence-gate.js) counts FarmAuditPhoto and FarmAuditChecklistItem rows
 * keyed to it, and with no row it refuses the mint with NO_ONSITE_AUDIT. That gate exists
 * because a certificate had previously been issuable with no proof anyone visited the farm.
 *
 * Two routes reach AUDIT_CONFIRMED and only one of them created that row:
 *
 *   /provider/scheduler/queue -> POST /api/audit/scheduling/assign
 *       -> audit-scheduling-service.js — created it
 *   /provider/calendar        -> scheduler-audit-schedules-post-handler.js
 *       -> wrote the state, created nothing
 *
 * A scheduler booking through the calendar produced an audit that could be carried out in
 * full — visit, photos, checklist — and still could not issue a certificate, with nothing
 * anywhere explaining why until the final state. This module is the one place that decides,
 * so the two doors cannot drift apart; pasting the block into the second handler would have
 * left two copies of an evidence rule, which is the same class of defect.
 *
 * A THIRD caller was found on 2026-08-26 and is not a scheduling door at all:
 *
 *   POST /api/provider/applications/:applicationId/checklist
 *       -> controllers/audit-checklist-controller.js — created its own row, inline
 *
 * It never read inspectionMode, so one call from the assigned auditor opened an audit on an
 * ONLINE_MEET application. Everything downstream then behaved correctly — the photos and
 * checklist items really did belong to that application — and a certificate minted for a
 * farm nobody visited. It now calls this function like the other two. The enforcing test
 * was rewritten at the same time: it had been grepping the two files somebody had already
 * thought of, which is why the third creator sat in the tree unnoticed.
 *
 * ONLINE_MEET deliberately arms nothing. An online meeting produces no onsite evidence, and
 * a certificate resting on one is precisely what the gate was built to prevent. What this
 * changes is that the refusal is returned to the caller at scheduling time, with a reason,
 * instead of surfacing weeks later as a cryptic failure at issuance.
 *
 * An unrecognised mode is treated as not certifiable. Failing open here would mean issuing
 * a certificate with no evidence behind it, which is the expensive direction to be wrong in.
 *
 * ── The evidence pin (added 2026-08-26) ──────────────────────────────────────────────
 * Application.formData.onsiteAuditId names the AuditChecklist row a certificate for this
 * application must rest on. audit-onsite-service.submitDecision stamps it when it records a
 * decision, so the in-transaction mint verifies the row the decision was actually made
 * against instead of re-resolving and possibly picking a newer duplicate.
 *
 * Nothing used to move it afterwards, and a pin that outlives its audit is a live defect
 * with no attacker in it: a farm FAILS (the FAIL branch pins too — deliberately, because
 * CAR_REVIEWING -> AUDIT_PASSED is a legal edge and a corrective action closed on paper
 * legitimately rests on that visit's photographs), the audit is re-scheduled, a new
 * AuditChecklist row is armed here, and the stale pin rides along untouched in the formData
 * blob every decision handler spreads. Issuance then verifies the evidence of the audit the
 * farm FAILED. The photographs are real; they are from the visit that said no.
 *
 * The pin is re-pointed HERE, at arming, rather than at each decision handler, because
 * arming is the event that makes the old pin false and because this function is meant to be
 * the only place in the codebase that creates an AuditChecklist row. That was written as a
 * statement of fact while a third creator was live in controllers/; it is now an invariant
 * a repo-wide source scan enforces, in
 * __tests__/unit/audit-checklist-created-by-every-scheduling-door.test.js. Re-stamping at
 * the decision instead would need the same block in four handlers today and in the fifth
 * one somebody adds next month — the exact drift this module was extracted to stop. Note
 * that re-pointing at a freshly armed audit points the pin at a row with NO evidence yet,
 * so issuance refuses until the new visit is actually recorded: that is the fail-closed
 * direction, and it is what a re-scheduled audit means.
 *
 * ── The mode flip (fixed 2026-08-26) ────────────────────────────────────────────────
 * A non-certifiable mode used to leave everything alone: it created nothing, and it also
 * deleted nothing and un-pinned nothing. So the refusal above was only ever enforced on the
 * FIRST scheduling of an application. Schedule ONSITE — a row is armed, the pin names it,
 * an auditor uploads photographs and answers the checklist against it — then re-schedule the
 * SAME application as ONLINE_MEET: the armed row and the pin both survived, and issuance
 * verified the onsite evidence of a visit that had just been called off. No attacker, one
 * ordinary re-schedule.
 *
 * What a flip to a non-certifiable mode now does, and why it is these two writes and not
 * either one alone:
 *
 *   1. It RETIRES (soft-deletes) the application's live IN_PROGRESS AuditChecklist rows —
 *      exactly the rows the ONSITE branch below would have re-used. Clearing the pin alone
 *      would have fixed nothing: with no pin the gate falls back to
 *      resolveCurrentOnsiteAuditId, which prefers precisely the IN_PROGRESS row, so the same
 *      photographs would have been counted one hop later. Soft delete, not a status change,
 *      because isDeleted is the one flag BOTH doors into the gate honour (the pinned lookup
 *      and the resolver); a status of, say, CANCELLED would still be returned by the
 *      resolver's "most recent row of any status" fallback.
 *   2. It CLEARS the pin, but only when the pin names a row this call just retired. A pin at
 *      any other row is left exactly as it was, which is what keeps the paper-CAR path
 *      whole: a farm that FAILED an onsite visit has a DECIDED (non-IN_PROGRESS) row pinned,
 *      CAR_REVIEWING -> AUDIT_PASSED is a legal edge, and that close legitimately rests on
 *      the failed visit's photographs. Clearing unconditionally would discard the only
 *      onsite evidence that exists, and would also hand the decision back to the resolver —
 *      undoing the reason the pin was introduced (freezing a DECIDED row so a newer,
 *      emptier duplicate cannot steal the decision).
 *
 * Only IN_PROGRESS rows are retired, because only an undecided row represents a visit that
 * has not happened yet and now will not. A COMPLETED/SUBMITTED row is a recorded fact about
 * a visit that DID happen; scheduling a later online meeting does not un-visit the farm.
 *
 * The cost, stated plainly: a flip to ONLINE_MEET discards the in-flight onsite evidence
 * set. If it was a mis-click and the scheduler re-books ONSITE, the branch below arms a
 * FRESH row and the earlier photographs do not carry over — the auditor uploads again. That
 * is the fail-closed direction (the alternative is a certificate resting on a visit the
 * schedule says is not happening), and the rows themselves are soft-deleted with a
 * deleteReason, not destroyed, so the history is still there for an investigator.
 */

/** Inspection modes that can lead to a certificate. */
const CERTIFIABLE_INSPECTION_MODES = Object.freeze(['ONSITE']);

/**
 * Point Application.formData.onsiteAuditId at `auditChecklistId`.
 *
 * Reads formData through the SAME client it writes with, immediately before writing: both
 * callers write the application's formData earlier in this very transaction (the scheduling
 * service through writeApplicationStatus, the calendar handler through the canonical
 * writer), so a blob captured before that write would silently roll their fields back.
 *
 * No `typeof client.application?.update === 'function'` guard. A client that cannot write
 * the pin cannot be trusted to have armed anything either, and "if the client looks unusual,
 * skip the evidence rule" is the fail-open shape this whole area keeps being bitten by.
 */
async function _repointEvidencePin(client, applicationId, auditChecklistId) {
    const app = await client.application.findUnique({
        where: { id: applicationId },
        select: { formData: true },
    });
    const formData = (app && typeof app.formData === 'object' && app.formData) ? app.formData : {};
    if (formData.onsiteAuditId === auditChecklistId) { return; }

    await client.application.update({
        where: { id: applicationId },
        data: { formData: { ...formData, onsiteAuditId: auditChecklistId } },
    });
}

/**
 * Soft-delete every live IN_PROGRESS AuditChecklist row of this application and return the
 * ids retired, most recent first.
 *
 * The `where` is deliberately the SAME shape the arming branch uses to decide what to
 * re-use: what a certifiable mode would have adopted is exactly what a non-certifiable mode
 * must stand down, or the two disagree about which row is the live one.
 *
 * A loop rather than a single findFirst, because the one-live-row invariant is this
 * module's to keep, not one it may assume: rows written before this module was the only
 * creator (controllers/audit-checklist-controller.js was minting its own until 2026-08-26)
 * can leave two IN_PROGRESS rows behind, and retiring only the newest would leave the older
 * one for the resolver to find — the same hole, one row over. `retiredIds.includes` is the
 * termination guard: it needs no iteration cap and cannot spin, because a client that hands
 * back a row it was just told to delete ends the loop on the second sight of that id
 * instead of forever.
 */
async function _retireArmedOnsiteAudits(client, { applicationId, inspectionMode, actorId }) {
    const retiredIds = [];
    for (;;) {
        const row = await client.auditChecklist.findFirst({
            where: { applicationId, isDeleted: false, status: 'IN_PROGRESS' },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
        });
        if (!row || retiredIds.includes(row.id)) { break; }
        await client.auditChecklist.update({
            where: { id: row.id },
            data: {
                isDeleted: true,
                deletedAt: new Date(),
                deletedBy: actorId,
                deleteReason: `Inspection re-scheduled as ${inspectionMode || 'UNSPECIFIED'}: the onsite visit this evidence row was armed for is not taking place.`,
            },
        });
        retiredIds.push(row.id);
    }
    return retiredIds;
}

/**
 * Drop Application.formData.onsiteAuditId if it names one of `retiredIds`.
 *
 * Membership, not "clear whenever something was retired": a pin at a DECIDED row is the
 * paper-CAR case and must survive a mode flip untouched. The key is deleted rather than set
 * to null so the blob reads the same as an application that was never pinned, which is what
 * it now is; the gate treats a missing pin as "resolve the current audit", and after the
 * retire above there is no in-flight onsite row for it to resolve to.
 *
 * formData is read through the SAME client immediately before writing, for the reason given
 * on _repointEvidencePin: both scheduling doors have already written this blob earlier in
 * this transaction.
 */
async function _clearEvidencePinIfRetired(client, applicationId, retiredIds) {
    if (retiredIds.length === 0) { return false; }

    const app = await client.application.findUnique({
        where: { id: applicationId },
        select: { formData: true },
    });
    const formData = (app && typeof app.formData === 'object' && app.formData) ? app.formData : {};
    if (!retiredIds.includes(formData.onsiteAuditId)) { return false; }

    const nextFormData = { ...formData };
    delete nextFormData.onsiteAuditId;
    await client.application.update({
        where: { id: applicationId },
        data: { formData: nextFormData },
    });
    return true;
}

/**
 * @param {object} tx Prisma transaction client (must expose auditChecklist AND application —
 *   arming re-points Application.formData.onsiteAuditId at the audit it armed)
 * @param {object} params
 * @param {string} params.applicationId
 * @param {string} params.auditorId
 * @param {string} params.organizationId
 * @param {string|null} [params.createdBy]
 * @param {string} params.inspectionMode  ONSITE | ONLINE_MEET | anything else
 * @param {string} [params.templateName]
 * @returns {Promise<{armed: boolean, canLeadToCertificate: boolean, auditChecklistId: string|null,
 *   retiredAuditChecklistIds: string[], pinCleared: boolean, reason: string|null}>}
 *   retiredAuditChecklistIds / pinCleared report what a non-certifiable mode stood down, so
 *   a scheduler door can say it in the response instead of the applicant discovering it at
 *   issuance. Both are empty/false on the certifiable path.
 */
async function armOnsiteEvidence(tx, params = {}) {
    const {
        applicationId,
        auditorId,
        organizationId,
        createdBy = null,
        inspectionMode,
        templateName = 'GACP_GENERAL',
    } = params;

    const canLeadToCertificate = CERTIFIABLE_INSPECTION_MODES.includes(inspectionMode);

    if (!canLeadToCertificate) {
        // A mode that cannot certify must not leave a certifiable pin (or a certifiable
        // row) behind it — see "The mode flip" in the module header for why both writes
        // are needed and why the pin is cleared conditionally.
        const retiredAuditChecklistIds = await _retireArmedOnsiteAudits(tx, {
            applicationId,
            inspectionMode,
            actorId: createdBy,
        });
        const pinCleared = await _clearEvidencePinIfRetired(tx, applicationId, retiredAuditChecklistIds);

        return {
            armed: false,
            canLeadToCertificate: false,
            auditChecklistId: null,
            retiredAuditChecklistIds,
            pinCleared,
            reason:
                // Read by the dispatcher on the calendar screen as written, so no enum names.
                `การตรวจแบบ${inspectionMode === 'ONLINE_MEET' ? 'ออนไลน์' : (inspectionMode || 'ที่ไม่ระบุ')} ไม่สร้างหลักฐานการลงพื้นที่ `
                + 'จึงออกใบรับรองจากการตรวจครั้งนี้ไม่ได้ ต้องนัดตรวจแบบลงพื้นที่ที่ฟาร์ม'
                + (retiredAuditChecklistIds.length > 0
                    ? ' ระบบยกเลิกรายการตรวจลงพื้นที่ที่เตรียมไว้ก่อนหน้าแล้ว '
                      + 'หากคุณต้องการใช้หลักฐานเดิม ต้องนัดตรวจแบบลงพื้นที่ใหม่และบันทึกหลักฐานอีกครั้ง'
                    : ''),
        };
    }

    // Idempotent: one active checklist per application (spec §7.1). Re-scheduling the same
    // audit must not produce a second row, or the evidence counts split across two and each
    // falls below the gate's threshold.
    //
    // Re-use means a re-armed audit INHERITS the previous attempt's photographs, and that is
    // deliberate rather than overlooked (reviewed 2026-08-26, kept). An ONSITE -> ONSITE
    // re-schedule moves the date of one visit that is still pending: nobody has decided
    // anything, the checklist answers already recorded are the same auditor's work on the
    // same farm, and starting clean would throw them away and split the evidence across two
    // rows so that neither reaches the gate's minimum. The case where "start clean" is right
    // is the case where the pending visit is CALLED OFF — a flip to a mode that cannot
    // certify — and that is exactly what the branch above now does by retiring the row. What
    // this leaves standing, named so the next reviewer does not have to rediscover it: a
    // re-schedule that swaps the auditor still inherits, so a certificate can rest on a photo
    // set two people contributed to. That is a provenance question about who attests to the
    // evidence, not a question of whether anyone visited the farm, and FarmAuditPhoto keeps
    // its own uploader; it is not this function's to answer by deleting rows.
    const existing = await tx.auditChecklist.findFirst({
        where: { applicationId, isDeleted: false, status: 'IN_PROGRESS' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    });

    // The pin is re-pointed on BOTH branches. On the existing branch it is a no-op whenever
    // the pin already names that row; when it does not — a re-schedule onto an audit still
    // IN_PROGRESS while formData still names the previous, decided one — it is the whole
    // fix, and skipping it because "nothing was created" would leave the stale pin standing.
    if (existing) {
        await _repointEvidencePin(tx, applicationId, existing.id);
        return {
            armed: true,
            canLeadToCertificate: true,
            auditChecklistId: existing.id,
            retiredAuditChecklistIds: [],
            pinCleared: false,
            reason: null,
        };
    }

    const created = await tx.auditChecklist.create({
        data: {
            applicationId,
            templateName,
            sections: [],
            auditorId,
            status: 'IN_PROGRESS',
            createdBy,
            organizationId,
        },
    });

    await _repointEvidencePin(tx, applicationId, created.id);

    return {
        armed: true,
        canLeadToCertificate: true,
        auditChecklistId: created.id,
        retiredAuditChecklistIds: [],
        pinCleared: false,
        reason: null,
    };
}

/**
 * Move the application's live evidence row to a different inspector.
 *
 * Every field-app door (context, start, photo, decision) compares AuditChecklist.auditorId
 * with the caller (audit-onsite-service._ensureAuditorMatches, routes/api/audit/onsite.js),
 * so an inspector swap that only rewrote Application.auditorId left the new inspector
 * locked out of the audit he had been given (403 AUDIT_AUDITOR_MISMATCH). Both reassign
 * paths call this inside the same transaction as the Application write, so the two columns
 * cannot disagree.
 *
 * Only the live IN_PROGRESS rows move, the same shape armOnsiteEvidence re-uses. A
 * SUBMITTED/COMPLETED row is the record of a visit somebody DID make and keeps the name of
 * the person who made it; a soft-deleted row is history.
 *
 * Updates, never creates: the one-creator rule (audit-checklist-created-by-every-
 * scheduling-door.test.js) stays true.
 *
 * @param {object} tx   Prisma transaction client exposing auditChecklist
 * @param {{applicationId: string, auditorId: string, actorId?: string|null}} params
 * @returns {Promise<{count: number}>}
 */
async function rebindEvidenceAuditor(tx, { applicationId, auditorId, actorId = null } = {}) {
    if (!applicationId || !auditorId) {
        throw new TypeError('rebindEvidenceAuditor: applicationId and auditorId are required');
    }
    return tx.auditChecklist.updateMany({
        where: { applicationId, isDeleted: false, status: 'IN_PROGRESS', NOT: { auditorId } },
        data: { auditorId, updatedBy: actorId },
    });
}

module.exports = {
    armOnsiteEvidence,
    rebindEvidenceAuditor,
    CERTIFIABLE_INSPECTION_MODES,
};
