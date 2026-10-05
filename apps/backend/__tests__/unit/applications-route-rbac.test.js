/**
 * V1-D D2 RBAC regression — explicit HEALTH-role gate on 5 applicant
 * routes that historically mounted the permissive `authenticateAny` alias.
 *
 * Why this test exists:
 *   - apps/backend/routes/api/applications/applications.js imports
 *     `{ authenticateAny: authenticateHealth }` from auth-middleware so
 *     listing handlers below (which legitimately need both health and
 *     provider tokens) keep working. But the 5 mutating routes
 *     (POST /draft, /submit, /prepare, /draft-documents, DELETE /draft/:id)
 *     must reject provider tokens — they create applicant-owned drafts.
 *   - Pre-V1-D fix any logged-in staff (admin/scheduler/reviewer/etc.)
 *     could create drafts that looked like they came from a real
 *     applicant — silent privilege confusion with no audit trail.
 *   - This file enforces the post-fix invariant: 5 routes × 7 non-HEALTH
 *     roles = 35 assertions, plus 5 positive assertions for the HEALTH
 *     role so we don't accidentally lock out applicants.
 *
 * Pattern: mirrors application-revision-deadline-auth.test.js — mock the
 * auth middleware to attach req.user from x-test-* headers, then assert
 * status codes per role × route combo. The service layer is mocked to
 * resolve a valid identity for the HEALTH positive case.
 *
 * See: docs/handoffs/iter-V1/00-rfc.md §V1-D / D2
 */

const express = require('express');
const request = require('supertest');

// Auth mock — sets req.user from x-test-role header so each test can
// vary the role without touching the JWT secret. Mirrors the established
// `application-revision-deadline-auth.test.js` pattern.
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
            // HEALTH role gets a healthId; provider roles deliberately do
            // not (matches the post-Sprint-6 JWT shape).
            healthId: role === 'health' ? (req.headers['x-test-health-id'] || 'health-1') : null,
            providerId: role !== 'health' ? (req.headers['x-test-provider-id'] || 'provider-1') : null,
        };
        return next();
    };
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
    };
});

// I-008: tests must expose every helper the SUT imports. The route
// imports `resolveHealthIdentity` and several CRUD methods — provide
// jest.fn() for each so resolved promises don't hang the request.
jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(),
    deleteDraft: jest.fn(),
    findApplicationByIdForHealth: jest.fn(),
    findLatestOpenDraftForHealth: jest.fn(),
    findPersonalEntityForHealthIdentity: jest.fn(),
    healDraftEntityColumns: jest.fn(),
    createDraftForHealth: jest.fn(),
    updateApplicantDraftColumns: jest.fn(),
    findDraftForSubmit: jest.fn(),
    getApplicationSlice: jest.fn(),
    findUserOrganizationId: jest.fn(),
    getApplicantReadinessSnapshot: jest.fn(),
    getLatestOpenDraftForApplicant: jest.fn(),
}));

// M1 PR-C: the route now loads the submit guard, which loads the effective-
// permission engine, which reads the CAPABILITIES tables out of this module at
// import time (entity-effective-permissions-service.js:54). A stub of two
// functions makes that module-level read explode, so keep the real exports and
// override only the two behaviours this suite drives.
jest.mock('../../services/entity-service', () => ({
    ...jest.requireActual('../../services/entity-service'),
    assertCapability: jest.fn(),
    ensureEntityFromApplicantData: jest.fn(),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {},
}));

jest.mock('../../services/fee-service', () => ({
    calculatePhase1Fee: jest.fn(() => ({})),
    calculatePhase2Fee: jest.fn(() => ({})),
}));

jest.mock('../../services/storage-service', () => ({
    createUploader: jest.fn(() => ({
        single: jest.fn(() => (_req, _res, next) => next()),
    })),
}));

jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(),
}));

jest.mock('../../services/quotation-service', () => ({
    issueQuotationsForApplication: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));

jest.mock('../../services/working-days-service', () => ({
    addWorkingDays: jest.fn((d) => d),
    loadHolidaySet: jest.fn().mockResolvedValue(new Set()),
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

jest.mock('../../shared/workflow-event-builder', () => ({
    buildWorkflowEvent: jest.fn((event) => ({ ...event, id: 'wf-1' })),
}));

// I-008: helpers expose getHealthScopeOptions which the route destructures.
jest.mock('../../routes/api/helpers/applications-helpers', () => ({
    mapHealthApplication: jest.fn((app) => app),
    getHealthScopeOptions: jest.fn((user) => ({
        healthId: user?.healthId,
        strictHealthScope: true,
    })),
    getActorIdentity: jest.fn((user) => user?.id || null),
}));

jest.mock('../../routes/api/helpers/application-constants', () => ({
    MASTER_STEPS: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    AUDITOR_ROLES: new Set(['auditor', 'admin']),
    REJECTABLE_STATUSES: new Set(['SUBMITTED']),
    REVISION_DECISION_TYPES: new Set(['DOC_REVISION']),
    asObject: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    asArray: (v) => (Array.isArray(v) ? v : []),
    upper: (v) => String(v || '').toUpperCase(),
    ensureApplicationNumber: jest.fn(() => 'APP-TEST-001'),
    isMissingApplicationCommentsTableError: jest.fn(() => false),
    mergeMasterSteps: jest.fn(() => ({})),
    validateMasterSubmission: jest.fn(() => ({ isValid: true, missingByStep: {} })),
}));

jest.mock('../../routes/api/preview/preview-utils', () => ({
    normalizeDocuments: jest.fn(() => []),
    summarizeCompletion: jest.fn(() => ({ isComplete: true, missingFields: [] })),
}));

jest.mock('../../validation/application-schemas', () => ({
    validateStep: jest.fn(() => ({ success: true, errors: [] })),
    validateAllSteps: jest.fn(() => ({ isValid: true, errorsByStep: {} })),
}));

// The two extracted handlers are mounted on a sub-path; isolate the
// route under test by stubbing them with empty routers.
jest.mock('../../routes/api/applications/application-listing-handlers', () => {
    return require('express').Router();
});
jest.mock('../../routes/api/applications/application-workflow-handlers', () => {
    return require('express').Router();
});

const applicationService = require('../../services/application-service');
const applicationsRouter = require('../../routes/api/applications/applications');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', applicationsRouter);
    return app;
}

/**
 * The 5 routes V1-D D2 gates. Each row is one request shape the test
 * exercises. Together they cover every method/path the alias previously
 * left wide open.
 */
const GATED_ROUTES = [
    { method: 'post',   path: '/api/applications/draft',           label: 'POST /draft' },
    { method: 'post',   path: '/api/applications/submit',          label: 'POST /submit' },
    { method: 'post',   path: '/api/applications/prepare',         label: 'POST /prepare' },
    { method: 'post',   path: '/api/applications/draft-documents', label: 'POST /draft-documents' },
    { method: 'delete', path: '/api/applications/draft/draft-1',   label: 'DELETE /draft/:id' },
];

/**
 * Non-HEALTH roles per the V1-D RFC spec — admin, scheduler,
 * document_reviewer, auditor, account_dtam, account_platform, and the
 * legacy `account` role retained for backward compat. Each MUST get a
 * 403 with code: 'HEALTH_ROLE_REQUIRED' on every gated route.
 */
const NON_HEALTH_ROLES = [
    'admin',
    'scheduler',
    'document_reviewer',
    'auditor',
    'account_dtam',
    'account_platform',
    'account',
];

describe('V1-D D2 — HEALTH role gate on applicant-only routes', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Default happy-path resolver — only the HEALTH positive case
        // should ever reach this, but seed it so the test doesn't hang
        // on undefined promises if a 403 ever silently breaks.
        applicationService.resolveHealthIdentity.mockResolvedValue({
            userId: 'user-1',
            healthId: 'health-1',
        });
        applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
        applicationService.findLatestOpenDraftForHealth.mockResolvedValue({
            id: 'draft-1',
            applicationNumber: 'APP-2026-000001',
            status: 'DRAFT',
            formData: { steps: {} },
            workflowHistory: [],
        });
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue(null);
        applicationService.updateApplicantDraftColumns.mockResolvedValue({
            id: 'draft-1',
            applicationNumber: 'APP-2026-000001',
            status: 'DRAFT',
            formData: { steps: {} },
            workflowHistory: [],
        });
        applicationService.findDraftForSubmit.mockResolvedValue({
            id: 'draft-1',
            applicationNumber: 'APP-2026-000001',
            status: 'DRAFT',
            formData: { steps: {} },
            workflowHistory: [],
        });
        applicationService.getApplicationSlice.mockResolvedValue({
            id: 'draft-1',
            applicationNumber: 'APP-2026-000001',
            status: 'PENDING_DOC_FEE',
        });
        applicationService.deleteDraft.mockResolvedValue({ id: 'draft-1' });
    });

    describe.each(GATED_ROUTES)('$label', ({ method, path }) => {
        test.each(NON_HEALTH_ROLES)('%s role gets 403 HEALTH_ROLE_REQUIRED', async (role) => {
            const response = await request(app)[method](path)
                .set('x-test-role', role)
                .send({});

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                success: false,
                code: 'HEALTH_ROLE_REQUIRED',
            });
            // The service layer must NOT be touched on a 403 — the gate
            // runs before any work, otherwise a provider request still
            // performs the side-effect even though the response says 403.
            expect(applicationService.resolveHealthIdentity).not.toHaveBeenCalled();
            expect(applicationService.deleteDraft).not.toHaveBeenCalled();
            expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
        });
    });

    describe('positive cases — HEALTH role is allowed through', () => {
        test.each(GATED_ROUTES)('$label permits role=health', async ({ method, path }) => {
            const response = await request(app)[method](path)
                .set('x-test-role', 'health')
                .set('x-test-health-id', 'health-1')
                .send({});

            // Any non-403 / non-401 result proves the gate let the
            // request through to the handler. The handler may then 200,
            // 404, 422 depending on the mocked downstream state — we
            // assert only that the RBAC gate did NOT intercept.
            expect(response.status).not.toBe(403);
            expect(response.status).not.toBe(401);
            // Specifically: the rejected-body shape must NOT appear.
            expect(response.body).not.toMatchObject({ code: 'HEALTH_ROLE_REQUIRED' });
        });
    });

    describe('anonymous (no token) — auth middleware rejects before the role gate', () => {
        test.each(GATED_ROUTES)('$label returns 401 without a token', async ({ method, path }) => {
            const response = await request(app)[method](path).send({});
            expect(response.status).toBe(401);
            // Role gate never runs, so the body must be the auth-layer
            // shape, not the RBAC code.
            expect(response.body).not.toMatchObject({ code: 'HEALTH_ROLE_REQUIRED' });
        });
    });
});
