'use strict';

/**
 * Bundle B / P1 (multi-role system test 2026-06-24) — the legacy admin
 * status-override path must NOT auto-issue a certificate. An admin force-setting
 * AUDIT_PASSED here previously omitted autoIssueCertificate:false, so the writer's
 * cert hook minted a cert — a back-door that bypasses the single-auditor SoD
 * (AUDIT-001). This pins autoIssueCertificate:false (matching the force-status +
 * PATCH /admin/applications/:id/status siblings).
 */

const express = require('express');
const request = require('supertest');

const mockWriteApplicationStatus = jest.fn().mockResolvedValue({ id: 'app-1', status: 'AUDIT_PASSED', formData: {} });
const mockFindSlice = jest.fn();

jest.mock('../../routes/api/provider/handlers/shared', () => ({
    // FU-1 (2026-07-07): the override now runs inside prisma.$transaction with
    // an in-tx audit hook — the mock must provide the tx entry point.
    prisma: { $transaction: async (cb) => cb({ __tx: true }) },
    authenticateProvider: (req, _res, next) => {
        req.user = { id: 'admin-1', role: 'admin', canonicalRole: 'admin', organizationId: 'org-1' };
        next();
    },
    requireRole: () => (_req, _res, next) => next(),
    logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    adminRoles: ['admin'],
    resolveUserIdFromHealthId: jest.fn().mockResolvedValue('health-1'),
    obj: (x) => (x && typeof x === 'object' ? x : {}),
    arr: (x) => (Array.isArray(x) ? x : []),
}));
jest.mock('../../services/application-status-writer', () => ({ writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a) }));
jest.mock('../../services/workflow-transition-service', () => ({ WORKFLOW_STATES: ['DRAFT', 'SUBMITTED', 'AUDIT_CONFIRMED', 'AUDIT_PASSED', 'CERTIFIED', 'REJECTED'] }));
jest.mock('../../services/notification-service', () => ({ createNotification: jest.fn().mockResolvedValue({ id: 'n1' }) }));
jest.mock('../../services/admin-application-service', () => ({ findApplicationStatusOverrideSlice: (...a) => mockFindSlice(...a) }));
jest.mock('../../services/assignment-ledger-service', () => ({ recordAssignment: jest.fn() }));
jest.mock('../../services/provider-user-service', () => ({}));
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

const { adminStatusOverride } = require('../../routes/api/provider/handlers/admin');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.post('/override', ...adminStatusOverride);
    return app;
}

describe('admin status-override does NOT auto-issue a certificate', () => {
    let app;
    beforeAll(() => { app = buildApp(); });
    beforeEach(() => {
        jest.clearAllMocks();
        mockWriteApplicationStatus.mockResolvedValue({ id: 'app-1', status: 'AUDIT_PASSED', formData: {} });
        mockFindSlice.mockResolvedValue({ status: 'AUDIT_CONFIRMED', workflowHistory: [] });
    });

    test('force-setting AUDIT_PASSED passes autoIssueCertificate:false to the writer', async () => {
        await request(app).post('/override').send({ applicationId: 'app-1', newStatus: 'AUDIT_PASSED', reason: 'admin emergency override' });
        expect(mockWriteApplicationStatus).toHaveBeenCalledTimes(1);
        expect(mockWriteApplicationStatus).toHaveBeenCalledWith(
            expect.objectContaining({ toStatus: 'AUDIT_PASSED', autoIssueCertificate: false }),
        );
    });
});
