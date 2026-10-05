/**
 * Workflow Event Builder
 *
 * Standardizes workflow history entry construction across the codebase.
 * Every workflow state change should record an event via this builder
 * to keep the shape and required fields consistent.
 */

/**
 * Build a workflow history event object.
 *
 * @param {object} opts
 * @param {string} opts.action        - Event action name (e.g. 'WORKFLOW_TRANSITION', 'REVISION_REQUESTED')
 * @param {string|null} [opts.fromState]  - Previous workflow state
 * @param {string|null} [opts.toState]    - Next workflow state
 * @param {string|null} [opts.fromStatus] - Previous legacy status
 * @param {string|null} [opts.toStatus]   - Next legacy status
 * @param {string|null} [opts.actorId]    - ID of the user performing the action
 * @param {string|null} [opts.actorRole]  - Role of the actor
 * @param {string|null} [opts.comment]    - Optional comment/reason
 * @param {string|null} [opts.reasonCode] - Machine-readable reason code
 * @param {object|null} [opts.metadata]   - Extra data (deadline, type, etc.)
 * @returns {object} A normalized workflow history entry
 */
function buildWorkflowEvent({
    action,
    fromState = null,
    toState = null,
    fromStatus = null,
    toStatus = null,
    actorId = null,
    actorRole = null,
    comment = null,
    reasonCode = null,
    metadata = null,
}) {
    return {
        timestamp: new Date().toISOString(),
        action,
        fromState: fromState || null,
        toState: toState || null,
        fromStatus: fromStatus || null,
        toStatus: toStatus || null,
        actorId: actorId || null,
        actorRole: actorRole || null,
        comment: comment || null,
        reasonCode: reasonCode || null,
        ...(metadata ? { metadata } : {}),
    };
}

module.exports = { buildWorkflowEvent };
