/**
 * @module services/tracked-writer
 *
 * Wave A Phase 24 / G3 foundation — generic tracked-field writer.
 *
 * The 2026-04-30 ERP gap analysis flagged that several consequential
 * fields change without a canonical writer recording the change:
 *   - Application.auditorId (auditor reassignment)
 *   - Application.phase1Status / phase2Status
 *   - WorkActivity.assignedUserId
 *   - Certificate.revokedAt
 *
 * `application-status-writer.js` already canonicalises Application.status
 * (PR-WF-1), with workflow-state assertion and work-activity spawning
 * baked in. This module is the generic primitive — same audit-log shape,
 * no model-specific logic, opt-in per call site.
 *
 * Consumers do not have to migrate immediately. The follow-up PRs will
 * port specific call sites (Phase 1/2 status writes, auditor reassignment)
 * once the schema-drift sort is in place. For now this ships the writer
 * + tests + a config slot the lint rule can read in a follow-up.
 *
 * Usage:
 *
 *   const { trackedUpdate } = require('./tracked-writer');
 *
 *   await trackedUpdate({
 *     prisma,                  // Prisma client OR tx handle
 *     model: 'application',    // any soft-delete-aware Prisma model name
 *     where: { id: 'abc' },
 *     data: { phase1Status: 'PAID', phase1PaidAt: new Date() },
 *     trackedFields: ['phase1Status'],   // only these fields emit audit rows
 *     actorId: 'user-123',
 *     actorRole: 'system',
 *     reason: 'webhook PAYMENT_CONFIRMED',
 *     onAudit: async ({ model, recordId, changes, actorId, actorRole, reason, timestamp }) => {
 *       for (const c of changes) {
 *         await auditLogger.log({
 *           category: 'TRACKED_FIELD',
 *           action: `${model}.${c.field}`,
 *           resourceType: model.toUpperCase(),
 *           resourceId: recordId,
 *           actorId, actorRole,
 *           metadata: { from: c.before, to: c.after, reason },
 *         });
 *       }
 *     },
 *   });
 *
 * Design notes:
 *   - `beforeState` is the caller's escape hatch. If the caller already has
 *     the prior row (e.g., they just queried it for a status check),
 *     they can pass it in to skip the re-fetch this writer would otherwise
 *     do. The writer compares the prior values against `data` to compute
 *     a `changes` array; equal-value writes don't emit audit rows.
 *   - `onAudit` is best-effort. A throw inside the callback is swallowed
 *     and logged to console.warn — same policy as application-status-writer.
 *     A tracked-write must not become unavailable just because the audit
 *     log path is down.
 *   - The writer is intentionally model-agnostic. It uses `prisma[model]`
 *     at runtime, so any model on the client is reachable. The caller is
 *     responsible for picking a model name that makes sense.
 *   - Transactional safety: the caller is expected to pass either the bare
 *     `prisma` client OR a `prisma.$transaction(...)` callback's `tx` so
 *     the read-before / update / audit-row INSERT happen atomically when
 *     they care about that.
 */

'use strict';

/**
 * Update a tracked record and emit a per-field audit entry for any value
 * that actually changed. Returns the updated row.
 *
 * @param {object} args
 * @param {object} args.prisma         — prisma client OR tx handle (required)
 * @param {string} args.model          — Prisma model name, e.g. 'application' (required)
 * @param {object} args.where          — Prisma where clause for update target (required)
 * @param {object} args.data           — fields to write (required)
 * @param {string[]} [args.trackedFields] — fields whose changes emit audit rows.
 *                                        Defaults to every key in `data`.
 * @param {string} args.actorId        — id of the actor triggering the change
 * @param {string} [args.actorRole]    — canonical role of the actor
 * @param {string} [args.reason]       — short human-readable reason / trigger
 * @param {object} [args.beforeState]  — prior row, optional. If absent and
 *                                       trackedFields is non-empty, the writer
 *                                       calls findFirst({ where, select: trackedFields }).
 * @param {(entry: object) => Promise<unknown>} [args.onAudit] — best-effort
 *   callback fired once with the full `changes` array. Receives:
 *     { model, recordId, changes: [{ field, before, after }],
 *       actorId, actorRole, reason, timestamp }
 *   `recordId` is `where.id` if present, otherwise `null`.
 * @returns {Promise<object>} the updated row from prisma
 */
async function trackedUpdate(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('trackedUpdate: args required');
    }
    const {
        prisma,
        model,
        where,
        data,
        trackedFields,
        actorId,
        actorRole = null,
        reason = null,
        beforeState,
        onAudit = null,
    } = args;

    if (!prisma) {
        throw new TypeError('trackedUpdate: prisma required');
    }
    if (!model || typeof model !== 'string') {
        throw new TypeError('trackedUpdate: model required (string)');
    }
    if (!where || typeof where !== 'object') {
        throw new TypeError('trackedUpdate: where required (object)');
    }
    if (!data || typeof data !== 'object') {
        throw new TypeError('trackedUpdate: data required (object)');
    }

    const prismaModel = prisma[model];
    if (!prismaModel || typeof prismaModel.update !== 'function') {
        throw new Error(`trackedUpdate: prisma.${model}.update is not a function`);
    }

    // Pick the field list to track. Default = every key the caller intends to
    // write. Filter to keys that exist in `data` so callers can pass a wider
    // tracked-fields config without it forcing a fetch of unrelated columns.
    const fields = (trackedFields && trackedFields.length > 0
        ? trackedFields.filter((f) => Object.prototype.hasOwnProperty.call(data, f))
        : Object.keys(data));

    let priorState = beforeState || null;
    if (!priorState && fields.length > 0 && typeof prismaModel.findFirst === 'function') {
        // Lazy fetch — only when we actually need to compute changes. The
        // caller's `where` clause is reused here.
        const select = Object.fromEntries(fields.map((f) => [f, true]));
        priorState = await prismaModel.findFirst({ where, select });
    }

    const updated = await prismaModel.update({ where, data });

    if (priorState && fields.length > 0) {
        const changes = [];
        for (const f of fields) {
            const before = priorState[f];
            const after = data[f];
            if (!shallowEqual(before, after)) {
                changes.push({ field: f, before, after });
            }
        }
        if (changes.length > 0 && typeof onAudit === 'function') {
            try {
                await onAudit({
                    model,
                    recordId: (where && typeof where === 'object' ? where.id : null) || null,
                    changes,
                    actorId: actorId || null,
                    actorRole,
                    reason,
                    timestamp: new Date(),
                });
            } catch (e) {
                // Swallow + log to console; do NOT re-throw. Same policy as
                // application-status-writer — audit-log availability MUST
                // NOT block tracked writes.
                console.warn(
                    `[tracked-writer] onAudit callback failed (non-fatal): ${e?.message || e}`,
                );
            }
        }
    }

    return updated;
}

/**
 * Cheap structural equality for the value types we expect in tracked
 * fields (string / number / boolean / null / Date). Falls back to
 * JSON.stringify for objects so we don't false-positive on identical
 * Json column writes. Not bullet-proof — callers writing big nested
 * objects should pass `trackedFields` to scope the comparison.
 */
function shallowEqual(a, b) {
    if (a === b) {
        return true;
    }
    if (a === null || b === null || a === undefined || b === undefined) {
        return false;
    }
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }
    if (typeof a === 'object' && typeof b === 'object') {
        try {
            return JSON.stringify(a) === JSON.stringify(b);
        } catch (_e) {
            return false;
        }
    }
    return false;
}

module.exports = {
    trackedUpdate,
    // Exposed for unit tests
    _shallowEqual: shallowEqual,
};
