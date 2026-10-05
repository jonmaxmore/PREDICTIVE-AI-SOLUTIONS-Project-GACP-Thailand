const { prisma } = require('../services/prisma-database');
const logger = require('../shared/logger');
// The ONE allowlist deciding what a client may write into formData, shared with
// POST /applications/draft. Imported, never re-declared: formData is a single
// blob that also holds fees, workflowState, reviewer/assignment records and
// onsiteAuditId, so a second copy of the list would drift, and a drifted
// allowlist fails open on exactly the keys nobody remembered to add to it.
const { asObject, pickWizardOwnedFormData } = require('../routes/api/helpers/application-constants');
// Canonical answer to "may the applicant still edit this filing?" — the same
// predicate the online doors use, so an offline replay cannot outlive it.
const { isApplicationEditable } = require('../services/workflow-transition-service');

/**
 * Controller for handling offline data synchronization
 * Used by field auditors and Applicants who lose connection during field work
 */
class SyncController {

    /**
     * Process a batch of offline actions in a transaction
     * Payload format:
     * { 
     *    actions: [
     *      { id: 'uuid-1', action: 'save_draft', payload: {...}, timestamp: '2026-...' },
     *      { id: 'uuid-2', action: 'submit_audit', payload: {...}, timestamp: '2026-...' }
     *    ]
     * }
     */
    async processOfflineSync(req, res) {
        try {
            const { actions } = req.body;
            const user = req.user;

            if (!actions || !Array.isArray(actions)) {
                return res.status(400).json({ success: false, error: 'Invalid sync payload format' });
            }

            const results = {
                processed: 0,
                failed: 0,
                errors: [],
                successfulActionIds: [],
            };

            // Process actions sequentially inside a Prisma transaction to ensure atomicity
            // or at least process each uniquely to avoid one failure ruining the rest
            for (const actionItem of actions) {
                try {
                    await prisma.$transaction(async (tx) => {
                        await this.processAction(tx, user, actionItem);
                    });
                    results.processed++;
                    results.successfulActionIds.push(actionItem.id);
                } catch (error) {
                    results.failed++;
                    results.errors.push({ id: actionItem.id, error: error.message });
                    // Keep sync flow resilient even if auxiliary audit logging is unavailable.
                    console.warn('[Sync] Action failed', {
                        actionId: actionItem.id,
                        actorId: user?.id || 'SYSTEM',
                        error: error.message,
                    });
                }
            }

            res.status(200).json({
                success: true,
                message: 'Sync completed',
                data: results,
            });

        } catch (error) {
            logger.error('[Sync] Process Offline Sync Error:', error);
            res.status(500).json({ success: false, error: 'Failed to process sync' });
        }
    }

    // Handle specific actions based on the action string type
    async processAction(tx, user, item) {
        const { action, payload, timestamp: _timestamp } = item;

        switch (action) {
            case 'save_draft': {
                // Simulates saving wizard forms — an applicant-owned action.
                if (!payload.applicationId) {throw new Error('Missing applicationId for save_draft');}
                // SEC-SYS-001: never trust a client-supplied applicationId without an
                // ownership check. Scope the write to the authenticated applicant so a
                // HEALTH user cannot overwrite another applicant's draft (cross-tenant IDOR).
                const ownerHealthId = user?.healthId;
                if (!ownerHealthId) {
                    throw new Error('save_draft requires an authenticated applicant');
                }
                const ownedDraft = await tx.application.findUnique({
                    where: { id: payload.applicationId },
                    select: { healthId: true, status: true, formData: true },
                });
                if (!ownedDraft) {
                    throw new Error('Application not found');
                }
                if (ownedDraft.healthId !== ownerHealthId) {
                    throw new Error('Forbidden: application does not belong to this applicant');
                }
                // Bug 2.3 parity: owning a filing is not the same as being allowed
                // to edit it. The online doors refuse an explicit id whose status
                // has left the applicant's hands; without the same gate here, a
                // queued offline save replayed after submit rewrites a SUBMITTED /
                // AUDIT_PASSED / CERTIFIED filing's answers under the reviewer's
                // feet — and the client is told the sync succeeded.
                if (!isApplicationEditable(ownedDraft.status)) {
                    throw Object.assign(
                        new Error(`Application is not editable in status ${ownedDraft.status}`),
                        { statusCode: 409, code: 'APPLICATION_NOT_EDITABLE' },
                    );
                }
                // Merge through the allowlist instead of replacing the blob. The
                // wholesale write let an offline client post its own
                // onsiteAuditId — the pin naming which audit's photographs a
                // certificate is issued against — along with fees, workflowState
                // and audit results. Stored blob first, so every key the
                // allowlist does not name keeps what the SERVER last wrote; a key
                // the client sends as [] or false still lands, because the
                // allowlist picks by hasOwnProperty (an emptied plot list is an
                // edit, not a missing field).
                const mergedFormData = {
                    ...asObject(ownedDraft.formData),
                    ...pickWizardOwnedFormData(payload.formData),
                };
                await tx.application.update({
                    where: { id: payload.applicationId },
                    data: { formData: mergedFormData },
                });
                break;
            }

            case 'submit_audit': {
                // PENTEST R6-1 — DISABLED (fail-closed). This legacy offline path wrote
                // the application status with assertTransition:false + fromStatus:undefined
                // and NO assignment-ownership / current-state / edge checks, so any AUDITOR
                // could force ANY org application to a terminal REJECTED (or a non-canonical
                // WAITING_CERTIFICATE) from ANY state — bypassing the 20-state machine, the
                // auditorId ownership gate, and (on PASS) the cert-issuance SoD/cert-hook
                // invariants. Round-1 restricted the role to AUDITOR, but that did not close
                // the state-machine bypass. Recording an audit outcome MUST go through the
                // vetted online routes (POST /api/audit/onsite/:auditId/decision and the
                // audits result route) which enforce ownership + edge + assertTransition +
                // the single-auditor cert hook. Refuse here rather than write unsafely.
                throw Object.assign(
                    new Error('submit_audit offline sync is disabled — record the audit decision via the online audit route'),
                    { statusCode: 410, code: 'SYNC_SUBMIT_AUDIT_DISABLED' },
                );
            }

            default:
                throw new Error(`Unknown sync action: ${action}`);
        }
    }
}

module.exports = new SyncController();
