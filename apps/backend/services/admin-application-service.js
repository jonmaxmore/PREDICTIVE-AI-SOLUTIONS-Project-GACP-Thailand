/**
 * Admin Application Service
 *
 * Helpers used by routes/api/provider/handlers/admin.js for admin-only
 * application operations (revision reminders, batch actions, deadline
 * extensions, status overrides). Extracted during the batch 10 Prisma-bypass
 * cleanup so the route does not reach into prisma.X.find/update directly.
 *
 * The writes that go through `writeApplicationStatus` (canonical writer) still
 * need a prisma client handle — that is supplied by the route via the existing
 * shared.js export and is explicitly the one allowed bypass per the cluster
 * convention.
 */

const { CANONICAL_ROLES, normalizeRole } = require('../shared/canonical-rbac');
const { prisma } = require('./prisma-database');
const { writeApplicationStatus } = require('./application-status-writer');
const { normalizeWorkflowStateInput, WORKFLOW_STATES } = require('./workflow-transition-service');
// FU-1 (full-system audit H-class follow-up, 2026-07-07): revert-last-transition
// must land in the immutable AuditLog hash chain, atomic with the status flip.
const { statusTransitionAuditHook } = require('../middleware/audit-logger');

// Iter 28 (B28-A admin tooling): force-status + revert-last-transition.
//
// The force-status flow is an emergency escape hatch. It bypasses
// workflow-transition-service.canTransition by calling writeApplicationStatus
// with `assertTransition: false`. Because that disarms the workflow guard,
// the policy MUST be enforced here:
//
//   1. Only callable from an ADMIN-scoped route (the route layer enforces
//      this via require-admin middleware; the service double-checks the
//      explicit actorRole arg as a defence-in-depth measure).
//   2. `reason` is mandatory and must be at least FORCE_STATUS_REASON_MIN_LEN
//      characters — short reasons like "test" or "fix" are explicitly
//      rejected because they leave the audit trail useless.
//   3. The override is recorded into formData.adminOverrides[] AND into
//      workflowHistory[] AND emits an AuditLog row with severity=WARNING.
//      Three independent records is intentional — losing any one of them
//      still leaves the override traceable.

const FORCE_STATUS_REASON_MIN_LEN = 10;
const REVERT_LAST_TRANSITION_REASON_MIN_LEN = 10;

/**
 * States an admin force-status may NOT target, and why. Everything else in
 * WORKFLOW_STATES is allowed.
 *
 * Derived rather than hand-listed: the previous literal Set was a copy of
 * WORKFLOW_STATES that had already drifted — it carried the legacy
 * 'REGISTERED' spelling and was missing two states that existed at the time
 * that shipped in April, so an admin could not force an application into
 * either slip state and nobody noticed. Stating the exclusions makes each one
 * a deliberate decision and makes a NEW state allowed by default, which is the
 * safe direction for an escape hatch.
 */
const FORCE_STATUS_EXCLUSIONS = Object.freeze({
    // Un-submitting an application is a data-deletion-shaped act, not a status
    // correction. Reverting the last transition is the supported route back.
    DRAFT: 'use revert-last-transition instead of un-submitting',
    // Leaving EXPIRED is fenced to the waiver-reopen flow (inspector request →
    // DTAM accountant approval), with BREAK_GLASS_REOPEN as the audited
    // override. Entering it here would sidestep the deadline machinery.
    EXPIRED: 'reserved for the deadline machinery and the waiver-reopen flow',
    // A rejection is a review decision with its own comment requirements.
    REJECTED: 'issue a rejection through the review flow so the reason is recorded',
});

const ALLOWED_FORCE_STATUSES = new Set(
    WORKFLOW_STATES.filter((state) => !(state in FORCE_STATUS_EXCLUSIONS)),
);

const FORCE_STATUS_ALLOWED_REASON_CODES = new Set([
    'DATA_CORRECTION',
    'COMPLIANCE_ESCALATION',
    'LEGAL_ORDER',
    'SYSTEM_RECOVERY',
    'MANUAL_REVIEW_EXCEPTION',
    // Waiver-reopen fence break-glass (owner ruling 2026-07-08): the ONLY
    // admin way to exit EXPIRED — reserved for when the waiver-reopen flow
    // itself is broken. Loudly audited (the in-tx audit hook records the
    // reasonCode); routine reopens MUST use the inspector→ACCOUNT_DTAM flow.
    'BREAK_GLASS_REOPEN',
]);

/**
 * Run `fn` inside a transaction on `client`, or directly when `client` is
 * already a tx handle (tx clients have no $transaction). Shared by the
 * force/revert escape hatches (carpet-bomb debug 2026-07-08 dedup).
 */
function runMaybeInTx(client, fn) {
    return typeof client.$transaction === 'function' ? client.$transaction(fn) : fn(client);
}

function asString(value) {
    return String(value || '').trim();
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Validate the inputs to a force-status request. Returns either:
 *   { ok: true, normalized: { toStatus, reasonCode, reason } }
 *   { ok: false, error: Error, status: 400 | 403 }
 *
 * Pure function — no prisma access. Called from the service mutator AND
 * directly from tests so the policy can be regression-tested without a
 * supertest harness.
 */
function validateForceStatusInputs({ toStatus, reasonCode, reason, actorRole } = {}) {
    if (normalizeRole(actorRole) !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        return {
            ok: false,
            status: 403,
            error: new Error('Force-status override requires ADMIN role'),
        };
    }
    const normalizedStatus = asString(toStatus).toUpperCase();
    if (!normalizedStatus) {
        return {
            ok: false,
            status: 400,
            error: new Error('toStatus is required'),
        };
    }
    if (!ALLOWED_FORCE_STATUSES.has(normalizedStatus)) {
        return {
            ok: false,
            status: 400,
            error: new Error(`Invalid toStatus: ${toStatus}`),
        };
    }
    const normalizedReasonCode = asString(reasonCode).toUpperCase();
    if (!normalizedReasonCode) {
        return {
            ok: false,
            status: 400,
            error: new Error('reasonCode is required'),
        };
    }
    if (!FORCE_STATUS_ALLOWED_REASON_CODES.has(normalizedReasonCode)) {
        return {
            ok: false,
            status: 400,
            error: new Error(`Invalid reasonCode: ${reasonCode}`),
        };
    }
    const trimmedReason = asString(reason);
    if (!trimmedReason) {
        return {
            ok: false,
            status: 400,
            error: new Error('reason is required'),
        };
    }
    if (trimmedReason.length < FORCE_STATUS_REASON_MIN_LEN) {
        return {
            ok: false,
            status: 400,
            error: new Error(`reason must be at least ${FORCE_STATUS_REASON_MIN_LEN} characters`),
        };
    }
    return {
        ok: true,
        normalized: {
            toStatus: normalizedStatus,
            reasonCode: normalizedReasonCode,
            reason: trimmedReason,
        },
    };
}

/**
 * Build the workflow-history entry persisted into both
 * formData.adminOverrides[] and workflowHistory[]. Kept pure so it can
 * be asserted in tests against a fixed clock.
 */
function buildForceStatusEvent({
    fromStatus, toStatus, reasonCode, reason, actorId, actorRole, now,
}) {
    return {
        action: 'ADMIN_FORCE_STATUS',
        fromStatus,
        toStatus,
        reasonCode,
        comment: reason,
        actorId,
        actorRole: actorRole || null,
        timestamp: (now || new Date()).toISOString(),
    };
}

/**
 * Find the most recent workflow-history entry whose `action` is one of
 * the configured workflow-step actions. Used by revertLastTransition to
 * compute the rollback target. Skips ADMIN_FORCE_STATUS entries when
 * `excludeAdminOverrides=true` so a revert call rolls back past prior
 * overrides instead of stacking on top.
 */
function findLastWorkflowTransition(workflowHistory, { excludeAdminOverrides = false } = {}) {
    const rows = asArray(workflowHistory);
    for (let i = rows.length - 1; i >= 0; i -= 1) {
        const evt = rows[i] || {};
        if (excludeAdminOverrides && evt.action === 'ADMIN_FORCE_STATUS') {
            continue;
        }
        if (evt.fromStatus && evt.toStatus) {
            return evt;
        }
    }
    return null;
}

/**
 * Force-transition an application's status, bypassing the normal workflow
 * state machine. The route layer is required to enforce the ADMIN role,
 * but we double-check inside validateForceStatusInputs as defence-in-depth.
 *
 * Returns the updated application row + an audit metadata payload for any
 * additional caller-side logging. The immutable AuditLog hash-chain row IS
 * written here (FU-1c, 2026-07-07): the status write runs in a transaction
 * with onAudit: statusTransitionAuditHook({tx,...}) — previously this ran on
 * a bare client with no audit emission while the route comment claimed
 * otherwise.
 */
async function forceTransitionStatus({
    applicationId,
    toStatus,
    reasonCode,
    reason,
    actorId,
    actorRole,
    prisma: prismaArg = prisma,
} = {}) {
    if (!applicationId) {throw new Error('applicationId is required');}
    if (!actorId) {throw new Error('actorId is required');}

    const validation = validateForceStatusInputs({
        toStatus,
        reasonCode,
        reason,
        actorRole,
    });
    if (!validation.ok) {
        validation.error.status = validation.status;
        throw validation.error;
    }
    const {
        toStatus: normalizedTo,
        reasonCode: normalizedReasonCode,
        reason: normalizedReason,
    } = validation.normalized;

    const existing = await prismaArg.application.findFirst({
        where: {
            OR: [{ id: applicationId }, { applicationNumber: applicationId }],
            isDeleted: false,
        },
        select: {
            id: true,
            applicationNumber: true,
            status: true,
            formData: true,
            workflowHistory: true,
        },
    });

    if (!existing) {
        const err = new Error('Application not found');
        err.status = 404;
        throw err;
    }

    if (existing.status === normalizedTo) {
        const err = new Error(`Application is already in status ${normalizedTo}`);
        err.status = 400;
        throw err;
    }

    const formData = asObject(existing.formData);
    const adminOverrides = asArray(formData.adminOverrides);
    const workflowHistory = asArray(existing.workflowHistory);
    const overrideEvent = buildForceStatusEvent({
        fromStatus: existing.status,
        toStatus: normalizedTo,
        reasonCode: normalizedReasonCode,
        reason: normalizedReason,
        actorId,
        actorRole,
        now: new Date(),
    });

    // FU-1c (adversarial-verify MUST, 2026-07-07): this third escape hatch
    // could force AUDIT_PASSED/APPROVED/CERTIFIED with ZERO AuditLog emission
    // (the route comment falsely claimed otherwise). Same treatment as the
    // override/revert siblings: one transaction + the immutable hash-chain
    // hook. prismaArg may already be a tx handle — reuse it directly then.
    await runMaybeInTx(prismaArg, async (tx) => {
        await writeApplicationStatus({
            prisma: tx,
            applicationId: existing.id,
            fromStatus: existing.status,
            toStatus: normalizedTo,
            actorId,
            actorRole: actorRole || 'ADMIN',
            reason: 'ADMIN_FORCE_STATUS',
            assertTransition: false,
            // Waiver-reopen fence: exiting EXPIRED requires the explicit
            // BREAK_GLASS_REOPEN reasonCode (the writer blocks it otherwise).
            breakGlassReopen: normalizedReasonCode === 'BREAK_GLASS_REOPEN',
            // A forced status change is a manual admin escalation, not a real audit
            // outcome — it must NOT auto-issue a certificate even if it lands on
            // AUDIT_PASSED/APPROVED. Certificate issuance stays bound to the genuine
            // auditor PASS flow (the writer's cert hook on a normal AUDIT_PASSED write).
            autoIssueCertificate: false,
            // Immutable hash-chain record, atomic with the status write.
            onAudit: statusTransitionAuditHook({
                tx,
                metadata: {
                    override: 'ADMIN_FORCE_STATUS',
                    reasonCode: normalizedReasonCode,
                    reason: normalizedReason,
                    decidedBy: actorId,
                },
            }),
            additionalData: {
                updatedBy: actorId,
                workflowHistory: [...workflowHistory, overrideEvent],
                formData: {
                    ...formData,
                    adminOverrides: [...adminOverrides, overrideEvent],
                },
            },
        });
    });

    return {
        applicationId: existing.id,
        applicationNumber: existing.applicationNumber,
        previousStatus: existing.status,
        nextStatus: normalizedTo,
        overrideEvent,
        auditMetadata: {
            applicationNumber: existing.applicationNumber,
            previousStatus: existing.status,
            nextStatus: normalizedTo,
            reasonCode: normalizedReasonCode,
            reason: normalizedReason,
            actionType: 'APPLICATION_FORCE_STATUS',
        },
    };
}

/**
 * Revert the last workflow transition for an application. Used as an
 * emergency rollback when an admin force-status was performed in error.
 * The revert is itself recorded as a NEW workflowHistory entry — we
 * never mutate the existing history because that would break the
 * forensic chain.
 */
async function revertLastTransition({
    applicationId,
    reason,
    actorId,
    actorRole,
    prisma: prismaArg = prisma,
} = {}) {
    if (!applicationId) {throw new Error('applicationId is required');}
    if (!actorId) {throw new Error('actorId is required');}

    if (normalizeRole(actorRole) !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        const err = new Error('Revert-last-transition requires ADMIN role');
        err.status = 403;
        throw err;
    }

    const trimmedReason = asString(reason);
    if (!trimmedReason || trimmedReason.length < REVERT_LAST_TRANSITION_REASON_MIN_LEN) {
        const err = new Error(`reason must be at least ${REVERT_LAST_TRANSITION_REASON_MIN_LEN} characters`);
        err.status = 400;
        throw err;
    }

    const existing = await prismaArg.application.findFirst({
        where: {
            OR: [{ id: applicationId }, { applicationNumber: applicationId }],
            isDeleted: false,
        },
        select: {
            id: true,
            applicationNumber: true,
            status: true,
            formData: true,
            workflowHistory: true,
        },
    });

    if (!existing) {
        const err = new Error('Application not found');
        err.status = 404;
        throw err;
    }

    const workflowHistory = asArray(existing.workflowHistory);
    // We deliberately do NOT exclude ADMIN_FORCE_STATUS — if the most
    // recent action WAS a force-status, the revert should undo that
    // force-status (i.e. roll back to the fromStatus the override
    // recorded). Excluding admin overrides would mean a revert after an
    // override silently skips past it, leading to incoherent state.
    const lastTransition = findLastWorkflowTransition(workflowHistory);
    if (!lastTransition) {
        const err = new Error('No prior transition found to revert');
        err.status = 400;
        throw err;
    }
    if (existing.status !== lastTransition.toStatus) {
        // Defensive: status drifted since the recorded transition. Refuse
        // because reverting from an unexpected current state could put
        // the application in a status it never legally occupied.
        const err = new Error(
            `Cannot revert: current status ${existing.status} does not match last transition toStatus ${lastTransition.toStatus}`,
        );
        err.status = 409;
        throw err;
    }

    // The revert target comes out of stored history, so it can carry whatever
    // spelling the writer of that event used. PR 2b made the status column
    // canonical-only; resolve the historical value through the SSOT rather than
    // replaying it verbatim into a guard that will now refuse it.
    const revertTarget = normalizeWorkflowStateInput(lastTransition.fromStatus);
    if (!revertTarget) {
        const err = new Error(
            `Cannot revert: recorded fromStatus ${lastTransition.fromStatus} does not resolve to a workflow state`,
        );
        err.status = 409;
        throw err;
    }

    const formData = asObject(existing.formData);
    const adminOverrides = asArray(formData.adminOverrides);
    const revertEvent = {
        action: 'ADMIN_REVERT_LAST_TRANSITION',
        fromStatus: lastTransition.toStatus,
        toStatus: revertTarget,
        revertedAction: lastTransition.action || 'UNKNOWN',
        revertedAt: lastTransition.timestamp || null,
        comment: trimmedReason,
        actorId,
        actorRole: actorRole || null,
        timestamp: new Date().toISOString(),
    };

    // FU-1: run the revert in ONE transaction with an immutable AuditLog row
    // (previously: bare client, ZERO AuditLog emission — the route comment
    // claimed a $transaction that did not exist). prismaArg may already BE a
    // transaction handle from a caller — tx clients have no $transaction, so
    // reuse it directly in that case.
    await runMaybeInTx(prismaArg, async (tx) => {
        await writeApplicationStatus({
            prisma: tx,
            applicationId: existing.id,
            fromStatus: existing.status,
            toStatus: revertTarget,
            actorId,
            actorRole: actorRole || 'ADMIN',
            reason: 'ADMIN_REVERT_LAST_TRANSITION',
            assertTransition: false,
            // A revert is an admin correction, not an audit outcome; if it lands on
            // AUDIT_PASSED/APPROVED it must NOT auto-issue a certificate (same
            // rationale as force-status above). Issuance stays bound to the genuine
            // auditor PASS flow.
            autoIssueCertificate: false,
            // Immutable hash-chain record, atomic with the status write.
            onAudit: statusTransitionAuditHook({
                tx,
                metadata: {
                    override: 'ADMIN_REVERT_LAST_TRANSITION',
                    revertedAction: lastTransition.action || 'UNKNOWN',
                    reason: trimmedReason,
                    decidedBy: actorId,
                },
            }),
            additionalData: {
                updatedBy: actorId,
                workflowHistory: [...workflowHistory, revertEvent],
                formData: {
                    ...formData,
                    adminOverrides: [...adminOverrides, revertEvent],
                },
            },
        });
    });

    return {
        applicationId: existing.id,
        applicationNumber: existing.applicationNumber,
        previousStatus: existing.status,
        nextStatus: revertTarget,
        revertEvent,
        auditMetadata: {
            applicationNumber: existing.applicationNumber,
            previousStatus: existing.status,
            nextStatus: revertTarget,
            revertedAction: lastTransition.action || 'UNKNOWN',
            reason: trimmedReason,
            actionType: 'APPLICATION_REVERT_LAST_TRANSITION',
        },
    };
}

/**
 * Pending revision deadlines that have not yet expired. Used by the daily
 * reminder sweep to nudge applicants 1 or 2 working days before due.
 */
async function listPendingRevisionDeadlines(now, { take = 2000 } = {}) {
    return prisma.revisionDeadline.findMany({
        where: {
            status: 'PENDING',
            revisionDue: { gt: now },
        },
        include: {
            application: {
                select: {
                    id: true,
                    applicationNumber: true,
                    healthId: true,
                },
            },
        },
        take,
    });
}

/**
 * Look up non-deleted applications by their ids for batch actions.
 */
async function findApplicationsByIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
        return [];
    }
    return prisma.application.findMany({
        where: { id: { in: ids }, isDeleted: false },
    });
}

/**
 * Latest PENDING revision deadline for an application — drives the admin
 * deadline-extension flow.
 */
async function findLatestPendingRevisionDeadline(applicationId) {
    return prisma.revisionDeadline.findFirst({
        where: { applicationId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
    });
}

/**
 * Push the revisionDue date forward and stamp updatedAt.
 */
async function updateRevisionDeadlineDue(deadlineId, { revisionDue, updatedAt }) {
    return prisma.revisionDeadline.update({
        where: { id: deadlineId },
        data: { revisionDue, updatedAt },
    });
}

/**
 * Pull the minimal application slice (id + formData + workflowHistory) admin
 * deadline-extension needs to log the event into workflowHistory.
 */
async function findApplicationWorkflowSlice(applicationId) {
    return prisma.application.findUnique({
        where: { id: applicationId },
        select: { id: true, formData: true, workflowHistory: true },
    });
}

/**
 * Append a workflowHistory entry without going through the status writer.
 * Used only by admin deadline-extension where the *status* is not changing.
 * (Any actual status transition must go through writeApplicationStatus.)
 */
async function appendWorkflowHistoryOnly(applicationId, { updatedBy, workflowHistory }) {
    return prisma.application.update({
        where: { id: applicationId },
        data: { updatedBy, workflowHistory },
    });
}

/**
 * Load the slice admin status-override needs to verify current status and
 * append a history entry via writeApplicationStatus.
 */
async function findApplicationStatusOverrideSlice(applicationId) {
    return prisma.application.findUnique({
        where: { id: applicationId, isDeleted: false },
        // R2 M3b: healthId + applicationNumber are read by the override handler
        // when the target status is the terminal REJECTED — the administrative
        // order it must mint in the same transaction is addressed to the
        // applicant and titled with the application number.
        select: { id: true, status: true, workflowHistory: true, healthId: true, applicationNumber: true },
    });
}

/**
 * Bulk-update PENDING/EXTENDED revision deadlines for an application to a
 * terminal state (FAILED / SUBMITTED / APPROVED). Used by workflow-transitions
 * + workflow-side-effects when a transition closes out an open revision row.
 */
async function bulkUpdateRevisionDeadlineStatus({ applicationId, fromStatuses, data } = {}) {
    return prisma.revisionDeadline.updateMany({
        where: { applicationId, status: { in: fromStatuses } },
        data,
    });
}

/**
 * Read a single revision deadline by applicationId to compute the next
 * revisionCount. Used by workflow-side-effects.handleRevisionDeadlines on
 * REVISION_REQUESTED.
 */
async function findRevisionDeadlineByApplicationId(applicationId, { select } = {}) {
    return prisma.revisionDeadline.findUnique({
        where: { applicationId },
        select,
    });
}

/**
 * Upsert revision deadline row for an application. Used when the workflow
 * transitions into REVISION_REQUESTED.
 */
async function upsertRevisionDeadline({ applicationId, update, create } = {}) {
    return prisma.revisionDeadline.upsert({
        where: { applicationId },
        update,
        create,
    });
}

/**
 * Pending/extended revision deadlines whose dueDate falls within a window.
 * Used by the scheduler urgent-monitor screen to surface deadlines that are
 * about to expire so the coordinator can intervene. Non-fatal at the call
 * site if RevisionDeadline table doesn't exist — caller wraps in try/catch.
 *
 * Replaces prisma.revisionDeadline.findMany at
 * routes/api/provider/scheduler.js:87.
 */
async function listApproachingRevisionDeadlines({ now, upperBound, take = 20 } = {}) {
    return prisma.revisionDeadline.findMany({
        where: {
            status: { in: ['PENDING', 'EXTENDED'] },
            revisionDue: {
                lte: upperBound,
                gt: now,
            },
        },
        include: {
            application: {
                select: {
                    id: true,
                    applicationNumber: true,
                    applicant: {
                        select: { firstName: true, lastName: true },
                    },
                },
            },
        },
        orderBy: { revisionDue: 'asc' },
        take,
    });
}

module.exports = {
    listPendingRevisionDeadlines,
    findApplicationsByIds,
    findLatestPendingRevisionDeadline,
    updateRevisionDeadlineDue,
    findApplicationWorkflowSlice,
    appendWorkflowHistoryOnly,
    findApplicationStatusOverrideSlice,
    bulkUpdateRevisionDeadlineStatus,
    findRevisionDeadlineByApplicationId,
    upsertRevisionDeadline,
    listApproachingRevisionDeadlines,
    // Iter 28 — force-status + revert-last-transition admin tooling.
    FORCE_STATUS_REASON_MIN_LEN,
    REVERT_LAST_TRANSITION_REASON_MIN_LEN,
    ALLOWED_FORCE_STATUSES,
    FORCE_STATUS_EXCLUSIONS,
    FORCE_STATUS_ALLOWED_REASON_CODES,
    validateForceStatusInputs,
    buildForceStatusEvent,
    findLastWorkflowTransition,
    forceTransitionStatus,
    revertLastTransition,
};
