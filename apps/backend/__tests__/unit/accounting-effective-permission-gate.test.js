/**
 * Wave 2 — accounting.js is the FIRST live consumer of the per-permission
 * grant engine. Proves the grant matrix is NOT decorative:
 *   - a user with NO grants gets the exact role-baseline behaviour (no change);
 *   - an admin REVOKE of ACCOUNTING_DASHBOARD_READ 403s an ACCOUNT_DTAM that
 *     the role would otherwise admit;
 *   - a GRANT admits a role that lacks the permission.
 * The gate reads effective perms live (role ∪ GRANT − REVOKE) via
 * effective-permissions-service, so the change bites on the next request.
 */

'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// header-driven auth (admin-routes-rbac pattern)
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => {
        req.user = {
            id: req.headers['x-test-user-id'] || 'u-1',
            role: req.headers['x-test-role'] || 'account_dtam',
            canonicalRole: req.headers['x-test-role'] || 'account_dtam',
            organizationId: 'org-1',
        };
        return next();
    },
}));

// the grant table — effective-permissions-service reads this LIVE
const mockGrantFindMany = jest.fn(async () => []);
jest.mock('../../services/prisma-database', () => ({
    prisma: { userPermissionGrant: { findMany: (...a) => mockGrantFindMany(...a) } },
}));

// accounting-service stubbed so the ALLOWED path returns 200 without a DB
jest.mock('../../services/accounting-service', () => ({
    getRootSummary: jest.fn(async () => ({ ok: true })),
    getDashboardStats: jest.fn(async () => ({ ok: true })),
}));
// The root + dashboard routes pass no role-derived side filter (operator
// 2026-09-11 — both finance roles see the same totals), so this gate test only
// exercises the PERMISSION layer.
const accountingRouter = require('../../routes/api/finance/accounting');

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/finance/accounting', accountingRouter);
    return a;
}

describe('Wave 2 — accounting gate honours effective permissions', () => {
    beforeEach(() => jest.clearAllMocks());

    test('ACCOUNT_DTAM with NO grants → 200 (role baseline unchanged)', async () => {
        mockGrantFindMany.mockResolvedValue([]);
        const res = await request(app()).get('/api/finance/accounting/').set('x-test-role', 'finance_officer_dtam');
        expect(res.status).toBe(200);
    });

    test('a REVOKE of ACCOUNTING_DASHBOARD_READ → 403 (admin can take it away)', async () => {
        mockGrantFindMany.mockResolvedValue([
            { permission: 'accounting.dashboard.read', effect: 'REVOKE' },
        ]);
        const res = await request(app()).get('/api/finance/accounting/').set('x-test-role', 'finance_officer_dtam');
        expect(res.status).toBe(403);
    });

    test('a GRANT admits a role that lacks the permission (e.g. scheduler)', async () => {
        mockGrantFindMany.mockResolvedValue([
            { permission: 'accounting.dashboard.read', effect: 'GRANT' },
        ]);
        const res = await request(app()).get('/api/finance/accounting/').set('x-test-role', 'dispatcher');
        expect(res.status).toBe(200);
    });

    test('scheduler with NO grants → 403 (role lacks it — unchanged)', async () => {
        mockGrantFindMany.mockResolvedValue([]);
        const res = await request(app()).get('/api/finance/accounting/').set('x-test-role', 'dispatcher');
        expect(res.status).toBe(403);
    });

    test('grant-table outage → falls back to role baseline (fail-safe, still 200 for account)', async () => {
        mockGrantFindMany.mockRejectedValue(new Error('db down'));
        const res = await request(app()).get('/api/finance/accounting/').set('x-test-role', 'finance_officer_dtam');
        expect(res.status).toBe(200);
    });
});
