'use strict';

/**
 * Blocker H (full-system audit 2026-07-07, area H — BROKEN):
 *
 * POST /api/audits/:id/result — the S6 field-audit decision that flips the
 * application to AUDIT_PASSED (auto-issuing a government GACP certificate via
 * the writer's cert hook) or CAR_PENDING (starting the applicant's 5-working-
 * day corrective clock) — wrote ZERO rows to the immutable AuditLog hash
 * chain: audits.js passed no `onAudit` into writeApplicationStatus and the
 * route is not under any blanket audit middleware. Attribution survived only
 * in mutable Application.updatedBy/formData.
 *
 * Fix: pass `onAudit: statusTransitionAuditHook({ tx, ... })` into the
 * writeApplicationStatus call — the exact pattern of the working onsite twin
 * (services/audit-onsite-service.js:866, WF-F8) — so the transition row
 * commits atomically with the status UPDATE.
 *
 * This spec pins the WIRING: the route must hand the writer an onAudit
 * callback built by the real statusTransitionAuditHook factory with the SAME
 * tx handle the status write uses. The hook's own behaviour (logWithin →
 * hash-chain row, PII masking, best-effort swallow) is already pinned by
 * audit-logger.test.js / audit-hash-chain-widen.test.js / the onsite twin
 * specs — mocking the factory here is wiring-scope, not behaviour-scope.
 *
 * RED (pre-fix): writeApplicationStatus receives NO onAudit (undefined) on
 * both the PASS and FAIL paths → both tests fail.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

// Transaction handle marker — the route runs writeApplicationStatus inside
// prisma.$transaction; the audit hook MUST be built with this same handle so
// the AuditLog row commits atomically with the status flip.
const TX_MARKER = { __tx: true, auditLog: {} };

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        $transaction: jest.fn(async (cb) => cb(TX_MARKER)),
    },
}));

// Auth shim: authenticateProvider injects an AUDITOR; requireRole passthrough
// (the RBAC gate itself is pinned by auditor-decision-admin-exclusion.test.js).
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => {
        req.user = {
            id: 'auditor-1',
            role: 'AUDITOR',
            canonicalRole: 'auditor',
            organizationId: 'org-1',
        };
        next();
    },
    requireRole: () => (_req, _res, next) => next(),
}));

const mockSendNotification = jest.fn().mockResolvedValue({});
jest.mock('../../services/notification-service', () => ({
    sendNotification: (...a) => mockSendNotification(...a),
    NotifyType: { APPLICATION_APPROVED: 'APPLICATION_APPROVED', REVISION_REQUESTED: 'REVISION_REQUESTED' },
}));

jest.mock('../../services/workflow-transition-service', () => ({
    buildTransitionUpdate: jest.fn(),
}));

jest.mock('../../services/farm-service', () => ({
    updateFarmFromAudit: jest.fn().mockResolvedValue({}),
}));

const mockFindAuditApplication = jest.fn();
const mockGetById = jest.fn();
jest.mock('../../services/application-service', () => ({
    findAuditApplication: (...a) => mockFindAuditApplication(...a),
    getById: (...a) => mockGetById(...a),
}));

const mockWriteApplicationStatus = jest.fn().mockResolvedValue({});
// The inspector's PASS now asks the onsite-evidence gate before the write (Batch A item 2);
// this suite is about what happens AFTER the evidence is accepted, and the gate has its own
// suites (onsite-evidence-gate, approver-sees-the-file-pass-doors).
jest.mock('../../services/onsite-evidence-gate', () => ({
    assertOnsiteEvidenceSufficient: jest.fn().mockResolvedValue({}),
    assertOnsiteEvidenceForPass: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
}));

jest.mock('../../shared/application-visibility', () => ({
    withVisibility: (where) => where,
}));

jest.mock('../../services/car-deadline-service', () => ({
    computeCarDueDate: jest.fn(() => new Date('2026-07-15T09:00:00.000Z')),
    seedCarRevisionDeadline: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: jest.fn().mockResolvedValue(null),
}));

// The real hook factory returns a closure; we mock the FACTORY to a marker so
// the spec can assert (a) the route passes ITS product as onAudit and (b) the
// factory got the same tx handle the status write runs in.
const HOOK_MARKER = jest.fn().mockResolvedValue({});
const mockStatusTransitionAuditHook = jest.fn(() => HOOK_MARKER);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(), logWithin: jest.fn() },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO' },
    ResourceType: { APPLICATION: 'APPLICATION' },
    statusTransitionAuditHook: (...a) => mockStatusTransitionAuditHook(...a),
}));

function buildApp() {
    const app = express();
    app.use(express.json());
    // Route file mounts its own router.use(authenticateProvider, requireRole(...)).
    app.use('/audits', require('../../routes/api/audit/audits'));
    return app;
}

const BASE_APPLICATION = {
    id: 'APP-1',
    status: 'AUDIT_CONFIRMED',
    applicationNumber: 'GACP-2026-0001',
    formData: {},
    applicant: { id: 'health-user-1', healthId: 'tok-1' },
};

describe('Blocker H — POST /audits/:id/result writes an immutable transition audit row', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFindAuditApplication.mockResolvedValue({ ...BASE_APPLICATION });
        mockGetById.mockResolvedValue({ ...BASE_APPLICATION });
        app = buildApp();
    });

    test('PASS (→AUDIT_PASSED, cert-minting) wires statusTransitionAuditHook({tx}) as onAudit', async () => {
        const res = await request(app)
            .post('/audits/APP-1/result')
            .send({ result: 'PASS', notes: 'ผ่านการตรวจประเมิน' });

        expect(res.status).toBe(200);
        expect(mockWriteApplicationStatus).toHaveBeenCalledTimes(1);
        const call = mockWriteApplicationStatus.mock.calls[0][0];
        expect(call.toStatus).toBe('AUDIT_PASSED');
        expect(call.assertTransition).toBe(true);
        // THE BLOCKER: the cert-minting transition must carry the audit hook.
        expect(call.onAudit).toBe(HOOK_MARKER);
        // The hook must be built with the SAME tx handle the write runs in
        // (atomic commit) — not the root client, not a fresh one.
        expect(mockStatusTransitionAuditHook).toHaveBeenCalledWith(
            expect.objectContaining({ tx: TX_MARKER }),
        );
        expect(call.prisma).toBe(TX_MARKER);
    });

    test('FAIL (→CAR_PENDING, starts the 5-day CAR clock) wires the same audit hook', async () => {
        const res = await request(app)
            .post('/audits/APP-1/result')
            .send({ result: 'FAIL', notes: 'พบข้อบกพร่อง ต้องแก้ไขแปลงปลูก' });

        expect(res.status).toBe(200);
        expect(mockWriteApplicationStatus).toHaveBeenCalledTimes(1);
        const call = mockWriteApplicationStatus.mock.calls[0][0];
        expect(call.toStatus).toBe('CAR_PENDING');
        expect(call.onAudit).toBe(HOOK_MARKER);
        expect(mockStatusTransitionAuditHook).toHaveBeenCalledWith(
            expect.objectContaining({ tx: TX_MARKER }),
        );
    });

    test('writer 4xx faults keep their own HTTP status — EXPIRED-exit fence → 409 WAIVER_REOPEN_REQUIRED, not 500', async () => {
        // Carpet-bomb debug 2026-07-08 (cb-workflow SHOULD): the writer's
        // EXPIRED-exit fence throws {statusCode:409, code:'WAIVER_REOPEN_REQUIRED'}
        // BEFORE assertTransition, so it never matches the /illegal transition/
        // 422 branch — the catch fell through to a hardcoded 500 with a
        // misleading "please retry" message, falsely tripping 5xx monitoring.
        mockFindAuditApplication.mockResolvedValue({ ...BASE_APPLICATION, status: 'EXPIRED' });
        mockWriteApplicationStatus.mockRejectedValueOnce(Object.assign(
            new Error('Reopening an EXPIRED application requires the waiver-reopen flow or break-glass'),
            { code: 'WAIVER_REOPEN_REQUIRED', statusCode: 409, status: 409 },
        ));

        const res = await request(app)
            .post('/audits/APP-1/result')
            .send({ result: 'PASS', notes: 'ผ่านการตรวจประเมิน' });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('WAIVER_REOPEN_REQUIRED');
        expect(res.body.success).toBe(false);
    });
});
