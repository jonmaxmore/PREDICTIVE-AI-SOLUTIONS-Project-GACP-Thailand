/**
 * GET /api/certificates/:id — provider branch carries display identities
 * (ledger F-G4-46 / F-G4-47).
 *
 * The admin detail page at /admin/certificates/[id] printed raw uuids for
 * 'ออกโดย' / 'ผู้ดำเนินการ' / 'ใบสมัคร' because the row only carries
 * issuedBy / revokedBy (User ids) and applicationId. This file pins the
 * ADDITIVE fields the provider branch now returns — nothing is removed:
 *
 *   (1) the application include selects { id, applicationNumber };
 *   (2) issuedBy / revokedBy are resolved through
 *       certificateService.resolveStaffIdentities with the SAME tenant
 *       predicate as the row itself (organizationId + crossTenant);
 *   (3) the response carries issuer / revoker as { id, displayName } —
 *       an id the lookup could not resolve still yields { id,
 *       displayName: null }, a null revokedBy yields revoker: null;
 *   (4) every original column is still on the payload (backward compatible);
 *   (5) PLATFORM_ADMIN resolves cross-tenant (crossTenant: true);
 *   (6) the HEALTH branch is untouched — no staff lookup runs there.
 *
 * Mock conventions copied from certificates-route-rbac.test.js.
 */

const express = require('express');
const request = require('supertest');

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
            healthId: role === 'health' ? 'health-1' : null,
            providerId: role !== 'health' ? 'provider-1' : null,
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

const mockFindById = jest.fn();
const mockGetCertificateForUser = jest.fn();
const mockResolveStaffIdentities = jest.fn();
// Spec 2026-09-30 §3.1 (Task 4): the health branch passes the caller's holder
// scope instead of a bare userId.
jest.mock('../../services/holder-access', () => ({
    holderScope: async (req) => ({ userId: req.user.id, readIds: ['entity-own'], editIds: ['entity-own'] }),
}));

jest.mock('../../services/certificate-service', () => ({
    listCertificates: jest.fn().mockResolvedValue([]),
    listCertificatesForUser: jest.fn().mockResolvedValue([]),
    findById: (...args) => mockFindById(...args),
    getCertificateForUser: (...args) => mockGetCertificateForUser(...args),
    resolveStaffIdentities: (...args) => mockResolveStaffIdentities(...args),
    findByCertificateNumber: jest.fn(),
    getCertificatePdf: jest.fn(),
}));

jest.mock('../../services/entity-service', () => ({
    assertCapability: jest.fn(),
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

const ISSUER_ID = '79242ab9-ae05-46e8-81f2-4743730ad7be';
const REVOKER_ID = 'f71d11dc-e896-4c93-86b0-00af70c4aa54';
const APPLICATION_ID = 'd74191d7-055b-49b4-a555-501cd30a9954';

function revokedRow() {
    return {
        id: 'cert-1',
        certificateNumber: 'GACP-TH-2569-CAE820',
        applicationId: APPLICATION_ID,
        application: { id: APPLICATION_ID, applicationNumber: 'GACP-2569-000123' },
        organizationId: 'org-A',
        status: 'revoked',
        province: 'Unknown',
        issuedBy: ISSUER_ID,
        revokedBy: REVOKER_ID,
        revokedAt: '2026-08-27T00:00:00.000Z',
        revokedReason: 'ใบรับรองนี้ลงนามด้วยคีย์ที่ระบบไม่เชื่อถือ',
    };
}

describe('GET /api/certificates/:id — provider branch display identities', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockFindById.mockResolvedValue(revokedRow());
        mockGetCertificateForUser.mockResolvedValue(revokedRow());
        mockResolveStaffIdentities.mockResolvedValue({
            [ISSUER_ID]: { id: ISSUER_ID, displayName: 'สมชาย ตรวจดี' },
            [REVOKER_ID]: { id: REVOKER_ID, displayName: 'สมหญิง เพิกถอน' },
        });
    });

    test('(1) the application include selects id + applicationNumber', async () => {
        const response = await request(app)
            .get('/api/certificates/cert-1')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-org-id', 'org-A');

        expect(response.status).toBe(200);
        expect(mockFindById).toHaveBeenCalledWith(
            'cert-1',
            expect.objectContaining({
                organizationId: 'org-A',
                crossTenant: false,
                include: {
                    application: { select: { id: true, applicationNumber: true } },
                },
            }),
        );
        expect(response.body.data.application).toEqual({
            id: APPLICATION_ID,
            applicationNumber: 'GACP-2569-000123',
        });
    });

    test('(2)+(3) issuedBy / revokedBy resolve through the tenant-scoped lookup into issuer / revoker', async () => {
        const response = await request(app)
            .get('/api/certificates/cert-1')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-org-id', 'org-A');

        expect(response.status).toBe(200);
        expect(mockResolveStaffIdentities).toHaveBeenCalledTimes(1);
        expect(mockResolveStaffIdentities).toHaveBeenCalledWith(
            [ISSUER_ID, REVOKER_ID],
            { organizationId: 'org-A', crossTenant: false },
        );
        expect(response.body.data.issuer).toEqual({ id: ISSUER_ID, displayName: 'สมชาย ตรวจดี' });
        expect(response.body.data.revoker).toEqual({ id: REVOKER_ID, displayName: 'สมหญิง เพิกถอน' });
    });

    test('(3) an id the lookup cannot resolve still yields { id, displayName: null }; a null revokedBy yields revoker: null', async () => {
        mockFindById.mockResolvedValue({ ...revokedRow(), status: 'active', revokedBy: null, revokedAt: null });
        mockResolveStaffIdentities.mockResolvedValue({});

        const response = await request(app)
            .get('/api/certificates/cert-1')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-org-id', 'org-A');

        expect(response.status).toBe(200);
        expect(response.body.data.issuer).toEqual({ id: ISSUER_ID, displayName: null });
        expect(response.body.data.revoker).toBeNull();
    });

    test('(4) every original column survives — the shape only grows', async () => {
        const response = await request(app)
            .get('/api/certificates/cert-1')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-org-id', 'org-A');

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual(expect.objectContaining(revokedRow()));
        // The staff lookup never widens the payload with anything but the two identities.
        expect(response.body.data).not.toHaveProperty('healthId');
        expect(response.body.data).not.toHaveProperty('providerId');
    });

    test('(5) PLATFORM_ADMIN resolves identities cross-tenant', async () => {
        const response = await request(app)
            .get('/api/certificates/cert-1')
            .set('x-test-role', 'system_admin_platform')
            .set('x-test-org-id', 'org-A');

        expect(response.status).toBe(200);
        expect(mockResolveStaffIdentities).toHaveBeenCalledWith(
            [ISSUER_ID, REVOKER_ID],
            expect.objectContaining({ crossTenant: true }),
        );
    });

    test('(6) HEALTH branch: ownership-scoped read, no staff lookup', async () => {
        const response = await request(app)
            .get('/api/certificates/cert-1')
            .set('x-test-role', 'health')
            .set('x-test-user-id', 'user-health-1');

        expect(response.status).toBe(200);
        expect(mockGetCertificateForUser).toHaveBeenCalledWith('cert-1', expect.objectContaining({ userId: 'user-health-1' }), expect.any(Object));
        expect(mockResolveStaffIdentities).not.toHaveBeenCalled();
        expect(response.body.data).not.toHaveProperty('issuer');
        expect(response.body.data).not.toHaveProperty('revoker');
    });

    test('404 when the tenant-scoped read finds nothing — the lookup never runs', async () => {
        mockFindById.mockResolvedValueOnce(null);

        const response = await request(app)
            .get('/api/certificates/cert-of-tenant-B')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-org-id', 'org-A');

        expect(response.status).toBe(404);
        expect(mockResolveStaffIdentities).not.toHaveBeenCalled();
    });
});
