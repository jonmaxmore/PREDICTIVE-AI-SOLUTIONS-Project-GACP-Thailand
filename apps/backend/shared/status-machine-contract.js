'use strict';

/**
 * The public status-machine contract served by GET /api/system/status-machine.
 *
 * `routes/api/system/system.js` used to hand-list this as sixteen object
 * literals. That list was a fourth parallel copy of the workflow vocabulary and
 * it had drifted exactly as the others had: it carried the legacy 'REGISTERED'
 * spelling, and it was missing DRAFT's slip-flow successors
 * (the two slip-review states, shipped April 2026 and retired 2026-09-11)
 * plus REJECTED and EXPIRED — so any consumer building a UI from this endpoint
 * was told four real states do not exist.
 *
 * Now the CODES come from the SSOT and only the per-state presentation
 * (Thai label, phase grouping) lives here. `assertContractIsTotal()` runs at
 * require() so a state added to WORKFLOW_STATES without an entry is a boot
 * failure rather than a silently short API response.
 *
 * `order` is derived from the SSOT's declaration order — it was hand-numbered,
 * which is a second thing to keep in sync for no benefit.
 */

const { WORKFLOW_STATES } = require('../services/workflow-transition-service');

/** Which broad phase of the lifecycle each state belongs to. */
const PHASE = Object.freeze({
    SUBMISSION: 'submission',
    PAYMENT: 'payment',
    REVIEW: 'review',
    AUDIT: 'audit',
    CERTIFICATION: 'certification',
    TERMINAL: 'terminal',
});

const STATUS_PRESENTATION = Object.freeze({
    DRAFT: { label: 'ร่าง', phase: PHASE.SUBMISSION },
    SUBMITTED: { label: 'ยื่นแล้ว', phase: PHASE.SUBMISSION },
    PENDING_DOC_FEE: { label: 'รอชำระค่าเอกสาร', phase: PHASE.PAYMENT },
    DOC_FEE_PAID: { label: 'ชำระค่าเอกสารแล้ว', phase: PHASE.REVIEW },
    ASSIGNED_FOR_REVIEW: { label: 'มอบหมายตรวจ', phase: PHASE.REVIEW },
    REVISION_REQUESTED: { label: 'แก้ไข/เพิ่มเติม', phase: PHASE.REVIEW },
    DOC_APPROVED: { label: 'เอกสารผ่าน', phase: PHASE.AUDIT },
    PENDING_AUDIT_FEE: { label: 'รอชำระค่าบริการ', phase: PHASE.PAYMENT },
    AUDIT_FEE_PAID: { label: 'ชำระค่าบริการแล้ว รอนัดตรวจแปลง', phase: PHASE.AUDIT },
    AUDIT_CONFIRMED: { label: 'ยืนยันนัดตรวจ', phase: PHASE.AUDIT },
    CAR_PENDING: { label: 'รอแก้ไข CAR', phase: PHASE.AUDIT },
    CAR_REVIEWING: { label: 'ตรวจ CAR', phase: PHASE.AUDIT },
    AUDIT_PASSED: { label: 'ผ่านตรวจ', phase: PHASE.CERTIFICATION },
    APPROVED: { label: 'อนุมัติ', phase: PHASE.CERTIFICATION },
    CERTIFIED: { label: 'ได้รับใบรับรอง', phase: PHASE.CERTIFICATION },
    REJECTED: { label: 'ไม่อนุมัติ', phase: PHASE.TERMINAL },
    EXPIRED: { label: 'หมดอายุ', phase: PHASE.TERMINAL },
    CANCEL_EXPIRED: { label: 'ยกเลิก/หมดอายุ', phase: PHASE.TERMINAL },
});

function assertContractIsTotal() {
    const missing = WORKFLOW_STATES.filter(
        (state) => !Object.prototype.hasOwnProperty.call(STATUS_PRESENTATION, state),
    );
    const extra = Object.keys(STATUS_PRESENTATION).filter((state) => !WORKFLOW_STATES.includes(state));

    const problems = [
        ...missing.map((s) => `workflow state ${s} has no status-machine presentation`),
        ...extra.map((s) => `status-machine presentation ${s} is not a workflow state`),
    ];
    if (problems.length > 0) {
        throw new Error(`[status-machine-contract] contract is not total:\n  - ${problems.join('\n  - ')}`);
    }
}

assertContractIsTotal();

function buildStatusMachine() {
    return WORKFLOW_STATES.map((code, index) => ({
        code,
        label: STATUS_PRESENTATION[code].label,
        phase: STATUS_PRESENTATION[code].phase,
        order: index + 1,
    }));
}

module.exports = {
    PHASE,
    STATUS_PRESENTATION,
    buildStatusMachine,
    assertContractIsTotal,
};
