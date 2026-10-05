/**
 * X5-FIX-A / M-5 — PDPA ม.24 read-side audit logging.
 *
 * Coverage:
 *   - GET /api/admin/users emits an ADMIN_USER_LIST_READ audit row.
 *   - GET /api/admin/audit-log emits an AUDIT_LOG_READ audit row.
 *   - GET /api/admin/audit-log/export.csv emits an AUDIT_LOG_EXPORT
 *     audit row.
 *
 * Why these tests exist: X5-D NEW-1 flagged that admin reads of PII
 * (user list, audit-log, CSV export) produced NO audit row of their
 * own access. PDPA ม.24 considers "viewing personal data" as
 * processing, so the access itself must be recorded. The fix wires
 * `auditLogger.log({ action: 'ADMIN_USER_LIST_READ' / 'AUDIT_LOG_READ'
 * / 'AUDIT_LOG_EXPORT' })` to the three endpoints. These tests pin
 * the contract — one row per request, with the right action name +
 * category + resourceType.
 *
 * Mock pattern follows admin-routes-rbac.test.js so the
 * authenticateProvider + requireAdmin gates are realistic (real
 * canonical-rbac, mocked auth-middleware that reads x-test-role).
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock (V5-B pattern) ────────────────────────────────────────────────
jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'admin-user-1',
            email: req.headers['x-test-email'] || 'admin-user-1@example.com',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
        };
        return next();
    };
    return {
        authenticateProvider: buildHeaderUser,
        authenticate: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticateHealth: buildHeaderUser,
        requireRole: () => (_req, _res, next) => next(),
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// provider-user-service mock so GET /api/admin/users returns deterministic rows.
const mockSearchAdminUsers = jest.fn();
jest.mock('../../services/provider-user-service', () => ({
    createProviderUser: jest.fn(),
    searchAdminUsers: (...args) => mockSearchAdminUsers(...args),
    getActiveAdminUserGuard: jest.fn(),
    updateAdminUser: jest.fn(),
}));

// admin-user-service mock — never exercised by the read endpoints, but
// admin/users.js requires it.
jest.mock('../../services/admin-user-service', () => {
    const real = jest.requireActual('../../services/admin-user-service');
    return {
        ...real,
        enableUser: jest.fn(),
        changeUserRole: jest.fn(),
        disableUser: jest.fn(),
    };
});

// audit-trail mock — backs the admin audit-log viewer.
const mockQueryWithFilters = jest.fn();
const mockExportAuditEvents = jest.fn();
const mockBuildAdminFilterWhere = jest.fn(() => ({}));
jest.mock('../../services/audit-trail', () => ({
    queryWithFilters: (...args) => mockQueryWithFilters(...args),
    exportAuditEvents: (...args) => mockExportAuditEvents(...args),
    buildAdminFilterWhere: (...args) => mockBuildAdminFilterWhere(...args),
}));

// cache-service — backs other admin sub-routers.
jest.mock('../../services/cache-service', () => ({
    getOrSet: jest.fn((_key, fetcher) => fetcher()),
    del: jest.fn(),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: {
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn().mockResolvedValue({}),
        },
        plantSpecies: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            delete: jest.fn().mockResolvedValue({}),
        },
        systemConfig: {
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue({}),
        },
        plantingCycle: {
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
        },
        // No `plantUnit` delegate: the admin read side stopped reading PlantUnit
        // rows on 2026-08-25 (spec R8 — per-plant tracking retired). A re-added
        // read fails loudly here instead of collecting a mocked zero.
        traceQrSecurity: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn(async (cb) => cb({
            application: { update: jest.fn(), findUnique: jest.fn() },
        })),
    },
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = {
        debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

const mockAuditLog = jest.fn().mockResolvedValue({ id: 'audit-1' });
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: {
        log: (...args) => mockAuditLog(...args),
        logWithin: jest.fn().mockResolvedValue(null),
        isSequenceConflictError: jest.fn(() => false),
    },
    AuditCategory: {
        ADMIN: 'ADMIN',
        APPLICATION: 'APPLICATION',
        SECURITY: 'SECURITY',
        SYSTEM: 'SYSTEM',
    },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
    ResourceType: { USER: 'USER', APPLICATION: 'APPLICATION', SYSTEM: 'SYSTEM' },
}));

jest.mock('../../utils/client-ip', () => ({
    getRequestIp: jest.fn(() => '10.0.0.1'),
}));

jest.mock('../../utils/field-encryption', () => ({
    maskThaiId: jest.fn((v) => `MASKED(${v || ''})`),
}));

jest.mock('../../shared/api-response', () => jest.requireActual('../../shared/api-response'));

const adminRouter = require('../../routes/api/admin');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    return app;
}

describe('X5-FIX-A M-5 — PDPA ม.24 read-side audit logging', () => {
    let app;
    beforeAll(() => {
        app = buildApp();
    });
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuditLog.mockResolvedValue({ id: 'audit-1' });
        mockSearchAdminUsers.mockResolvedValue({ rows: [], total: 0 });
        mockQueryWithFilters.mockResolvedValue({ rows: [], total: 0 });
        mockExportAuditEvents.mockResolvedValue([]);
    });

    describe('GET /api/admin/users', () => {
        it('emits ADMIN_USER_LIST_READ audit row on success', async () => {
            const response = await request(app)
                .get('/api/admin/users?role=ADMIN&type=provider')
                .set('x-test-role', 'system_admin_dtam');
            expect(response.status).toBe(200);
            expect(mockAuditLog).toHaveBeenCalledTimes(1);
            const event = mockAuditLog.mock.calls[0][0];
            expect(event.category).toBe('ADMIN');
            expect(event.action).toBe('ADMIN_USER_LIST_READ');
            expect(event.severity).toBe('INFO');
            expect(event.resourceType).toBe('USER');
            expect(event.actorRole).toBe('system_admin_dtam');
            expect(event.metadata).toMatchObject({
                page: expect.any(Number),
                limit: expect.any(Number),
                resultCount: 0,
                totalCount: 0,
            });
            expect(event.metadata.filters).toMatchObject({
                type: 'provider',
                role: null,
                hasSearchQuery: false,
            });
        });

        it('does NOT fail the request when audit-write throws', async () => {
            mockAuditLog.mockRejectedValueOnce(new Error('db down'));
            const response = await request(app)
                .get('/api/admin/users')
                .set('x-test-role', 'system_admin_dtam');
            // Even with audit-write failure, the read response remains 200
            // because the audit emission is best-effort (PDPA gap is closed
            // for the happy path; transient audit-table issues must not
            // black-hole admin operations).
            expect(response.status).toBe(200);
        });
    });

    describe('GET /api/admin/audit-log', () => {
        it('emits AUDIT_LOG_READ audit row on success', async () => {
            const response = await request(app)
                .get('/api/admin/audit-log?category=ADMIN&page=2&limit=25')
                .set('x-test-role', 'system_admin_dtam');
            expect(response.status).toBe(200);
            expect(mockAuditLog).toHaveBeenCalledTimes(1);
            const event = mockAuditLog.mock.calls[0][0];
            expect(event.category).toBe('ADMIN');
            expect(event.action).toBe('AUDIT_LOG_READ');
            expect(event.severity).toBe('INFO');
            expect(event.resourceType).toBe('SYSTEM');
            expect(event.resourceId).toBe('AUDIT_LOG');
            expect(event.metadata).toMatchObject({
                page: 2,
                limit: 25,
                resultCount: 0,
            });
            expect(event.metadata.filters.category).toBe('ADMIN');
        });

        it('records filter values in metadata for forensic recall', async () => {
            const response = await request(app)
                .get('/api/admin/audit-log?actorId=u-42&from=2026-05-01T00:00:00Z&to=2026-05-10T23:59:59Z')
                .set('x-test-role', 'system_admin_dtam');
            expect(response.status).toBe(200);
            const event = mockAuditLog.mock.calls[0][0];
            expect(event.metadata.filters.actorId).toBe('u-42');
            expect(event.metadata.filters.from).toBe('2026-05-01T00:00:00Z');
            expect(event.metadata.filters.to).toBe('2026-05-10T23:59:59Z');
        });
    });

    describe('GET /api/admin/audit-log/export.csv', () => {
        it('emits AUDIT_LOG_EXPORT audit row distinct from AUDIT_LOG_READ', async () => {
            const response = await request(app)
                .get('/api/admin/audit-log/export.csv?category=ADMIN')
                .set('x-test-role', 'system_admin_dtam');
            expect(response.status).toBe(200);
            expect(mockAuditLog).toHaveBeenCalledTimes(1);
            const event = mockAuditLog.mock.calls[0][0];
            expect(event.action).toBe('AUDIT_LOG_EXPORT');
            expect(event.category).toBe('ADMIN');
            expect(event.resourceId).toBe('AUDIT_LOG');
            expect(event.metadata).toMatchObject({
                resultCount: 0,
                maxRows: 50_000,
            });
        });
    });
});
