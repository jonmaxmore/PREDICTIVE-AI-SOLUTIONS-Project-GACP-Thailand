'use strict';

/**
 * Follow-up from the full-system audit (H-class, adversarial-verify SHOULD #2,
 * owner-approved 2026-07-07):
 *
 * Two ADMIN escape hatches flip application status with ZERO immutable
 * AuditLog emission — attribution lives only in logger.warn + the MUTABLE
 * formData.workflowHistory/adminOverrides:
 *   1. adminStatusOverride (routes/api/provider/handlers/admin.js) —
 *      POST .../admin/applications/:id/status-override
 *   2. adminApplicationService.revertLastTransition —
 *      POST /api/admin/applications/:id/revert-last-transition
 * All are admin-only and set autoIssueCertificate:false (no cert mint), but
 * a force to/from AUDIT_PASSED with no immutable trace is the same weakness
 * class Blocker H closed on the auditor path. Give them the identical
 * treatment: writeApplicationStatus inside a $transaction with
 * onAudit: statusTransitionAuditHook({ tx, ... }) so the transition row
 * commits atomically with the status write.
 *
 * FU-1c (adversarial-verify MUST, 2026-07-07): the THIRD escape hatch —
 * adminApplicationService.forceTransitionStatus, behind
 * POST /api/admin/applications/:id/force-status — could force
 * AUDIT_PASSED/APPROVED/CERTIFIED (ALLOWED_FORCE_STATUSES) with ZERO AuditLog
 * emission, while the route comment falsely claimed a "$transaction +
 * canonical writeApplicationStatus audit row". (The PATCH /:id/status sibling
 * in the same file is the only one that already did tx + logWithin.)
 *
 * RED (pre-fix): all three surfaces pass NO onAudit (and no tx) → tests fail.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const TX_MARKER = { __tx: true, auditLog: {} };
const HOOK_MARKER = jest.fn().mockResolvedValue({});
const mockStatusTransitionAuditHook = jest.fn(() => HOOK_MARKER);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(), logWithin: jest.fn() },
    AuditCategory: { ADMIN: 'ADMIN', APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { APPLICATION: 'APPLICATION' },
    statusTransitionAuditHook: (...a) => mockStatusTransitionAuditHook(...a),
}));

const mockWriteApplicationStatus = jest.fn().mockResolvedValue({});
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
}));

describe('FU-1a — adminStatusOverride emits an in-tx transition audit row', () => {
    let app;
    const mockFindSlice = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();

        jest.doMock('../../routes/api/provider/handlers/shared', () => ({
            prisma: { $transaction: jest.fn(async (cb) => cb(TX_MARKER)) },
            authenticateProvider: (req, _res, next) => {
                req.user = { id: 'admin-uuid-1', role: 'ADMIN', canonicalRole: 'admin', firstName: 'A', lastName: 'B' };
                next();
            },
            requireRole: () => (_req, _res, next) => next(),
            logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
            adminRoles: ['admin'],
            resolveUserIdFromHealthId: jest.fn(),
            obj: (x) => (x && typeof x === 'object' ? x : {}),
            arr: (x) => (Array.isArray(x) ? x : []),
        }));
        // Real WORKFLOW_STATES + real normalizeWorkflowStateInput: the revert
        // path resolves the historical fromStatus through the SSOT, and a stub
        // that trimmed the module down to a 5-element array made this suite
        // pass against a normalizer that did not exist.
        jest.doMock('../../services/workflow-transition-service', () => {
            const actual = jest.requireActual('../../services/workflow-transition-service');
            return {
                WORKFLOW_STATES: actual.WORKFLOW_STATES,
                normalizeWorkflowStateInput: actual.normalizeWorkflowStateInput,
                canTransition: actual.canTransition,
            };
        });
        jest.doMock('../../services/notification-service', () => ({ createNotification: jest.fn() }));
        jest.doMock('../../services/admin-application-service', () => ({
            findApplicationStatusOverrideSlice: (...a) => mockFindSlice(...a),
            listPendingRevisionDeadlines: jest.fn().mockResolvedValue([]),
        }));
        jest.doMock('../../services/assignment-ledger-service', () => ({ recordAssignment: jest.fn() }));
        jest.doMock('../../services/provider-user-service', () => ({}));

        mockFindSlice.mockResolvedValue({
            id: 'APP-OV-1',
            applicationNumber: 'GACP-2026-0100',
            status: 'CAR_PENDING',
            workflowHistory: [],
        });

        const { adminStatusOverride } = require('../../routes/api/provider/handlers/admin');
        app = express();
        app.use(express.json());
        app.post('/override/:applicationId', ...adminStatusOverride);
    });

    test('force-set status runs in a tx and wires statusTransitionAuditHook({tx}) as onAudit', async () => {
        const res = await request(app)
            .post('/override/APP-OV-1')
            .send({ applicationId: 'APP-OV-1', newStatus: 'AUDIT_PASSED', reason: 'เหตุผลการแก้ไขสถานะโดยผู้ดูแลระบบ' });

        expect(res.status).toBe(200);
        expect(mockWriteApplicationStatus).toHaveBeenCalledTimes(1);
        const call = mockWriteApplicationStatus.mock.calls[0][0];
        expect(call.toStatus).toBe('AUDIT_PASSED');
        expect(call.autoIssueCertificate).toBe(false); // SoD guard unchanged
        // THE FIX: in-tx + audit hook (was: root prisma, no onAudit).
        expect(call.prisma).toBe(TX_MARKER);
        expect(call.onAudit).toBe(HOOK_MARKER);
        expect(mockStatusTransitionAuditHook).toHaveBeenCalledWith(
            expect.objectContaining({ tx: TX_MARKER }),
        );
    });
});

describe('FU-1b — revertLastTransition emits an in-tx transition audit row', () => {
    let service;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        jest.doMock('../../services/prisma-database', () => ({
            prisma: {
                $transaction: jest.fn(async (cb) => cb(TX_MARKER)),
                application: {
                    findFirst: jest.fn().mockResolvedValue({
                        id: 'APP-RV-1',
                        applicationNumber: 'GACP-2026-0101',
                        status: 'AUDIT_PASSED',
                        formData: {},
                        workflowHistory: [
                            { timestamp: '2026-07-01T00:00:00Z', action: 'AUDIT_RESULT', fromStatus: 'AUDIT_CONFIRMED', toStatus: 'AUDIT_PASSED' },
                        ],
                    }),
                },
            },
        }));
        // FU-1a's doMock of admin-application-service persists across
        // resetModules — requireActual bypasses it for THIS module only
        // (its deps still resolve through the mock registry).
        service = jest.requireActual('../../services/admin-application-service');
    });

    test('revert runs in a tx and wires statusTransitionAuditHook({tx}) as onAudit', async () => {
        const result = await service.revertLastTransition({
            applicationId: 'APP-RV-1',
            reason: 'เหตุผลการย้อนสถานะโดยผู้ดูแลระบบ ยาวเกินขั้นต่ำแน่นอน',
            actorId: 'admin-uuid-1',
            actorRole: 'system_admin_dtam',
        });

        expect(result.previousStatus).toBe('AUDIT_PASSED');
        expect(mockWriteApplicationStatus).toHaveBeenCalledTimes(1);
        const call = mockWriteApplicationStatus.mock.calls[0][0];
        expect(call.toStatus).toBe('AUDIT_CONFIRMED');
        expect(call.autoIssueCertificate).toBe(false);
        // THE FIX: in-tx + audit hook.
        expect(call.prisma).toBe(TX_MARKER);
        expect(call.onAudit).toBe(HOOK_MARKER);
        expect(mockStatusTransitionAuditHook).toHaveBeenCalledWith(
            expect.objectContaining({ tx: TX_MARKER }),
        );
    });
});

describe('FU-1c — forceTransitionStatus emits an in-tx transition audit row', () => {
    let service;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        jest.doMock('../../services/prisma-database', () => ({
            prisma: {
                $transaction: jest.fn(async (cb) => cb(TX_MARKER)),
                application: {
                    findFirst: jest.fn().mockResolvedValue({
                        id: 'APP-FS-1',
                        applicationNumber: 'GACP-2026-0102',
                        status: 'AUDIT_CONFIRMED',
                        formData: {},
                        workflowHistory: [],
                    }),
                },
            },
        }));
        service = jest.requireActual('../../services/admin-application-service');
    });

    test('force-status (can land AUDIT_PASSED) runs in a tx and wires the audit hook', async () => {
        const result = await service.forceTransitionStatus({
            applicationId: 'APP-FS-1',
            toStatus: 'AUDIT_PASSED',
            reasonCode: 'DATA_CORRECTION',
            reason: 'เหตุผลการบังคับเปลี่ยนสถานะโดยผู้ดูแลระบบ ยาวเกินขั้นต่ำแน่นอน',
            actorId: 'admin-uuid-1',
            actorRole: 'system_admin_dtam',
        });

        expect(result.nextStatus).toBe('AUDIT_PASSED');
        expect(mockWriteApplicationStatus).toHaveBeenCalledTimes(1);
        const call = mockWriteApplicationStatus.mock.calls[0][0];
        expect(call.toStatus).toBe('AUDIT_PASSED');
        expect(call.autoIssueCertificate).toBe(false); // SoD guard unchanged
        // THE FIX: in-tx + audit hook (was: bare client, ZERO AuditLog rows,
        // behind a route comment claiming otherwise).
        expect(call.prisma).toBe(TX_MARKER);
        expect(call.onAudit).toBe(HOOK_MARKER);
        expect(mockStatusTransitionAuditHook).toHaveBeenCalledWith(
            expect.objectContaining({ tx: TX_MARKER }),
        );
    });
});
