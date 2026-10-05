/**
 * Wave 2 — per-permission GRANT/REVOKE engine (effective-permissions-service).
 *
 * The ERP standard model:
 *   effective(user) = ROLE_PERMISSIONS[canonicalRole]
 *                     ∪ {grants effect=GRANT}
 *                     − {grants effect=REVOKE}
 *
 * Grants are read LIVE per request from user_permission_grants (NOT baked
 * into the JWT), so a grant/revoke takes effect on the very next request.
 *
 * canonical-rbac stays REAL — the test proves the engine against the real
 * role baseline. A tiny injected prisma stub supplies the grant rows.
 *
 * Anchor permissions (from shared/canonical-rbac.js ROLE_PERMISSIONS):
 *   - document_reviewer HAS   'application.document.review' (APPLICATION_DOC_REVIEW)
 *   - document_reviewer LACKS 'report.export'               (REPORT_EXPORT)
 * These two anchors let us test GRANT-adds and REVOKE-removes independently.
 */

'use strict';

// canonical-rbac stays real.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// Logger mock so the fail-safe path's logger.error is observable + silent.
const mockLoggerError = jest.fn();
jest.mock('../../shared/logger', () => {
    const l = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: (...a) => mockLoggerError(...a),
    };
    return { ...l, createLogger: jest.fn(() => l) };
});

// prisma-database is required by the service default; stub it so require()
// does not process.exit(1) on a machine with no DATABASE_URL. The tests
// inject their own prisma, so this default is never actually used.
jest.mock('../../services/prisma-database', () => ({
    prisma: { userPermissionGrant: { findMany: jest.fn().mockResolvedValue([]) } },
}));

const {
    PERMISSION_VALUES,
    isValidPermission,
    getEffectivePermissions,
    userHasEffectivePermission,
} = require('../../services/effective-permissions-service');
const { PERMISSIONS } = require('../../shared/canonical-rbac');

const REVIEWER_HAS = PERMISSIONS.APPLICATION_DOC_REVIEW; // 'application.document.review'
const REVIEWER_LACKS = PERMISSIONS.REPORT_EXPORT; // 'report.export'

function stubPrisma(rows) {
    return { userPermissionGrant: { findMany: jest.fn().mockResolvedValue(rows) } };
}

beforeEach(() => {
    mockLoggerError.mockClear();
});

describe('PERMISSION_VALUES + isValidPermission', () => {
    it('PERMISSION_VALUES is a frozen array of all PERMISSIONS values', () => {
        expect(Array.isArray(PERMISSION_VALUES)).toBe(true);
        expect(Object.isFrozen(PERMISSION_VALUES)).toBe(true);
        expect(PERMISSION_VALUES).toEqual(expect.arrayContaining(Object.values(PERMISSIONS)));
        expect(PERMISSION_VALUES.length).toBe(Object.values(PERMISSIONS).length);
    });

    it('isValidPermission → true for a real PERMISSIONS value, false for garbage', () => {
        expect(isValidPermission(REVIEWER_HAS)).toBe(true);
        expect(isValidPermission(PERMISSIONS.REPORT_EXPORT)).toBe(true);
        expect(isValidPermission('not.a.permission')).toBe(false);
        expect(isValidPermission('')).toBe(false);
        expect(isValidPermission(null)).toBe(false);
        expect(isValidPermission(undefined)).toBe(false);
    });
});

describe('getEffectivePermissions', () => {
    it('role-only user (no grants) → effective == role baseline set', async () => {
        const prisma = stubPrisma([]);
        const res = await getEffectivePermissions({ role: 'document_reviewer', userId: 'u1', prisma });

        // Role baseline = the permissions the reviewer holds by role.
        const roleBaseline = PERMISSION_VALUES.filter((p) => res.rolePermissions.includes(p));
        expect(res.rolePermissions.sort()).toEqual(roleBaseline.sort());
        expect(res.grants).toEqual([]);
        expect(res.effective.sort()).toEqual([...res.rolePermissions].sort());
        expect(res.effective).toContain(REVIEWER_HAS);
        expect(res.effective).not.toContain(REVIEWER_LACKS);
    });

    it('GRANT adds a permission the role lacks → present in effective', async () => {
        const prisma = stubPrisma([{ permission: REVIEWER_LACKS, effect: 'GRANT' }]);
        const res = await getEffectivePermissions({ role: 'document_reviewer', userId: 'u1', prisma });

        expect(res.rolePermissions).not.toContain(REVIEWER_LACKS);
        expect(res.effective).toContain(REVIEWER_LACKS);
        // still holds everything it had by role
        expect(res.effective).toContain(REVIEWER_HAS);
    });

    it('REVOKE removes a permission the role has → absent in effective', async () => {
        const prisma = stubPrisma([{ permission: REVIEWER_HAS, effect: 'REVOKE' }]);
        const res = await getEffectivePermissions({ role: 'document_reviewer', userId: 'u1', prisma });

        expect(res.rolePermissions).toContain(REVIEWER_HAS);
        expect(res.effective).not.toContain(REVIEWER_HAS);
    });

    it('GRANT+REVOKE precedence: same permission granted AND revoked → REVOKE wins (absent)', async () => {
        const prisma = stubPrisma([
            { permission: REVIEWER_LACKS, effect: 'GRANT' },
            { permission: REVIEWER_LACKS, effect: 'REVOKE' },
        ]);
        const res = await getEffectivePermissions({ role: 'document_reviewer', userId: 'u1', prisma });

        expect(res.effective).not.toContain(REVIEWER_LACKS);
    });

    it('unknown/invalid stored permission in a GRANT → ignored (not in effective, no throw)', async () => {
        const prisma = stubPrisma([{ permission: 'totally.bogus.permission', effect: 'GRANT' }]);
        const res = await getEffectivePermissions({ role: 'document_reviewer', userId: 'u1', prisma });

        expect(res.effective).not.toContain('totally.bogus.permission');
        // role baseline unaffected
        expect(res.effective).toContain(REVIEWER_HAS);
    });

    it('deterministic sort — effective is sorted ascending', async () => {
        const prisma = stubPrisma([{ permission: REVIEWER_LACKS, effect: 'GRANT' }]);
        const res = await getEffectivePermissions({ role: 'document_reviewer', userId: 'u1', prisma });
        expect(res.effective).toEqual([...res.effective].sort());
    });

    it('fail-safe: prisma.findMany throws → falls back to role-only + logs, does not throw', async () => {
        const prisma = {
            userPermissionGrant: {
                findMany: jest.fn().mockRejectedValue(new Error('db down')),
            },
        };
        const res = await getEffectivePermissions({ role: 'document_reviewer', userId: 'u1', prisma });

        expect(res.grants).toEqual([]);
        expect(res.effective.sort()).toEqual([...res.rolePermissions].sort());
        expect(res.effective).toContain(REVIEWER_HAS); // role baseline still governs
        expect(mockLoggerError).toHaveBeenCalled();
    });

    it('unknown role → empty role baseline (no throw)', async () => {
        const prisma = stubPrisma([]);
        const res = await getEffectivePermissions({ role: 'not_a_role', userId: 'u1', prisma });
        expect(res.rolePermissions).toEqual([]);
        expect(res.effective).toEqual([]);
    });
});

describe('userHasEffectivePermission', () => {
    it('true when role holds the permission (no grants)', async () => {
        const prisma = stubPrisma([]);
        await expect(
            userHasEffectivePermission({ role: 'document_reviewer', userId: 'u1', prisma }, REVIEWER_HAS),
        ).resolves.toBe(true);
    });

    it('false when role lacks it and no GRANT', async () => {
        const prisma = stubPrisma([]);
        await expect(
            userHasEffectivePermission({ role: 'document_reviewer', userId: 'u1', prisma }, REVIEWER_LACKS),
        ).resolves.toBe(false);
    });

    it('true after a GRANT of a role-lacked permission', async () => {
        const prisma = stubPrisma([{ permission: REVIEWER_LACKS, effect: 'GRANT' }]);
        await expect(
            userHasEffectivePermission({ role: 'document_reviewer', userId: 'u1', prisma }, REVIEWER_LACKS),
        ).resolves.toBe(true);
    });

    it('false after a REVOKE of a role-held permission', async () => {
        const prisma = stubPrisma([{ permission: REVIEWER_HAS, effect: 'REVOKE' }]);
        await expect(
            userHasEffectivePermission({ role: 'document_reviewer', userId: 'u1', prisma }, REVIEWER_HAS),
        ).resolves.toBe(false);
    });
});
