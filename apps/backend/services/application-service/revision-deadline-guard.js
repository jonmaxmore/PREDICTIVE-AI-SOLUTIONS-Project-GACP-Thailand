/**
 * Bug 6.5 — shared revision-deadline enforcement.
 *
 * The applicant gets 5 working days to fix a REVISION_REQUESTED (document
 * review) or CAR_PENDING (audit) application; past the deadline the application
 * EXPIRES and must be re-filed from scratch. submitRevision
 * (application-review-revision-methods.js) enforced this, but the PRIMARY FE
 * resubmit path (POST /applications/submit, RESUBMIT_TARGET) did NOT — so an
 * overdue applicant could resubmit past the deadline through the front door.
 *
 * This helper is the ONE place that resolves the due date and, when overdue,
 * performs the identical EXPIRE side-effects both entry points now share.
 *
 * @module services/application-service/revision-deadline-guard
 */

'use strict';

const { writeApplicationStatus } = require('../application-status-writer');

/**
 * Resolve the revision due date for an application. Prefers the value stamped
 * into formData (revisionDueAt / revision_due_at) then falls back to the
 * RevisionDeadline row. Returns a Date or null.
 */
async function resolveRevisionDueAt(application, prisma) {
    const formData = (application && typeof application.formData === 'object' && application.formData)
        ? application.formData
        : {};

    if (formData.revisionDueAt) {
        return new Date(formData.revisionDueAt);
    }
    if (formData.revision_due_at) {
        return new Date(formData.revision_due_at);
    }

    if (prisma?.revisionDeadline?.findUnique) {
        const deadline = await prisma.revisionDeadline.findUnique({
            where: { applicationId: application.id },
            select: { revisionDue: true, status: true },
        });
        return deadline?.revisionDue || null;
    }
    return null;
}

/**
 * Enforce the revision deadline before a resubmit. When the application is past
 * its due date this EXPIRES it (canonical writer + fails the RevisionDeadline
 * row) and returns `{ expired: true }`; the caller must then reject the
 * resubmit. Within the deadline (or when no deadline is set) it returns
 * `{ expired: false }` and performs no side-effects.
 *
 * @param {object} application — the application row (needs id, status, formData,
 *   workflowHistory).
 * @param {object} opts
 * @param {object} opts.prisma          — prisma client / tx handle.
 * @param {string} opts.actorUserId     — User UUID stamped into scalar columns.
 * @param {string} [opts.actorRole]     — canonical actor role.
 * @param {string} [opts.actorIdentity] — identity for the encrypted JSON history
 *   (falls back to actorUserId).
 * @returns {Promise<{ expired: boolean, dueAt: Date|null }>}
 */
async function assertRevisionNotExpired(application, opts = {}) {
    const { prisma, actorUserId, actorRole = null, actorIdentity = null } = opts;
    if (!prisma) { throw new TypeError('assertRevisionNotExpired: prisma required'); }
    if (!application || !application.id) {
        throw new TypeError('assertRevisionNotExpired: application with id required');
    }

    const dueAt = await resolveRevisionDueAt(application, prisma);
    const now = new Date();

    if (!(dueAt && Number.isFinite(dueAt.getTime()) && now > dueAt)) {
        return { expired: false, dueAt: dueAt || null };
    }

    // Overdue — mirror submitRevision's EXPIRE side-effects exactly.
    const currentFormData = (typeof application.formData === 'object' && application.formData)
        ? application.formData
        : {};
    const currentWorkflowHistory = Array.isArray(application.workflowHistory)
        ? application.workflowHistory
        : [];
    const ts = now.toISOString();

    await writeApplicationStatus({
        prisma,
        applicationId: application.id,
        fromStatus: application.status,
        toStatus: 'EXPIRED',
        // Scalar applications.updatedBy → User UUID, not the plaintext national
        // ID identity; the encrypted JSON workflowHistory keeps the identity.
        actorId: actorUserId,
        actorRole: actorRole || null,
        reason: 'REVISION_DEADLINE_EXPIRED',
        additionalData: {
            formData: {
                ...currentFormData,
                workflowState: 'EXPIRED',
                workflowStateUpdatedAt: ts,
                expiredAt: ts,
                expiredReason: 'REVISION_OVERDUE',
            },
            workflowHistory: [
                ...currentWorkflowHistory,
                {
                    timestamp: ts,
                    action: 'REVISION_DEADLINE_EXPIRED',
                    fromStatus: application.status,
                    toStatus: 'EXPIRED',
                    actorId: actorIdentity || actorUserId,
                    actorRole: actorRole || null,
                },
            ],
        },
    });

    if (prisma?.revisionDeadline?.updateMany) {
        await prisma.revisionDeadline.updateMany({
            where: { applicationId: application.id, status: { in: ['PENDING', 'EXTENDED'] } },
            // revision_deadlines.updatedBy scalar → User UUID (no plaintext ID).
            data: { status: 'FAILED', updatedBy: actorUserId },
        });
    }

    return { expired: true, dueAt };
}

module.exports = {
    assertRevisionNotExpired,
    resolveRevisionDueAt,
};
