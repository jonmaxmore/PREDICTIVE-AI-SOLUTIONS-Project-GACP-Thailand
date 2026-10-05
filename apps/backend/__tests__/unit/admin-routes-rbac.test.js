/**
 * V5-B RBAC matrix — Admin tooling routes × every non-admin role.
 *
 * Why this test exists:
 *   - Loop V Iter 5 audited the `/api/admin/*` surface and discovered that
 *     19 admin routes had only ONE regression test (the healthId-masking
 *     test). 6 Iter 28 mutation endpoints (disable / enable / change-role /
 *     force-reset-mfa / force-status / revert-last-transition) had ZERO
 *     coverage. (force-reset-mfa was removed 2026-09-26, operator "ถอดทั้ง
 *     สองประตู"; second-factor-doors.test.js pins it as unmounted.) This file pins the ADMIN-only gate at every admin tooling
 *     endpoint: non-admin roles MUST 403 AND the service-layer mutation
 *     MUST NOT fire (so a 403 truly means "no work done").
 *   - The route layer mounts authenticateProvider + requireAdmin at the
 *     parent admin router (routes/api/admin/index.js). Individual routes
 *     in admin/applications.js + admin/users.js ALSO call requireAdmin
 *     internally as a defence-in-depth layer. Both gates are exercised
 *     here because each sub-router is mounted under its own express app
 *     instance with the parent middleware re-applied.
 *
 * Coverage per RFC §V5-B (originally 19 admin routes; 22 after the
 * feat/backoffice-per-permission-grants /user-permissions trio was added; 23
 * after the admin certificate revoke door, 2026-08-27; 25 after the
 * certificate revision door preview + press, 2026-08-27; 24 after
 * force-reset-mfa was removed, 2026-09-26) ×
 * 7 non-admin roles + one positive path each + a 401 anonymous check:
 *
 *   /api/admin/users (6 routes):
 *     - GET    /
 *     - POST   /provider
 *     - PATCH  /:id/role
 *     - PATCH  /:id/enable                (Iter 28 — was ZERO coverage)
 *     - PATCH  /:id/change-role           (Iter 28 — was ZERO coverage)
 *     - PATCH  /:id/disable
 *
 *   /api/admin/applications (4 routes):
 *     - GET    /
 *     - PATCH  /:id/status
 *     - POST   /:id/force-status          (Iter 28 — was ZERO coverage)
 *     - POST   /:id/revert-last-transition (Iter 28 — was ZERO coverage)
 *
 *   /api/admin/audit-log (2 routes):
 *     - GET    /
 *     - GET    /export.csv
 *
 *   /api/admin/config (2 routes):
 *     - GET    /
 *     - PATCH  /:key
 *
 *   /api/admin/plants (4 routes):
 *     - GET    /
 *     - POST   /
 *     - PATCH  /:id
 *     - DELETE /:id
 *
 *   /api/admin/user-permissions (3 routes — feat/backoffice-per-permission-grants):
 *     - GET    /:userId
 *     - PUT    /:userId/:permission
 *     - DELETE /:userId/:permission
 *
 *   /api/admin/certificates (3 routes — admin revoke door + revision door, 2026-08-27):
 *     - POST   /:id/revoke
 *     - GET    /:id/revise-location/preview
 *     - POST   /:id/revise-location
 *
 * Pattern: copied from V4-D finance-routes-rbac.test.js + V3-D
 * auditor-routes-rbac.test.js — auth middleware mock attaches req.user
 * from x-test-role headers, canonical-rbac stays REAL via
 * `jest.requireActual` (so the test proves the canonical contract), and
 * the service-layer spies stay uncalled on 403.
 *
 * I-008 applied: mocks expose every helper the SUT imports —
 * provider-user-service (createProviderUser / searchAdminUsers /
 * getActiveAdminUserGuard / updateAdminUser), admin-user-service
 * (the Iter 28 wrapper — re-exported via jest.requireActual to keep
 * policy realistic), admin-application-service (forceTransitionStatus /
 * revertLastTransition spied), audit-logger.log + logWithin +
 * isSequenceConflictError, prisma (application + user + auditLog +
 * plantSpecies + systemConfig + plantingCycle), cache-service,
 * audit-trail, safe-error-message, client-ip, field-encryption.maskThaiId.
 *
 * See: docs/handoffs/iter-V5/00-rfc.md §V5-B.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock (V1-D / V2-D / V3-D / V4-D pattern) ──────────────────────────
jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'user-1',
            email: req.headers['x-test-email'] || 'user-1@example.com',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            healthId: role === 'health' ? (req.headers['x-test-health-id'] || 'health-1') : null,
            providerId: role !== 'health' ? (req.headers['x-test-provider-id'] || 'provider-1') : null,
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
        };
        return next();
    };
    const requireRole = () => (_req, _res, next) => next();
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticate: buildHeaderUser,
        requireRole,
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

// canonical-rbac stays REAL — the test proves the canonical contract.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// ── Service-layer mocks (I-008 mock completeness) ──────────────────────────

// provider-user-service: route handlers in admin/users.js use these helpers.
const mockCreateProviderUser = jest.fn();
const mockSearchAdminUsers = jest.fn();
const mockGetActiveAdminUserGuard = jest.fn();
const mockUpdateAdminUser = jest.fn();

jest.mock('../../services/provider-user-service', () => ({
    createProviderUser: (...args) => mockCreateProviderUser(...args),
    searchAdminUsers: (...args) => mockSearchAdminUsers(...args),
    getActiveAdminUserGuard: (...args) => mockGetActiveAdminUserGuard(...args),
    updateAdminUser: (...args) => mockUpdateAdminUser(...args),
}));

// user-permissions.js reads the grant table + the effective-permissions engine.
// The engine stays REAL (proves the additive-override math); only its prisma
// grant read is mocked below. userPermissionGrant.upsert/findMany is the
// service-layer side-effect that MUST stay uncalled on the 403 path.
const mockUserPermissionGrantFindMany = jest.fn(() => Promise.resolve([]));
const mockUserPermissionGrantFindUnique = jest.fn(() => Promise.resolve(null));
const mockUserPermissionGrantUpsert = jest.fn(() => Promise.resolve({}));
const mockUserPermissionGrantDelete = jest.fn(() => Promise.resolve({}));

// admin-user-service: spy on the mutators so we can assert they are NOT
// called on the 403 path. We rely on the real module's pure helpers (which
// are not used by the route directly) staying untouched — only the four
// async mutators are wrapped.
const mockEnableUser = jest.fn();
const mockChangeUserRole = jest.fn();
const mockDisableUser = jest.fn();

jest.mock('../../services/admin-user-service', () => {
    const real = jest.requireActual('../../services/admin-user-service');
    return {
        ...real,
        enableUser: (...args) => mockEnableUser(...args),
        changeUserRole: (...args) => mockChangeUserRole(...args),
        disableUser: (...args) => mockDisableUser(...args),
    };
});

// admin-application-service: spy on the Iter 28 mutators (force-status,
// revert-last-transition) so 403 path stays mute. Other read helpers
// remain accessible via the real module (this surface is not invoked
// from admin/applications.js — only the provider shim uses them).
const mockForceTransitionStatus = jest.fn();
const mockRevertLastTransition = jest.fn();

jest.mock('../../services/admin-application-service', () => {
    const real = jest.requireActual('../../services/admin-application-service');
    return {
        ...real,
        forceTransitionStatus: (...args) => mockForceTransitionStatus(...args),
        revertLastTransition: (...args) => mockRevertLastTransition(...args),
    };
});

// certificate-service: admin/certificates.js pre-checks through findById and
// mutates through revokeCertificate; the revision door reads through
// previewCertificateRevision and mutates through reviseCertificateFromFarm.
// Every spy MUST stay uncalled on the 403 path.
const mockCertificateFindById = jest.fn();
const mockRevokeCertificate = jest.fn();
const mockPreviewCertificateRevision = jest.fn();
const mockReviseCertificateFromFarm = jest.fn();
jest.mock('../../services/certificate-service', () => ({
    findById: (...args) => mockCertificateFindById(...args),
    revokeCertificate: (...args) => mockRevokeCertificate(...args),
    previewCertificateRevision: (...args) => mockPreviewCertificateRevision(...args),
    reviseCertificateFromFarm: (...args) => mockReviseCertificateFromFarm(...args),
}));

// application-status-writer — invoked by admin/applications.js inside
// the override transaction. Mocked so the positive path resolves cleanly
// without touching prisma.
const mockWriteApplicationStatus = jest.fn();
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...args) => mockWriteApplicationStatus(...args),
}));

// audit-trail service — backs the admin audit-log viewer.
const mockQueryWithFilters = jest.fn();
const mockExportAuditEvents = jest.fn();
const mockBuildAdminFilterWhere = jest.fn(() => ({}));
jest.mock('../../services/audit-trail', () => ({
    queryWithFilters: (...args) => mockQueryWithFilters(...args),
    exportAuditEvents: (...args) => mockExportAuditEvents(...args),
    buildAdminFilterWhere: (...args) => mockBuildAdminFilterWhere(...args),
}));

// cache-service — backs config + plants caching.
const mockCacheGetOrSet = jest.fn((_key, fetcher) => fetcher());
const mockCacheDel = jest.fn();
jest.mock('../../services/cache-service', () => ({
    getOrSet: (...args) => mockCacheGetOrSet(...args),
    del: (...args) => mockCacheDel(...args),
}));

// prisma: every model/method the admin routes touch.
const mockApplicationFindMany = jest.fn();
const mockApplicationCount = jest.fn();
const mockApplicationFindFirst = jest.fn();
const mockApplicationFindUnique = jest.fn();
const mockApplicationUpdate = jest.fn();
const mockPlantSpeciesFindMany = jest.fn();
const mockPlantSpeciesFindUnique = jest.fn();
const mockPlantSpeciesCreate = jest.fn();
const mockPlantSpeciesUpdate = jest.fn();
const mockPlantSpeciesDelete = jest.fn();
const mockSystemConfigFindMany = jest.fn();
const mockSystemConfigUpsert = jest.fn();
const mockPlantingCycleFindMany = jest.fn();
const mockPlantingCycleCount = jest.fn();
const mockPlantingCycleFindUnique = jest.fn();
const mockTransaction = jest.fn(async (cb, _opts) => {
    // Provide a minimal tx client that exposes the writers our code reaches
    // for. The admin/applications PATCH /:id/status handler asserts that
    // `tx.application.update` is a function, so we expose a stub.
    const tx = {
        application: {
            update: jest.fn(() => Promise.resolve({})),
            findUnique: (...args) => mockApplicationFindUnique(...args),
        },
    };
    return cb(tx);
});

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: {
            findMany: (...args) => mockApplicationFindMany(...args),
            count: (...args) => mockApplicationCount(...args),
            findFirst: (...args) => mockApplicationFindFirst(...args),
            findUnique: (...args) => mockApplicationFindUnique(...args),
            update: (...args) => mockApplicationUpdate(...args),
        },
        plantSpecies: {
            findMany: (...args) => mockPlantSpeciesFindMany(...args),
            findUnique: (...args) => mockPlantSpeciesFindUnique(...args),
            create: (...args) => mockPlantSpeciesCreate(...args),
            update: (...args) => mockPlantSpeciesUpdate(...args),
            delete: (...args) => mockPlantSpeciesDelete(...args),
        },
        systemConfig: {
            findMany: (...args) => mockSystemConfigFindMany(...args),
            upsert: (...args) => mockSystemConfigUpsert(...args),
        },
        plantingCycle: {
            findMany: (...args) => mockPlantingCycleFindMany(...args),
            count: (...args) => mockPlantingCycleCount(...args),
            findUnique: (...args) => mockPlantingCycleFindUnique(...args),
            findFirst: jest.fn().mockResolvedValue(null),
        },
        // No `plantUnit` delegate: the admin planting handlers stopped reading
        // PlantUnit rows on 2026-08-25 (R8 of design notes
        // 2026-08-20-planting-tnt-design.md retires per-plant tracking). A
        // re-added read fails loudly here instead of collecting a mocked zero.
        traceQrSecurity: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        userPermissionGrant: {
            findMany: (...args) => mockUserPermissionGrantFindMany(...args),
            findUnique: (...args) => mockUserPermissionGrantFindUnique(...args),
            upsert: (...args) => mockUserPermissionGrantUpsert(...args),
            delete: (...args) => mockUserPermissionGrantDelete(...args),
        },
        $transaction: (...args) => mockTransaction(...args),
    },
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: {
        log: jest.fn().mockResolvedValue(null),
        logWithin: jest.fn().mockResolvedValue(null),
        isSequenceConflictError: jest.fn(() => false),
    },
    AuditCategory: { ADMIN: 'ADMIN', APPLICATION: 'APPLICATION', CERTIFICATE: 'CERTIFICATE' },
    AuditSeverity: { WARNING: 'WARNING', INFO: 'INFO' },
    ResourceType: { APPLICATION: 'APPLICATION', USER: 'USER', CERTIFICATE: 'CERTIFICATE' },
}));

jest.mock('../../utils/client-ip', () => ({
    getRequestIp: jest.fn(() => '127.0.0.1'),
}));

jest.mock('../../utils/field-encryption', () => ({
    maskThaiId: jest.fn((value) => `MASKED(${value || ''})`),
}));

// workflow-event-builder is a pure helper; keep real for shape integrity.
jest.mock('../../shared/workflow-event-builder', () => jest.requireActual('../../shared/workflow-event-builder'));

jest.mock('../../shared/api-response', () => jest.requireActual('../../shared/api-response'));

// ── Seed: happy-path return values so positive admin paths reach < 400 ─────

function seedHappyPath() {
    mockCreateProviderUser.mockResolvedValue({
        user: {
            id: 'u-new',
            email: 'new@example.com',
            firstName: 'New',
            lastName: 'User',
            role: 'field_inspector',
            providerId: '1234567890123',
            healthId: null,
            accountType: 'PROVIDER',
            authType: 'PROVIDER_ID',
            status: 'ACTIVE',
            createdAt: new Date(),
            updatedAt: new Date(),
        },
        canonicalRole: 'field_inspector',
    });
    mockSearchAdminUsers.mockResolvedValue({ rows: [], total: 0 });
    mockGetActiveAdminUserGuard.mockResolvedValue({
        id: 'u-1',
        role: 'field_inspector',
        status: 'ACTIVE',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
        providerId: '1234567890123',
        healthId: null,
    });
    mockUpdateAdminUser.mockResolvedValue({
        id: 'u-1',
        email: 'u-1@example.com',
        firstName: 'Updated',
        lastName: 'User',
        role: 'field_inspector',
        status: 'ACTIVE',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
        providerId: '1234567890123',
        healthId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    });
    mockEnableUser.mockResolvedValue({
        user: {
            id: 'u-1',
            email: 'u-1@example.com',
            firstName: 'A',
            lastName: 'B',
            role: 'field_inspector',
            status: 'ACTIVE',
            accountType: 'PROVIDER',
            authType: 'PROVIDER_ID',
            providerId: '1234567890123',
            healthId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
        previousStatus: 'INACTIVE',
        auditMetadata: { actionType: 'USER_ENABLE' },
    });
    mockChangeUserRole.mockResolvedValue({
        user: {
            id: 'u-1',
            email: 'u-1@example.com',
            firstName: 'A',
            lastName: 'B',
            role: 'dispatcher',
            status: 'ACTIVE',
            accountType: 'PROVIDER',
            authType: 'PROVIDER_ID',
            providerId: '1234567890123',
            healthId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
        auditMetadata: { actionType: 'USER_ROLE_CHANGE' },
    });
    mockDisableUser.mockResolvedValue({
        user: {
            id: 'u-1',
            email: 'u-1@example.com',
            firstName: 'A',
            lastName: 'B',
            role: 'field_inspector',
            status: 'INACTIVE',
            accountType: 'PROVIDER',
            authType: 'PROVIDER_ID',
            providerId: '1234567890123',
            healthId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
        previousStatus: 'ACTIVE',
        auditMetadata: { actionType: 'USER_DISABLE' },
    });
    mockForceTransitionStatus.mockResolvedValue({
        applicationId: 'app-1',
        applicationNumber: 'APP-001',
        previousStatus: 'SUBMITTED',
        nextStatus: 'APPROVED',
    });
    mockRevertLastTransition.mockResolvedValue({
        applicationId: 'app-1',
        applicationNumber: 'APP-001',
        previousStatus: 'APPROVED',
        nextStatus: 'SUBMITTED',
    });
    mockWriteApplicationStatus.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        status: 'APPROVED',
    });
    mockApplicationFindMany.mockResolvedValue([]);
    mockApplicationCount.mockResolvedValue(0);
    mockApplicationFindFirst.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        status: 'SUBMITTED',
        formData: {},
        workflowHistory: [],
    });
    mockApplicationFindUnique.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        status: 'APPROVED',
        updatedAt: new Date(),
    });
    mockApplicationUpdate.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-001',
        status: 'APPROVED',
    });
    mockPlantSpeciesFindMany.mockResolvedValue([]);
    mockPlantSpeciesFindUnique.mockResolvedValue(null);
    mockPlantSpeciesCreate.mockResolvedValue({
        id: 'plant-1',
        name: 'cannabis',
        productionInputs: {},
        sortOrder: 100,
        isActive: true,
    });
    mockPlantSpeciesUpdate.mockResolvedValue({
        id: 'plant-1',
        name: 'cannabis',
        productionInputs: {},
        sortOrder: 100,
        isActive: true,
    });
    mockPlantSpeciesDelete.mockResolvedValue({ id: 'plant-1' });
    mockSystemConfigFindMany.mockResolvedValue([]);
    mockSystemConfigUpsert.mockResolvedValue({
        key: 'platform_fee', value: '500', type: 'STRING', description: '',
    });
    mockPlantingCycleFindMany.mockResolvedValue([]);
    mockPlantingCycleCount.mockResolvedValue(0);
    mockPlantingCycleFindUnique.mockResolvedValue(null);
    mockQueryWithFilters.mockResolvedValue({ rows: [], total: 0 });
    mockExportAuditEvents.mockResolvedValue([]);
    mockCertificateFindById.mockResolvedValue({
        id: 'cert-1',
        certificateNumber: 'GACP-TH-2569-AAAAAA',
        organizationId: 'org-1',
        status: 'active',
        isDeleted: false,
    });
    mockRevokeCertificate.mockResolvedValue({
        id: 'cert-1',
        certificateNumber: 'GACP-TH-2569-AAAAAA',
        organizationId: 'org-1',
        status: 'revoked',
        revokedAt: new Date(),
        revokedBy: 'user-1',
        revokedReason: 'non-conformity found per audit finding #7',
    });
    mockPreviewCertificateRevision.mockResolvedValue({
        current: { province: 'Unknown', district: 'Unknown', subDistrict: 'Unknown', address: null },
        corrected: { province: 'เชียงใหม่', district: 'แม่ริม', subDistrict: 'ริมใต้', address: null },
        changed: ['province', 'district', 'subDistrict'],
    });
    mockReviseCertificateFromFarm.mockResolvedValue({
        certificate: {
            id: 'cert-1',
            certificateNumber: 'GACP-TH-2569-AAAAAA',
            organizationId: 'org-1',
            status: 'active',
            revisionNo: 2,
            revisedAt: new Date(),
            revisedBy: 'user-1',
        },
        previousRevisionNo: 1,
        correctedFields: ['province', 'district', 'subDistrict'],
    });
}

// ── Mount admin router with its real parent middleware chain ───────────────
//
// We mount the full admin/index.js so that BOTH gates fire:
//   1. authenticateProvider (mocked above → reads x-test-role header)
//   2. requireAdmin (real require-admin middleware — calls
//      canonical-rbac.normalizeRole on req.user.role and 403s when the
//      result is not CANONICAL_ROLES.SYSTEM_ADMIN_DTAM)
// Each individual route module (admin/users.js + admin/applications.js)
// ALSO declares its own requireAdmin per-route as defence-in-depth; that
// second gate is also live in this mount.
const adminRouter = require('../../routes/api/admin');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    return app;
}

// ── Role tiers ─────────────────────────────────────────────────────────────
//
// 7 non-admin roles (= the 7 cells × 23 routes = 161 negative assertions).
// 1 admin role (= 23 positive assertions) + 23 anonymous 401 checks.
const NON_ADMIN_ROLES = Object.freeze([
    'document_reviewer',
    'dispatcher',
    'field_inspector',
    'finance_officer_dtam',
    'finance_officer_platform',
    'finance_officer_platform',
    'health',
]);
const ADMIN_ROLE = 'system_admin_dtam';

// ── Route inventory (23) ───────────────────────────────────────────────────
//
// Each entry declares the HTTP verb, path, request body, and the
// service-layer side-effect mock that MUST stay uncalled on the 403 path.
// The `sideEffectMock` selector is a thunk so the mock identity is
// resolved AT ASSERT time (after jest.clearAllMocks in beforeEach has
// reset any cross-test state).
const ADMIN_ROUTES = Object.freeze([
    // ── /api/admin/users ── (7 routes)
    {
        label: 'GET /api/admin/users',
        method: 'get',
        path: '/api/admin/users',
        body: undefined,
        sideEffectMock: () => mockSearchAdminUsers,
    },
    {
        label: 'POST /api/admin/users/provider',
        method: 'post',
        path: '/api/admin/users/provider',
        body: {
            providerId: '1234567890123',
            email: 'new@example.com',
            password: 'Str0ngPass!',
            firstName: 'New',
            lastName: 'Provider',
            role: 'field_inspector',
        },
        sideEffectMock: () => mockCreateProviderUser,
    },
    {
        label: 'PATCH /api/admin/users/:id/role',
        method: 'patch',
        path: '/api/admin/users/u-1/role',
        body: { role: 'dispatcher' },
        sideEffectMock: () => mockUpdateAdminUser,
    },
    {
        label: 'PATCH /api/admin/users/:id/enable',
        method: 'patch',
        path: '/api/admin/users/u-1/enable',
        body: {},
        sideEffectMock: () => mockEnableUser,
    },
    {
        label: 'PATCH /api/admin/users/:id/change-role',
        method: 'patch',
        path: '/api/admin/users/u-1/change-role',
        body: { newRole: 'dispatcher', reason: 'reorg structural realignment' },
        sideEffectMock: () => mockChangeUserRole,
    },
    {
        label: 'PATCH /api/admin/users/:id/disable',
        method: 'patch',
        path: '/api/admin/users/u-1/disable',
        body: { reason: 'policy violation per ticket #1234' },
        // P0-A/P0-D: the route now delegates to adminUserService.disableUser
        // (one policy point: self-guard + tenant scope + last-admin guard +
        // session-epoch stamp) instead of the inline updateAdminUser write.
        sideEffectMock: () => mockDisableUser,
    },
    // ── /api/admin/user-permissions ── (3 routes, feat/backoffice-per-permission-grants)
    {
        label: 'GET /api/admin/user-permissions/:userId',
        method: 'get',
        path: '/api/admin/user-permissions/u-1',
        body: undefined,
        // The GET-payload read hits the grant table via the real engine.
        sideEffectMock: () => mockUserPermissionGrantFindMany,
    },
    {
        label: 'PUT /api/admin/user-permissions/:userId/:permission',
        method: 'put',
        path: '/api/admin/user-permissions/u-1/report.export',
        body: { effect: 'GRANT', reason: 'delegated report export for finance backup' },
        sideEffectMock: () => mockUserPermissionGrantUpsert,
    },
    {
        label: 'DELETE /api/admin/user-permissions/:userId/:permission',
        method: 'delete',
        path: '/api/admin/user-permissions/u-1/report.export',
        body: undefined,
        sideEffectMock: () => mockUserPermissionGrantDelete,
    },
    // ── /api/admin/applications ── (4 routes)
    {
        label: 'GET /api/admin/applications',
        method: 'get',
        path: '/api/admin/applications',
        body: undefined,
        sideEffectMock: () => mockApplicationFindMany,
    },
    {
        label: 'PATCH /api/admin/applications/:id/status',
        method: 'patch',
        path: '/api/admin/applications/app-1/status',
        body: {
            status: 'APPROVED',
            reasonCode: 'DATA_CORRECTION',
            comment: 'Adjusting per audit findings',
        },
        sideEffectMock: () => mockWriteApplicationStatus,
    },
    {
        label: 'POST /api/admin/applications/:id/force-status',
        method: 'post',
        path: '/api/admin/applications/app-1/force-status',
        body: {
            toStatus: 'APPROVED',
            reasonCode: 'DATA_CORRECTION',
            reason: 'Audit recovery per ticket #4242',
        },
        sideEffectMock: () => mockForceTransitionStatus,
    },
    {
        label: 'POST /api/admin/applications/:id/revert-last-transition',
        method: 'post',
        path: '/api/admin/applications/app-1/revert-last-transition',
        body: { reason: 'Operator error rollback' },
        sideEffectMock: () => mockRevertLastTransition,
    },
    // ── /api/admin/audit-log ── (2 routes)
    {
        label: 'GET /api/admin/audit-log',
        method: 'get',
        path: '/api/admin/audit-log',
        body: undefined,
        sideEffectMock: () => mockQueryWithFilters,
    },
    {
        label: 'GET /api/admin/audit-log/export.csv',
        method: 'get',
        path: '/api/admin/audit-log/export.csv',
        body: undefined,
        sideEffectMock: () => mockExportAuditEvents,
    },
    // ── /api/admin/config ── (2 routes)
    {
        label: 'GET /api/admin/config',
        method: 'get',
        path: '/api/admin/config',
        body: undefined,
        sideEffectMock: () => mockSystemConfigFindMany,
    },
    {
        label: 'PATCH /api/admin/config/:key',
        method: 'patch',
        path: '/api/admin/config/platform_fee',
        body: { value: '500', type: 'STRING', description: 'Platform fee' },
        sideEffectMock: () => mockSystemConfigUpsert,
    },
    // ── /api/admin/plants ── (4 routes)
    {
        label: 'GET /api/admin/plants',
        method: 'get',
        path: '/api/admin/plants',
        body: undefined,
        sideEffectMock: () => mockPlantSpeciesFindMany,
    },
    {
        label: 'POST /api/admin/plants',
        method: 'post',
        // The route requires BOTH `code` (@unique) and `name` (→ nameTH); without
        // `code` it 400s at validation before the create spy fires (the old body
        // omitted `code`, so the positive-bypass assertion never saw the mutation).
        path: '/api/admin/plants',
        body: { code: 'cannabis', name: 'cannabis', productionInputs: {} },
        sideEffectMock: () => mockPlantSpeciesCreate,
    },
    {
        label: 'PATCH /api/admin/plants/:id',
        method: 'patch',
        path: '/api/admin/plants/plant-1',
        body: { name: 'cannabis-v2' },
        sideEffectMock: () => mockPlantSpeciesUpdate,
    },
    {
        label: 'DELETE /api/admin/plants/:id',
        method: 'delete',
        path: '/api/admin/plants/plant-1',
        body: undefined,
        sideEffectMock: () => mockPlantSpeciesDelete,
    },
    // ── /api/admin/certificates ── (3 routes, admin revoke door + revision door 2026-08-27)
    {
        label: 'POST /api/admin/certificates/:id/revoke',
        method: 'post',
        path: '/api/admin/certificates/cert-1/revoke',
        body: { reason: 'non-conformity found per audit finding #7' },
        sideEffectMock: () => mockRevokeCertificate,
    },
    {
        label: 'GET /api/admin/certificates/:id/revise-location/preview',
        method: 'get',
        path: '/api/admin/certificates/cert-1/revise-location/preview',
        body: undefined,
        sideEffectMock: () => mockPreviewCertificateRevision,
    },
    {
        label: 'POST /api/admin/certificates/:id/revise-location',
        method: 'post',
        path: '/api/admin/certificates/cert-1/revise-location',
        body: { reason: 'farm location was mistyped at registration' },
        sideEffectMock: () => mockReviseCertificateFromFarm,
    },
]);

// ── Negative matrix: 24 routes × 7 non-admin roles = 168 assertions ────────

describe('V5-B Admin tooling RBAC — non-admin roles MUST 403', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    describe.each(ADMIN_ROUTES)('$label', ({ method, path, body, sideEffectMock }) => {
        test.each(NON_ADMIN_ROLES)('%s role gets 403 (require-admin gate)', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = await (body !== undefined ? req.send(body) : req.send());

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({ success: false });
            // I-008 load-bearing: the service-layer side-effect MUST NOT
            // have been called on the 403 response. This is what makes a
            // 403 mean "no work done" rather than "work done then ignored".
            expect(sideEffectMock()).not.toHaveBeenCalled();
        });
    });
});

// ── Positive matrix: 24 routes × 1 admin role = 24 assertions ──────────────

describe('V5-B Admin tooling RBAC — ADMIN role bypasses the gate', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    describe.each(ADMIN_ROUTES)('$label', ({ method, path, body, sideEffectMock }) => {
        test(`${ADMIN_ROLE} role bypasses the gate (positive)`, async () => {
            const req = request(app)[method](path).set('x-test-role', ADMIN_ROLE);
            const response = await (body !== undefined ? req.send(body) : req.send());

            // The gate let the request through. The downstream service
            // may return 200, 201, 400, 404, etc. depending on body
            // shape — we only assert "not 401 (unauthenticated) and
            // not 403 (forbidden)". Any other status means the gate
            // accepted the role.
            expect(response.status).not.toBe(401);
            expect(response.status).not.toBe(403);
            // The service-layer side-effect was reached. For pure-read
            // routes this asserts the read fired; for write routes this
            // asserts the mutation was attempted (it may still 4xx if
            // the body shape is rejected later, but the spy fires
            // before that 4xx).
            expect(sideEffectMock()).toHaveBeenCalled();
        });
    });
});

// ── Anonymous request returns 401 ──────────────────────────────────────────
//
// Sanity check that the auth middleware sits BEFORE require-admin: a
// request with no `x-test-role` header is rejected with 401, not 403.
// This guards against a regression where require-admin is moved above
// the auth middleware and admins-without-tokens get a 403 instead of
// the canonical 401 (which leaks "the resource is admin-only" before
// authentication).

describe('V5-B Admin tooling RBAC — anonymous request returns 401', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test.each(ADMIN_ROUTES)('$label returns 401 without a token', async ({ method, path, body }) => {
        const req = request(app)[method](path);
        const response = await (body !== undefined ? req.send(body) : req.send());
        expect(response.status).toBe(401);
    });
});
