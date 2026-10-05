/**
 * X1-FIX-A / C-5 RBAC regression — `GET /api/applications/` (system-wide
 * provider branch) MUST require a canonical provider role.
 *
 * Why this test exists:
 *   - Pre-X1, the listing handler at
 *     `apps/backend/routes/api/applications/application-listing-handlers.js`
 *     branched on the presence of `req.user.healthId`. The HEALTH branch
 *     is correctly scoped to self (line 47); the provider branch (lines
 *     38-45) unconditionally returned the first 100 applications system-
 *     wide with `viewType: 'provider'`. Any authenticated token whose
 *     canonical role failed to populate `healthId` (e.g. a leaked
 *     non-canonical token, or a HEALTH JWT that lost its healthId claim
 *     mid-session) walked away with the cross-tenant view.
 *   - X1-D §4 H-2 flagged this as a MED provider-side hole.
 *   - The fix layers an explicit allow-list check on top of the existing
 *     branch: canonical role MUST be in {ADMIN, DOCUMENT_REVIEWER,
 *     AUDITOR, SCHEDULER, ACCOUNT_DTAM, ACCOUNT_PLATFORM, ACCOUNT}.
 *     HEALTH is blocked by definition (HEALTH is not a provider role per
 *     canonical-rbac.js PROVIDER_CANONICAL_ROLES).
 *
 * This file locks the post-fix invariant. It deliberately exercises both
 * negative cases — HEALTH-without-healthId (the exact bug shape) and
 * unknown-role-without-healthId (the leaked-token shape) — plus positive
 * cases for the five non-admin provider roles.
 *
 * Pattern mirrors `applications-route-rbac.test.js`: stub the auth
 * middleware to attach req.user from headers, mock the service + prisma
 * layer to return deterministic rows, assert per-role status.
 *
 * See: docs/handoffs/iter-X1/X1-D.md §4 H-2.
 */

const express = require('express');
const request = require('supertest');

// ── Mocks ────────────────────────────────────────────────────────────────

jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'user-1',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            // The bug shape under test: req.user has NO healthId for the
            // non-HEALTH cases. We let the test set healthId via header
            // for the positive HEALTH case.
            healthId: req.headers['x-test-health-id'] || null,
            providerId: req.headers['x-test-provider-id'] || null,
        };
        return next();
    };
    return {
        authenticateAny: buildHeaderUser,
        authenticateHealth: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
    };
});

// applicationService is only hit by the HEALTH branch (which we don't
// exercise for the C-5 negative tests). Stubbed so the import resolves.
jest.mock('../../services/application-service', () => ({
    getHealthApplications: jest.fn(async () => []),
    resolveHealthIdentity: jest.fn(async () => ({ healthId: 'health-1' })),
}));

jest.mock('../../services/working-days-service', () => ({
    addWorkingDays: jest.fn(),
    loadHolidaySet: jest.fn(async () => new Set()),
}));

jest.mock('../../services/fee-service', () => ({
    calculatePhase1Fee: jest.fn(() => ({})),
    calculatePhase2Fee: jest.fn(() => ({})),
}));

// prisma is reached by the provider-branch findMany. The mock returns a
// deterministic row count so we can prove positive cases reached the
// query (and negative cases did NOT).
const mockFindMany = jest.fn(async () => [
    { id: 'app-1', formData: {}, status: 'DRAFT', certificates: [] },
]);
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findMany: (...a) => mockFindMany(...a) },
    },
}));

jest.mock('../../shared/logger', () => {
    const m = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...m, createLogger: jest.fn(() => m) };
});

// The two payload-builders are pure helpers; let the real module load.

const listingRouter = require('../../routes/api/applications/application-listing-handlers');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', listingRouter);
    return app;
}

describe('[X1-FIX-A / C-5] GET /api/applications — provider-branch RBAC', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('HEALTH role with NO healthId is rejected with 403 (closes X1-D H-2)', async () => {
        // This is the exact bug shape — a HEALTH token that fell through
        // to the provider branch because its healthId claim was missing
        // / cleared mid-session. Pre-X1 returned the first 100 apps; the
        // fix MUST gate on canonical role and return 403.
        const response = await request(app)
            .get('/api/applications')
            .set('x-test-role', 'health')
            // Deliberately NO x-test-health-id — req.user.healthId === null.
            .send();
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            error: 'Forbidden',
        });
        // The unfiltered findMany must NOT have been called — otherwise
        // we executed the cross-tenant query and only the status code
        // looks innocent (silent privilege escalation surface).
        expect(mockFindMany).not.toHaveBeenCalled();
    });

    test('unknown role (leaked / malformed token) returns 403', async () => {
        const response = await request(app)
            .get('/api/applications')
            .set('x-test-role', 'definitely-not-a-real-role')
            .send();
        expect(response.status).toBe(403);
        expect(mockFindMany).not.toHaveBeenCalled();
    });

    test.each([
        ['system_admin_dtam'],
        ['document_reviewer'],
        ['dispatcher'],
        ['field_inspector'],
        ['finance_officer_dtam'],
        ['finance_officer_platform'],
        // Per Phase D+E review: include the legacy `account` role too. It is
        // present in both PROVIDER_LISTING_ROLES (handler line 57) and
        // PROVIDER_CANONICAL_ROLES (canonical-rbac.js line 228). Without this
        // row a future refactor could silently drop the legacy role from the
        // allow-list and the suite would not catch it.
        ['finance_officer_platform'],
    ])('provider role %s reaches the system-wide listing', async (role) => {
        const response = await request(app)
            .get('/api/applications')
            .set('x-test-role', role)
            .send();
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.viewType).toBe('provider');
        expect(mockFindMany).toHaveBeenCalledTimes(1);
    });
});
