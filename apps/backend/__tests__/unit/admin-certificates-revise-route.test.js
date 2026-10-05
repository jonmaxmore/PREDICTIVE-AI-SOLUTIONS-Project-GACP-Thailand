/**
 * Admin revision door —
 *   GET  /api/admin/certificates/:id/revise-location/preview
 *   POST /api/admin/certificates/:id/revise-location
 *
 * Design: design note 2026-08-27-certificate-revision-design §4.
 * The door never types register values: the corrected province / district /
 * subDistrict / address come from the Farm row through
 * certificateService.previewCertificateRevision / reviseCertificateFromFarm.
 * This file pins what the door itself owns:
 *
 *   (1) the parent admin router gates both routes — anonymous 401, non-admin
 *       403, and neither service entry point fires on either;
 *   (2) the reason is validated at the door (trimmed, 1..500 chars) with the
 *       catalogued codes REVISION_REASON_REQUIRED / REVISION_REASON_TOO_LONG,
 *       service untouched on refusal;
 *   (3) every service refusal that carries a catalogued `code` is answered
 *       with the catalog's httpStatus + Thai message (NOT_REVISABLE,
 *       NO_CHANGE, CONFLICT, FARM_LOCATION_MISSING + missingFields,
 *       CERT_SIGNING_UNAVAILABLE); a statusCode 404 maps to
 *       CERTIFICATE_NOT_FOUND; anything else is a 500 through
 *       safeErrorMessage;
 *   (4) the happy path calls the service with the caller's own tenant and
 *       crossTenant:false, returns the documented data shape, and records
 *       ADMIN_CERTIFICATE_REVISED (metadata: certificateNumber, revisionNo,
 *       correctedFields — never the free-text reason);
 *   (5) the preview route reads only: it never calls reviseCertificateFromFarm.
 *
 * Scaffold copied from admin-certificates-revoke-route.test.js (auth mock
 * reads x-test-* headers, canonical-rbac stays REAL, the real admin/index.js
 * is mounted so both gates fire).
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock (same shape as admin-routes-rbac.test.js) ────────────────────
jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'user-1',
            email: 'user-1@example.com',
            role,
            canonicalRole: role,
            healthId: null,
            providerId: 'provider-1',
            organizationId: req.headers['x-test-no-organization']
                ? null
                : (req.headers['x-test-organization-id'] || 'org-1'),
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

// canonical-rbac stays REAL — the 403 proves the canonical contract.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// ── certificate-service: the entry points the admin certificate door may use ──
const mockFindById = jest.fn();
const mockRevokeCertificate = jest.fn();
const mockPreviewCertificateRevision = jest.fn();
const mockReviseCertificateFromFarm = jest.fn();
jest.mock('../../services/certificate-service', () => ({
    findById: (...args) => mockFindById(...args),
    revokeCertificate: (...args) => mockRevokeCertificate(...args),
    previewCertificateRevision: (...args) => mockPreviewCertificateRevision(...args),
    reviseCertificateFromFarm: (...args) => mockReviseCertificateFromFarm(...args),
}));

// prisma: NO `certificate` delegate on purpose — the door must go through the
// service, not a fresh prisma call.
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        $transaction: jest.fn(async (cb) => cb({})),
    },
}));

jest.mock('../../services/cache-service', () => ({
    getOrSet: jest.fn((_key, fetcher) => fetcher()),
    del: jest.fn(),
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockAuditLog = jest.fn().mockResolvedValue(null);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: {
        log: (...args) => mockAuditLog(...args),
        logWithin: jest.fn().mockResolvedValue(null),
        isSequenceConflictError: jest.fn(() => false),
    },
    AuditCategory: { ADMIN: 'ADMIN', APPLICATION: 'APPLICATION', CERTIFICATE: 'CERTIFICATE' },
    AuditSeverity: { WARNING: 'WARNING', INFO: 'INFO' },
    ResourceType: { APPLICATION: 'APPLICATION', USER: 'USER', CERTIFICATE: 'CERTIFICATE' },
    statusTransitionAuditHook: jest.fn(),
}));

jest.mock('../../utils/client-ip', () => ({
    getRequestIp: jest.fn(() => '127.0.0.1'),
}));

jest.mock('../../shared/api-response', () => jest.requireActual('../../shared/api-response'));

const { lookup } = require('../../shared/error-codes');
const adminRouter = require('../../routes/api/admin');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    return app;
}

const CERT_ID = 'cert-a-1';
const REVISE_PATH = `/api/admin/certificates/${CERT_ID}/revise-location`;
const PREVIEW_PATH = `/api/admin/certificates/${CERT_ID}/revise-location/preview`;
const EM_DASH = '—';

const REVISED_AT = new Date('2026-08-27T03:00:00.000Z');

const REVISED_CERT = Object.freeze({
    id: CERT_ID,
    certificateNumber: 'GACP-TH-2569-AAAAAA',
    organizationId: 'org-1',
    status: 'active',
    isDeleted: false,
    revisionNo: 2,
    revisedAt: REVISED_AT,
    revisedBy: 'admin-1',
    revisionReason: 'SYSTEM_DATA_CORRECTION',
    holderName: 'MUST NOT LEAK',
});

const PREVIEW = Object.freeze({
    current: { province: 'Unknown', district: 'Unknown', subDistrict: 'Unknown', address: null },
    corrected: { province: 'เชียงใหม่', district: 'แม่ริม', subDistrict: 'ริมใต้', address: '99 หมู่ 4' },
    changed: ['province', 'district', 'subDistrict', 'address'],
});

function serviceError(message, statusCode, code, extra = {}) {
    return Object.assign(new Error(message), { statusCode, code, ...extra });
}

function asAdminPost(app) {
    return request(app).post(REVISE_PATH)
        .set('x-test-role', 'system_admin_dtam')
        .set('x-test-user-id', 'admin-1')
        .set('x-test-organization-id', 'org-1');
}

function asAdminPreview(app) {
    return request(app).get(PREVIEW_PATH)
        .set('x-test-role', 'system_admin_dtam')
        .set('x-test-user-id', 'admin-1')
        .set('x-test-organization-id', 'org-1');
}

function expectServicesUntouched() {
    expect(mockReviseCertificateFromFarm).not.toHaveBeenCalled();
    expect(mockPreviewCertificateRevision).not.toHaveBeenCalled();
    expect(mockRevokeCertificate).not.toHaveBeenCalled();
    expect(mockFindById).not.toHaveBeenCalled();
}

describe('admin revision door — /api/admin/certificates/:id/revise-location', () => {
    let app;

    beforeAll(() => { app = buildApp(); });

    beforeEach(() => {
        jest.clearAllMocks();
        mockFindById.mockResolvedValue({ ...REVISED_CERT, revisionNo: 1 });
        mockPreviewCertificateRevision.mockResolvedValue({ ...PREVIEW });
        mockReviseCertificateFromFarm.mockResolvedValue({
            certificate: { ...REVISED_CERT },
            previousRevisionNo: 1,
            correctedFields: ['province', 'district', 'subDistrict', 'address'],
        });
    });

    describe('(1) the parent admin gate', () => {
        it('anonymous POST → 401, services untouched', async () => {
            const res = await request(app).post(REVISE_PATH).send({ reason: 'x' });
            expect(res.status).toBe(401);
            expectServicesUntouched();
        });

        it('anonymous GET preview → 401, services untouched', async () => {
            const res = await request(app).get(PREVIEW_PATH);
            expect(res.status).toBe(401);
            expectServicesUntouched();
        });

        it.each(['auditor', 'document_reviewer', 'scheduler', 'account', 'health'])(
            '%s provider POST → 403, services untouched',
            async (role) => {
                const res = await request(app).post(REVISE_PATH)
                    .set('x-test-role', role)
                    .send({ reason: 'farm location was mistyped' });
                expect(res.status).toBe(403);
                expect(res.body).toMatchObject({ success: false });
                expectServicesUntouched();
            },
        );

        it.each(['auditor', 'document_reviewer', 'scheduler', 'account', 'health'])(
            '%s provider GET preview → 403, services untouched',
            async (role) => {
                const res = await request(app).get(PREVIEW_PATH).set('x-test-role', role);
                expect(res.status).toBe(403);
                expect(res.body).toMatchObject({ success: false });
                expectServicesUntouched();
            },
        );
    });

    describe('(2) reason validation at the door', () => {
        it.each([
            ['missing', {}],
            ['empty string', { reason: '' }],
            ['whitespace only', { reason: '   ' }],
            ['non-string', { reason: 42 }],
        ])('%s reason → 400 REVISION_REASON_REQUIRED from the catalog, service untouched', async (_label, body) => {
            const res = await asAdminPost(app).send(body);
            expect(res.status).toBe(400);
            expect(res.body).toEqual({
                success: false,
                error: 'REVISION_REASON_REQUIRED',
                message: lookup('REVISION_REASON_REQUIRED').messageTh,
            });
            expect(res.body.message).toContain('คุณ');
            expect(res.body.message).not.toContain(EM_DASH);
            expect(mockReviseCertificateFromFarm).not.toHaveBeenCalled();
            expect(mockAuditLog).not.toHaveBeenCalled();
        });

        it('reason over 500 chars → 400 REVISION_REASON_TOO_LONG from the catalog, service untouched', async () => {
            const res = await asAdminPost(app).send({ reason: 'ก'.repeat(501) });
            expect(res.status).toBe(400);
            expect(res.body).toEqual({
                success: false,
                error: 'REVISION_REASON_TOO_LONG',
                message: lookup('REVISION_REASON_TOO_LONG').messageTh,
            });
            expect(res.body.message).not.toContain(EM_DASH);
            expect(mockReviseCertificateFromFarm).not.toHaveBeenCalled();
        });

        it('a 500-char reason is still accepted', async () => {
            const res = await asAdminPost(app).send({ reason: 'ก'.repeat(500) });
            expect(res.status).toBe(200);
            expect(mockReviseCertificateFromFarm).toHaveBeenCalledTimes(1);
        });
    });

    describe('(3) service refusals map through the catalog', () => {
        it.each([
            ['CERTIFICATE_NOT_REVISABLE', 409],
            ['CERTIFICATE_REVISION_NO_CHANGE', 409],
            ['CERTIFICATE_REVISION_CONFLICT', 409],
            ['CERT_SIGNING_UNAVAILABLE', 503],
        ])('service code %s → %s with the catalog Thai message, no admin audit', async (code, status) => {
            mockReviseCertificateFromFarm.mockRejectedValue(serviceError(`service refused: ${code}`, status, code));
            const res = await asAdminPost(app).send({ reason: 'farm location was mistyped' });
            expect(res.status).toBe(status);
            expect(res.body).toEqual({
                success: false,
                error: code,
                message: lookup(code).messageTh,
            });
            expect(res.body.message).not.toContain(EM_DASH);
            expect(mockAuditLog).not.toHaveBeenCalled();
        });

        it('CERTIFICATE_FARM_LOCATION_MISSING (422) → 422 carrying missingFields', async () => {
            mockReviseCertificateFromFarm.mockRejectedValue(
                serviceError('farm location incomplete', 422, 'CERTIFICATE_FARM_LOCATION_MISSING', {
                    missingFields: ['district', 'subDistrict'],
                }),
            );
            const res = await asAdminPost(app).send({ reason: 'farm location was mistyped' });
            expect(res.status).toBe(422);
            expect(res.body).toEqual({
                success: false,
                error: 'CERTIFICATE_FARM_LOCATION_MISSING',
                message: lookup('CERTIFICATE_FARM_LOCATION_MISSING').messageTh,
                missingFields: ['district', 'subDistrict'],
            });
            expect(mockAuditLog).not.toHaveBeenCalled();
        });

        it('statusCode 404 (missing OR another tenant) → 404 CERTIFICATE_NOT_FOUND with Thai copy', async () => {
            mockReviseCertificateFromFarm.mockRejectedValue(
                Object.assign(new Error('Certificate not found'), { statusCode: 404 }),
            );
            const res = await asAdminPost(app).send({ reason: 'cross-tenant or missing' });
            expect(res.status).toBe(404);
            expect(res.body).toMatchObject({ success: false, error: 'CERTIFICATE_NOT_FOUND' });
            expect(res.body.message).toContain('คุณ');
            expect(mockAuditLog).not.toHaveBeenCalled();
        });

        it('anything else → 500 CERTIFICATE_REVISE_FAILED through safeErrorMessage (no internals leak)', async () => {
            mockReviseCertificateFromFarm.mockRejectedValue(
                new Error('PrismaClientKnownRequestError: connect ECONNREFUSED at /app/node_modules/x.js:1'),
            );
            const res = await asAdminPost(app).send({ reason: 'db down' });
            expect(res.status).toBe(500);
            expect(res.body).toMatchObject({ success: false, error: 'CERTIFICATE_REVISE_FAILED' });
            expect(res.body.message).not.toMatch(/prisma|node_modules|ECONNREFUSED/i);
            expect(mockAuditLog).not.toHaveBeenCalled();
        });

        it('an unknown code with a statusCode still does not leak internals', async () => {
            mockReviseCertificateFromFarm.mockRejectedValue(
                serviceError('at /app/node_modules/y.js:2 boom', 418, 'NOT_A_CATALOGUED_CODE'),
            );
            const res = await asAdminPost(app).send({ reason: 'odd error' });
            expect(res.status).toBe(500);
            expect(res.body).toMatchObject({ success: false, error: 'CERTIFICATE_REVISE_FAILED' });
            expect(res.body.message).not.toMatch(/node_modules/i);
        });
    });

    describe('(4) happy path', () => {
        it('→ 200, service called with the caller tenant and crossTenant:false, data shape, admin audit', async () => {
            const res = await asAdminPost(app).send({ reason: '  farm location was mistyped  ' });

            expect(res.status).toBe(200);
            expect(mockReviseCertificateFromFarm).toHaveBeenCalledTimes(1);
            expect(mockReviseCertificateFromFarm).toHaveBeenCalledWith(CERT_ID, {
                reason: 'farm location was mistyped',
                actorId: 'admin-1',
                callerOrganizationId: 'org-1',
                crossTenant: false,
            });
            expect(mockPreviewCertificateRevision).not.toHaveBeenCalled();
            expect(mockFindById).not.toHaveBeenCalled();
            expect(res.body).toEqual({
                success: true,
                data: {
                    id: CERT_ID,
                    certificateNumber: 'GACP-TH-2569-AAAAAA',
                    revisionNo: 2,
                    revisedAt: REVISED_AT.toISOString(),
                    correctedFields: ['province', 'district', 'subDistrict', 'address'],
                },
            });
            expect(JSON.stringify(res.body)).not.toContain('MUST NOT LEAK');

            expect(mockAuditLog).toHaveBeenCalledTimes(1);
            const entry = mockAuditLog.mock.calls[0][0];
            expect(entry).toMatchObject({
                category: 'ADMIN',
                action: 'ADMIN_CERTIFICATE_REVISED',
                severity: 'WARNING',
                actorId: 'admin-1',
                actorRole: 'system_admin_dtam',
                actorType: 'ADMIN',
                resourceType: 'CERTIFICATE',
                resourceId: CERT_ID,
                organizationId: 'org-1',
                ipAddress: '127.0.0.1',
                metadata: {
                    certificateNumber: 'GACP-TH-2569-AAAAAA',
                    revisionNo: 2,
                    correctedFields: ['province', 'district', 'subDistrict', 'address'],
                },
            });
            const serialised = JSON.stringify(entry);
            expect(serialised).not.toContain('MUST NOT LEAK');
            // The free-text reason is the archived revision's record, never the admin audit's.
            expect(serialised).not.toContain('farm location was mistyped');
        });

        it('an audit-log outage does not turn the committed revision into a 500', async () => {
            mockAuditLog.mockRejectedValueOnce(new Error('audit store down'));
            const res = await asAdminPost(app).send({ reason: 'farm location was mistyped' });
            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ id: CERT_ID, revisionNo: 2 });
        });

        it('a caller with no organizationId passes null (service fail-closes with 404)', async () => {
            mockReviseCertificateFromFarm.mockRejectedValue(
                Object.assign(new Error('Certificate not found'), { statusCode: 404 }),
            );
            const res = await request(app).post(REVISE_PATH)
                .set('x-test-role', 'system_admin_dtam')
                .set('x-test-user-id', 'admin-1')
                .set('x-test-no-organization', '1')
                .send({ reason: 'no tenant' });
            expect(res.status).toBe(404);
            expect(mockReviseCertificateFromFarm).toHaveBeenCalledWith(CERT_ID, expect.objectContaining({
                callerOrganizationId: null,
                crossTenant: false,
            }));
        });
    });

    describe('(5) preview reads only', () => {
        it('→ 200 { current, corrected, changed }, called with the caller tenant, revise never called', async () => {
            const res = await asAdminPreview(app);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, data: PREVIEW });
            expect(mockPreviewCertificateRevision).toHaveBeenCalledTimes(1);
            expect(mockPreviewCertificateRevision).toHaveBeenCalledWith(CERT_ID, {
                callerOrganizationId: 'org-1',
                crossTenant: false,
            });
            expect(mockReviseCertificateFromFarm).not.toHaveBeenCalled();
            expect(mockAuditLog).not.toHaveBeenCalled();
        });

        it('a no-change preview is 200 with changed: [] (never a 409)', async () => {
            mockPreviewCertificateRevision.mockResolvedValue({
                current: PREVIEW.corrected,
                corrected: PREVIEW.corrected,
                changed: [],
            });
            const res = await asAdminPreview(app);
            expect(res.status).toBe(200);
            expect(res.body.data.changed).toEqual([]);
        });

        it('service 404 → 404 CERTIFICATE_NOT_FOUND', async () => {
            mockPreviewCertificateRevision.mockRejectedValue(
                Object.assign(new Error('Certificate not found'), { statusCode: 404 }),
            );
            const res = await asAdminPreview(app);
            expect(res.status).toBe(404);
            expect(res.body).toMatchObject({ success: false, error: 'CERTIFICATE_NOT_FOUND' });
        });

        it('service CERTIFICATE_NOT_REVISABLE → 409 with the catalog Thai message', async () => {
            mockPreviewCertificateRevision.mockRejectedValue(
                serviceError('not active', 409, 'CERTIFICATE_NOT_REVISABLE'),
            );
            const res = await asAdminPreview(app);
            expect(res.status).toBe(409);
            expect(res.body).toEqual({
                success: false,
                error: 'CERTIFICATE_NOT_REVISABLE',
                message: lookup('CERTIFICATE_NOT_REVISABLE').messageTh,
            });
        });

        it('service CERTIFICATE_FARM_LOCATION_MISSING → 422 carrying missingFields', async () => {
            mockPreviewCertificateRevision.mockRejectedValue(
                serviceError('farm location incomplete', 422, 'CERTIFICATE_FARM_LOCATION_MISSING', {
                    missingFields: ['province'],
                }),
            );
            const res = await asAdminPreview(app);
            expect(res.status).toBe(422);
            expect(res.body).toMatchObject({
                success: false,
                error: 'CERTIFICATE_FARM_LOCATION_MISSING',
                missingFields: ['province'],
            });
        });
    });
});
