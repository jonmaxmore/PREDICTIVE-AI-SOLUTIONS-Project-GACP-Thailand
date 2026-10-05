/**
 * [AppAudit AH9] Revision deadline GET — auth + ownership
 *
 * Previously the GET /api/revision-deadline/:applicationId endpoint was fully
 * unauthenticated — anyone with an application UUID could read deadline urgency,
 * `revisionCount`, and `revisionDue`. After the fix, it requires
 * `authenticateAny` AND a per-application ownership check for health users.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log), stream: { write: jest.fn() } };
});

// Test-friendly auth mock — sets req.user from x-test-* headers.
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateAny: (req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'user-1',
            role,
            canonicalRole: role,
            healthId: req.headers['x-test-health-id'] || '1100100100011',
        };
        return next();
    },
    authenticateProvider: (req, _res, next) => { req.user = { id: 'p1', role: 'system_admin_dtam' }; next(); },
    authenticateHealth: (req, _res, next) => { req.user = { id: 'h1', role: 'health' }; next(); },
}));

jest.mock('../../middleware/role-middleware', () => ({
    providerOnly: (_req, _res, next) => next(),
}));

const mockResolveHealthIdentity = jest.fn();
jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: (...args) => mockResolveHealthIdentity(...args),
}));

const mockApplicationFindFirst = jest.fn();
const mockRevisionDeadlineFindUnique = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findFirst: (...args) => mockApplicationFindFirst(...args) },
        revisionDeadline: { findUnique: (...args) => mockRevisionDeadlineFindUnique(...args) },
    },
}));

const revisionDeadlineRouter = require('../../routes/api/applications/revision-deadline');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/revision-deadline', revisionDeadlineRouter);
    return app;
}

describe('[AppAudit AH9] GET /api/revision-deadline/:applicationId', () => {
    beforeEach(() => {
        mockResolveHealthIdentity.mockReset();
        mockApplicationFindFirst.mockReset();
        mockRevisionDeadlineFindUnique.mockReset();
    });

    it('rejects unauthenticated requests with 401', async () => {
        const app = buildApp();
        const response = await request(app).get('/api/revision-deadline/app-1');
        expect(response.status).toBe(401);
        // Ownership / DB checks must NOT run on unauthenticated requests.
        expect(mockResolveHealthIdentity).not.toHaveBeenCalled();
        expect(mockApplicationFindFirst).not.toHaveBeenCalled();
        expect(mockRevisionDeadlineFindUnique).not.toHaveBeenCalled();
    });

    it('health user who DOES own the application can read the deadline', async () => {
        mockResolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: '1100100100011' });
        mockApplicationFindFirst.mockResolvedValue({ id: 'app-1' });
        mockRevisionDeadlineFindUnique.mockResolvedValue({
            id: 'rd-1',
            applicationId: 'app-1',
            status: 'PENDING',
            revisionDue: new Date(Date.now() + 86400000),
            revisionCount: 1,
        });

        const app = buildApp();
        const response = await request(app)
            .get('/api/revision-deadline/app-1')
            .set('x-test-role', 'health')
            .set('x-test-health-id', '1100100100011');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.hasDeadline).toBe(true);
    });

    it('health user who does NOT own the application gets 404 (no info leak)', async () => {
        mockResolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: '1100100100011' });
        mockApplicationFindFirst.mockResolvedValue(null); // ownership lookup returns nothing

        const app = buildApp();
        const response = await request(app)
            .get('/api/revision-deadline/someone-elses-app-uuid')
            .set('x-test-role', 'health');

        expect(response.status).toBe(404);
        // Revision deadline must NOT be looked up — the ownership check fails first.
        expect(mockRevisionDeadlineFindUnique).not.toHaveBeenCalled();
    });

    it('provider/admin role bypasses ownership check (audit/review needs)', async () => {
        mockRevisionDeadlineFindUnique.mockResolvedValue({
            id: 'rd-2',
            applicationId: 'app-2',
            status: 'PENDING',
            revisionDue: new Date(Date.now() + 86400000),
        });

        const app = buildApp();
        const response = await request(app)
            .get('/api/revision-deadline/app-2')
            .set('x-test-role', 'system_admin_dtam');

        expect(response.status).toBe(200);
        // Provider/admin path does NOT call resolveHealthIdentity (no ownership filter).
        expect(mockResolveHealthIdentity).not.toHaveBeenCalled();
    });

    it('health user with no healthId resolution gets 403', async () => {
        mockResolveHealthIdentity.mockResolvedValue(null);

        const app = buildApp();
        const response = await request(app)
            .get('/api/revision-deadline/app-1')
            .set('x-test-role', 'health');

        expect(response.status).toBe(403);
        expect(mockApplicationFindFirst).not.toHaveBeenCalled();
        expect(mockRevisionDeadlineFindUnique).not.toHaveBeenCalled();
    });
});
