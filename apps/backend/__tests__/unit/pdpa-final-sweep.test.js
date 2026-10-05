/**
 * [Sprint 6 healthId-audit — final sweep] PDPA regression guards.
 *
 * Anchors three CRIT fixes found by the final cross-cutting PDPA sweep:
 *
 *   1. MFA verify response/JWT must not echo raw healthId/providerId.
 *      A regression here means every device that decodes the JWT after a
 *      MFA login sees the bare national ID — undoing Batch 1's strip of
 *      the same fields from the canonical login flow.
 *
 *   2. POST /api/admin/users/provider must not store raw providerId in the
 *      hash-chained AuditLog metadata. The audit table is append-only and
 *      retained beyond active-user lifetime, so raw PII there is a worse
 *      leak than the JSON response.
 *
 *   3. Provider directory list/inspector dropdown must mask providerId.
 *      Endpoint is callable by any authenticated provider — without the
 *      mask, every auditor sees every other auditor's Thai national ID.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        // Batch 15 (2026-05-16): identity-service uses findFirst (not
        // findUnique) so it can also enforce isDeleted:false. Expose
        // both so this test stays compatible.
        user: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
        application: { findMany: jest.fn(), count: jest.fn() },
    },
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(null) },
    AuditCategory: { ADMIN: 'ADMIN', AUTHENTICATION: 'AUTHENTICATION' },
    AuditSeverity: { WARNING: 'WARNING', INFO: 'INFO' },
    ResourceType: { USER: 'USER' },
}));

jest.mock('../../services/provider-user-service', () => ({
    createProviderUser: jest.fn(),
}));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => {
        req.user = req.user || { id: 'provider-1', role: 'AUDITOR', canonicalRole: 'field_inspector' };
        next();
    },
    authenticateAny: (req, _res, next) => next(),
}));

jest.mock('../../middleware/mfa-service', () => ({
    mfaService: {
        hashBackupCode: jest.fn(() => 'hashed'),
        verifyTOTP: jest.fn(() => true),
    },
}));

jest.mock('../../config/jwt-security', () => ({
    generateToken: jest.fn(() => 'signed.jwt.token'),
    generateRefreshToken: jest.fn(() => 'signed.refresh.token'),
    verifyToken: jest.fn(() => ({ id: 'u-1', purpose: 'mfa_challenge', jti: 'jti-1' })),
}));

const { prisma } = require('../../services/prisma-database');
const { createProviderUser } = require('../../services/provider-user-service');
const { auditLogger } = require('../../middleware/audit-logger');
const auditLogMock = auditLogger.log;

const RAW_PROVIDER_ID = '3209900112233';
const RAW_HEALTH_ID = '1101900000005';

describe('[Sprint6 final sweep] PDPA regression guards', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Batch 15 (2026-05-16): identity-service uses findFirst, the
        // legacy MFA tests below set up data via findUnique. Mirror
        // findUnique → findFirst so the route reads the same row.
        prisma.user.findFirst.mockImplementation((args) => prisma.user.findUnique(args));
    });

    describe('MFA verify response/JWT — no raw national ID', () => {
        it('JWT payload from /verify omits providerId and healthId', async () => {
            const jwtConfig = require('../../config/jwt-security');
            jwtConfig.verifyToken.mockReturnValue({ id: 'u-1', purpose: 'mfa_challenge', jti: 'jti-1' });

            prisma.user.findUnique.mockResolvedValue({
                id: 'u-1',
                uuid: 'uuid-1',
                email: 'auditor@example.com',
                firstName: 'A',
                lastName: 'B',
                role: 'AUDITOR',
                providerId: RAW_PROVIDER_ID,
                healthId: null,
                twoFactorEnabled: true,
                twoFactorSecret: 'secret',
                twoFactorBackupCodes: [],
                organizationId: null,
                status: 'ACTIVE',
            });
            prisma.user.update.mockResolvedValue(undefined);

            const mfaRouter = require('../../routes/api/identity/mfa');

            const app = express();
            app.use(express.json());
            app.use((req, _res, next) => {
                req.user = { id: 'u-1', role: 'AUDITOR' };
                next();
            });
            app.use('/api/mfa', mfaRouter);

            const response = await request(app)
                .post('/api/mfa/verify')
                .send({ code: '123456', mfa_session: 'fake.session.token' });

            expect(response.status).toBe(200);
            const tokenCall = jwtConfig.generateToken.mock.calls[0];
            expect(tokenCall).toBeTruthy();
            const tokenPayload = tokenCall[0];
            expect(tokenPayload).not.toHaveProperty('providerId');
            expect(tokenPayload).not.toHaveProperty('healthId');
            expect(JSON.stringify(tokenPayload)).not.toContain(RAW_PROVIDER_ID);
        });

        it('JSON response body from /verify omits raw providerId/healthId', async () => {
            const jwtConfig = require('../../config/jwt-security');
            jwtConfig.verifyToken.mockReturnValue({ id: 'u-2', purpose: 'mfa_challenge', jti: 'jti-2' });

            prisma.user.findUnique.mockResolvedValue({
                id: 'u-2',
                uuid: 'uuid-2',
                email: 'health@example.com',
                firstName: 'H',
                lastName: 'L',
                role: 'HEALTH',
                providerId: null,
                healthId: RAW_HEALTH_ID,
                twoFactorEnabled: true,
                twoFactorSecret: 'secret',
                twoFactorBackupCodes: [],
                organizationId: null,
                status: 'ACTIVE',
            });
            prisma.user.update.mockResolvedValue(undefined);

            const mfaRouter = require('../../routes/api/identity/mfa');
            const app = express();
            app.use(express.json());
            app.use((req, _res, next) => {
                req.user = { id: 'u-2', role: 'HEALTH' };
                next();
            });
            app.use('/api/mfa', mfaRouter);

            const response = await request(app)
                .post('/api/mfa/verify')
                .send({ code: '654321', mfa_session: 'fake.session.token' });

            expect(response.status).toBe(200);
            expect(JSON.stringify(response.body)).not.toContain(RAW_HEALTH_ID);
            expect(JSON.stringify(response.body)).not.toContain(RAW_PROVIDER_ID);
            expect(response.body.data?.user).not.toHaveProperty('providerId');
            expect(response.body.data?.user).not.toHaveProperty('healthId');
        });
    });

    describe('admin/users PROVIDER_USER_CREATED audit metadata — no raw providerId', () => {
        it('persists masked providerId, never raw, into the AuditLog row', async () => {
            createProviderUser.mockResolvedValue({
                user: {
                    id: 'new-prov-1',
                    email: 'newprov@example.com',
                    firstName: 'N',
                    lastName: 'P',
                    role: 'AUDITOR',
                    accountType: 'PROVIDER',
                    authType: 'PROVIDER_ID',
                    status: 'ACTIVE',
                    providerId: RAW_PROVIDER_ID,
                    healthId: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                canonicalRole: 'field_inspector',
            });

            const adminUsersRouter = require('../../routes/api/admin/users');

            const app = express();
            app.use(express.json());
            app.use((req, _res, next) => {
                req.user = { id: 'admin-1', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam' };
                next();
            });
            app.use('/api/admin/users', adminUsersRouter);

            const response = await request(app)
                .post('/api/admin/users/provider')
                .send({
                    providerId: RAW_PROVIDER_ID,
                    email: 'newprov@example.com',
                    password: 'StrongP@ss123',
                    firstName: 'N',
                    lastName: 'P',
                    role: 'AUDITOR',
                });

            expect(response.status).toBe(201);
            // 201 response itself goes through mapUser, which already masks.
            expect(JSON.stringify(response.body)).not.toContain(RAW_PROVIDER_ID);

            // The audit-log call must NOT include the raw providerId in any
            // metadata field. The new masked key is `providerIdMasked`.
            const call = auditLogMock.mock.calls.find(c => c[0]?.action === 'PROVIDER_USER_CREATED');
            expect(call).toBeTruthy();
            const metadata = call[0].metadata || {};
            expect(metadata).not.toHaveProperty('providerId');
            expect(JSON.stringify(metadata)).not.toContain(RAW_PROVIDER_ID);
        });
    });

    describe('provider-directory mapProviderUser — masks raw providerId in response', () => {
        it('mapProviderUser output never contains the raw 13-digit id', () => {
            const { mapProviderUser } = require('../../routes/api/provider/provider-directory-utils');
            const out = mapProviderUser({
                id: 'p-1',
                uuid: 'uuid-p-1',
                email: 'auditor@example.com',
                firstName: 'A',
                lastName: 'U',
                role: 'AUDITOR',
                status: 'ACTIVE',
                providerId: RAW_PROVIDER_ID,
                accountType: 'PROVIDER',
                source: 'USER',
            });
            expect(JSON.stringify(out)).not.toContain(RAW_PROVIDER_ID);
            // Username also must not echo the raw id.
            expect(out.username).not.toContain(RAW_PROVIDER_ID);
        });
    });
});
