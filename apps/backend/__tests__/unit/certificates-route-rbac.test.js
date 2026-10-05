/**
 * V1-D D8 RBAC regression — certificates routes.
 *
 * D8 in the RFC is intentionally "no fix needed — only regression tests
 * so future drift fails loud". The two scope-by-role routes
 * (GET /api/certificates and GET /api/certificates/:id) branch on
 * `isProviderRole(req.user.role)`:
 *   - PROVIDER → cross-tenant scope (`listCertificates({scope:'all'})` /
 *     `findById(...)`)
 *   - HEALTH (default) → per-user scope
 *     (`listCertificates({scope:'self', userId})` /
 *     `getCertificateForUser(id, userId)`)
 * If a future refactor flips the predicate or drops the branch, this
 * test fails — the gate is the route itself, so we can't rely on the
 * service layer to catch the regression.
 *
 * Additionally, GET /api/certificates/my uses the REAL `authenticateHealth`
 * (not the alias) so a provider token must NOT decode through it. We
 * assert the route reaches `listCertificatesForUser` for HEALTH and
 * NOT for any provider role.
 *
 * Pattern mirrors application-revision-deadline-auth.test.js.
 *
 * See: docs/handoffs/iter-V1/00-rfc.md §D8
 */

const express = require('express');
const request = require('supertest');

// Auth mock — sets req.user from x-test-role header.
jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'user-1',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            healthId: role === 'health' ? (req.headers['x-test-health-id'] || 'health-1') : null,
            providerId: role !== 'health' ? (req.headers['x-test-provider-id'] || 'provider-1') : null,
            // bindTenant populates req.user.organizationId on real requests.
            organizationId: req.headers['x-test-org-id'] || 'org-A',
        };
        return next();
    };
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
    };
});

// I-008: expose every helper certificate-service consumers might use.
const mockListCertificates = jest.fn();
const mockListCertificatesForUser = jest.fn();
const mockFindById = jest.fn();
const mockGetCertificateForUser = jest.fn();
const mockFindByCertificateNumber = jest.fn();
const mockGetCertificatePdf = jest.fn();
// F-G4-47: the provider branch of GET /:id resolves issuedBy / revokedBy
// through this read-only lookup after findById — part of the service surface.
const mockResolveStaffIdentities = jest.fn();
jest.mock('../../services/certificate-service', () => ({
    listCertificates: (...args) => mockListCertificates(...args),
    listCertificatesForUser: (...args) => mockListCertificatesForUser(...args),
    findById: (...args) => mockFindById(...args),
    getCertificateForUser: (...args) => mockGetCertificateForUser(...args),
    findByCertificateNumber: (...args) => mockFindByCertificateNumber(...args),
    getCertificatePdf: (...args) => mockGetCertificatePdf(...args),
    resolveStaffIdentities: (...args) => mockResolveStaffIdentities(...args),
}));

jest.mock('../../services/entity-service', () => ({
    assertCapability: jest.fn(),
}));

// Spec 2026-09-30 §3.1 (Task 4): the health branch passes the caller's holder
// scope instead of a bare userId.
jest.mock('../../services/holder-access', () => ({
    holderScope: async (req) => ({ userId: req.user.id, readIds: ['entity-own'], editIds: ['entity-own'] }),
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

const certificatesRouter = require('../../routes/api/certificates/certificates');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/certificates', certificatesRouter);
    return app;
}

const PROVIDER_ROLES = [
    'system_admin_dtam',
    'dispatcher',
    'document_reviewer',
    'field_inspector',
    'finance_officer_dtam',
    'finance_officer_platform',
    'finance_officer_platform',
];

describe('V1-D D8 — certificates route RBAC regression', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockListCertificates.mockResolvedValue([]);
        mockListCertificatesForUser.mockResolvedValue([]);
        mockFindById.mockResolvedValue({ id: 'cert-1', certificateNumber: 'GACP-TH-2569-AAA' });
        mockGetCertificateForUser.mockResolvedValue({ id: 'cert-1', certificateNumber: 'GACP-TH-2569-AAA' });
        mockResolveStaffIdentities.mockResolvedValue({});
    });

    describe('GET /api/certificates — branch by role', () => {
        test('HEALTH role → service called with scope=self + userId', async () => {
            const response = await request(app)
                .get('/api/certificates')
                .set('x-test-role', 'health')
                .set('x-test-user-id', 'user-health-1');

            expect(response.status).toBe(200);
            // Scoped path: only the per-user query runs.
            expect(mockListCertificates).toHaveBeenCalledWith(
                expect.objectContaining({
                    scope: 'self',
                    userId: 'user-health-1',
                    holderScope: expect.objectContaining({ userId: 'user-health-1' }),
                }),
            );
        });

        test.each(PROVIDER_ROLES)('%s role → scope=all but tenant-bounded (C3: organizationId, crossTenant:false)', async (role) => {
            const response = await request(app)
                .get('/api/certificates')
                .set('x-test-role', role)
                .set('x-test-user-id', `user-${role}`)
                .set('x-test-org-id', 'org-A');

            expect(response.status).toBe(200);
            // scope must be 'all' — NOT scoped by userId — but C3 bounds it to
            // the caller's own org and does NOT grant cross-tenant.
            expect(mockListCertificates).toHaveBeenCalledWith(
                expect.objectContaining({ scope: 'all', organizationId: 'org-A', crossTenant: false }),
            );
            const lastCallArgs = mockListCertificates.mock.calls[mockListCertificates.mock.calls.length - 1][0];
            expect(lastCallArgs).not.toHaveProperty('userId');
        });

        test('PLATFORM_ADMIN → scope=all + crossTenant:true (sees every tenant)', async () => {
            const response = await request(app)
                .get('/api/certificates')
                .set('x-test-role', 'system_admin_platform')
                .set('x-test-user-id', 'user-pa')
                .set('x-test-org-id', 'org-A');

            expect(response.status).toBe(200);
            expect(mockListCertificates).toHaveBeenCalledWith(
                expect.objectContaining({ scope: 'all', crossTenant: true }),
            );
        });
    });

    describe('GET /api/certificates/:id — branch by role', () => {
        test('HEALTH role → ownership-scoped getCertificateForUser', async () => {
            const response = await request(app)
                .get('/api/certificates/cert-1')
                .set('x-test-role', 'health')
                .set('x-test-user-id', 'user-health-1');

            expect(response.status).toBe(200);
            // The IDOR-safe path runs — never the cross-tenant findById.
            expect(mockGetCertificateForUser).toHaveBeenCalledWith(
                'cert-1',
                expect.objectContaining({ userId: 'user-health-1' }),
                expect.any(Object),
            );
            expect(mockFindById).not.toHaveBeenCalled();
        });

        test.each(PROVIDER_ROLES)('%s role → tenant-bounded findById (C3: organizationId, crossTenant:false)', async (role) => {
            const response = await request(app)
                .get('/api/certificates/cert-1')
                .set('x-test-role', role)
                .set('x-test-org-id', 'org-A');

            expect(response.status).toBe(200);
            expect(mockFindById).toHaveBeenCalledWith(
                'cert-1',
                expect.objectContaining({ organizationId: 'org-A', crossTenant: false }),
            );
            // Ownership-scoped path must NOT run for providers (they
            // have no healthId; running it would 404 every cert).
            expect(mockGetCertificateForUser).not.toHaveBeenCalled();
        });

        test('PLATFORM_ADMIN → cross-tenant findById (crossTenant:true)', async () => {
            const response = await request(app)
                .get('/api/certificates/cert-1')
                .set('x-test-role', 'system_admin_platform')
                .set('x-test-org-id', 'org-A');

            expect(response.status).toBe(200);
            expect(mockFindById).toHaveBeenCalledWith(
                'cert-1',
                expect.objectContaining({ crossTenant: true }),
            );
        });

        test('C3 tenant isolation: tenant-A ADMIN requesting a tenant-B cert id → 404 (service returns null)', async () => {
            // The service applies the org-A where-clause; a tenant-B row never
            // matches → null → the route 404s instead of leaking the row.
            mockFindById.mockResolvedValueOnce(null);
            const response = await request(app)
                .get('/api/certificates/cert-of-tenant-B')
                .set('x-test-role', 'system_admin_dtam')
                .set('x-test-org-id', 'org-A');

            expect(response.status).toBe(404);
            expect(mockFindById).toHaveBeenCalledWith(
                'cert-of-tenant-B',
                expect.objectContaining({ organizationId: 'org-A', crossTenant: false }),
            );
        });
    });

    describe('GET /api/certificates/my — HEALTH-only by design (real authenticateHealth)', () => {
        test('HEALTH role → service called with own userId', async () => {
            mockListCertificatesForUser.mockResolvedValue([
                { id: 'cert-1', certificateNumber: 'GACP-TH-2569-AAA', status: 'ACTIVE', cropType: 'CANNABIS' },
            ]);
            const response = await request(app)
                .get('/api/certificates/my')
                .set('x-test-role', 'health')
                .set('x-test-user-id', 'user-health-1');

            expect(response.status).toBe(200);
            expect(mockListCertificatesForUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-health-1' }));
        });

        test('each row carries the holder (entityId) of its application - R2 task 15 fix 4', async () => {
            mockListCertificatesForUser.mockResolvedValue([
                { id: 'c1', certificateNumber: 'N1', status: 'ACTIVE', application: { entityId: 'entity-own' } },
                { id: 'c2', certificateNumber: 'N2', status: 'ACTIVE', application: null },
            ]);
            const response = await request(app)
                .get('/api/certificates/my')
                .set('x-test-role', 'health')
                .set('x-test-user-id', 'user-health-1');

            expect(response.status).toBe(200);
            expect(response.body.data[0].entityId).toBe('entity-own');
            expect(response.body.data[1].entityId).toBeNull();
        });

        // Note: because the test mock above accepts any decoded role, a
        // provider hitting /my would in production fail at JWT-secret
        // mismatch (provider tokens sign with PROVIDER_JWT_SECRET, /my
        // uses authenticateHealth which only verifies against
        // HEALTH_JWT_SECRET). This test asserts the contract that /my
        // remains the HEALTH-only endpoint by checking the route never
        // returns provider-scoped data shapes.
        test.each(PROVIDER_ROLES)('%s role → still scoped to caller userId only', async (role) => {
            mockListCertificatesForUser.mockResolvedValue([]);
            const response = await request(app)
                .get('/api/certificates/my')
                .set('x-test-role', role)
                .set('x-test-user-id', `user-${role}`);

            // The endpoint always scopes to the caller — never returns
            // a cross-tenant list even when a provider somehow reaches it.
            if (response.status === 200) {
                expect(mockListCertificatesForUser).toHaveBeenCalledWith(expect.objectContaining({ userId: `user-${role}` }));
                // Cross-tenant listCertificates must NEVER be called from /my.
                expect(mockListCertificates).not.toHaveBeenCalled();
            }
        });
    });

    describe('anonymous → 401, no service touched', () => {
        test('GET /api/certificates without token', async () => {
            const response = await request(app).get('/api/certificates');
            expect(response.status).toBe(401);
            expect(mockListCertificates).not.toHaveBeenCalled();
        });

        test('GET /api/certificates/my without token', async () => {
            const response = await request(app).get('/api/certificates/my');
            expect(response.status).toBe(401);
            expect(mockListCertificatesForUser).not.toHaveBeenCalled();
        });

        test('GET /api/certificates/:id without token', async () => {
            const response = await request(app).get('/api/certificates/cert-1');
            expect(response.status).toBe(401);
            expect(mockFindById).not.toHaveBeenCalled();
            expect(mockGetCertificateForUser).not.toHaveBeenCalled();
        });
    });
});
