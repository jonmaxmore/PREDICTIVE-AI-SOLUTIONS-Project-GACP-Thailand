'use strict';

/**
 * Assignment Ledger Service (work-distribution ledger, Phase 1B).
 *
 * Append-only operational record of "who assigned which work to which person,
 * when, why" — see prisma/schema/work-distribution-ledger.prisma +
 * docs/handoffs/work-distribution-ledger-design-2026-06-18.md.
 *
 * recordAssignment() is **best-effort**: it NEVER throws to the caller. An
 * assignment (a payment/workflow-critical operation) must not fail because a
 * ledger row couldn't be written — the regulatory AuditLog remains the durable
 * record. We log and swallow on error, mirroring the existing best-effort
 * audit-emit pattern (application-status-writer.js).
 */

const logger = require('../shared/logger');

const ENTITY_TYPES = new Set(['APPLICATION', 'WORK_ACTIVITY', 'POST_AUDIT_TASK']);
const ACTIONS = new Set(['ASSIGN', 'REASSIGN', 'CLAIM', 'UNCLAIM', 'COMPLETE', 'CANCEL']);

/**
 * Write one assignment-lifecycle event to the ledger. Best-effort.
 *
 * @param {object} args
 * @param {object} args.prisma            Prisma client OR tx handle (caller's).
 * @param {string} args.entityType        APPLICATION | WORK_ACTIVITY | POST_AUDIT_TASK
 * @param {string} args.entityId
 * @param {string} args.action            ASSIGN | REASSIGN | CLAIM | UNCLAIM | COMPLETE | CANCEL
 * @param {string} args.assigneeUserId    who is now responsible
 * @param {string|null} [args.assignedByUserId]  who initiated (null = self-claim/system)
 * @param {string|null} [args.role]       canonical role (document_reviewer | auditor | ...)
 * @param {string|null} [args.previousAssigneeUserId]  prior assignee (REASSIGN)
 * @param {string|null} [args.source]     SCHEDULER | ADMIN_BATCH | SELF_CLAIM | SYSTEM
 * @param {string|null} [args.reason]
 * @param {string} args.organizationId    tenant (ADR-014)
 * @returns {Promise<object|null>} the created row, or null on (swallowed) failure.
 */
async function recordAssignment(args) {
    const {
        prisma,
        entityType,
        entityId,
        action,
        assigneeUserId,
        assignedByUserId = null,
        role = null,
        previousAssigneeUserId = null,
        source = null,
        reason = null,
        organizationId,
    } = args || {};

    try {
        // Defensive validation — a malformed ledger call must not poison the
        // caller; just log and skip rather than write garbage.
        if (!prisma || !entityType || !entityId || !action || !assigneeUserId || !organizationId) {
            logger.warn('[assignment-ledger] skipped — missing required field', {
                hasPrisma: !!prisma, entityType, entityId, action,
                hasAssignee: !!assigneeUserId, hasOrg: !!organizationId,
            });
            return null;
        }
        if (!ENTITY_TYPES.has(entityType) || !ACTIONS.has(action)) {
            logger.warn('[assignment-ledger] skipped — invalid entityType/action', { entityType, action });
            return null;
        }

        return await prisma.assignmentLedgerEntry.create({
            data: {
                entityType,
                entityId,
                action,
                assigneeUserId,
                assignedByUserId,
                role,
                previousAssigneeUserId,
                source,
                reason,
                organizationId,
            },
        });
    } catch (e) {
        // Never break the assignment on a ledger failure.
        logger.error('[assignment-ledger] recordAssignment failed (swallowed):', e.message);
        return null;
    }
}

module.exports = { recordAssignment, ENTITY_TYPES, ACTIONS };
