/**
 * S4(b) — /admin/users 13-digit identity search must not crash when
 * computeLookupHmac throws (ENCRYPTION_KEY unset on dev boxes — the util
 * throws outside NODE_ENV=test). The route wraps the HMAC-clause build in
 * try/catch: logger.warn once, then degrade to email/name-only search
 * instead of 500ing the entire console list.
 *
 * Sibling of admin-users-console-contract.test.js — separate file because
 * that suite keeps utils/field-encryption REAL (it computes expected HMACs
 * with the same function); here the util is mocked to THROW.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'admin-1',
            email: 'admin-1@example.com',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            organizationId: 'org-1',
        };
        return next();
    };
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticate: buildHeaderUser,
        requireRole: () => (_req, _res, next) => next(),
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

const mockSearchAdminUsers = jest.fn();
jest.mock('../../services/provider-user-service', () => ({
    createProviderUser: jest.fn(),
    searchAdminUsers: (...args) => mockSearchAdminUsers(...args),
    getActiveAdminUserGuard: jest.fn(),
    updateAdminUser: jest.fn(),
}));

jest.mock('../../services/admin-user-service', () => ({
    enableUser: jest.fn(),
    changeUserRole: jest.fn(),
    disableUser: jest.fn(),
    assertNotLastActiveAdmin: jest.fn(),
}));

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../shared/logger', () => {
    const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLog, createLogger: jest.fn(() => mockLog) };
});

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(null) },
    AuditCategory: { ADMIN: 'ADMIN' },
    AuditSeverity: { WARNING: 'WARNING', INFO: 'INFO' },
    ResourceType: { USER: 'USER' },
}));

// The dev-box failure mode under test: no ENCRYPTION_KEY → computeLookupHmac
// throws at call time.
jest.mock('../../utils/field-encryption', () => ({
    maskThaiId: jest.fn((value) => (value ? 'MASKED' : null)),
    computeLookupHmac: jest.fn(() => {
        throw new Error('ENCRYPTION_KEY is required for lookup HMAC');
    }),
}));

const usersRouter = require('../../routes/api/admin/users');
const logger = require('../../shared/logger');
const { authenticateProvider } = require('../../middleware/auth-middleware');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(authenticateProvider);
    app.use('/api/admin/users', usersRouter);
    return app;
}

describe('S4(b) — 13-digit search degrades gracefully without ENCRYPTION_KEY', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockSearchAdminUsers.mockResolvedValue({ rows: [], total: 0 });
    });

    it('falls back to email/name-only search (200, no HMAC clauses) and warns once', async () => {
        const response = await request(app)
            .get('/api/admin/users?q=1186494077533')
            .set('x-test-role', 'system_admin_dtam');

        expect(response.status).toBe(200);
        expect(mockSearchAdminUsers).toHaveBeenCalled();
        const { where } = mockSearchAdminUsers.mock.calls[0][0];
        // email/name contains survive; identity clauses are dropped.
        expect(where.OR).toEqual(expect.arrayContaining([
            { email: { contains: '1186494077533', mode: 'insensitive' } },
        ]));
        for (const clause of where.OR) {
            expect(clause).not.toHaveProperty('healthIdHmac');
            expect(clause).not.toHaveProperty('providerIdHmac');
        }
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('non-13-digit queries never touch the HMAC path at all', async () => {
        const response = await request(app)
            .get('/api/admin/users?q=somchai')
            .set('x-test-role', 'system_admin_dtam');

        expect(response.status).toBe(200);
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
