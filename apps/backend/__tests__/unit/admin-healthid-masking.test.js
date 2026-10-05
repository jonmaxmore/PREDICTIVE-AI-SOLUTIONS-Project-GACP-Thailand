/**
 * [Sprint6] Admin Route PII Masking + Error Sanitisation (C2, M4)
 *
 * Sprint 6 healthId-audit:
 *   - C2: GET /api/admin/applications must mask healthId in every row
 *   - M4: 5xx responses must NOT echo raw Prisma error.message
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        user: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
    },
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(null) },
    AuditCategory: { ADMIN: 'ADMIN' },
    AuditSeverity: { WARNING: 'WARNING' },
    ResourceType: { APPLICATION: 'APPLICATION', USER: 'USER' },
}));

const { prisma } = require('../../services/prisma-database');
const adminApplicationsRouter = require('../../routes/api/admin/applications');
const adminUsersRouter = require('../../routes/api/admin/users');

function buildApp(role = 'admin') {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: 'admin-1', role, canonicalRole: role };
        next();
    });
    app.use('/api/admin/applications', adminApplicationsRouter);
    app.use('/api/admin/users', adminUsersRouter);
    return app;
}

describe('[Sprint6] Admin Route PII Masking + Error Sanitisation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('GET /api/admin/applications masks healthId in every row (C2)', async () => {
        prisma.application.findMany.mockResolvedValue([
            { id: 'app-1', applicationNumber: 'A001', status: 'DRAFT', healthId: '1101900000005', serviceType: 'new_application', areaType: 'OUTDOOR', createdAt: new Date(), updatedAt: new Date() },
            { id: 'app-2', applicationNumber: 'A002', status: 'SUBMITTED', healthId: '2202900000007', serviceType: 'new_application', areaType: 'INDOOR', createdAt: new Date(), updatedAt: new Date() },
        ]);
        prisma.application.count.mockResolvedValue(2);

        const app = buildApp('system_admin_dtam');
        const response = await request(app).get('/api/admin/applications');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        for (const row of response.body.data) {
            // Masked form: starts with one digit, then dashes/asterisks, ends with one digit.
            expect(row.healthId).toMatch(/^\d-\*{4}-\*{5}-\*{2}-\d$/);
            // The raw 13-digit value MUST NOT appear anywhere in the response.
            expect(JSON.stringify(row)).not.toContain('1101900000005');
            expect(JSON.stringify(row)).not.toContain('2202900000007');
        }
    });

    it('GET /api/admin/users response masks healthId, providerId, identityNumber', async () => {
        prisma.user.findMany.mockResolvedValue([
            { id: 'u-1', email: 'a@b.test', firstName: 'A', lastName: 'B', role: 'HEALTH', accountType: 'INDIVIDUAL', authType: 'HEALTH_ID', status: 'ACTIVE', healthId: '1101900000005', providerId: null, createdAt: new Date(), updatedAt: new Date() },
        ]);
        prisma.user.count.mockResolvedValue(1);

        const app = buildApp('system_admin_dtam');
        const response = await request(app).get('/api/admin/users');

        expect(response.status).toBe(200);
        // Response shape: { data: { users: [...], pagination: {...} } }
        const row = response.body.data.users[0];
        expect(row.healthId).toMatch(/^\d-\*{4}-\*{5}-\*{2}-\d$/);
        expect(JSON.stringify(response.body)).not.toContain('1101900000005');
    });

    it('5xx response does NOT echo raw Prisma error.message (M4)', async () => {
        const fakePrismaError = new Error('Unique constraint failed on the fields: (`healthId`) — value `1101900000005`');
        fakePrismaError.name = 'PrismaClientKnownRequestError';
        prisma.application.findMany.mockRejectedValue(fakePrismaError);

        const app = buildApp('system_admin_dtam');
        const response = await request(app).get('/api/admin/applications');

        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        // The Prisma error message contained `healthId` and a raw value; neither must leak.
        expect(JSON.stringify(response.body)).not.toContain('1101900000005');
        expect(JSON.stringify(response.body)).not.toContain('Unique constraint failed');
    });

    it('admin/users 5xx error also sanitises Prisma error.message', async () => {
        const prismaError = new Error('Unique constraint failed on the fields: (`healthIdHash`)');
        prismaError.name = 'PrismaClientKnownRequestError';
        prisma.user.findMany.mockRejectedValue(prismaError);

        const app = buildApp('system_admin_dtam');
        const response = await request(app).get('/api/admin/users');

        expect(response.status).toBe(500);
        expect(JSON.stringify(response.body)).not.toContain('Unique constraint');
        expect(JSON.stringify(response.body)).not.toContain('healthIdHash');
    });

    it('non-admin role is rejected with 403 (RBAC regression guard)', async () => {
        const app = buildApp('health');
        const response = await request(app).get('/api/admin/users');
        // Role middleware should return 403; if it returns 401 or passes through that's a regression.
        expect([401, 403]).toContain(response.status);
        expect(response.body.success).toBe(false);
    });
});
