'use strict';

/**
 * Round-2 (field-inspection fee) payment gate for on-site audit scheduling.
 *
 * Business rule: a field inspection may not be queued until the applicant's
 * round-2 slip has been APPROVED by accounting. Only `approveSlip`
 * (services/payment-slip-service.js:1268-1284) walks
 * PENDING_AUDIT_FEE -> AUDIT_FEE_PAID (settled by webhook), and ROLE_TRANSITIONS grants
 * that edge to the ACCOUNT_* roles alone — so "state is AUDIT_FEE_PAID" is
 * itself an accounting-approval proof, and the settlement projection is the
 * second, independent layer.
 *
 * This module exists because the rule had been enforced on one write path and
 * not on its twin. `PATCH /api/audits/:id/schedule` writes the same two
 * columns as the canonical scheduler handler (`scheduledDate`, `auditorId`)
 * and carried neither check, so a SCHEDULER could assign an auditor and an
 * inspection date to an application still in PENDING_AUDIT_FEE. Keeping the
 * predicate in one place is what stops the next writer of those columns from
 * inheriting the same gap.
 *
 * Guarded by __tests__/unit/audits-patch-schedule-phase2-gate.test.js.
 */

const invoiceService = require('../services/invoice-service');
const { computePhaseSettlement } = require('../services/phase-billing-service');
const workflowTransitionService = require('../services/workflow-transition-service');

// The columns the gate needs to reach a verdict. A tenancy lookup that selects
// only `id` cannot gate anything — that narrowing is what disabled the check
// on the PATCH path in the first place, so both call sites share this
// projection rather than hand-rolling one.
const SCHEDULE_GATE_SELECT = Object.freeze({
    id: true,
    status: true,
    phase2Status: true,
    formData: true,
});

const SCHEDULABLE_STATE = 'AUDIT_FEE_PAID';

async function isPhase2PaymentConfirmed(application) {
    if (!application?.id) {
        return false;
    }

    const invoices = await invoiceService.listSettlementsForApplication(application.id);
    const phase2Settlement = computePhaseSettlement(invoices, 'PHASE_2');

    return phase2Settlement.phasePaid
        || String(application?.phase2Status || '').toUpperCase() === 'PAID';
}

/**
 * Resolve whether an on-site inspection may be scheduled for this application.
 *
 * Returns `{ allowed: true }` or `{ allowed: false, error }` rather than
 * throwing, so each route keeps its own response shape and status code.
 */
async function checkSchedulingAllowed(application) {
    if (!application?.id) {
        return { allowed: false, error: 'Application not found' };
    }

    const currentState = workflowTransitionService.resolveStateFromApplication(application);
    if (currentState !== SCHEDULABLE_STATE) {
        return {
            allowed: false,
            error: `Application must be in ${SCHEDULABLE_STATE} before scheduling (current: ${currentState})`,
        };
    }

    if (!(await isPhase2PaymentConfirmed(application))) {
        return { allowed: false, error: 'Phase 2 payment must be confirmed before scheduling' };
    }

    return { allowed: true };
}

module.exports = {
    SCHEDULE_GATE_SELECT,
    SCHEDULABLE_STATE,
    isPhase2PaymentConfirmed,
    checkSchedulingAllowed,
};
