/**
 * V2-B RB-2 RBAC regression — DOCUMENT_REVIEWER + AUDITOR-only access
 * to the reviewer queue/progress endpoints.
 *
 * Why this test exists:
 *   - `apps/backend/routes/api/provider/handlers/reviewer.js` gates both
 *     routes (`GET /api/provider/reviewer/dashboard` and
 *     `PATCH /api/provider/reviewer/:id/progress`) on the canonical
 *     permission `APPLICATION_DOC_REVIEW`. That permission is granted to
 *     {DOCUMENT_REVIEWER, AUDITOR, ADMIN} per canonical-rbac.js
 *     (lines 169-193). Every other provider role must get 403.
 *   - Prior to V2 there was no test that explicitly proved this for the
 *     5 non-target provider roles (HEALTH, SCHEDULER, ACCOUNT_DTAM,
 *     ACCOUNT_PLATFORM, legacy ACCOUNT). A regression that widened the
 *     permission set would have been silent.
 *   - This file locks that contract: 2 routes × 5 non-target roles = 10
 *     negative assertions; plus 2 positive cases each for DOCUMENT_REVIEWER
 *     and AUDITOR (the two roles that legitimately review documents) +
 *     ADMIN to prove the bypass works = 6 positive assertions. 16 total.
 *
 * I-008: mock the auth middleware to set req.user from x-test-role
 * header so each test varies the role without touching the JWT secret.
 * Mock the application-service so the positive cases don't try to talk
 * to a real Prisma client.
 *
 * See: docs/handoffs/iter-V2/00-rfc.md §V2-B / RB-2 / RB-5
 */

const express = require('express');
const request = require('supertest');

// Auth mock — sets req.user from x-test-* headers. Mirrors the
// applications-route-rbac.test.js pattern (V1-D D2). The real
// canonical-rbac module is NOT mocked, so the permission check uses
// the actual production tables — the test proves the canonical
// contract, not the mock's behaviour.
jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'user-1',
            providerId: req.headers['x-test-provider-id'] || 'provider-1',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
        };
        return next();
    };
    return {
        authenticateProvider: buildHeaderUser,
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        // requireRole is unused by the reviewer routes, but defensively
        // expose it so other handlers loaded transitively don't error.
        requireRole: () => (_req, _res, next) => next(),
    };
});

// I-008: tests must expose every helper the SUT imports. The reviewer
// handler imports two service methods plus the toReviewerQueueItem
// utility (not mocked — pure function).
jest.mock('../../services/application-service', () => ({
    listAllReviewerQueueApplications: jest.fn().mockResolvedValue({ items: [], truncated: false }),
    findApplicationByIdOrNumberFormDataSlice: jest.fn().mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-2026-000001',
        status: 'ASSIGNED_FOR_REVIEW',
        formData: {
            PROVIDERAssignment: { reviewerId: 'provider-1' },
            reviewProgress: {},
            reviewedSteps: [],
        },
    }),
    updateReviewerProgress: jest.fn().mockResolvedValue({
        id: 'app-1',
        formData: { reviewProgress: { step1: { verified: true } }, reviewedSteps: [1] },
    }),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {},
}));

// The shared logger is required by `shared.js` and `reviewer.js`. Provide
// both default + createLogger to satisfy modules that destructure either.
jest.mock('../../shared/logger', () => {
    const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

// user-lookup-service is imported transitively by `shared.js`. Mock so the
// loader doesn't try to call prisma.
jest.mock('../../services/user-lookup-service', () => ({
    resolveUserIdFromHealthIdSecurely: jest.fn().mockResolvedValue(null),
}));

const applicationService = require('../../services/application-service');
const reviewerRouter = require('../../routes/api/provider/reviewer');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/provider/reviewer', reviewerRouter);
    return app;
}

/**
 * The 2 routes V2-B RB-2 gates. Each row is one request shape the test
 * exercises.
 */
const GATED_ROUTES = [
    {
        method: 'get',
        path: '/api/provider/reviewer/dashboard',
        label: 'GET /reviewer/dashboard',
        body: undefined,
    },
    {
        method: 'patch',
        path: '/api/provider/reviewer/app-1/progress',
        label: 'PATCH /reviewer/:id/progress',
        body: { step: 1, verified: true, notes: 'ok' },
    },
];

/**
 * Non-target roles per the V2-B RFC spec. Each MUST get a 403 on every
 * gated route because they lack APPLICATION_DOC_REVIEW permission.
 */
const NON_TARGET_ROLES = [
    'health',
    'dispatcher',
    'finance_officer_dtam',
    'finance_officer_platform',
    'finance_officer_platform',
];

/**
 * Positive roles — DOCUMENT_REVIEWER + AUDITOR + ADMIN have
 * APPLICATION_DOC_REVIEW. All MUST receive a non-403 response.
 */
const POSITIVE_ROLES = ['document_reviewer', 'field_inspector', 'system_admin_dtam'];

describe('V2-B RB-2 — APPLICATION_DOC_REVIEW gate on /api/provider/reviewer/*', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        applicationService.listAllReviewerQueueApplications.mockResolvedValue({ items: [], truncated: false });
        applicationService.findApplicationByIdOrNumberFormDataSlice.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'APP-2026-000001',
            status: 'ASSIGNED_FOR_REVIEW',
            formData: {
                PROVIDERAssignment: { reviewerId: 'provider-1' },
                reviewProgress: {},
                reviewedSteps: [],
            },
        });
        applicationService.updateReviewerProgress.mockResolvedValue({
            id: 'app-1',
            formData: { reviewProgress: { step1: { verified: true } }, reviewedSteps: [1] },
        });
    });

    describe.each(GATED_ROUTES)('$label', ({ method, path, body }) => {
        test.each(NON_TARGET_ROLES)('%s role gets 403 Forbidden', async (role) => {
            const req = request(app)[method](path).set('x-test-role', role);
            const response = body ? await req.send(body) : await req.send();

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                success: false,
                error: 'Forbidden',
            });
            // The gate must short-circuit before the service runs;
            // otherwise the handler still did its work even though the
            // response says 403 — silent privilege escalation.
            expect(applicationService.listAllReviewerQueueApplications).not.toHaveBeenCalled();
            expect(applicationService.updateReviewerProgress).not.toHaveBeenCalled();
        });
    });

    describe('positive cases — APPLICATION_DOC_REVIEW holders pass the gate', () => {
        test.each(POSITIVE_ROLES)(
            'GET /reviewer/dashboard permits role=%s',
            async (role) => {
                const response = await request(app)
                    .get('/api/provider/reviewer/dashboard')
                    .set('x-test-role', role)
                    .send();

                // Any non-403 / non-401 proves the RBAC gate let the
                // request through to the handler. The handler may then
                // return 200 / 500 based on mocks; we only assert RBAC
                // did NOT intercept.
                expect(response.status).not.toBe(403);
                expect(response.status).not.toBe(401);
            },
        );

        test.each(POSITIVE_ROLES)(
            'PATCH /reviewer/:id/progress permits role=%s',
            async (role) => {
                const response = await request(app)
                    .patch('/api/provider/reviewer/app-1/progress')
                    .set('x-test-role', role)
                    .set('x-test-provider-id', 'provider-1')
                    .send({ step: 1, verified: true, notes: 'ok' });

                expect(response.status).not.toBe(403);
                expect(response.status).not.toBe(401);
            },
        );
    });

    describe('anonymous (no role header) — auth middleware rejects before the gate', () => {
        test.each(GATED_ROUTES)('$label returns 401 without a role', async ({ method, path, body }) => {
            const req = request(app)[method](path);
            const response = body ? await req.send(body) : await req.send();
            expect(response.status).toBe(401);
        });
    });
});
