/**
 * Unit tests for admin-user-service — Iter 28 (B28-A admin tooling).
 *
 * Covers:
 *   - pure helpers (validateReason, validateStatusInput,
 *     planRoleChangeSideEffects, isSelfTarget, metadata builders)
 *   - service mutations against a mocked provider-user-service
 *
 * No prisma access here — provider-user-service is mocked at module
 * boundary so the tests don't depend on a live DB.
 */

'use strict';

const path = require('path');

const providerUserServicePath = path.resolve(
    __dirname,
    '../services/provider-user-service.js',
);

function loadService() {
    jest.resetModules();
    jest.doMock(providerUserServicePath, () => ({
        getActiveAdminUserGuard: jest.fn(),
        updateAdminUser: jest.fn(),
        searchAdminUsers: jest.fn(),
        createProviderUser: jest.fn(),
        countOtherActiveAdmins: jest.fn().mockResolvedValue(1),
    }));
    const svc = require('../services/admin-user-service');
    const provider = require(providerUserServicePath);
    return { svc, provider };
}

describe('admin-user-service / pure helpers', () => {
    test('validateReason rejects empty / whitespace', () => {
        const { svc } = loadService();
        expect(svc.validateReason('', 5)).toBeInstanceOf(Error);
        expect(svc.validateReason('   ', 5)).toBeInstanceOf(Error);
    });

    test('validateReason enforces minimum length', () => {
        const { svc } = loadService();
        expect(svc.validateReason('hi', 5)).toBeInstanceOf(Error);
        expect(svc.validateReason('valid reason here', 5)).toBeNull();
    });

    test('validateStatusInput uppercases and validates allowed list', () => {
        const { svc } = loadService();
        expect(svc.validateStatusInput('active')).toEqual({
            ok: true,
            status: 'ACTIVE',
        });
        expect(svc.validateStatusInput('BANNED')).toMatchObject({ ok: false });
    });

    test('isSelfTarget compares actor and target', () => {
        const { svc } = loadService();
        expect(svc.isSelfTarget({ actorId: 'a1', targetUserId: 'a1' })).toBe(true);
        expect(svc.isSelfTarget({ actorId: 'a1', targetUserId: 'b2' })).toBe(false);
        expect(svc.isSelfTarget({ actorId: null, targetUserId: 'a1' })).toBe(false);
    });

    test('planRoleChangeSideEffects: provider role needs providerId', () => {
        const { svc } = loadService();
        const result = svc.planRoleChangeSideEffects({
            targetCanonicalRole: 'field_inspector',
            existing: { providerId: null, healthId: null },
        });
        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
    });

    test('planRoleChangeSideEffects: provider role with healthId conflict → 409', () => {
        const { svc } = loadService();
        const result = svc.planRoleChangeSideEffects({
            targetCanonicalRole: 'field_inspector',
            existing: { providerId: '1234567890123', healthId: '9876543210987' },
        });
        expect(result.ok).toBe(false);
        expect(result.status).toBe(409);
    });

    test('planRoleChangeSideEffects: valid provider role sets accountType / authType', () => {
        const { svc } = loadService();
        const result = svc.planRoleChangeSideEffects({
            targetCanonicalRole: 'field_inspector',
            existing: { providerId: '1234567890123', healthId: null },
        });
        expect(result.ok).toBe(true);
        expect(result.sideEffects).toEqual({
            accountType: 'PROVIDER',
            authType: 'PROVIDER_ID',
        });
    });

    test('planRoleChangeSideEffects: HEALTH role flips accountType when previously PROVIDER', () => {
        const { svc } = loadService();
        const result = svc.planRoleChangeSideEffects({
            targetCanonicalRole: 'health',
            existing: {
                providerId: null,
                healthId: '1234567890123',
                accountType: 'PROVIDER',
            },
        });
        expect(result.ok).toBe(true);
        expect(result.sideEffects.accountType).toBe('INDIVIDUAL');
        expect(result.sideEffects.authType).toBe('HEALTH_ID');
    });

    test('buildRoleChangeMetadata snapshots before/after', () => {
        const { svc } = loadService();
        const md = svc.buildRoleChangeMetadata({
            reason: 'support escalation',
            before: { role: 'HEALTH', accountType: 'INDIVIDUAL', authType: 'HEALTH_ID' },
            after: { role: 'field_inspector', accountType: 'PROVIDER', authType: 'PROVIDER_ID' },
        });
        expect(md.before.role).toBe('HEALTH');
        expect(md.after.role).toBe('field_inspector');
        expect(md.actionType).toBe('USER_ROLE_CHANGE');
    });

});

describe('admin-user-service / disableUser', () => {
    test('rejects self-disable', async () => {
        const { svc } = loadService();
        await expect(svc.disableUser({
            userId: 'a1',
            actorId: 'a1',
            reason: 'self attempt',
        })).rejects.toMatchObject({ code: 'SELF_DISABLE_FORBIDDEN' });
    });

    test('rejects short reason', async () => {
        const { svc } = loadService();
        await expect(svc.disableUser({
            userId: 'u1',
            actorId: 'a1',
            reason: 'no',
        })).rejects.toThrow(/at least/);
    });

    test('404 when target user is missing', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue(null);
        await expect(svc.disableUser({
            userId: 'u1',
            actorId: 'a1',
            reason: 'legitimate reason',
        })).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    });

    test('happy path returns metadata and updates user', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue({
            id: 'u1', role: 'HEALTH', status: 'ACTIVE',
        });
        provider.updateAdminUser.mockResolvedValue({
            id: 'u1', status: 'INACTIVE',
        });
        const result = await svc.disableUser({
            userId: 'u1',
            actorId: 'a1',
            reason: 'compliance check fail',
        });
        expect(result.user.status).toBe('INACTIVE');
        expect(result.previousStatus).toBe('ACTIVE');
        expect(result.auditMetadata.actionType).toBe('USER_DISABLE');
        expect(provider.updateAdminUser).toHaveBeenCalledWith('u1', expect.objectContaining({
            status: 'INACTIVE',
            updatedBy: 'a1',
        }));
    });
});

describe('P0-A — permission changes take effect (session-epoch stamp)', () => {
    // Bug: changeUserRole/disableUser persisted the new role/status but never
    // bumped User.sessionsRevokedAt, so the target's live 12h provider JWT
    // (role baked in at mint) kept its OLD role/access until natural expiry —
    // a demoted or disabled staffer retained privileged access. The epoch
    // infra already exists (utils/session-epoch.js + auth-middleware
    // isTokenBeforeSessionEpoch gates on verify/refresh); these mutations are
    // exactly the "credential mutation" class that util documents.
    test('disableUser stamps sessionsRevokedAt so live tokens are evicted', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue({
            id: 'u1', role: 'HEALTH', status: 'ACTIVE',
        });
        provider.updateAdminUser.mockResolvedValue({ id: 'u1', status: 'INACTIVE' });
        await svc.disableUser({ userId: 'u1', actorId: 'a1', reason: 'compliance check fail' });
        const data = provider.updateAdminUser.mock.calls[0][1];
        expect(data.sessionsRevokedAt).toBeInstanceOf(Date);
        // whole-second boundary (SF-2 — see utils/session-epoch.js)
        expect(data.sessionsRevokedAt.getTime() % 1000).toBe(0);
    });

    test('changeUserRole stamps sessionsRevokedAt so the old-role JWT is evicted', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue({
            id: 'u1', role: 'DTAM_STAFF', accountType: 'DTAM', authType: 'PROVIDER_ID',
            providerId: '1234567890123', healthId: null, status: 'ACTIVE',
        });
        provider.updateAdminUser.mockResolvedValue({
            id: 'u1', role: 'DTAM_STAFF', accountType: 'DTAM', authType: 'PROVIDER_ID',
        });
        await svc.changeUserRole({
            userId: 'u1', newRole: 'field_inspector', actorId: 'a1',
            reason: 'moving to audit team', organizationId: 'org-1',
        });
        const data = provider.updateAdminUser.mock.calls[0][1];
        expect(data.sessionsRevokedAt).toBeInstanceOf(Date);
    });

    test('enableUser does NOT stamp (re-enable must not evict a fresh login)', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue({ id: 'u1', status: 'INACTIVE' });
        provider.updateAdminUser.mockResolvedValue({ id: 'u1', status: 'ACTIVE' });
        await svc.enableUser({ userId: 'u1', actorId: 'a1' });
        const data = provider.updateAdminUser.mock.calls[0][1];
        expect(data.sessionsRevokedAt).toBeUndefined();
    });
});

describe('P0-D — last-admin guard (a tenant must never lock itself out)', () => {
    // Bug: nothing prevented demoting or disabling the LAST active ADMIN of an
    // org — the tenant would permanently lose permission control (FE already
    // maps ROLE_ADMIN_CANNOT_BE_LAST in ChangeRoleModal.tsx:48; the BE never
    // emitted it).
    const lastAdmin = {
        id: 'u-admin', role: 'system_admin_dtam', status: 'ACTIVE', accountType: 'PROVIDER',
        authType: 'PROVIDER_ID', providerId: '1234567890123', healthId: null,
        organizationId: 'org-1',
    };

    test('changeUserRole demoting the LAST active admin → ROLE_ADMIN_CANNOT_BE_LAST', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue(lastAdmin);
        provider.countOtherActiveAdmins.mockResolvedValue(0);
        await expect(svc.changeUserRole({
            userId: 'u-admin', newRole: 'field_inspector', actorId: 'a1',
            reason: 'moving to audit team', organizationId: 'org-1',
        })).rejects.toMatchObject({ code: 'ROLE_ADMIN_CANNOT_BE_LAST' });
        expect(provider.updateAdminUser).not.toHaveBeenCalled();
    });

    test('changeUserRole demoting an admin with ANOTHER active admin → proceeds', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue(lastAdmin);
        provider.countOtherActiveAdmins.mockResolvedValue(1);
        provider.updateAdminUser.mockResolvedValue({
            id: 'u-admin', role: 'field_inspector', accountType: 'PROVIDER', authType: 'PROVIDER_ID',
        });
        await expect(svc.changeUserRole({
            userId: 'u-admin', newRole: 'field_inspector', actorId: 'a1',
            reason: 'moving to audit team', organizationId: 'org-1',
        })).resolves.toBeTruthy();
    });

    test('disableUser on the LAST active admin → ROLE_ADMIN_CANNOT_BE_LAST', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue(lastAdmin);
        provider.countOtherActiveAdmins.mockResolvedValue(0);
        await expect(svc.disableUser({
            userId: 'u-admin', actorId: 'a1', reason: 'compliance check',
            organizationId: 'org-1',
        })).rejects.toMatchObject({ code: 'ROLE_ADMIN_CANNOT_BE_LAST' });
        expect(provider.updateAdminUser).not.toHaveBeenCalled();
    });

    test('non-admin target skips the count entirely', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue({
            id: 'u2', role: 'field_inspector', status: 'ACTIVE', accountType: 'PROVIDER',
            authType: 'PROVIDER_ID', providerId: '1234567890123', healthId: null,
        });
        provider.updateAdminUser.mockResolvedValue({ id: 'u2', status: 'INACTIVE' });
        await svc.disableUser({ userId: 'u2', actorId: 'a1', reason: 'left team', organizationId: 'org-1' });
        expect(provider.countOtherActiveAdmins).not.toHaveBeenCalled();
    });
});

describe('admin-user-service / enableUser', () => {
    test('409 when already ACTIVE', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue({
            id: 'u1', status: 'ACTIVE',
        });
        await expect(svc.enableUser({
            userId: 'u1', actorId: 'a1',
        })).rejects.toMatchObject({ code: 'ALREADY_ACTIVE' });
    });

    test('happy path flips INACTIVE → ACTIVE', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue({
            id: 'u1', status: 'INACTIVE',
        });
        provider.updateAdminUser.mockResolvedValue({
            id: 'u1', status: 'ACTIVE',
        });
        const result = await svc.enableUser({
            userId: 'u1', actorId: 'a1',
        });
        expect(result.user.status).toBe('ACTIVE');
        expect(result.auditMetadata.actionType).toBe('USER_ENABLE');
    });

    // S2(b): enableUser looked the target up WITHOUT the caller's org while
    // its siblings disableUser/changeUserRole tenant-scope the guard lookup —
    // a tenant ADMIN could re-enable another org's disabled account.
    test('threads organizationId into the guard lookup (tenant scope)', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue({ id: 'u1', status: 'INACTIVE' });
        provider.updateAdminUser.mockResolvedValue({ id: 'u1', status: 'ACTIVE' });
        await svc.enableUser({ userId: 'u1', actorId: 'a1', organizationId: 'org-1' });
        expect(provider.getActiveAdminUserGuard).toHaveBeenCalledWith('u1', { organizationId: 'org-1' });
    });
});

describe('admin-user-service / changeUserRole', () => {
    test('rejects invalid role', async () => {
        const { svc } = loadService();
        await expect(svc.changeUserRole({
            userId: 'u1',
            actorId: 'a1',
            newRole: 'GOBLIN',
            reason: 'long enough reason',
        })).rejects.toThrow(/Invalid role/);
    });

    test('rejects short reason (10 char minimum)', async () => {
        const { svc } = loadService();
        await expect(svc.changeUserRole({
            userId: 'u1',
            actorId: 'a1',
            newRole: 'field_inspector',
            reason: 'short',
        })).rejects.toThrow(/at least 10/);
    });

    test('rejects self role-change', async () => {
        const { svc } = loadService();
        await expect(svc.changeUserRole({
            userId: 'a1',
            actorId: 'a1',
            newRole: 'field_inspector',
            reason: 'legitimate ten chars',
        })).rejects.toMatchObject({ code: 'SELF_ROLE_CHANGE_FORBIDDEN' });
    });

    test('rejects assigning PLATFORM_ADMIN (privilege escalation)', async () => {
        const { svc, provider } = loadService();
        await expect(svc.changeUserRole({
            userId: 'u1',
            actorId: 'a1',
            newRole: 'system_admin_platform',
            reason: 'attempted privilege escalation',
        })).rejects.toMatchObject({ status: 403 });
        // Must short-circuit before any user lookup/mutation.
        expect(provider.getActiveAdminUserGuard).not.toHaveBeenCalled();
        expect(provider.updateAdminUser).not.toHaveBeenCalled();
    });

    test('happy path returns before/after snapshot', async () => {
        const { svc, provider } = loadService();
        provider.getActiveAdminUserGuard.mockResolvedValue({
            id: 'u1', role: 'HEALTH', accountType: 'INDIVIDUAL',
            authType: 'HEALTH_ID', providerId: null,
            healthId: '1234567890123', status: 'ACTIVE',
        });
        provider.updateAdminUser.mockResolvedValue({
            id: 'u1', role: 'HEALTH', accountType: 'INDIVIDUAL',
            authType: 'HEALTH_ID', status: 'ACTIVE',
        });
        const result = await svc.changeUserRole({
            userId: 'u1',
            actorId: 'a1',
            newRole: 'HEALTH',
            reason: 'reconfirmed health role',
        });
        expect(result.auditMetadata.before.role).toBe('HEALTH');
        expect(result.auditMetadata.after.role).toBe('HEALTH');
    });
});

// มติ operator 2026-09-26 "ถอดทั้งสองประตู": ไม่มีใครล้าง 2FA ของบัญชีอื่น — forceResetMfa ถูกถอด
// (เดิมเทสชุดนี้ mock updateAdminUser จึงเขียวตลอด ทั้งที่ของจริงเขียนคอลัมน์ที่ไม่มีแล้ว Prisma ปฏิเสธทุกครั้ง)
// การที่ route ไม่มีแล้วตรึงที่ __tests__/unit/second-factor-doors.test.js
describe('admin-user-service / no force-MFA-reset', () => {
    test('the service exports no way to clear another account\'s 2FA', () => {
        const { svc } = loadService();
        expect(svc.forceResetMfa).toBeUndefined();
        expect(svc.buildForceMfaResetMetadata).toBeUndefined();
        expect(svc.FORCE_MFA_RESET_REASON_MIN_LEN).toBeUndefined();
    });
});
