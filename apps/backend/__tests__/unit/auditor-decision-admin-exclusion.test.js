'use strict';

/**
 * Regression — AUDIT-001 / #539 EXTENDED (2026-06-24 multi-role system test).
 *
 * The PRIMARY auditor decision surface
 *   POST /api/provider/auditor/applications/:id/audit-decisions
 * previously gated only on the APPLICATION_AUDIT_RECORD permission (which ADMIN
 * holds via the all-permissions set) plus an ADMIN ownership-bypass, so an ADMIN
 * could record PASS and auto-issue a certificate — contradicting the AUDIT-001
 * decision ("admin is not in the audit decision path") that #539 enforced on the
 * two sibling surfaces (/audits/:id/result, /onsite/:auditId/decision).
 *
 * This pins the fix: the surface now applies requireRole(ROLE_GROUPS.AUDITORS)
 * (admin REMOVED) and the ownership check is unconditional. requireRole + the
 * canonical RBAC policy are REAL so this proves the canonical contract, mirroring
 * audit-onsite-rbac.test.js.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

// Header-auth shim for authenticateProvider; requireRole stays REAL (imported
// directly from auth-middleware by the handler) so the AUDITORS gate fires.
const headerUser = (req, res, next) => {
    const role = req.headers['x-test-role'];
    if (!role || role === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = {
        id: req.headers['x-test-user-id'] || 'user-1',
        role,
        canonicalRole: req.headers['x-test-canonical-role'] || role,
        organizationId: 'org-1',
    };
    return next();
};

const mockFindAuditDecisionApplication = jest.fn();

// Mock the handler's dependency barrel: authenticateProvider (header shim) +
// requireCanonicalPermission (passthrough) + the names the handler destructures.
// requireRole is NOT here — the handler imports it directly from auth-middleware
// (left real), which is the gate under test.
jest.mock('../../routes/api/provider/handlers/auditor-handler-deps', () => {
    const rbac = jest.requireActual('../../shared/canonical-rbac');
    return {
        authenticateProvider: headerUser,
        requireCanonicalPermission: () => (_req, _res, next) => next(),
        PERMISSIONS: rbac.PERMISSIONS,
        logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
        obj: (x) => (x && typeof x === 'object' ? x : {}),
        arr: (x) => (Array.isArray(x) ? x : []),
        prisma: {},
        workflowTransitionService: { resolveStateFromApplication: () => 'AUDIT_CONFIRMED' },
        getRequestIp: () => '127.0.0.1',
        auditLogger: { log: jest.fn() },
        AuditCategory: {},
        AuditSeverity: {},
        ResourceType: {},
        resolveUserIdFromHealthId: jest.fn().mockResolvedValue('health-user-1'),
        applicationService: { findAuditDecisionApplication: (...a) => mockFindAuditDecisionApplication(...a) },
    };
});

// Heavy side-effect deps the handler requires at module load — stub so requiring
// the handler never reaches a real DB/PKI path (admin is rejected at the gate
// long before these run, but the require() must not blow up).
jest.mock('../../services/application-status-writer', () => ({ writeApplicationStatus: jest.fn() }));
jest.mock('../../services/notification-service', () => ({ createNotification: jest.fn() }));
jest.mock('../../services/car-deadline-service', () => ({ computeCarDueDate: jest.fn(), seedCarRevisionDeadline: jest.fn() }));
jest.mock('../../utils/field-encryption', () => ({ maskThaiId: (x) => x }));

const { auditorAuditDecisions } = require('../../routes/api/provider/handlers/auditor-audit-decision-handler');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.post('/api/provider/auditor/applications/:id/audit-decisions', ...auditorAuditDecisions);
    return app;
}

describe('AUDIT-001/#539 — primary auditor decision surface excludes ADMIN', () => {
    let app;
    beforeAll(() => { app = buildApp(); });
    beforeEach(() => {
        jest.clearAllMocks();
        // Seed an application owned by 'auditor-1' (so ownership is exercised too).
        mockFindAuditDecisionApplication.mockResolvedValue({
            id: 'app-1', auditorId: 'auditor-1', healthId: 'health-1', formData: {},
        });
    });

    // Roles that must be REJECTED at the AUDITORS gate (admin REMOVED per AUDIT-001).
    test.each(['admin', 'document_reviewer', 'scheduler', 'account_dtam', 'account_platform', 'health'])(
        '%s is rejected with 403 (not in ROLE_GROUPS.AUDITORS)',
        async (role) => {
            const res = await request(app)
                .post('/api/provider/auditor/applications/app-1/audit-decisions')
                .set('x-test-role', role)
                .send({ decision: 'PASS' });
            expect(res.status).toBe(403);
            // The decision must never have been recorded.
            expect(mockFindAuditDecisionApplication).not.toHaveBeenCalled();
        },
    );

    test('the assigned AUDITOR passes the gate (not 403)', async () => {
        const res = await request(app)
            .post('/api/provider/auditor/applications/app-1/audit-decisions')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'auditor-1')
            .send({ decision: 'PASS' });
        expect(res.status).not.toBe(403);
        expect(res.status).not.toBe(401);
    });

    test('an AUDITOR who does NOT own the audit gets 403 (unconditional ownership)', async () => {
        const res = await request(app)
            .post('/api/provider/auditor/applications/app-1/audit-decisions')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'auditor-2')
            .send({ decision: 'PASS' });
        expect(res.status).toBe(403);
    });
});
