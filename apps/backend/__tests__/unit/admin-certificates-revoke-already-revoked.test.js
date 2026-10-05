/**
 * Admin revoke door — the already-revoked refusal must hold on EVERY key the
 * service accepts, and must survive a concurrent double-press.
 *
 * Finding (2026-08-27, routes/api/admin/certificates.js:94): the route's
 * pre-check resolved by row id only (certificateService.findById), but the
 * service resolves by certificateNumber FIRST. Posting an already-revoked
 * cert's NUMBER as :id skipped the 409 and re-stamped revokedAt/revokedBy/
 * revokedReason/updatedBy on an existing revocation record (ISO 17065 §7.11
 * record of decision). findById also filtered isDeleted:false while the
 * service does not, and the check + stamp were two statements with no
 * conditional write, so two concurrent presses both re-stamped.
 *
 * This file mounts the REAL admin router with the REAL certificate-service
 * and a mocked prisma, so the id-vs-number resolution mismatch is visible
 * (the service-mocked route test cannot see it).
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
            id: req.headers['x-test-user-id'] || 'user-1',
            email: 'user-1@example.com',
            role,
            canonicalRole: role,
            healthId: null,
            providerId: 'provider-1',
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

jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// REAL certificate-service on top of a mocked prisma.certificate delegate.
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        $transaction: jest.fn(async (cb) => cb({})),
        certificate: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
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

const { prisma } = require('../../services/prisma-database');
const adminRouter = require('../../routes/api/admin');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    return app;
}

const CERT_ID = 'cert-a-1';
const CERT_NUMBER = 'GACP-TH-2569-AAAAAA';

const REVOKED_CERT = Object.freeze({
    id: CERT_ID,
    certificateNumber: CERT_NUMBER,
    organizationId: 'org-1',
    status: 'revoked',
    isDeleted: false,
    revokedAt: new Date('2026-08-01T00:00:00.000Z'),
    revokedBy: 'admin-original',
    revokedReason: 'original decision',
});

const ACTIVE_CERT = Object.freeze({
    id: CERT_ID,
    certificateNumber: CERT_NUMBER,
    organizationId: 'org-1',
    status: 'active',
    isDeleted: false,
});

function asAdmin(app, key) {
    return request(app).post(`/api/admin/certificates/${key}/revoke`)
        .set('x-test-role', 'system_admin_dtam')
        .set('x-test-user-id', 'admin-second')
        .set('x-test-organization-id', 'org-1');
}

describe('POST /api/admin/certificates/:id/revoke — already-revoked refusal through the real service', () => {
    let app;

    beforeAll(() => { app = buildApp(); });

    beforeEach(() => {
        jest.clearAllMocks();
        prisma.certificate.update.mockImplementation(async ({ data }) => ({ ...ACTIVE_CERT, ...data }));
    });

    it('the certificateNumber of a revoked row as :id → 409, no re-stamp, no admin audit', async () => {
        // The service resolves by number first: the number matches.
        prisma.certificate.findUnique.mockResolvedValue({ ...REVOKED_CERT });
        // The id lookup would miss (a number is not an id).
        prisma.certificate.findFirst.mockResolvedValue(null);

        const res = await asAdmin(app, CERT_NUMBER).send({ reason: 'second attempt by number' });

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false, error: 'CERTIFICATE_ALREADY_REVOKED' });
        expect(res.body.message).toContain('คุณ');
        expect(prisma.certificate.update).not.toHaveBeenCalled();
        expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it.each(['revoked', 'REVOKED'])('the id of a revoked (%s) row → 409, no re-stamp', async (status) => {
        prisma.certificate.findUnique.mockResolvedValue(null);
        prisma.certificate.findFirst.mockResolvedValue({ ...REVOKED_CERT, status });

        const res = await asAdmin(app, CERT_ID).send({ reason: 'second attempt by id' });

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false, error: 'CERTIFICATE_ALREADY_REVOKED' });
        expect(prisma.certificate.update).not.toHaveBeenCalled();
        expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('the id of a soft-deleted revoked row → 409, no re-stamp (the isDeleted gap)', async () => {
        prisma.certificate.findUnique.mockResolvedValue(null);
        prisma.certificate.findFirst.mockResolvedValue({ ...REVOKED_CERT, isDeleted: true });

        const res = await asAdmin(app, CERT_ID).send({ reason: 'second attempt on deleted row' });

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false, error: 'CERTIFICATE_ALREADY_REVOKED' });
        expect(prisma.certificate.update).not.toHaveBeenCalled();
    });

    it('race loser: the row read active but the conditional write matched nothing (P2025) → 409, no admin audit', async () => {
        prisma.certificate.findUnique.mockResolvedValue({ ...ACTIVE_CERT });
        prisma.certificate.findFirst.mockResolvedValue({ ...ACTIVE_CERT });
        prisma.certificate.update.mockRejectedValue(
            Object.assign(new Error('Record to update not found.'), { code: 'P2025' }),
        );

        const res = await asAdmin(app, CERT_NUMBER).send({ reason: 'concurrent press' });

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false, error: 'CERTIFICATE_ALREADY_REVOKED' });
        expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('an active row → 200 and the stamp is a conditional write scoped to a not-yet-revoked status', async () => {
        prisma.certificate.findUnique.mockResolvedValue({ ...ACTIVE_CERT });
        prisma.certificate.findFirst.mockResolvedValue({ ...ACTIVE_CERT });

        const res = await asAdmin(app, CERT_NUMBER).send({ reason: 'non-conformity found' });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ id: CERT_ID, certificateNumber: CERT_NUMBER, status: 'revoked' });
        expect(prisma.certificate.update).toHaveBeenCalledTimes(1);
        const { where, data } = prisma.certificate.update.mock.calls[0][0];
        expect(where).toEqual({ id: CERT_ID, status: { notIn: ['revoked', 'REVOKED'] } });
        expect(data.status).toBe('revoked');
        expect(data.revokedBy).toBe('admin-second');
        // The admin act was recorded once (the lifecycle audit is a separate row).
        const adminEntries = mockAuditLog.mock.calls.filter((c) => c[0]?.action === 'ADMIN_CERTIFICATE_REVOKED');
        expect(adminEntries).toHaveLength(1);
    });
});
