const crypto = require('crypto');
const providerUserService = require('../../../services/provider-user-service');
const { normalizeRole, isProviderRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { maskThaiId } = require('../../../utils/field-encryption');

const PROVIDER_ACCOUNT_TYPES = new Set(['PROVIDER', 'PROVIDER']);
const THAI_ID_REGEX = /^\d{13}$/;

// X2-FIX-D H-12 (DR-DIR-1): role-based projection for staff directory.
// PDPA Section 24 — personal data may only be processed for the
// purpose for which it was collected. The directory endpoint is read
// by every authenticated provider role (for queue-ownership UI and
// assignee labels), but only ADMIN/SCHEDULER have a legitimate need
// for staff PII (email, login lifecycle, lock state, 2FA enrollment).
//
// The PROJECTION_PRIVILEGED canonical roles see the full `mapProviderUser`
// payload (email + lastLoginAt + isLocked + twoFactorEnabled etc.).
// All other provider roles see the minimal projection (id + name +
// role + isActive + masked providerId only), which is enough for
// "who owns this work item" UI labels without exposing peer staff PII.
const PROJECTION_PRIVILEGED_ROLES = new Set([
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.DISPATCHER,
]);

function canViewFullProviderDirectory(viewerCanonicalRole) {
    const canonical = normalizeRole(viewerCanonicalRole);
    return canonical ? PROJECTION_PRIVILEGED_ROLES.has(canonical) : false;
}

/**
 * ค่าบทบาทที่ส่งออกไปให้หน้าจอ — คำปัจจุบันตรง ๆ
 *
 * เดิมชื่อ toDirectoryRole() และแปลงกลับเป็นคำตัวพิมพ์ใหญ่ยุคก่อน (`AUDITOR`,
 * `REVIEWER_AUDITOR`) ก่อนส่งออก · ตั้งแต่ operator สั่งตัดขาดจากคำเก่า 2026-09-10
 * ไม่มีคำเก่าให้แปลกลับไปหาอีกแล้ว และการส่งคำที่ระบบปฏิเสธออกไปให้หน้าจอ
 * คือการสร้างค่าที่ส่งกลับเข้ามาแล้วถูก 400
 */
function toDirectoryRole(role) {
    return normalizeRole(role);
}

function toCanonicalRole(role) {
    return normalizeRole(role);
}

function hashProviderId(providerId) {
    if (!providerId) {
        return null;
    }

    return crypto.createHash('sha256').update(String(providerId).trim()).digest('hex');
}

function isProviderUser(user) {
    if (!user || user.isDeleted) {
        return false;
    }

    const canonicalRole = toCanonicalRole(user.role);
    if (!canonicalRole || !isProviderRole(canonicalRole)) {
        return false;
    }

    const accountType = String(user.accountType || '').toUpperCase();
    return Boolean(user.providerId) || PROVIDER_ACCOUNT_TYPES.has(accountType);
}

function resolveUsername(user) {
    if (user.username) {
        return user.username;
    }

    const email = String(user.email || '').trim();
    if (email.includes('@')) {
        return email.split('@')[0];
    }

    // PDPA Sprint 6 (final sweep): never use the raw 13-digit providerId
    // as a username — the provider list endpoint is served to any
    // authenticated provider, so the raw value would leak to peers.
    // Fall back to the UUID-prefixed handle.
    return `provider-${String(user.id || '').slice(0, 8)}`;
}

function mapProviderUser(user) {
    const canonicalRole = toCanonicalRole(user.role);
    // PDPA Sprint 6 (final sweep): mask the 13-digit Thai national ID
    // in every provider-directory payload. The list endpoint is served
    // to any authenticated provider; raw providerId in the body would
    // leak peer auditors' national IDs into the inspector dropdown.
    return {
        id: user.id,
        uuid: user.uuid || user.id,
        username: resolveUsername(user),
        email: user.email,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        providerId: user.providerId ? maskThaiId(user.providerId) : null,
        department: user.department || 'DTAM',
        role: toDirectoryRole(user.role),
        canonicalRole,
        isActive: String(user.status || '').toUpperCase() === 'ACTIVE',
        // Wave B Phase 53 (G6) — surface the lifecycle fields admins
        // need to see at a glance: last login, account-lock state,
        // 2FA enabled. The schema has had these forever; only the
        // API was hiding them.
        lastLoginAt: user.lastLoginAt || null,
        loginAttempts: typeof user.loginAttempts === 'number' ? user.loginAttempts : 0,
        isLocked: !!user.isLocked,
        lockedUntil: user.lockedUntil || null,
        twoFactorEnabled: !!user.twoFactorEnabled,
        createdAt: user.createdAt,
        source: user.source || 'USER',
    };
}

// X2-FIX-D H-12 (DR-DIR-1): PDPA-minimised projection for non-privileged
// callers (DOC_REVIEWER, AUDITOR, ACCOUNT_*). Returns only the fields
// the queue / work-ownership UI needs:
//   id, name, role, department, isActive — for label rendering
//   masked providerId — opaque token for cross-reference
// Strips: email, lastLoginAt, loginAttempts, isLocked, lockedUntil,
//   twoFactorEnabled, lockedUntil, createdAt — admin lifecycle metadata.
function mapProviderUserPublic(user) {
    const canonicalRole = toCanonicalRole(user.role);
    return {
        id: user.id,
        uuid: user.uuid || user.id,
        username: resolveUsername(user),
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        providerId: user.providerId ? maskThaiId(user.providerId) : null,
        department: user.department || 'DTAM',
        role: toDirectoryRole(user.role),
        canonicalRole,
        isActive: String(user.status || '').toUpperCase() === 'ACTIVE',
        source: user.source || 'USER',
    };
}

// Selects the right projection for a viewer. Centralises the policy so
// list, getById, and inspectors routes can apply the same gate.
function projectProviderUserForViewer(user, viewerCanonicalRole) {
    if (canViewFullProviderDirectory(viewerCanonicalRole)) {
        return mapProviderUser(user);
    }
    return mapProviderUserPublic(user);
}

function matchesRoleFilter(provider, requestedRole) {
    const roleFilter = String(requestedRole || '').trim();
    if (!roleFilter) {
        return true;
    }

    const requestedCanonical = toCanonicalRole(roleFilter);
    if (requestedCanonical) {
        return provider.canonicalRole === requestedCanonical;
    }

    return String(provider.role || '').toLowerCase() === roleFilter.toLowerCase()
        || String(provider.canonicalRole || '').toLowerCase() === roleFilter.toLowerCase();
}

// X2-FIX-D H-12: optional `viewerCanonicalRole` selects per-role projection.
// Defaults to full payload to preserve existing call-site behaviour
// (admin tooling, migrations). Route handlers should ALWAYS pass the
// caller's canonical role so PDPA minimisation applies.
async function listProvidersFromUsers(viewerCanonicalRole) {
    const users = await providerUserService.listAllUsersForProviderDirectory();
    const useProjection = typeof viewerCanonicalRole === 'string';

    return users
        .filter(isProviderUser)
        .map((user) => {
            const enriched = { ...user, source: 'USER' };
            return useProjection
                ? projectProviderUserForViewer(enriched, viewerCanonicalRole)
                : mapProviderUser(enriched);
        });
}


async function findProviderById(providerId, viewerCanonicalRole) {
    const user = await providerUserService.findUserForProviderDirectory(providerId);

    if (user && isProviderUser(user)) {
        const enriched = { ...user, source: 'USER' };
        const record = typeof viewerCanonicalRole === 'string'
            ? projectProviderUserForViewer(enriched, viewerCanonicalRole)
            : mapProviderUser(enriched);
        return { record, source: 'USER' };
    }

    return null;
}

function toRoleValue(inputRole) {
    const canonical = toCanonicalRole(inputRole);
    if (!canonical || !isProviderRole(canonical)) {
        return null;
    }

    return toDirectoryRole(canonical);
}

function extractProviderIdentity(payload = {}) {
    const raw = String(payload.providerId || '').trim();
    if (raw) {
        return raw;
    }

    const usernameLikeId = String(payload.username || '').trim();
    if (THAI_ID_REGEX.test(usernameLikeId)) {
        return usernameLikeId;
    }

    return null;
}

module.exports = {
    THAI_ID_REGEX,
    hashProviderId,
    mapProviderUser,
    mapProviderUserPublic,
    projectProviderUserForViewer,
    canViewFullProviderDirectory,
    matchesRoleFilter,
    listProvidersFromUsers,
    findProviderById,
    toRoleValue,
    extractProviderIdentity,
};
