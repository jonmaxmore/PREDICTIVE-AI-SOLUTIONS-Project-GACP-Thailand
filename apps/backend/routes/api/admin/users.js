const express = require('express');
const router = express.Router();
// Prisma client is no longer imported here. Reads and writes go through
// provider-user-service so the admin column projection (no password hashes,
// no MFA secrets, no PDPA-encrypted columns) lives in one place and cannot
// drift between findMany/update calls. See docs/tech-debt/prisma-bypass-routes.md.
const { getRequestIp } = require('../../../utils/client-ip');
const logger = require('../../../shared/logger'); // C4-06: log cause before generic 500
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
} = require('../../../middleware/audit-logger');
const {
    CANONICAL_ROLES,
    normalizeRole,
    isProviderRole,
} = require('../../../shared/canonical-rbac');
const {
    createProviderUser,
    searchAdminUsers,
    getActiveAdminUserGuard,
    updateAdminUser,
} = require('../../../services/provider-user-service');
const adminUserService = require('../../../services/admin-user-service');
// P0-A: role/status writes on this router are credential mutations — stamp the
// session epoch so the target's live 12h JWT (role baked in at mint) is
// evicted immediately instead of keeping its old access until expiry.
const { sessionEpochStamp } = require('../../../utils/session-epoch');
const { safeErrorMessage } = require('../../../shared/api-response');
// P0-B: computeLookupHmac — 13-digit ID search must hit the keyed lookup
// columns (healthIdHmac/providerIdHmac); the plaintext columns hold `enc:v1:`
// ciphertext under ENABLE_PDPA_FIELD_ENCRYPTION so `contains` never matches.
const { maskThaiId, computeLookupHmac } = require('../../../utils/field-encryption');
const ALLOWED_STATUSES = new Set([
    'ACTIVE',
    'SUSPENDED',
    'LOCKED',
    'INACTIVE',
    'PENDING_VERIFICATION',
]);
function isAdminRole(role) {
    return normalizeRole(role) === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM;
}
function requireAdmin(req, res, next) {
    const role = req.user?.canonicalRole || req.user?.role;
    if (!isAdminRole(role)) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: 'Admin role required',
        });
    }
    return next();
}
function asString(value) {
    return String(value || '').trim();
}
// users.role is canonical (migration 20260801000000), so the canonical value
// IS the stored value — no per-role legacy spelling list. The old switch
// enumerated the legacy spellings, every one of which matched ZERO rows
// post-migration, so filtering the admin user list by any role returned an
// empty page. It also conflated DOCUMENT_REVIEWER and AUDITOR (both listed
// 'REVIEWER_AUDITOR'); the migration collapsed that ambiguity into exactly
// one canonical value per row.
function roleFilterFromCanonical(canonicalRole) {
    const ROLE_FILTERABLE = [
        CANONICAL_ROLES.HEALTH,
        CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
        CANONICAL_ROLES.DISPATCHER,
        CANONICAL_ROLES.DOCUMENT_REVIEWER,
        CANONICAL_ROLES.FIELD_INSPECTOR,
    ];
    return ROLE_FILTERABLE.includes(canonicalRole) ? { equals: canonicalRole } : undefined;
}
function resolveUserType(user, canonicalRole) {
    if (user.authType === 'PROVIDER_ID' || user.providerId) {
        return 'PROVIDER_ID';
    }
    if (user.authType === 'HEALTH_ID' || user.healthId) {
        return 'HEALTH_ID';
    }
    return canonicalRole === CANONICAL_ROLES.HEALTH ? 'HEALTH_ID' : 'PROVIDER_ID';
}
/**
 * Sprint 6 healthId-audit C2 (2026-05-15): mask the 13-digit identifier so
 * the raw value never appears in admin list payloads. The mask preserves the
 * first and last digit so admins can recognise a specific record.
 *
 *   1101900000005 → 1-****-*****-**-5
 */
function maskHealthIdForAdmin(value) {
    if (value === null || value === undefined) {return value;}
    const digits = String(value).replace(/[^0-9]/g, '');
    if (digits.length !== 13) {
        if (digits.length <= 1) {return '*';}
        return '*'.repeat(digits.length - 1) + digits.slice(-1);
    }
    return `${digits[0]}-****-*****-**-${digits[12]}`;
}

/**
 * P0-B: display username for the admin console. Mirrors the provider
 * directory's resolveUsername (routes/api/provider/provider-directory-utils.js)
 * — there is NO `username` column on User, so derive from the email
 * local-part. PDPA: NEVER fall back to the raw 13-digit healthId/providerId;
 * use a UUID-prefixed handle instead.
 */
function resolveAdminUsername(user) {
    if (user.username) {
        return user.username;
    }
    const email = String(user.email || '').trim();
    if (email.includes('@')) {
        return email.split('@')[0];
    }
    return `user-${String(user.id || '').slice(0, 8)}`;
}

function mapUser(user) {
    const canonicalRole = normalizeRole(user.role) || CANONICAL_ROLES.HEALTH;
    const userType = resolveUserType(user, canonicalRole);
    const maskedHealthId = maskHealthIdForAdmin(user.healthId);
    const maskedProviderId = maskHealthIdForAdmin(user.providerId);
    const identityNumber = userType === 'PROVIDER_ID'
        ? (maskedProviderId || null)
        : (maskedHealthId || null);
    return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        canonicalRole,
        userType,
        accountType: user.accountType,
        authType: user.authType,
        status: user.status,
        providerId: maskedProviderId,
        healthId: maskedHealthId,
        identityNumber,
        // P0-B: the fields page.tsx renders/branches on. `isActive` drives the
        // disable/enable toggle (undefined => the modal ALWAYS called enable →
        // 409 ALREADY_ACTIVE on active users); isLocked mirrors the provider
        // directory's derivation (mapProviderUser: !!user.isLocked).
        username: resolveAdminUsername(user),
        lastLoginAt: user.lastLoginAt || null,
        lockedUntil: user.lockedUntil || null,
        isActive: user.status === 'ACTIVE',
        isLocked: !!user.isLocked,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
}
async function writeAdminUserAudit(req, action, targetUserId, metadata) {
    try {
        await auditLogger.log({
            category: AuditCategory.ADMIN,
            action,
            severity: AuditSeverity.WARNING,
            actorId: req.user?.id || 'SYSTEM',
            actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
            actorType: 'ADMIN',
            resourceType: ResourceType.USER,
            resourceId: targetUserId,
            ipAddress: getRequestIp(req),
            userAgent: req.get('user-agent'),
            metadata,
        });
    } catch (_error) {
        // Best effort logging only
    }
}
// GET /api/admin/users - Search users with canonical role and identity model
router.get('/', requireAdmin, async (req, res) => {
    try {
        const {
            type = 'all', // all | health | provider
            role,
            search,
            q, // P0-B: the FE console (admin-service-b28.ts) sends `q`, not `search`
            status, // P0-B: FE status filter was silently ignored
            page = 1,
            limit = 20,
        } = req.query;
        const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
        const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
        const skip = (safePage - 1) * safeLimit;
        const query = asString(search) || asString(q);
        const normalizedType = asString(type).toLowerCase();
        const canonicalRole = normalizeRole(role);
        // P0-B: 13-digit identity search. healthId/providerId store `enc:v1:`
        // ciphertext under ENABLE_PDPA_FIELD_ENCRYPTION (LIVE prod), so a
        // plaintext `contains` can only match ciphertext noise. An exactly-
        // 13-digit query (dashes/spaces stripped) is matched EXACTLY against
        // the keyed lookup columns instead — the same computeLookupHmac the
        // login path uses. Non-13-digit queries drop the identity clauses
        // entirely and search email/name only.
        const queryDigits = query.replace(/[-\s]/g, '');
        const isThaiIdQuery = /^\d{13}$/.test(queryDigits);
        // S4(b): computeLookupHmac THROWS when ENCRYPTION_KEY is unset (dev
        // boxes without the key; NODE_ENV=test has a deterministic fallback).
        // Degrade to email/name-only search instead of 500ing the console.
        let identityClauses = [];
        if (isThaiIdQuery) {
            try {
                identityClauses = [
                    { healthIdHmac: computeLookupHmac(queryDigits) },
                    { providerIdHmac: computeLookupHmac(queryDigits) },
                ];
            } catch (hmacError) {
                logger.warn(
                    '[admin/users] identity-search HMAC unavailable (ENCRYPTION_KEY unset?) — falling back to email/name-only search:',
                    hmacError?.message,
                );
            }
        }
        const where = {
            isDeleted: false,
            ...(query
                ? {
                    OR: [
                        { email: { contains: query, mode: 'insensitive' } },
                        { firstName: { contains: query, mode: 'insensitive' } },
                        { lastName: { contains: query, mode: 'insensitive' } },
                        ...identityClauses,
                    ],
                }
                : {}),
        };
        // P0-B: account-status filter. `DISABLED` is what the FE sends for the
        // "ถูกระงับ" option — the disable endpoint stores INACTIVE, so alias it.
        let normalizedStatus = null;
        const statusFilterInput = asString(status);
        if (statusFilterInput && statusFilterInput.toUpperCase() !== 'ALL') {
            normalizedStatus = statusFilterInput.toUpperCase() === 'DISABLED'
                ? 'INACTIVE'
                : statusFilterInput.toUpperCase();
            if (!ALLOWED_STATUSES.has(normalizedStatus)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid status filter: ${statusFilterInput}`,
                });
            }
            // S3: NO code path ever writes status='LOCKED' — locks live in the
            // isLocked/lockedUntil boolean columns (see mapUser / the provider
            // lockout writers). where.status='LOCKED' returned a guaranteed-
            // empty list; filter on the lock column instead.
            if (normalizedStatus === 'LOCKED') {
                where.isLocked = true;
            } else {
                where.status = normalizedStatus;
            }
        }
        // Canonical spelling — `{ not: 'HEALTH' }` against the canonicalised
        // column matched EVERY row (no row spells it uppercase any more), so
        // the provider tab listed applicants.
        if (normalizedType === 'health') {
            where.role = { equals: CANONICAL_ROLES.HEALTH };
        } else if (normalizedType === 'provider') {
            where.role = { not: CANONICAL_ROLES.HEALTH };
        }
        if (canonicalRole) {
            const roleFilter = roleFilterFromCanonical(canonicalRole);
            if (!roleFilter) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid role filter: ${role}`,
                });
            }
            where.role = roleFilter;
        }
        const { rows, total } = await searchAdminUsers({ where, skip, take: safeLimit });
        // X5-FIX-A / M-5 (PDPA ม.24) read-side audit. Viewing the user
        // directory IS processing of personal data; emit one INFO row
        // per request (not per result row) so the audit chain can prove
        // WHICH admin viewed WHICH filter at WHICH time. Best-effort
        // wrapper — failure here MUST NOT bubble to the read response.
        try {
            await auditLogger.log({
                category: AuditCategory.ADMIN,
                action: 'ADMIN_USER_LIST_READ',
                severity: AuditSeverity.INFO,
                actorId: req.user?.id || 'SYSTEM',
                actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
                actorEmail: req.user?.email || null,
                actorType: 'ADMIN',
                resourceType: ResourceType.USER,
                resourceId: 'ADMIN_USER_LIST',
                ipAddress: getRequestIp(req),
                userAgent: req.get('user-agent'),
                metadata: {
                    page: safePage,
                    limit: safeLimit,
                    resultCount: rows.length,
                    totalCount: total,
                    filters: {
                        type: normalizedType || null,
                        role: canonicalRole || null,
                        status: normalizedStatus || null, // P0-B
                        hasSearchQuery: Boolean(query),
                    },
                },
            });
        } catch (_error) {
            // Best effort — see admin/audit-log.js writeAuditLogReadAudit
            // header for the same rationale.
        }
        return res.json({
            success: true,
            data: {
                users: rows.map(mapUser),
                pagination: {
                    total,
                    page: safePage,
                    limit: safeLimit,
                    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
                },
            },
        });
    } catch (error) {
        // S4(a) golden rule #3: log the cause before the generic envelope —
        // the swallow made list failures undiagnosable.
        logger.error('[admin/users] list failed:', error?.message);
        // Sprint 6 M4: never echo raw Prisma error.message — it may contain
        // PII (e.g. unique-constraint violation messages naming healthIdHash /
        // taxIdHash columns and their values).
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch users',
        });
    }
});
// POST /api/admin/users/provider - Create provider account using providerId identity
const createProviderUserHandler = async (req, res) => {
    try {
        const { user, canonicalRole } = await createProviderUser({
            providerId: req.body?.providerId,
            email: req.body?.email,
            password: req.body?.password,
            firstName: req.body?.firstName,
            lastName: req.body?.lastName,
            role: req.body?.role,
            actorId: req.user?.id || null,
        });
        // PDPA Sprint 6 (final sweep): audit metadata is persisted to the
        // hash-chained AuditLog table. Storing the raw 13-digit providerId
        // there is a PDPA violation. Mask before write — the masked form
        // is sufficient for the admin to identify which account was created.
        await writeAdminUserAudit(req, 'PROVIDER_USER_CREATED', user.id, {
            providerIdMasked: maskThaiId(user.providerId),
            canonicalRole,
        });
        return res.status(201).json({
            success: true,
            data: mapUser(user),
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            error: error.status ? error.message : 'Failed to create provider user',
            message: error.status ? error.message : safeErrorMessage(error, 'Failed to create provider user'),
        });
    }
};
router.post('/provider', requireAdmin, createProviderUserHandler);
// PATCH /api/admin/users/:id/role - Update role/status with identity checks
router.patch('/:id/role', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const roleInput = req.body?.role;
        const statusInput = req.body?.status;
        if (!roleInput && typeof statusInput === 'undefined') {
            return res.status(400).json({
                success: false,
                error: 'At least one field required: role or status',
            });
        }
        // Self-target guard: an admin cannot change their own role/status here
        // (the /:id/change-role service path already blocks self — mirror it so
        // neither role endpoint can be used for self-escalation/lockout).
        if (id === req.user?.id) {
            return res.status(403).json({
                success: false,
                error: 'An admin cannot change their own role or status',
            });
        }
        // Pull only the guard columns (no email, no audit timestamps) needed
        // to validate the requested mutation. Tenant-scope by the caller's org
        // so a cross-tenant target id 404s instead of being mutated. The full
        // admin projection is returned by updateAdminUser below.
        const existing = await getActiveAdminUserGuard(id, { organizationId: req.user?.organizationId });
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
            });
        }
        // P0-A/S1: the session-epoch stamp is added AFTER role/status are
        // resolved, and only when the resolved value actually DIFFERS from the
        // existing row — the validation above only proves role/status are
        // PRESENT in the body, not that anything changes (the console can
        // re-submit the current values; a before==after write must not evict
        // the target's live session).
        const updateData = {
            updatedBy: req.user?.id || null,
        };
        let targetCanonicalRole = normalizeRole(existing.role);
        if (roleInput) {
            targetCanonicalRole = normalizeRole(roleInput);
            if (!targetCanonicalRole) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid role: ${roleInput}`,
                });
            }
            // PLATFORM_ADMIN is the only cross-tenant role and a superset of
            // every permission — never assignable through the tenant-ADMIN API.
            if (targetCanonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM) {
                return res.status(403).json({
                    success: false,
                    error: 'PLATFORM_ADMIN cannot be assigned through the admin user API',
                });
            }
            // PR 2e (contract phase): the column is canonical, so write canonical.
            if (!targetCanonicalRole) {
                return res.status(400).json({
                    success: false,
                    error: `Unsupported role: ${roleInput}`,
                });
            }
            updateData.role = targetCanonicalRole;
        }
        if (typeof statusInput !== 'undefined') {
            const normalizedStatus = asString(statusInput).toUpperCase();
            if (!ALLOWED_STATUSES.has(normalizedStatus)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid status: ${statusInput}`,
                });
            }
            updateData.status = normalizedStatus;
        }
        if (targetCanonicalRole && isProviderRole(targetCanonicalRole)) {
            if (!existing.providerId) {
                return res.status(400).json({
                    success: false,
                    error: 'provider role requires providerId',
                });
            }
            if (existing.healthId) {
                return res.status(409).json({
                    success: false,
                    error: 'Identity conflict: account has both providerId and healthId',
                });
            }
            updateData.accountType = 'PROVIDER';
            updateData.authType = 'PROVIDER_ID';
        } else if (targetCanonicalRole === CANONICAL_ROLES.HEALTH) {
            if (!existing.healthId) {
                return res.status(400).json({
                    success: false,
                    error: 'Health role requires healthId',
                });
            }
            if (existing.providerId) {
                return res.status(409).json({
                    success: false,
                    error: 'Identity conflict: account has both providerId and healthId',
                });
            }
            updateData.authType = 'HEALTH_ID';
            if (asString(existing.accountType).toUpperCase() === 'PROVIDER') {
                updateData.accountType = 'INDIVIDUAL';
            }
        }
        // S1 (change-vs-presence): only a REAL role/status change is a
        // credential mutation. Compare the resolved values against `existing`.
        const roleChanged = updateData.role !== undefined
            && normalizeRole(updateData.role) !== normalizeRole(existing.role);
        const statusChanged = updateData.status !== undefined
            && updateData.status !== existing.status;
        if (roleChanged || statusChanged) {
            // P0-A: evict the target's live tokens (role/status baked into the
            // JWT at mint time).
            updateData.sessionsRevokedAt = sessionEpochStamp();
        }
        // P0-D: never remove the org's final active ADMIN — whether by demoting
        // the role or by deactivating the account through this endpoint.
        const removesAdminRole = Boolean(updateData.role)
            && normalizeRole(updateData.role) !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM;
        const deactivates = Boolean(updateData.status) && updateData.status !== 'ACTIVE';
        if (removesAdminRole || deactivates) {
            await adminUserService.assertNotLastActiveAdmin({
                existing,
                organizationId: req.user?.organizationId,
            });
        }
        const updated = await updateAdminUser(id, updateData);
        await writeAdminUserAudit(req, 'USER_ROLE_UPDATED', id, {
            before: {
                role: existing.role,
                status: existing.status,
                accountType: existing.accountType,
                authType: existing.authType,
            },
            after: {
                role: updated.role,
                status: updated.status,
                accountType: updated.accountType,
                authType: updated.authType,
            },
        });
        return res.json({
            success: true,
            data: mapUser(updated),
        });
    } catch (error) {
        // P0-D: surface the typed guard error (409 + stable code the FE maps)
        // instead of collapsing it into a generic 500.
        if (error.code === 'ROLE_ADMIN_CANNOT_BE_LAST') {
            return res.status(409).json({
                success: false,
                code: error.code,
                error: error.code,
                message: error.message,
            });
        }
        logger.error('[admin/users] update user role failed:', error?.message); // C4-06
        return res.status(500).json({
            success: false,
            error: 'Failed to update user role',
            message: safeErrorMessage(error, 'Failed to update user role'),
        });
    }
});
// PATCH /api/admin/users/:id/enable - Re-enable a disabled user (Iter 28)
router.patch('/:id/enable', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await adminUserService.enableUser({
            userId: id,
            actorId: req.user?.id || null,
            // S2(b): tenant-scope the guard lookup like disable/change-role.
            organizationId: req.user?.organizationId,
        });
        await writeAdminUserAudit(req, 'USER_ENABLED', id, result.auditMetadata);
        return res.json({
            success: true,
            data: mapUser(result.user),
        });
    } catch (error) {
        const status = error.code === 'USER_NOT_FOUND'
            ? 404
            : error.code === 'ALREADY_ACTIVE'
                ? 409
                : 500;
        return res.status(status).json({
            success: false,
            error: status === 500 ? 'Failed to enable user' : error.message,
            message: safeErrorMessage(error, 'Failed to enable user'),
        });
    }
});

// PATCH /api/admin/users/:id/change-role - Role change with strict reason (Iter 28)
router.patch('/:id/change-role', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await adminUserService.changeUserRole({
            userId: id,
            newRole: req.body?.newRole || req.body?.role,
            reason: req.body?.reason,
            actorId: req.user?.id || null,
            organizationId: req.user?.organizationId,
        });
        await writeAdminUserAudit(req, 'USER_ROLE_CHANGED', id, result.auditMetadata);
        return res.json({
            success: true,
            data: mapUser(result.user),
        });
    } catch (error) {
        const status = error.status
            || (error.code === 'USER_NOT_FOUND' ? 404 : 400);
        return res.status(status).json({
            success: false,
            // Y1-FIX-D contract: the FE modal maps the STABLE code via
            // resolveErrorCode(envelope.code) — always include it.
            code: error.code || null,
            error: error.message || 'Failed to change role',
            message: safeErrorMessage(error, 'Failed to change role'),
        });
    }
});

// No force-reset-mfa: POST /:id/force-reset-mfa is gone (operator 2026-09-26
// "ถอดทั้งสองประตู"). It let an admin clear any same-org user's 2FA — a
// staff-issued second-factor recovery, and there is no account recovery
// (2026-09-17); 2FA recovery belongs to หมอพร้อม. It was also dead: it wrote
// `twoFactorRecoveryCodes`, which is not a User column, so Prisma refused every
// call and the raw validation message went back to the browser.
// pinned by __tests__/unit/second-factor-doors.test.js

// PATCH /api/admin/users/:id/disable - Disable user with mandatory reason
router.patch('/:id/disable', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const reason = asString(req.body?.reason);
        if (!reason || reason.length < 5) {
            return res.status(400).json({
                success: false,
                error: 'reason is required (minimum 5 characters)',
            });
        }
        // P0-A/P0-D: delegate to the service so this path shares ONE policy
        // point with /:id/change-role — self-disable guard, tenant-scoped
        // target lookup, last-admin guard, and the session-epoch stamp that
        // evicts the disabled user's live tokens. (The old inline update had
        // none of those: any same-DB user id could be disabled, including the
        // caller themselves and the org's final ADMIN, and the target's JWT
        // kept working for up to 12h.)
        const result = await adminUserService.disableUser({
            userId: id,
            reason,
            actorId: req.user?.id || null,
            organizationId: req.user?.organizationId,
        });
        await writeAdminUserAudit(req, 'USER_DISABLED', id, {
            reason,
            previousStatus: result.previousStatus,
            nextStatus: 'INACTIVE',
        });
        return res.json({
            success: true,
            data: mapUser(result.user),
        });
    } catch (error) {
        if (error.code === 'USER_NOT_FOUND') {
            return res.status(404).json({ success: false, code: error.code, error: 'User not found' });
        }
        if (error.code === 'SELF_DISABLE_FORBIDDEN') {
            return res.status(403).json({ success: false, code: error.code, error: error.message });
        }
        if (error.code === 'ROLE_ADMIN_CANNOT_BE_LAST') {
            return res.status(409).json({ success: false, code: error.code, error: error.code, message: error.message });
        }
        return res.status(500).json({
            success: false,
            error: 'Failed to disable user',
            message: safeErrorMessage(error, 'Failed to disable user'),
        });
    }
});
module.exports = router;
