/**
 * Admin User Service — Iter 28 (B28-A admin tooling).
 *
 * Centralises the admin-only user lifecycle mutations that the
 * /api/admin/users routes invoke. Until this iteration, those flows
 * were inlined in the route handler, which made it impossible to
 * unit-test the policy (status transitions, role guards) without
 * spinning a supertest app. Extracting the
 * pure-logic builders + the prisma-bound mutators here means:
 *
 *   1. Route handlers stay thin — they validate the HTTP envelope
 *      (req.body shapes, role guard) and delegate the actual
 *      mutation to this service.
 *   2. Each policy decision (e.g. "you cannot disable yourself",
 *      "role-change requires a 10-char reason") lives in one
 *      place and is regression-tested.
 *   3. The audit-trail metadata payload that gets persisted into
 *      AuditLog is built here so the writer cannot diverge between
 *      disable/enable/role-change paths. (The force-MFA-reset path was
 *      removed 2026-09-26 — operator "ถอดทั้งสองประตู": no one clears
 *      another account's 2FA.)
 *
 * This file MUST NOT import canonical-rbac directly — it receives
 * canonical role helpers via the caller (route layer) so that the
 * service stays decoupled from the RBAC module and can be tested
 * with mocked role tables when needed. In practice the route layer
 * passes the helpers through `deps` but the default export wires
 * the production helpers automatically.
 *
 * IMPORTANT — file boundaries (Iter 28):
 *   - We do NOT touch application-status-writer.js. The application
 *     force-status flow lives in admin-application-service.js.
 *   - We do NOT touch canonical-rbac.js. The role table is read-only
 *     from this service.
 *
 * Legal basis: Thai PDPA Act B.E. 2562 s.32 — admin-user mutations
 * affecting another data subject (disable, role-change) MUST be
 * logged with the actor's identity, the reason, and
 * the before/after snapshot. Failing to record any of these makes
 * the resulting account state unauditable.
 */

'use strict';

const {
    CANONICAL_ROLES,
    normalizeRole,
    isProviderRole,
} = require('../shared/canonical-rbac');
const providerUserService = require('./provider-user-service');
// P0-A: role/status mutations are credential mutations — stamp the session
// epoch so the target's LIVE tokens (role/status baked in at mint, 12h TTL)
// are evicted at the next request instead of surviving until natural expiry.
const { sessionEpochStamp } = require('../utils/session-epoch');

// Allowed status values for the admin status mutation. Kept in sync with the
// route-layer ALLOWED_STATUSES set (users.js). We re-export it from here so
// integration tests don't drift from the route's actual policy.
const ALLOWED_STATUSES = Object.freeze([
    'ACTIVE',
    'SUSPENDED',
    'LOCKED',
    'INACTIVE',
    'PENDING_VERIFICATION',
]);

const ALLOWED_STATUS_SET = new Set(ALLOWED_STATUSES);

// Minimum length of the human-supplied reason on disable / role-change.
// Tuned to match the route-layer policy:
//   - disable: 5 chars (legacy, kept for backward compat — see assertReason)
//   - role-change: 10 chars (Iter 28 — stricter because role escalations
//     are the most sensitive admin mutation)
const DISABLE_REASON_MIN_LEN = 5;
const ROLE_CHANGE_REASON_MIN_LEN = 10;

// Pure helpers — no prisma access. Safe to import in unit tests.

function asString(value) {
    return String(value || '').trim();
}

/**
 * Validate a reason string against a minimum length policy. Returns an
 * Error object describing what went wrong (or null if the reason is OK).
 * Returning an error rather than throwing keeps callers in control of
 * the HTTP status code mapping.
 */
function validateReason(reason, minLen) {
    const trimmed = asString(reason);
    if (!trimmed) {
        return new Error('reason is required');
    }
    if (trimmed.length < minLen) {
        return new Error(`reason must be at least ${minLen} characters`);
    }
    return null;
}

/**
 * Build the AuditLog metadata payload for a disable-user mutation. Keeps
 * the shape stable so the audit-log viewer's metadata filter can index
 * disable events consistently.
 */
function buildDisableMetadata({ reason, previousStatus }) {
    return {
        reason: asString(reason),
        previousStatus: previousStatus || 'UNKNOWN',
        nextStatus: 'INACTIVE',
        actionType: 'USER_DISABLE',
    };
}

/**
 * Build the AuditLog metadata payload for an enable-user mutation.
 * Mirror of buildDisableMetadata so audit-log queries can pair the two.
 */
function buildEnableMetadata({ previousStatus }) {
    return {
        previousStatus: previousStatus || 'UNKNOWN',
        nextStatus: 'ACTIVE',
        actionType: 'USER_ENABLE',
    };
}

/**
 * Build the AuditLog metadata payload for a role-change mutation. The
 * `before`/`after` snapshot is required by ISO 27799 §7.10.4 — a role
 * change without a before/after pair cannot be reversed forensically.
 */
function buildRoleChangeMetadata({ reason, before, after }) {
    return {
        reason: asString(reason),
        before: {
            role: before?.role || null,
            accountType: before?.accountType || null,
            authType: before?.authType || null,
        },
        after: {
            role: after?.role || null,
            accountType: after?.accountType || null,
            authType: after?.authType || null,
        },
        actionType: 'USER_ROLE_CHANGE',
    };
}

/**
 * Decide the role-change side-effects on accountType / authType. For
 * provider roles we require providerId; for HEALTH we require healthId.
 * Mixed identity (both providerId AND healthId) is a 409 conflict.
 *
 * Returns either:
 *   { ok: true, sideEffects: { accountType?, authType? } }
 *   { ok: false, error: Error, status: 400 | 409 }
 */
function planRoleChangeSideEffects({ targetCanonicalRole, existing }) {
    if (!targetCanonicalRole) {
        return {
            ok: false,
            status: 400,
            error: new Error('targetCanonicalRole is required'),
        };
    }
    if (!existing) {
        return {
            ok: false,
            status: 404,
            error: new Error('User not found'),
        };
    }

    if (isProviderRole(targetCanonicalRole)) {
        if (!existing.providerId) {
            return {
                ok: false,
                status: 400,
                error: new Error('provider role requires providerId'),
            };
        }
        if (existing.healthId) {
            return {
                ok: false,
                status: 409,
                error: new Error('Identity conflict: account has both providerId and healthId'),
            };
        }
        return {
            ok: true,
            sideEffects: {
                accountType: 'PROVIDER',
                authType: 'PROVIDER_ID',
            },
        };
    }

    if (targetCanonicalRole === CANONICAL_ROLES.HEALTH) {
        if (!existing.healthId) {
            return {
                ok: false,
                status: 400,
                error: new Error('Health role requires healthId'),
            };
        }
        if (existing.providerId) {
            return {
                ok: false,
                status: 409,
                error: new Error('Identity conflict: account has both providerId and healthId'),
            };
        }
        const sideEffects = { authType: 'HEALTH_ID' };
        if (String(existing.accountType || '').toUpperCase() === 'PROVIDER') {
            sideEffects.accountType = 'INDIVIDUAL';
        }
        return { ok: true, sideEffects };
    }

    // Unknown / unsupported canonical role.
    return {
        ok: false,
        status: 400,
        error: new Error(`Unsupported canonical role: ${targetCanonicalRole}`),
    };
}

/**
 * Validate a requested status mutation. Returns either:
 *   { ok: true, status: <UPPERCASED> }
 *   { ok: false, error: Error }
 */
function validateStatusInput(statusInput) {
    const normalized = asString(statusInput).toUpperCase();
    if (!normalized) {
        return { ok: false, error: new Error('status is required') };
    }
    if (!ALLOWED_STATUS_SET.has(normalized)) {
        return { ok: false, error: new Error(`Invalid status: ${statusInput}`) };
    }
    return { ok: true, status: normalized };
}

/**
 * Guard "an admin cannot disable themselves". Returning a boolean keeps
 * the route layer free to choose the HTTP status (we send 400 to make
 * the bad-request semantics explicit — 403 would suggest a permissions
 * issue, which it isn't).
 */
function isSelfTarget({ actorId, targetUserId }) {
    if (!actorId || !targetUserId) {return false;}
    return String(actorId) === String(targetUserId);
}

// Service mutations — these touch prisma via provider-user-service. Each
// returns the canonical admin projection so the route layer can serialise
// without an extra DB round-trip.

/**
 * P0-D — last-admin guard. Throws ROLE_ADMIN_CANNOT_BE_LAST (409) when the
 * mutation would leave the target's org with ZERO active tenant ADMINs
 * (demoting the last admin away from admin, or disabling them). A tenant
 * that loses its final ADMIN permanently loses permission control — nobody
 * left can manage users/roles. The FE already maps this exact code
 * (ChangeRoleModal.tsx ROLE_ADMIN_CANNOT_BE_LAST).
 *
 * Only fires when the CURRENT role is admin AND the mutation removes their
 * active-admin standing. Non-admin targets skip the count entirely.
 *
 * NOTE (deferred): count-then-write TOCTOU — two concurrent demotions of the
 * final two admins can both pass the count before either write lands (needs
 * a tx/serializable lock to close). ms-concurrency window, pilot-acceptable.
 */
async function assertNotLastActiveAdmin({ existing, organizationId } = {}) {
    if (normalizeRole(existing?.role) !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        return;
    }
    if (String(existing?.status || '').toUpperCase() !== 'ACTIVE') {
        return; // already inactive — not an active admin being removed
    }
    const others = await providerUserService.countOtherActiveAdmins({
        organizationId: organizationId || existing.organizationId || null,
        excludeUserId: existing.id,
    });
    if (others === 0) {
        const err = new Error('Cannot remove the last active ADMIN of the organization');
        err.code = 'ROLE_ADMIN_CANNOT_BE_LAST';
        err.status = 409;
        throw err;
    }
}

/**
 * Soft-disable a user (status=INACTIVE). The caller is responsible for
 * writing the audit row — this function returns the metadata payload so
 * the caller can pass it straight to auditLogger.log.
 */
async function disableUser({ userId, reason, actorId, organizationId } = {}) {
    if (!userId) {throw new Error('userId is required');}
    const reasonError = validateReason(reason, DISABLE_REASON_MIN_LEN);
    if (reasonError) {throw reasonError;}

    if (isSelfTarget({ actorId, targetUserId: userId })) {
        const err = new Error('An admin cannot disable their own account');
        err.code = 'SELF_DISABLE_FORBIDDEN';
        throw err;
    }

    const existing = await providerUserService.getActiveAdminUserGuard(userId, { organizationId });
    if (!existing) {
        const err = new Error('User not found');
        err.code = 'USER_NOT_FOUND';
        throw err;
    }

    // P0-D: disabling the org's final active ADMIN would lock the tenant out
    // of permission control forever.
    await assertNotLastActiveAdmin({ existing, organizationId });

    const updated = await providerUserService.updateAdminUser(userId, {
        status: 'INACTIVE',
        updatedBy: actorId || null,
        // P0-A: evict the disabled user's live tokens (see require note above).
        // Without this a disabled staffer keeps full access for up to 12h.
        sessionsRevokedAt: sessionEpochStamp(),
    });

    return {
        user: updated,
        previousStatus: existing.status,
        auditMetadata: buildDisableMetadata({
            reason,
            previousStatus: existing.status,
        }),
    };
}

/**
 * Re-enable a previously-disabled user (status=ACTIVE). Symmetric with
 * disableUser — same shape so the route layer can share the audit path.
 */
async function enableUser({ userId, actorId, organizationId } = {}) {
    if (!userId) {throw new Error('userId is required');}

    // S2(b): tenant-scope the guard lookup like disableUser/changeUserRole —
    // an unscoped lookup let a tenant ADMIN re-enable another org's account.
    const existing = await providerUserService.getActiveAdminUserGuard(userId, { organizationId });
    if (!existing) {
        const err = new Error('User not found');
        err.code = 'USER_NOT_FOUND';
        throw err;
    }

    if (existing.status === 'ACTIVE') {
        const err = new Error('User is already ACTIVE');
        err.code = 'ALREADY_ACTIVE';
        throw err;
    }

    const updated = await providerUserService.updateAdminUser(userId, {
        status: 'ACTIVE',
        updatedBy: actorId || null,
    });

    return {
        user: updated,
        previousStatus: existing.status,
        auditMetadata: buildEnableMetadata({ previousStatus: existing.status }),
    };
}

/**
 * Change a user's role. The new role is normalised through
 * canonical-rbac.normalizeRole before being persisted. The accountType /
 * authType side-effects are computed via planRoleChangeSideEffects.
 *
 * Returns the canonical admin projection plus the audit metadata payload.
 */
async function changeUserRole({ userId, newRole, reason, actorId, organizationId } = {}) {
    if (!userId) {throw new Error('userId is required');}

    const reasonError = validateReason(reason, ROLE_CHANGE_REASON_MIN_LEN);
    if (reasonError) {throw reasonError;}

    const targetCanonicalRole = normalizeRole(newRole);
    if (!targetCanonicalRole) {
        const err = new Error(`Invalid role: ${newRole}`);
        err.status = 400;
        throw err;
    }
    // PLATFORM_ADMIN is the only cross-tenant role (superset of all
    // permissions). A tenant ADMIN must not be able to escalate anyone
    // (incl. themselves) into it via this endpoint — close the privesc.
    if (targetCanonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM) {
        const err = new Error('PLATFORM_ADMIN cannot be assigned through the admin user API');
        err.status = 403;
        throw err;
    }
    // PR 2e (contract phase): the column is canonical, so write canonical.
    // normalizeRole already returned null for anything unmappable, so this
    // guard is now about the caller's input rather than the legacy table.
    if (!targetCanonicalRole) {
        const err = new Error(`Unsupported role: ${newRole}`);
        err.status = 400;
        throw err;
    }

    if (isSelfTarget({ actorId, targetUserId: userId })) {
        const err = new Error('An admin cannot change their own role');
        err.code = 'SELF_ROLE_CHANGE_FORBIDDEN';
        err.status = 400;
        throw err;
    }

    const existing = await providerUserService.getActiveAdminUserGuard(userId, { organizationId });
    if (!existing) {
        const err = new Error('User not found');
        err.code = 'USER_NOT_FOUND';
        err.status = 404;
        throw err;
    }

    const plan = planRoleChangeSideEffects({ targetCanonicalRole, existing });
    if (!plan.ok) {
        plan.error.status = plan.status;
        throw plan.error;
    }

    // P0-D: demoting the org's final active ADMIN to any non-admin role would
    // lock the tenant out of permission control (admin→admin passes through).
    if (targetCanonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        await assertNotLastActiveAdmin({ existing, organizationId });
    }

    const data = {
        role: targetCanonicalRole,
        updatedBy: actorId || null,
        ...plan.sideEffects,
        // P0-A: the old-role JWT must not survive the demotion/promotion —
        // stamp the epoch so verify/refresh reject tokens minted before now.
        sessionsRevokedAt: sessionEpochStamp(),
    };

    const updated = await providerUserService.updateAdminUser(userId, data);

    return {
        user: updated,
        auditMetadata: buildRoleChangeMetadata({
            reason,
            before: {
                role: existing.role,
                accountType: existing.accountType,
                authType: existing.authType,
            },
            after: {
                role: updated.role,
                accountType: updated.accountType,
                authType: updated.authType,
            },
        }),
    };
}

module.exports = {
    // Constants (re-exported for the route layer + tests)
    ALLOWED_STATUSES,
    DISABLE_REASON_MIN_LEN,
    ROLE_CHANGE_REASON_MIN_LEN,

    // Pure helpers (testable without prisma)
    validateReason,
    validateStatusInput,
    buildDisableMetadata,
    buildEnableMetadata,
    buildRoleChangeMetadata,
    planRoleChangeSideEffects,
    isSelfTarget,

    // Service mutations
    disableUser,
    enableUser,
    changeUserRole,
    assertNotLastActiveAdmin,
};
