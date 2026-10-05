/**
 * Provider directory routes for scheduler/admin operations.
 * Canonical source is User model with providerId identity.
 */
const express = require('express');
const { safeErrorMessage, respondError } = require('../../../shared/api-response');
const router = express.Router();
const prisma = require('../../../services/prisma-database').prisma;
// S6: findMutationTarget / loadProviderTarget carry their OWN explicit
// organizationId filter (incl. the PLATFORM_ADMIN bypass) — they must run
// outside the TENANT_READ_ORG_SCOPE read-scope extension (see the helpers).
const { withoutTenantScope } = require('../../../services/tenant-context');
const authModule = require('../../../middleware/auth-middleware');
const logger = require('../../../shared/logger');
const {
    THAI_ID_REGEX,
    mapProviderUser,
    matchesRoleFilter,
    listProvidersFromUsers,
    findProviderById,
    toRoleValue,
    extractProviderIdentity,
} = require('../provider/provider-directory-utils');
const {
    normalizeRole,
    CANONICAL_ROLES,
    isProviderRole,
} = require('../../../shared/canonical-rbac');
const { createProviderUser } = require('../../../services/provider-user-service');

// ผู้ที่ปรากฏในดรอปดาวน์ "ผู้ตรวจ" ของหน้าจัดตาราง · ค่าคงที่ ไม่ใช่คำเป็นตัวอักษร —
// การรีเนม 2026-09-10 เปลี่ยนค่า คำที่ค้างจะทำให้รายชื่อว่างเปล่าโดยไม่มี error
const INSPECTOR_PICKLIST_ROLES = [
    CANONICAL_ROLES.FIELD_INSPECTOR, CANONICAL_ROLES.DOCUMENT_REVIEWER,
];
// P0-D: last-admin guard shared with the /admin/users surface — one policy
// point (services/admin-user-service.assertNotLastActiveAdmin), not a fork.
const adminUserService = require('../../../services/admin-user-service');
// P0-A class: role/status/password mutations are credential mutations — the
// target's live 12h JWT must be evicted by stamping sessionsRevokedAt.
const { sessionEpochStamp } = require('../../../utils/session-epoch');
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
} = require('../../../middleware/audit-logger');
// Wave B Phase 55 (G6) — admin user lifecycle action helper (unlock).
// Pure builder so the route handler stays thin and the unit tests don't
// need Prisma.
const {
    buildUnlockPayload,
    isAdminCaller,
} = require('../provider/handlers/admin-user-actions-helpers');
const { getRequestIp } = require('../../../utils/client-ip');

const authenticateProvider = authModule.authenticateProvider;

// ── P0-D hardening helpers (staff-directory mutation surface) ───────────────

// Directory mutations (PATCH/PUT/DELETE) are ADMIN-only, with PLATFORM_ADMIN
// (the sole cross-tenant role) also allowed so platform operators can manage
// any tenant's staff. normalizeRole canonicalises every alias/case (ADMIN,
// super_admin → admin; PLATFORM_ADMIN → platform_admin), which preserves the
// legacy super_admin acceptance of the old string check.
function resolveDirectoryManager(req) {
    const canonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
    const isPlatformAdmin = canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM;
    return {
        canonicalRole,
        isPlatformAdmin,
        isManager: canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM || isPlatformAdmin,
    };
}

// Tenant-scoped target lookup for mutations. Threads the caller's
// organizationId into the WHERE (fail-closed `|| null` when the caller
// somehow has no org) so a tenant ADMIN cannot mutate — or even confirm the
// existence of (404, not 403) — another org's users. PLATFORM_ADMIN bypasses
// the org filter (cross-tenant role).
async function findMutationTarget(req, { isPlatformAdmin }) {
    // S6: run OUTSIDE the tenant read-scope extension. Under
    // TENANT_READ_ORG_SCOPE (ON on staging+prod) applyReadScopes spreads
    // `organizationId: ctx.org` over every user.findFirst WHERE — which would
    // clobber the PLATFORM_ADMIN cross-tenant bypass below. This lookup does
    // its OWN explicit org filtering; the extension must not second-guess it.
    //
    // Staff only (operator 2026-09-26, security review 2026-09-26-no-recovery-review.md):
    // the directory edits STAFF accounts. A same-org farmer (no providerId, role
    // health) used to be a valid target for PUT/PATCH/DELETE. A non-staff row now
    // answers exactly like a cross-org one — null → 404, no existence disclosure.
    const target = await withoutTenantScope(() => prisma.user.findFirst({
        where: {
            id: req.params.id,
            isDeleted: false,
            providerId: { not: null },
            ...(isPlatformAdmin ? {} : { organizationId: req.user?.organizationId || null }),
        },
        select: {
            id: true,
            role: true,
            status: true,
            providerId: true,
            organizationId: true,
        },
    }));
    return isStaffAccount(target) ? target : null;
}

// A staff account carries a providerId (the provider login identity) and a
// role that is not the applicant role.
function isStaffAccount(user) {
    return Boolean(user && user.providerId && normalizeRole(user.role) !== CANONICAL_ROLES.HEALTH);
}

// No directory door writes a password (operator 2026-09-26: "ปิด"). An admin
// setting someone else's password is a staff-issued reset, and there is no
// account recovery (operator 2026-09-17). Staff change their OWN password with
// the old one at POST /auth/provider/change-password. A body that carries a
// password is refused outright rather than silently dropped, so a caller that
// still sends one learns the door is shut. An empty string is "no password"
// (the value an untouched form field used to send). Returns true when it has
// already sent the 400 response.
function rejectPasswordWrite(res, bodyPassword) {
    if (bodyPassword === undefined || bodyPassword === null || bodyPassword === '') {
        return false;
    }
    res.status(400).json({
        success: false,
        code: 'DIRECTORY_PASSWORD_WRITE_FORBIDDEN',
        error: 'The staff directory does not set passwords. Staff change their own password with the current one.',
    });
    return true;
}

// providerId (13-digit national ID) is a LOGIN IDENTITY, not a profile field.
// Under the LIVE prod flags (AUTH_LOOKUP_USE_HMAC + APP_FK_USE_TOKEN) the old
// edit path rewrote only the plaintext + legacy sha256 providerIdHash —
// providerIdHmac (what login resolves) and the canonicalId FK token were left
// stale, so the edited user could NO LONGER LOG IN and their application/
// invoice FKs dangled. Owner decision: FORBID the edit outright — admins must
// recreate the account instead. An identical value (dashes/whitespace
// tolerated) is an idempotent no-op: silently ignored, never written.
// Returns true when it has already sent the 400 response.
function rejectProviderIdEdit(res, bodyProviderId, existing) {
    if (bodyProviderId === undefined || bodyProviderId === null) {
        return false;
    }
    const clean = String(bodyProviderId).replace(/-/g, '').trim();
    if (clean === String(existing.providerId || '')) {
        return false; // idempotent no-op
    }
    res.status(400).json({
        success: false,
        code: 'PROVIDER_ID_EDIT_FORBIDDEN',
        error: 'providerId (national ID) cannot be edited — recreate the provider account with the correct providerId instead',
    });
    return true;
}

// Map the shared last-admin guard error (services/admin-user-service) to the
// same 409 envelope the /admin/users surface emits (routes/api/admin/users.js)
// so the FE ChangeRoleModal mapping works on both surfaces. Returns true when
// it has already sent the response.
function respondLastAdminConflict(res, error) {
    if (error && error.code === 'ROLE_ADMIN_CANNOT_BE_LAST') {
        res.status(409).json({
            success: false,
            code: error.code,
            error: error.code,
            message: error.message,
        });
        return true;
    }
    return false;
}

// Get all providers (with optional role/isActive filters)
//
// X2-FIX-D H-12 (DR-DIR-1): the staff directory is read by every
// authenticated provider role for queue-ownership UI labels. Per PDPA
// Section 24 (data minimisation) we pass the caller's canonical role
// to listProvidersFromUsers so non-privileged roles receive the
// `mapProviderUserPublic` projection (no email, no login-lifecycle
// metadata). ADMIN + SCHEDULER continue to see the full payload they
// need for assignment / lifecycle management.
router.get('/', authenticateProvider, async (req, res) => {
    try {
        const { role, isActive } = req.query;
        const viewerCanonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);

        const providers = await listProvidersFromUsers(viewerCanonicalRole);

        const filtered = providers.filter((provider) => {
            if (!matchesRoleFilter(provider, role)) {
                return false;
            }
            if (typeof isActive === 'string') {
                const expected = isActive === 'true';
                return provider.isActive === expected;
            }
            return true;
        });

        res.json({ success: true, data: filtered });
    } catch (error) {
        logger.error('[Provider] list error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch providers' });
    }
});

// Get auditors/reviewers for scheduler dropdown
//
// X2-FIX-D H-12: inspectors dropdown already projected to id/name/role/
// providerId — the strip is preserved here. Pass viewer role so that
// the underlying `listProvidersFromUsers` projects the public shape;
// it's defence in depth in case the inline projection below is ever
// expanded to include email/phone.
router.get('/inspectors', authenticateProvider, async (req, res) => {
    try {
        const viewerCanonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
        const providers = await listProvidersFromUsers(viewerCanonicalRole);
        const inspectors = providers
            .filter((provider) => INSPECTOR_PICKLIST_ROLES.includes(provider.canonicalRole))
            .map((provider) => ({
                id: provider.id,
                firstName: provider.firstName,
                lastName: provider.lastName,
                role: provider.role,
                providerId: provider.providerId,
            }));

        res.json({ success: true, data: inspectors });
    } catch (error) {
        logger.error('[Provider] inspectors error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch inspectors' });
    }
});

// Legacy routes removed
router.get('/stats', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Legacy provider route is disabled, please use dedicated domain endpoints',
    });
});

// Get provider roles
//
// P0-D: derived from canonical-rbac instead of the old hardcoded 5-entry
// list that omitted the Tier-16 ACCOUNT_DTAM / ACCOUNT_PLATFORM split.
// PLATFORM_ADMIN (cross-tenant — never assignable via this tenant-scoped
// surface) and HEALTH (applicant) are excluded by the isProviderRole /
// explicit filter below. Response shape preserved for the FE console:
// value = legacy role enum stored in User.role, label = display string.
const DIRECTORY_ROLE_LABELS = Object.freeze({
    [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]: 'Admin',
    [CANONICAL_ROLES.DOCUMENT_REVIEWER]: 'Reviewer',
    [CANONICAL_ROLES.DISPATCHER]: 'Scheduler',
    [CANONICAL_ROLES.FIELD_INSPECTOR]: 'Auditor',
    [CANONICAL_ROLES.FINANCE_OFFICER_DTAM]: 'Accountant (DTAM)',
    [CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]: 'Accountant (Platform)',
    [CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]: 'Accountant',
});

const PROVIDER_ASSIGNABLE_ROLES = Object.freeze(
    [...new Set(Object.values(CANONICAL_ROLES))].filter(
        (canonicalRole) => isProviderRole(canonicalRole)
            && canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM,
    ),
);

router.get('/roles', authenticateProvider, async (_req, res) => {
    res.json({
        success: true,
        data: PROVIDER_ASSIGNABLE_ROLES.map((canonicalRole) => ({
            value: canonicalRole,
            label: DIRECTORY_ROLE_LABELS[canonicalRole] || canonicalRole,
        })),
    });
});

// Create new provider account (canonical User model)
router.post('/', authenticateProvider, async (req, res) => {
    try {
        // Creating an account IS a directory mutation, so it uses the same
        // resolver as every other mutation in this file (resolveDirectoryManager
        // above): ADMIN plus PLATFORM_ADMIN, "so platform operators can manage
        // any tenant's staff". This handler was the one that never got
        // converted, and comparing the RAW role column against two hand-listed
        // spellings refused callers who genuinely hold the role — raw
        // 'PLATFORM_ADMIN' and the 'platform_owner' alias both normalise to
        // platform_admin and were rejected here while being accepted three
        // lines away. normalizeRole collapses super_admin -> admin, so the
        // legacy acceptance is preserved rather than dropped.
        const { isManager } = resolveDirectoryManager(req);
        if (!isManager) {
            return res.status(403).json({
                success: false,
                error: 'Unauthorized: Only Admins can create provider accounts',
            });
        }

        const { username, email, password, firstName, lastName, role } = req.body;
        const providerId = extractProviderIdentity(req.body);

        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: email, password, firstName, lastName',
            });
        }

        // Field-shape validation — reject malformed/oversized input before it is
        // persisted. Without this an arbitrarily long (e.g. 5000-char) email was
        // accepted and stored. RFC 5321 caps an address at 254 chars.
        const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (typeof email !== 'string' || email.length > 254 || !EMAIL_REGEX.test(email)) {
            return res.status(400).json({ success: false, error: 'A valid email (max 254 chars) is required' });
        }
        if (typeof firstName !== 'string' || firstName.length > 100
            || typeof lastName !== 'string' || lastName.length > 100) {
            return res.status(400).json({ success: false, error: 'firstName and lastName must be strings of at most 100 characters' });
        }
        // Upper bound only — the password strength policy is owned by
        // createProviderUser; here we just reject a non-string / abusive length.
        if (typeof password !== 'string' || password.length > 200) {
            return res.status(400).json({ success: false, error: 'password must be a string of at most 200 characters' });
        }

        if (!providerId) {
            return res.status(400).json({
                success: false,
                error: 'providerId is required for provider accounts',
            });
        }

        if (!THAI_ID_REGEX.test(providerId)) {
            return res.status(400).json({
                success: false,
                error: 'providerId must be a 13-digit Thai ID',
            });
        }

        const { user } = await createProviderUser({
            providerId,
            email,
            password,
            firstName,
            lastName,
            role: role || 'REVIEWER_AUDITOR',
            actorId: req.user?.id || null,
        });

        res.status(201).json({
            success: true,
            message: 'Provider account created successfully',
            data: mapProviderUser({ ...user, source: 'USER', username }),
        });
    } catch (error) {
        logger.error('[Provider] create error:', error);
        res.status(error.status || 500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Get provider by ID
//
// X2-FIX-D H-12: same projection policy as the list route — non-
// privileged roles get the public shape (no email / lifecycle).
router.get('/:id', authenticateProvider, async (req, res) => {
    try {
        const viewerCanonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
        const found = await findProviderById(req.params.id, viewerCanonicalRole);
        if (!found) {
            return res.status(404).json({ success: false, error: 'Provider not found' });
        }
        res.json({ success: true, data: found.record });
    } catch (error) {
        logger.error('[Provider] getById error:', error);
        return respondError(res, req, error);
    }
});

// Partial update (canonical User model)
router.patch('/:id', authenticateProvider, async (req, res) => {
    try {
        const caller = resolveDirectoryManager(req);
        if (!caller.isManager) {
            return res.status(403).json({
                success: false,
                error: 'Unauthorized: Only Admins can manage provider accounts',
            });
        }

        const { firstName, lastName, role, isActive, providerId, password } = req.body;
        if (rejectPasswordWrite(res, password)) {
            return undefined;
        }
        const isSelfTarget = String(req.params.id) === String(req.user?.id);
        const updateData = {
            updatedBy: req.user?.id,
        };

        if (firstName) {
            updateData.firstName = firstName;
        }
        if (lastName) {
            updateData.lastName = lastName;
        }
        if (role) {
            const roleValue = toRoleValue(role);
            if (!roleValue) {
                return res.status(400).json({ success: false, error: 'Invalid provider role' });
            }
            // Privilege-escalation guard — mirrors provider-user-service.createProviderUser
            // and admin/users.js. PLATFORM_ADMIN is the ONLY cross-tenant role; it must
            // never be assignable through this tenant-scoped directory API, or a tenant
            // ADMIN could mint a cross-tenant superuser (the hole #505 closed on the other
            // role-write paths but missed here). normalizeRole canonicalises every alias/case.
            // (Presence-based on purpose — fail-closed even for a "same value" submit.)
            if (normalizeRole(role) === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM) {
                return res.status(403).json({ success: false, error: 'PLATFORM_ADMIN cannot be assigned through the provider directory API' });
            }
            // NOTE (deferred): directory role writes do not run
            // planRoleChangeSideEffects (accountType/authType) — the admin
            // surface enforces those; directory targets always have providerId.
            updateData.role = roleValue;
        }
        if (typeof isActive === 'boolean') {
            updateData.status = isActive ? 'ACTIVE' : 'INACTIVE';
        }

        // P0-D: tenant-scoped target lookup (404 on cross-tenant, no existence
        // disclosure). PLATFORM_ADMIN bypasses the org filter.
        const existing = await findMutationTarget(req, caller);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Provider not found' });
        }

        // P0-D: providerId edits are forbidden (identical value = no-op) — the
        // old dual-write here stranded providerIdHmac + the canonicalId token.
        if (rejectProviderIdEdit(res, providerId, existing)) {
            return undefined;
        }

        // S1 (change-vs-presence): the management console modal ALWAYS sends
        // role, so every guard/side-effect keyed on mere body presence misfired
        // — admins could not edit their own name/email at all, and every
        // routine edit of another staffer force-evicted their session + wrote
        // a before==after audit row. Compare against the EXISTING row instead.
        const roleChanged = updateData.role !== undefined
            && normalizeRole(updateData.role) !== normalizeRole(existing.role);
        const statusChanged = updateData.status !== undefined
            && updateData.status !== existing.status;

        // Self-guards fire only on a REAL change (self-escalation / lockout);
        // an identical-value re-submit is a clean no-op profile edit.
        if (isSelfTarget && roleChanged) {
            return res.status(403).json({
                success: false,
                code: 'SELF_ROLE_CHANGE_FORBIDDEN',
                error: 'You cannot change your own role',
            });
        }
        if (isSelfTarget && statusChanged) {
            return res.status(403).json({
                success: false,
                code: 'SELF_DISABLE_FORBIDDEN',
                error: 'You cannot change your own active status',
            });
        }

        const changesRoleOrStatus = roleChanged || statusChanged;
        // P0-D last-admin guard: demoting an ADMIN away from admin or disabling
        // an ADMIN must not leave the target's org with zero active admins.
        // (assertNotLastActiveAdmin no-ops for non-admin / inactive targets.)
        // NOTE (deferred): count-then-write TOCTOU — two concurrent demotions of
        // the final two admins can interleave past the count (needs a tx/lock;
        // ms-concurrency window, pilot-acceptable).
        const removesAdminStanding = (roleChanged && normalizeRole(updateData.role) !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM)
            || (statusChanged && updateData.status === 'INACTIVE');
        if (removesAdminStanding) {
            await adminUserService.assertNotLastActiveAdmin({
                existing,
                // Count in the TARGET's org — identical to the caller's org for
                // tenant admins (the lookup above is org-scoped) and correct for
                // cross-tenant PLATFORM_ADMIN edits.
                organizationId: existing.organizationId || req.user?.organizationId || null,
            });
        }
        if (changesRoleOrStatus) {
            // P0-A class: evict the target's live 12h JWT (role/status are baked
            // into the token at mint time). Real changes only (S1).
            updateData.sessionsRevokedAt = sessionEpochStamp();
        }

        const updated = await prisma.user.update({
            where: { id: existing.id },
            data: updateData,
            select: {
                id: true,
                uuid: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                status: true,
                providerId: true,
                accountType: true,
                lastLoginAt: true,
                createdAt: true,
            },
        });

        if (changesRoleOrStatus) {
            // P0-D: before/after audit row on directory role/status changes —
            // best-effort (emitAdminUserAudit never throws), mirrors the
            // unlock pattern below.
            await emitAdminUserAudit(req, 'USER_ROLE_UPDATED', AuditSeverity.WARNING, existing.id, {
                before: { role: existing.role, status: existing.status },
                after: { role: updated.role, status: updated.status },
                via: 'provider-directory',
            });
        }

        res.json({ success: true, data: mapProviderUser({ ...updated, source: 'USER' }) });
    } catch (error) {
        if (respondLastAdminConflict(res, error)) {
            return undefined;
        }
        logger.error('[Provider] patch error:', error);
        return respondError(res, req, error);
    }
});

// Full update (canonical User model)
router.put('/:id', authenticateProvider, async (req, res) => {
    try {
        const caller = resolveDirectoryManager(req);
        if (!caller.isManager) {
            return res.status(403).json({
                success: false,
                error: 'Unauthorized: Only Admins can manage provider accounts',
            });
        }

        const { firstName, lastName, email, role, isActive, password, providerId } = req.body;
        if (rejectPasswordWrite(res, password)) {
            return undefined;
        }
        const isSelfTarget = String(req.params.id) === String(req.user?.id);
        const updateData = {
            updatedBy: req.user?.id,
            updatedAt: new Date(),
        };

        if (firstName) {
            updateData.firstName = firstName;
        }
        if (lastName) {
            updateData.lastName = lastName;
        }
        if (email) {
            updateData.email = email;
        }
        if (role) {
            const roleValue = toRoleValue(role);
            if (!roleValue) {
                return res.status(400).json({ success: false, error: 'Invalid provider role' });
            }
            // Privilege-escalation guard — mirrors provider-user-service.createProviderUser
            // and admin/users.js. PLATFORM_ADMIN is the ONLY cross-tenant role; it must
            // never be assignable through this tenant-scoped directory API, or a tenant
            // ADMIN could mint a cross-tenant superuser (the hole #505 closed on the other
            // role-write paths but missed here). normalizeRole canonicalises every alias/case.
            // (Presence-based on purpose — fail-closed even for a "same value" submit.)
            if (normalizeRole(role) === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM) {
                return res.status(403).json({ success: false, error: 'PLATFORM_ADMIN cannot be assigned through the provider directory API' });
            }
            // NOTE (deferred): directory role writes do not run
            // planRoleChangeSideEffects — see PATCH handler.
            updateData.role = roleValue;
        }
        if (typeof isActive === 'boolean') {
            updateData.status = isActive ? 'ACTIVE' : 'INACTIVE';
        }

        // P0-D: tenant-scoped target lookup (404 on cross-tenant, no existence
        // disclosure). PLATFORM_ADMIN bypasses the org filter.
        const existing = await findMutationTarget(req, caller);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Provider not found' });
        }

        // P0-D: providerId edits are forbidden (identical value = no-op) — the
        // old dual-write here stranded providerIdHmac + the canonicalId token.
        if (rejectProviderIdEdit(res, providerId, existing)) {
            return undefined;
        }

        // S1 (change-vs-presence) — see PATCH handler. Guards/side-effects key
        // on a REAL change vs the existing row, not body presence.
        const roleChanged = updateData.role !== undefined
            && normalizeRole(updateData.role) !== normalizeRole(existing.role);
        const statusChanged = updateData.status !== undefined
            && updateData.status !== existing.status;

        if (isSelfTarget && roleChanged) {
            return res.status(403).json({
                success: false,
                code: 'SELF_ROLE_CHANGE_FORBIDDEN',
                error: 'You cannot change your own role',
            });
        }
        if (isSelfTarget && statusChanged) {
            return res.status(403).json({
                success: false,
                code: 'SELF_DISABLE_FORBIDDEN',
                error: 'You cannot change your own active status',
            });
        }

        const changesRoleOrStatus = roleChanged || statusChanged;
        // P0-D last-admin guard — see PATCH handler (incl. the deferred
        // count-then-write TOCTOU note).
        const removesAdminStanding = (roleChanged && normalizeRole(updateData.role) !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM)
            || (statusChanged && updateData.status === 'INACTIVE');
        if (removesAdminStanding) {
            await adminUserService.assertNotLastActiveAdmin({
                existing,
                organizationId: existing.organizationId || req.user?.organizationId || null,
            });
        }
        if (changesRoleOrStatus) {
            // P0-A class: role/status are credential mutations — evict the
            // target's live 12h JWT. Real changes only (S1). (This door no
            // longer writes a password at all — rejectPasswordWrite above.)
            updateData.sessionsRevokedAt = sessionEpochStamp();
        }

        const updated = await prisma.user.update({
            where: { id: existing.id },
            data: updateData,
            select: {
                id: true,
                uuid: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                status: true,
                providerId: true,
                accountType: true,
                lastLoginAt: true,
                createdAt: true,
            },
        });

        if (changesRoleOrStatus) {
            // P0-D: before/after audit row — see PATCH handler.
            await emitAdminUserAudit(req, 'USER_ROLE_UPDATED', AuditSeverity.WARNING, existing.id, {
                before: { role: existing.role, status: existing.status },
                after: { role: updated.role, status: updated.status },
                via: 'provider-directory',
            });
        }

        res.json({ success: true, data: mapProviderUser({ ...updated, source: 'USER' }) });
    } catch (error) {
        if (respondLastAdminConflict(res, error)) {
            return undefined;
        }
        logger.error('[Provider] put error:', error);
        return respondError(res, req, error);
    }
});

// Wave B Phase 55 (G6) — admin user lifecycle actions.
//
// One admin-only POST endpoint (unlock) that acts on the lifecycle fields
// surfaced by Phase 53 (#132). It follows this shape:
//
//   1. require admin/super_admin caller (per isAdminCaller)
//   2. load the target user, verify they're a provider account
//   3. apply the relevant Prisma update
//   4. emit an audit event under AuditCategory.ADMIN
//
// The audit emission is deliberately outside the update transaction —
// hash-chain inserts retry internally and we don't want a chain
// retry to roll back the user mutation. If the audit log fails, the
// auditLogger logs to console as fallback (per audit-logger.js).
// S2: tenant-scoped like findMutationTarget — the lifecycle actions
// previously looked the target up UNSCOPED, so a tenant ADMIN could act on
// another tenant's staff. Cross-tenant targets 404 (no existence disclosure);
// PLATFORM_ADMIN (the sole cross-tenant role) bypasses the org filter.
//
// The third action, POST /:id/force-password-reset, is gone (operator
// 2026-09-17: "เราไม่มีการกู้บัญชี" — there is no account recovery). It minted
// a one-shot reset token that only POST /auth/health/reset-password/:token
// could redeem, and that route is gone too. pinned by
// __tests__/unit/password-reset-routes-behaviour.test.js
// S6: runs inside withoutTenantScope for the same reason as
// findMutationTarget — this WHERE does its own explicit org filtering.
async function loadProviderTarget(req, { isPlatformAdmin } = {}) {
    const user = await withoutTenantScope(() => prisma.user.findFirst({
        where: {
            id: req.params.id,
            isDeleted: false,
            ...(isPlatformAdmin ? {} : { organizationId: req.user?.organizationId || null }),
        },
        select: {
            id: true,
            email: true,
            role: true,
            providerId: true,
            isLocked: true,
        },
    }));

    if (!user) {
        return { error: { status: 404, body: { success: false, error: 'Provider not found' } } };
    }

    if (!user.providerId) {
        return {
            error: {
                status: 400,
                body: { success: false, error: 'Target is not a provider account' },
            },
        };
    }

    return { user };
}

async function emitAdminUserAudit(req, action, severity, targetUserId, metadata) {
    try {
        await auditLogger.log({
            category: AuditCategory.ADMIN,
            action,
            severity,
            actorId: req.user?.id || 'SYSTEM',
            actorEmail: req.user?.email || null,
            actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
            actorType: 'PROVIDER',
            resourceType: ResourceType.USER,
            resourceId: targetUserId,
            ipAddress: getRequestIp(req),
            userAgent: req.get('user-agent'),
            metadata: metadata || {},
        });
    } catch (error) {
        // Best-effort — auditLogger.log already falls back to console.
        logger.error('[Provider] admin user audit emit failed:', error);
    }
}

// Unlock a locked-out provider account.
router.post('/:id/unlock', authenticateProvider, async (req, res) => {
    if (!isAdminCaller(req.user?.role)) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized: Only Admins can manage provider accounts',
        });
    }

    try {
        const target = await loadProviderTarget(req, resolveDirectoryManager(req));
        if (target.error) {
            return res.status(target.error.status).json(target.error.body);
        }

        // No-op short circuit so admins don't end up with confusing
        // "unlocked" audit entries on an already-unlocked account.
        if (!target.user.isLocked) {
            return res.json({
                success: true,
                message: 'Account is already unlocked',
                data: { id: target.user.id, isLocked: false },
            });
        }

        const updated = await prisma.user.update({
            where: { id: target.user.id },
            data: buildUnlockPayload(req.user?.id),
            select: {
                id: true,
                isLocked: true,
                lockedUntil: true,
                loginAttempts: true,
            },
        });

        await emitAdminUserAudit(req, 'PROVIDER_USER_UNLOCKED', AuditSeverity.WARNING, target.user.id, {
            providerId: target.user.providerId,
            email: target.user.email,
        });

        res.json({
            success: true,
            message: 'Provider account unlocked',
            data: updated,
        });
    } catch (error) {
        logger.error('[Provider] unlock error:', error);
        return respondError(res, req, error);
    }
});

// No "disable 2FA" action: POST /:id/disable-2fa is gone (operator 2026-09-26
// "ถอดทั้งสองประตู"). It let an admin wipe another account's TOTP secret and
// backup codes — a staff-issued second-factor recovery, and there is no account
// recovery (2026-09-17); 2FA recovery belongs to หมอพร้อม. The owner still turns
// their own 2FA off at DELETE /api/mfa/disable with a code from their own app.
// pinned by __tests__/unit/second-factor-doors.test.js

// Delete provider (soft delete)
router.delete('/:id', authenticateProvider, async (req, res) => {
    try {
        const caller = resolveDirectoryManager(req);
        if (!caller.isManager) {
            return res.status(403).json({
                success: false,
                error: 'Unauthorized: Only Admins can delete provider accounts',
            });
        }

        // P0-D self-guard: deleting your own account is a self-lockout —
        // same policy code as the disable guard (a delete IS a disable).
        if (String(req.params.id) === String(req.user?.id)) {
            return res.status(403).json({
                success: false,
                code: 'SELF_DISABLE_FORBIDDEN',
                error: 'You cannot delete your own account',
            });
        }

        // P0-D: tenant-scoped target lookup (404 on cross-tenant, no existence
        // disclosure). PLATFORM_ADMIN bypasses the org filter.
        const existing = await findMutationTarget(req, caller);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Provider not found' });
        }

        // P0-D last-admin guard: deleting the org's final active ADMIN would
        // lock the tenant out of permission control forever. No-ops for
        // non-admin targets.
        await adminUserService.assertNotLastActiveAdmin({
            existing,
            organizationId: existing.organizationId || req.user?.organizationId || null,
        });

        await prisma.user.update({
            where: { id: existing.id },
            data: {
                isDeleted: true,
                status: 'INACTIVE',
                deletedAt: new Date(),
                deletedBy: req.user?.id,
                updatedBy: req.user?.id,
                // P0-A class: a deleted staffer's live 12h JWT must die now,
                // not at natural expiry.
                sessionsRevokedAt: sessionEpochStamp(),
            },
        });

        res.json({ success: true, message: 'Provider account deleted successfully' });
    } catch (error) {
        if (respondLastAdminConflict(res, error)) {
            return undefined;
        }
        logger.error('[Provider] delete error:', error);
        return respondError(res, req, error);
    }
});

module.exports = router;
