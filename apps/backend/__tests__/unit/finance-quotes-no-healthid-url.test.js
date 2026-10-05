/**
 * [Sprint6] Finance Quotes PDPA URL Param Guard (C3, H8, H10)
 *
 * Sprint 6 healthId-audit:
 *   - C3: GET /api/finance/quotes?healthId=<13-digit> is REMOVED — replaced with ?applicantId=<uuid>
 *   - H8: route now goes through canonical applicationService.resolveHealthIdentity
 *   - H10: payments.js uses real authenticateHealth, not aliased authenticateAny
 */

const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        quote: {
            findMany: jest.fn(),
            count: jest.fn(),
            findFirst: jest.fn(),
        },
        user: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
        },
    },
}));

// Mock middleware to inject provider role.
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => {
        req.user = { id: 'provider-1', role: 'admin', canonicalRole: 'admin' };
        next();
    },
    authenticateHealth: (req, _res, next) => {
        req.user = { id: 'health-1', role: 'HEALTH', canonicalRole: 'health' };
        next();
    },
}));

jest.mock('../../middleware/role-middleware', () => ({
    financeOnly: (req, _res, next) => next(),
    financeReader: (req, _res, next) => next(),
    requireRole: () => (req, _res, next) => next(),
    requirePermission: () => (req, _res, next) => next(),
    canAccessApplication: (req, _res, next) => next(),
}));

const { prisma } = require('../../services/prisma-database');
const quotesRouter = require('../../routes/api/finance/quotes');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/finance/quotes', quotesRouter);
    return app;
}

describe('[Sprint6] Finance Quotes PDPA URL Param Guard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('GET /api/finance/quotes?healthId=<13-digit> returns 400 PARAM_REMOVED (C3)', async () => {
        const app = buildApp();
        const response = await request(app).get('/api/finance/quotes?healthId=1101900000005');

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('PARAM_REMOVED');
        expect(response.body.message).toMatch(/applicantId/);
        // Prisma should NOT be called when the legacy param is rejected.
        expect(prisma.quote.findMany).not.toHaveBeenCalled();
    });

    it('GET /api/finance/quotes?applicantId=<uuid> resolves user UUID → healthId server-side', async () => {
        prisma.user.findFirst.mockResolvedValue({ healthId: '1101900000005' });
        prisma.quote.findMany.mockResolvedValue([]);
        prisma.quote.count.mockResolvedValue(0);

        const app = buildApp();
        const response = await request(app).get('/api/finance/quotes?applicantId=user-uuid-1');

        expect(response.status).toBe(200);
        // user.findFirst was called to translate UUID → healthId.
        expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'user-uuid-1', isDeleted: false },
            select: { healthId: true },
        }));
    });

    it('GET /api/finance/quotes with unknown applicantId returns empty list (no leakage)', async () => {
        prisma.user.findFirst.mockResolvedValue(null);

        const app = buildApp();
        const response = await request(app).get('/api/finance/quotes?applicantId=nonexistent-uuid');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual([]);
        // findMany must NOT be called when the UUID does not resolve — no broad query leakage.
        expect(prisma.quote.findMany).not.toHaveBeenCalled();
    });

    it('legacy `?healthId=` rejection happens BEFORE any DB call (defence-in-depth)', async () => {
        const app = buildApp();
        await request(app).get('/api/finance/quotes?healthId=1234567890123');
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
        expect(prisma.quote.findMany).not.toHaveBeenCalled();
    });

    it('static regression: routes/api/finance/payments.js imports real `authenticateHealth` (H10)', () => {
        const filePath = path.join(__dirname, '..', '..', 'routes', 'api', 'finance', 'payments.js');
        const raw = fs.readFileSync(filePath, 'utf8');
        // Strip block comments AND line comments so the alias mention in our explanatory
        // banner doesn't trip the regression check.
        const stripped = raw
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        // The Sprint 6 H10 fix removed the alias from the import statement. Stripped
        // source must NOT contain the legacy aliased import.
        expect(stripped).not.toMatch(/authenticateAny:\s*authenticateHealth/);
        // It must import the real `authenticateHealth`.
        expect(stripped).toMatch(/\{[^}]*authenticateHealth[^}]*\}\s*=\s*require\([^)]*auth-middleware/);
    });

    it('static regression: routes/api/finance/quotes.js delegates to canonical resolveHealthIdentity (H8)', () => {
        const filePath = path.join(__dirname, '..', '..', 'routes', 'api', 'finance', 'quotes.js');
        const src = fs.readFileSync(filePath, 'utf8');
        // The Sprint 6 H8 fix routed file-local resolveApplicantHealthId through the canonical service.
        expect(src).toMatch(/applicationService\.resolveHealthIdentity/);
    });

    it('static regression: routes/api/finance/payments.js delegates to canonical resolveHealthIdentity (H8)', () => {
        const filePath = path.join(__dirname, '..', '..', 'routes', 'api', 'finance', 'payments.js');
        const src = fs.readFileSync(filePath, 'utf8');
        expect(src).toMatch(/applicationService\.resolveHealthIdentity/);
    });

    it('static regression: routes/api/finance/invoice-helpers.js delegates to canonical resolveHealthIdentity (H8)', () => {
        const filePath = path.join(__dirname, '..', '..', 'routes', 'api', 'finance', 'invoice-helpers.js');
        const src = fs.readFileSync(filePath, 'utf8');
        expect(src).toMatch(/applicationService\.resolveHealthIdentity/);
    });
});
