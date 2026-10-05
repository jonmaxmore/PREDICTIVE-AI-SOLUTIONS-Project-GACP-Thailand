/**
 * Admin revoke door — POST /api/admin/certificates/:id/revoke.
 *
 * Until 2026-08-27 the only route caller of
 * certificateService.revokeCertificate was the external-agency door
 * (routes/api/integration/interoperability.js); the admin certificate
 * detail page carried a stub button. This file pins the admin door:
 *
 *   (1) the parent admin router gates it — anonymous 401, non-admin 403,
 *       and the service mutation never fires on either;
 *   (2) an empty reason is rejected at the door (400, service untouched);
 *   (3) an already-revoked cert is refused with 409: the SERVICE owns that
 *       refusal (it resolves by certificateNumber first, so an id-only
 *       pre-check at the door was bypassable — see
 *       admin-certificates-revoke-already-revoked.test.js); the door only
 *       maps the service's statusCode 409 and never pre-reads by id;
 *   (4) the happy path calls the service with the caller's own tenant and
 *       crossTenant:false (ADMIN is per-tenant; never a platform bypass),
 *       and returns the documented data shape;
 *   (5) a service-thrown statusCode 404 maps to HTTP 404 with that message.
 *
 * Conventions copied from admin-routes-rbac.test.js (auth mock reads
 * x-test-* headers, canonical-rbac stays REAL, the real admin/index.js is
 * mounted so both gates fire) and cert-revoke-org-guard.test.js.
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
            // 'x-test-no-organization' models an admin row with no tenant.
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

// ── certificate-service: the two entry points the door is allowed to use ──
const mockFindById = jest.fn();
const mockRevokeCertificate = jest.fn();
jest.mock('../../services/certificate-service', () => ({
    findById: (...args) => mockFindById(...args),
    revokeCertificate: (...args) => mockRevokeCertificate(...args),
}));

// prisma: NO `certificate` delegate on purpose — the door must go through the
// service getter, not a fresh prisma call. Other admin sub-routers require
// prisma-database at load; they are not exercised here.
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

const adminRouter = require('../../routes/api/admin');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    return app;
}

const CERT_ID = 'cert-a-1';
const PATH = `/api/admin/certificates/${CERT_ID}/revoke`;

const ACTIVE_CERT = Object.freeze({
    id: CERT_ID,
    certificateNumber: 'GACP-TH-2569-AAAAAA',
    organizationId: 'org-1',
    status: 'active',
    isDeleted: false,
});

function asAdmin(app) {
    return request(app).post(PATH)
        .set('x-test-role', 'system_admin_dtam')
        .set('x-test-user-id', 'admin-1')
        .set('x-test-organization-id', 'org-1');
}

describe('POST /api/admin/certificates/:id/revoke', () => {
    let app;

    beforeAll(() => { app = buildApp(); });

    beforeEach(() => {
        jest.clearAllMocks();
        mockFindById.mockResolvedValue({ ...ACTIVE_CERT });
    });

    describe('(1) the parent admin gate', () => {
        it('anonymous → 401, service untouched', async () => {
            const res = await request(app).post(PATH).send({ reason: 'x' });
            expect(res.status).toBe(401);
            expect(mockRevokeCertificate).not.toHaveBeenCalled();
        });

        it.each(['auditor', 'document_reviewer', 'scheduler', 'account', 'health'])(
            '%s provider → 403, service untouched',
            async (role) => {
                const res = await request(app).post(PATH)
                    .set('x-test-role', role)
                    .send({ reason: 'non-conformity found' });
                expect(res.status).toBe(403);
                expect(res.body).toMatchObject({ success: false });
                expect(mockRevokeCertificate).not.toHaveBeenCalled();
                expect(mockFindById).not.toHaveBeenCalled();
            },
        );
    });

    describe('(2) reason validation at the door', () => {
        it.each([
            ['missing', {}],
            ['empty string', { reason: '' }],
            ['whitespace only', { reason: '   ' }],
            ['non-string', { reason: 42 }],
        ])('%s reason → 400 REVOCATION_REASON_REQUIRED, service untouched', async (_label, body) => {
            const res = await asAdmin(app).send(body);
            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({ success: false, error: 'REVOCATION_REASON_REQUIRED' });
            expect(typeof res.body.message).toBe('string');
            expect(res.body.message).toContain('คุณ');
            expect(mockRevokeCertificate).not.toHaveBeenCalled();
        });

        it('reason over 500 chars → 400 REVOCATION_REASON_TOO_LONG, service untouched', async () => {
            const res = await asAdmin(app).send({ reason: 'ก'.repeat(501) });
            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({ success: false, error: 'REVOCATION_REASON_TOO_LONG' });
            expect(mockRevokeCertificate).not.toHaveBeenCalled();
        });

        it('a 500-char reason is still accepted', async () => {
            mockRevokeCertificate.mockResolvedValue({ ...ACTIVE_CERT, status: 'revoked' });
            const res = await asAdmin(app).send({ reason: 'ก'.repeat(500) });
            expect(res.status).toBe(200);
            expect(mockRevokeCertificate).toHaveBeenCalledTimes(1);
        });
    });

    describe('(3) already revoked', () => {
        it('service statusCode 409 → 409 CERTIFICATE_ALREADY_REVOKED with Thai copy, no admin audit', async () => {
            mockRevokeCertificate.mockRejectedValue(
                Object.assign(new Error('Certificate is already revoked'), { statusCode: 409 }),
            );
            const res = await asAdmin(app).send({ reason: 'second attempt' });
            expect(res.status).toBe(409);
            expect(res.body).toMatchObject({ success: false, error: 'CERTIFICATE_ALREADY_REVOKED' });
            expect(res.body.message).toContain('คุณ');
            expect(mockAuditLog).not.toHaveBeenCalled();
        });

        it('the door never pre-checks by row id: the service owns the refusal (it resolves by number first)', async () => {
            mockRevokeCertificate.mockResolvedValue({ ...ACTIVE_CERT, status: 'revoked' });
            const res = await asAdmin(app).send({ reason: 'first attempt' });
            expect(res.status).toBe(200);
            expect(mockFindById).not.toHaveBeenCalled();
            expect(mockRevokeCertificate).toHaveBeenCalledTimes(1);
        });
    });

    describe('(4) happy path', () => {
        it('→ 200, service called with the caller tenant and crossTenant:false, data shape', async () => {
            const revokedAt = new Date('2026-08-27T03:00:00.000Z');
            mockRevokeCertificate.mockResolvedValue({
                ...ACTIVE_CERT,
                status: 'revoked',
                revokedAt,
                revokedBy: 'admin-1',
                revokedReason: 'non-conformity found',
                holderName: 'MUST NOT LEAK',
            });

            const res = await asAdmin(app).send({ reason: '  non-conformity found  ' });

            expect(res.status).toBe(200);
            expect(mockRevokeCertificate).toHaveBeenCalledTimes(1);
            expect(mockRevokeCertificate).toHaveBeenCalledWith(CERT_ID, {
                reason: 'non-conformity found',
                actorId: 'admin-1',
                callerOrganizationId: 'org-1',
                crossTenant: false,
            });
            expect(res.body).toEqual({
                success: true,
                data: {
                    id: CERT_ID,
                    certificateNumber: 'GACP-TH-2569-AAAAAA',
                    status: 'revoked',
                    revokedAt: revokedAt.toISOString(),
                    revokedBy: 'admin-1',
                    revokedReason: 'non-conformity found',
                },
            });

            // Admin audit row: action + metadata carries no personal data.
            expect(mockAuditLog).toHaveBeenCalledTimes(1);
            const entry = mockAuditLog.mock.calls[0][0];
            expect(entry).toMatchObject({
                category: 'ADMIN',
                action: 'ADMIN_CERTIFICATE_REVOKED',
                severity: 'WARNING',
                actorId: 'admin-1',
                resourceType: 'CERTIFICATE',
                resourceId: CERT_ID,
                metadata: { certificateNumber: 'GACP-TH-2569-AAAAAA', reasonLength: 'non-conformity found'.length },
            });
            expect(JSON.stringify(entry)).not.toContain('MUST NOT LEAK');
        });

        it('a caller with no organizationId never reaches the getter and the service 404s (fail-closed)', async () => {
            mockRevokeCertificate.mockRejectedValue(
                Object.assign(new Error('Certificate not found'), { statusCode: 404 }),
            );
            const res = await request(app).post(PATH)
                .set('x-test-role', 'system_admin_dtam')
                .set('x-test-user-id', 'admin-1')
                .set('x-test-no-organization', '1')
                .send({ reason: 'no tenant' });
            expect(res.status).toBe(404);
            expect(mockFindById).not.toHaveBeenCalled();
            expect(mockRevokeCertificate).toHaveBeenCalledWith(CERT_ID, expect.objectContaining({
                callerOrganizationId: null,
                crossTenant: false,
            }));
        });
    });

    describe('(5) service errors', () => {
        it('statusCode 404 → 404 with that message', async () => {
            mockFindById.mockResolvedValue(null);
            mockRevokeCertificate.mockRejectedValue(
                Object.assign(new Error('Certificate not found'), { statusCode: 404 }),
            );
            const res = await asAdmin(app).send({ reason: 'cross-tenant or missing' });
            expect(res.status).toBe(404);
            expect(res.body).toMatchObject({
                success: false,
                error: 'CERTIFICATE_NOT_FOUND',
                message: 'Certificate not found',
            });
            expect(mockAuditLog).not.toHaveBeenCalled();
        });

        it('statusCode 400 → 400 with that message', async () => {
            mockRevokeCertificate.mockRejectedValue(
                Object.assign(new Error('A revocation reason is required'), { statusCode: 400 }),
            );
            const res = await asAdmin(app).send({ reason: 'valid at the door' });
            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({
                success: false,
                error: 'INVALID_REVOCATION_REQUEST',
                message: 'A revocation reason is required',
            });
        });

        it('anything else → 500 through safeErrorMessage (no internals leak)', async () => {
            mockRevokeCertificate.mockRejectedValue(
                new Error('PrismaClientKnownRequestError: connect ECONNREFUSED at /app/node_modules/x.js:1'),
            );
            const res = await asAdmin(app).send({ reason: 'db down' });
            expect(res.status).toBe(500);
            expect(res.body.success).toBe(false);
            expect(res.body.message).not.toMatch(/prisma|node_modules|ECONNREFUSED/i);
        });
    });
});
