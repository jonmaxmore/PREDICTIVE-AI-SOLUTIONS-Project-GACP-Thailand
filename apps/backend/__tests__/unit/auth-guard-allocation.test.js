'use strict';

/**
 * Auth-guard hot-path allocation cleanup — Step 2 of the post-canonicalization
 * mandate.
 *
 * Every authenticated request crosses at least one of these guards, and each
 * guard was re-deriving static data per request:
 *
 *   role-middleware requireRole      allowed list re-normalized on EVERY
 *                                    request (.map().filter() + two linear
 *                                    includes) — the list is fixed at guard
 *                                    construction and never changes after.
 *   auth-middleware authorize        same pattern, deprecated alias.
 *   effective-permissions-service    the role BASELINE rebuilt per request by
 *                                    filtering every PERMISSIONS value through
 *                                    hasPermission — the baseline is static
 *                                    for the process lifetime.
 *   permission gates (x2)            O(n) .includes scan per gate over the
 *                                    effective array.
 *
 * The fix moves construction-time work to construction time (frozen Sets in
 * the closure), memoizes the per-role baseline, and has the service hand the
 * gates a Set so membership is O(1).
 *
 * These tests pin the WORK DONE PER REQUEST by counting calls into the (real)
 * canonical-rbac functions — not by scanning source for .map(). A call-count
 * regression is exactly the bug class this prevents: someone moving the
 * normalization back inside the handler.
 *
 * Behaviour must not move AT ALL — the raw-spelling match in requireRole, the
 * platform_admin bypass, and the fail-safe paths are pinned alongside.
 */

process.env.HEALTH_JWT_SECRET = 'test-only-health-jwt-secret-32-bytes-exactly-here!!';
process.env.PROVIDER_JWT_SECRET = 'test-only-provider-jwt-secret-32-bytes-exactly-ok';

// REAL canonical-rbac, with the two hot functions wrapped so calls are
// countable. Both middlewares and the permission engine destructure these at
// require() time; jest.mock hoists above those requires, so the wrappers are
// what every module under test captures.
jest.mock('../../shared/canonical-rbac', () => {
    const actual = jest.requireActual('../../shared/canonical-rbac');
    return {
        ...actual,
        normalizeRole: jest.fn(actual.normalizeRole),
        hasPermission: jest.fn(actual.hasPermission),
    };
});

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

jest.mock('../../services/token-revocation-service', () => ({
    isAccessTokenBlocklisted: jest.fn().mockResolvedValue(false),
}));

const mockGrantFindMany = jest.fn().mockResolvedValue([]);
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        userPermissionGrant: { findMany: (...a) => mockGrantFindMany(...a) },
    },
}));

const fs = require('fs');
const path = require('path');

const { normalizeRole, hasPermission, PERMISSIONS } = require('../../shared/canonical-rbac');
const { AuthorizationError } = require('../../shared/errors');
const { requireRole, requireEffectivePermission } = require('../../middleware/role-middleware');
const { authorize } = require('../../middleware/auth-middleware');
const { getEffectivePermissions, userHasEffectivePermission } =
    require('../../services/effective-permissions-service');

function createRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

describe('requireRole does per-request work proportional to the REQUEST, not the guard config', () => {
    test('the allowed list is normalized once at construction — one normalizeRole per request after', () => {
        const middleware = requireRole(['system_admin_dtam', 'dispatcher', 'document_reviewer']);

        normalizeRole.mockClear();
        for (let i = 0; i < 20; i++) {
            middleware({ user: { id: 'u1', role: 'field_inspector' }, path: '/x' }, createRes(), jest.fn());
        }

        // Exactly the user's own role, once per request. The three-entry
        // allowed list contributes ZERO per-request calls — it was resolved
        // when the guard was built. (Before the fix: 3 extra per request.)
        expect(normalizeRole.mock.calls.length).toBe(20);
    });

    test('a raw legacy spelling in the caller list still matches a raw legacy user value', () => {
        // The rawMatch branch: guards written before canonicalization pass
        // e.g. ['document_reviewer'], and a mock/stale req.user may carry the
        // raw value. Hoisting the normalization must not drop this path.
        const middleware = requireRole(['document_reviewer']);
        const next = jest.fn();
        middleware({ user: { id: 'u2', role: 'document_reviewer' }, path: '/x' }, createRes(), next);
        expect(next).toHaveBeenCalledWith();
    });

    test('platform_admin still bypasses every role requirement', () => {
        const middleware = requireRole(['dispatcher']);
        const next = jest.fn();
        middleware({ user: { id: 'u3', role: 'system_admin_platform' }, path: '/x' }, createRes(), next);
        expect(next).toHaveBeenCalledWith();
    });

    test('a non-matching role is still refused', () => {
        const middleware = requireRole(['dispatcher']);
        const next = jest.fn();
        middleware({ user: { id: 'u4', role: 'finance_officer_platform' }, path: '/x' }, createRes(), next);
        expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
    });
});

describe('authorize (deprecated alias) — same construction-time discipline', () => {
    test('one normalizeRole per request, none for the fixed list', () => {
        const middleware = authorize(['system_admin_dtam', 'dispatcher']);

        normalizeRole.mockClear();
        for (let i = 0; i < 20; i++) {
            middleware({ user: { id: 'u1', role: 'system_admin_dtam' } }, createRes(), jest.fn());
        }
        expect(normalizeRole.mock.calls.length).toBe(20);
    });

    test('behaviour pins: canonical match passes, mismatch 403, missing user 401', () => {
        const middleware = authorize(['system_admin_dtam']);

        const next = jest.fn();
        middleware({ user: { id: 'u1', role: 'system_admin_dtam' } }, createRes(), next);
        expect(next).toHaveBeenCalledWith();

        const res403 = createRes();
        middleware({ user: { id: 'u2', role: 'health' } }, res403, jest.fn());
        expect(res403.status).toHaveBeenCalledWith(403);

        const res401 = createRes();
        middleware({}, res401, jest.fn());
        expect(res401.status).toHaveBeenCalledWith(401);
    });

    test('a single string (non-array) role argument still works', () => {
        const middleware = authorize('system_admin_dtam');
        const next = jest.fn();
        middleware({ user: { id: 'u1', role: 'system_admin_dtam' } }, createRes(), next);
        expect(next).toHaveBeenCalledWith();
    });
});

describe('the role permission baseline is computed once per role, not once per request', () => {
    test('a second request for the same role does ZERO hasPermission calls', async () => {
        await getEffectivePermissions({ role: 'document_reviewer' });

        hasPermission.mockClear();
        await getEffectivePermissions({ role: 'document_reviewer' });
        await getEffectivePermissions({ role: 'DOCUMENT_REVIEWER' }); // alias, same baseline

        expect(hasPermission.mock.calls.length).toBe(0);
    });

    test('the memo does not cross roles', async () => {
        const reviewer = await getEffectivePermissions({ role: 'document_reviewer' });
        const auditor = await getEffectivePermissions({ role: 'field_inspector' });
        expect(reviewer.effective).not.toEqual(auditor.effective);
    });
});

describe('the permission gates test membership in O(1)', () => {
    test('the service result carries effectiveSet mirroring effective', async () => {
        const result = await getEffectivePermissions({ role: 'document_reviewer', userId: 'u1' });
        expect(result.effectiveSet).toBeInstanceOf(Set);
        expect([...result.effectiveSet].sort()).toEqual(result.effective);
    });

    test('effectiveSet reflects GRANT and REVOKE, same as the array', async () => {
        mockGrantFindMany.mockResolvedValueOnce([
            { permission: PERMISSIONS.REPORT_EXPORT, effect: 'GRANT' },
            { permission: PERMISSIONS.APPLICATION_DOC_REVIEW, effect: 'REVOKE' },
        ]);
        const result = await getEffectivePermissions({ role: 'document_reviewer', userId: 'u2' });
        expect(result.effectiveSet.has(PERMISSIONS.REPORT_EXPORT)).toBe(true);
        expect(result.effectiveSet.has(PERMISSIONS.APPLICATION_DOC_REVIEW)).toBe(false);
    });

    test('the fail-safe path (grant read throws) also carries effectiveSet', async () => {
        mockGrantFindMany.mockRejectedValueOnce(new Error('table gone'));
        const result = await getEffectivePermissions({ role: 'document_reviewer', userId: 'u3' });
        expect(result.effectiveSet).toBeInstanceOf(Set);
        expect(result.effectiveSet.has(PERMISSIONS.APPLICATION_DOC_REVIEW)).toBe(true);
    });

    test('requireEffectivePermission still grants and denies correctly through the Set', async () => {
        const gate = requireEffectivePermission(PERMISSIONS.APPLICATION_DOC_REVIEW);

        const okReq = { user: { id: 'u1', role: 'document_reviewer' }, path: '/x' };
        const okNext = jest.fn();
        await gate(okReq, createRes(), okNext);
        expect(okNext).toHaveBeenCalledWith();

        const denyReq = { user: { id: 'u2', role: 'document_reviewer' }, path: '/x' };
        const denyGate = requireEffectivePermission(PERMISSIONS.REPORT_EXPORT);
        const denyNext = jest.fn();
        await denyGate(denyReq, createRes(), denyNext);
        expect(denyNext.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
    });

    test('userHasEffectivePermission agrees with the gate', async () => {
        await expect(userHasEffectivePermission(
            { role: 'document_reviewer', userId: 'u1' }, PERMISSIONS.APPLICATION_DOC_REVIEW,
        )).resolves.toBe(true);
        await expect(userHasEffectivePermission(
            { role: 'document_reviewer', userId: 'u1' }, PERMISSIONS.REPORT_EXPORT,
        )).resolves.toBe(false);
    });

    test('no gate linear-scans the effective array any more (ratchet)', () => {
        const GATES = [
            'middleware/role-middleware.js',
            'routes/api/finance/accounting.js',
        ];
        for (const rel of GATES) {
            const source = fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
            expect(source).not.toMatch(/\.effective\.includes\s*\(/);
        }
    });
});
