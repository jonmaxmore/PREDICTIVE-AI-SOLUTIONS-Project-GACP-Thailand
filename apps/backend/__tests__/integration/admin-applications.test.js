const request = require('supertest');
const express = require('express');

// The admin override route now runs inside a `prisma.$transaction(async (tx) => ...)`
// with SERIALIZABLE isolation so the status mutation + audit insert commit/abort
// atomically. The mock therefore needs:
//   - a $transaction(callback, opts) that invokes the callback with a `tx`
//     handle exposing the same prisma surface used inside the route
//     (application.update, application.findUnique, and auditLog.create via
//     auditLogger.logWithin).
//   - per-test stubs on the SAME tx object so we can assert what each mock
//     was called with, and trigger conflict-retry scenarios.
const mockTx = {
  application: {
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  auditLog: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  // workActivity is referenced by application-status-writer but is optional;
  // omitting workActivity makes the writer skip the activity-emission branch.
};

jest.mock('../../services/prisma-database', () => ({
  prisma: {
    application: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (cb, _opts) => cb(mockTx)),
  },
}));

// A0 / PR-A0-2: the override hop now writes TWO audit rows inside its tx —
// the canonical APPLICATION / APPLICATION_STATUS_TRANSITION row (built by
// `statusTransitionAuditHook`) and the pre-existing ADMIN /
// APPLICATION_STATUS_OVERRIDE row. Both go through `logWithin`, so the mock
// mirrors the real factory (middleware/audit-logger.js:834-850) and routes the
// hook through the SAME `logWithin` jest.fn the retry cases drive. Without
// that, `statusTransitionAuditHook` would be undefined here and every override
// case would 500 on a TypeError rather than exercising the route.
jest.mock('../../middleware/audit-logger', () => {
  const logWithin = jest.fn().mockResolvedValue({ id: 'audit-mock' });
  return {
    auditLogger: {
      log: jest.fn().mockResolvedValue(null),
      logWithin,
    },
    AuditCategory: {
      ADMIN: 'ADMIN',
      APPLICATION: 'APPLICATION',
    },
    AuditSeverity: {
      INFO: 'INFO',
      WARNING: 'WARNING',
    },
    ResourceType: {
      APPLICATION: 'APPLICATION',
    },
    statusTransitionAuditHook: ({ tx, metadata = {} } = {}) => (entry) => logWithin({
      category: 'APPLICATION',
      action: entry?.event || 'APPLICATION_STATUS_TRANSITION',
      severity: 'INFO',
      actorId: entry?.actorId || 'SYSTEM',
      actorRole: entry?.actorRole || 'UNKNOWN',
      resourceType: 'APPLICATION',
      resourceId: entry?.applicationId,
      metadata: {
        fromStatus: entry?.fromStatus ?? null,
        toStatus: entry?.toStatus ?? null,
        reason: entry?.reason ?? null,
        ...metadata,
      },
    }, tx),
  };
});

jest.mock('../../shared/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { prisma } = require('../../services/prisma-database');
const { auditLogger } = require('../../middleware/audit-logger');
const adminApplicationsRouter = require('../../routes/api/admin/applications');

describe('Admin Application Override API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = {
        id: req.headers['x-test-user-id'] || 'admin-1',
        role: req.headers['x-test-role'] || 'system_admin_dtam',
      };
      next();
    });
    app.use('/api/admin/applications', adminApplicationsRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 403 for non-admin role', async () => {
    const response = await request(app)
      .patch('/api/admin/applications/app-1/status')
      .set('x-test-role', 'document_reviewer')
      .send({ status: 'APPROVED', reason: 'Manual override' });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it('returns 400 when reason is too short', async () => {
    const response = await request(app)
      .patch('/api/admin/applications/app-1/status')
      .send({ status: 'APPROVED', reasonCode: 'DATA_CORRECTION', comment: 'bad' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/comment is required/i);
  });

  it('returns 404 when application does not exist', async () => {
    prisma.application.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .patch('/api/admin/applications/app-404/status')
      .send({
        status: 'APPROVED',
        reasonCode: 'DATA_CORRECTION',
        comment: 'Data correction from QA review',
      });

    expect(response.status).toBe(404);
    expect(prisma.application.findFirst).toHaveBeenCalledTimes(1);
  });

  it('updates status and writes audit event for admin override', async () => {
    prisma.application.findFirst.mockResolvedValue({
      id: 'app-1',
      applicationNumber: 'APP-2026-000001',
      status: 'AUDIT_PASSED',
      formData: { applicantType: 'INDIVIDUAL' },
      workflowHistory: [],
    });
    mockTx.application.update.mockResolvedValue({
      id: 'app-1',
      applicationNumber: 'APP-2026-000001',
      status: 'APPROVED',
      updatedAt: new Date().toISOString(),
    });
    mockTx.application.findUnique.mockResolvedValue({
      id: 'app-1',
      applicationNumber: 'APP-2026-000001',
      status: 'APPROVED',
      updatedAt: new Date().toISOString(),
    });

    const response = await request(app)
      .patch('/api/admin/applications/app-1/status')
      .send({
        status: 'APPROVED',
        reasonCode: 'MANUAL_REVIEW_EXCEPTION',
        comment: 'Committee confirmed corrective evidence',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Everything must run INSIDE one $transaction with Serializable isolation.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual(
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );

    expect(mockTx.application.update).toHaveBeenCalledTimes(1);
    const updateInput = mockTx.application.update.mock.calls[0][0];
    expect(updateInput.data.status).toBe('APPROVED');
    expect(Array.isArray(updateInput.data.workflowHistory)).toBe(true);
    expect(updateInput.data.workflowHistory[0].action).toBe('ADMIN_STATUS_OVERRIDE');
    expect(updateInput.data.formData.adminOverrides[0].reasonCode).toBe('MANUAL_REVIEW_EXCEPTION');
    expect(updateInput.data.formData.adminOverrides[0].comment).toContain('Committee');

    // The audit inserts must go through logWithin (not log) so they participate
    // in the same tx as the status mutation.
    // A0 / PR-A0-2: TWO rows now — the canonical transition row first, then the
    // administrative-act row. Both bound to the same tx handle.
    expect(auditLogger.logWithin).toHaveBeenCalledTimes(2);
    expect(auditLogger.log).not.toHaveBeenCalled();

    const [canonicalEvent, canonicalTx] = auditLogger.logWithin.mock.calls[0];
    expect(canonicalEvent.category).toBe('APPLICATION');
    expect(canonicalEvent.action).toBe('APPLICATION_STATUS_TRANSITION');
    expect(canonicalEvent.resourceId).toBe('app-1');
    expect(canonicalEvent.metadata).toMatchObject({
      fromStatus: 'AUDIT_PASSED',
      toStatus: 'APPROVED',
    });
    expect(canonicalTx).toBe(mockTx);

    const [auditEvent, txArg] = auditLogger.logWithin.mock.calls[1];
    expect(auditEvent.action).toBe('APPLICATION_STATUS_OVERRIDE');
    // Issue C fix: admin override is tagged actorType: 'ADMIN' (หมวดของ audit log — คนละชุดกับบทบาท), not 'PROVIDER'.
    expect(auditEvent.actorType).toBe('ADMIN');
    // The tx handle passed to logWithin is the same one used for the status update.
    expect(txArg).toBe(mockTx);
  });

  it('retries the whole transaction on P2002 audit-chain conflict and succeeds', async () => {
    prisma.application.findFirst.mockResolvedValue({
      id: 'app-2',
      applicationNumber: 'APP-2026-000002',
      status: 'AUDIT_PASSED',
      formData: {},
      workflowHistory: [],
    });
    mockTx.application.update.mockResolvedValue({
      id: 'app-2',
      applicationNumber: 'APP-2026-000002',
      status: 'APPROVED',
      updatedAt: new Date().toISOString(),
    });
    mockTx.application.findUnique.mockResolvedValue({
      id: 'app-2',
      applicationNumber: 'APP-2026-000002',
      status: 'APPROVED',
      updatedAt: new Date().toISOString(),
    });

    const p2002 = Object.assign(
      new Error('Unique constraint failed on the fields: (`sequenceNumber`)'),
      { code: 'P2002', meta: { target: ['sequenceNumber'] } },
    );

    auditLogger.logWithin
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({ id: 'audit-retry' });

    const response = await request(app)
      .patch('/api/admin/applications/app-2/status')
      .send({
        status: 'APPROVED',
        reasonCode: 'DATA_CORRECTION',
        comment: 'Retry path after P2002',
      });

    expect(response.status).toBe(200);
    // Two $transaction attempts: first rolls back on P2002, second commits.
    // Each attempt opens its own tx — the rolled-back loser leaves no partial
    // row behind (no duplicate audit rows).
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    // A0 / PR-A0-2: attempt 1 dies on its FIRST row (the canonical one — the
    // conflict is raised there now), attempt 2 writes both. 1 + 2 = 3.
    // This is the property that made `onAudit: false` the right migration: a
    // sequence conflict on the canonical row is visible to the retry loop
    // instead of being swallowed by the writer's fail-open default emitter.
    expect(auditLogger.logWithin).toHaveBeenCalledTimes(3);
  });

  it('returns 500 when transaction retries are exhausted', async () => {
    prisma.application.findFirst.mockResolvedValue({
      id: 'app-3',
      applicationNumber: 'APP-2026-000003',
      status: 'AUDIT_PASSED',
      formData: {},
      workflowHistory: [],
    });
    mockTx.application.update.mockResolvedValue({
      id: 'app-3',
      applicationNumber: 'APP-2026-000003',
      status: 'APPROVED',
      updatedAt: new Date().toISOString(),
    });
    mockTx.application.findUnique.mockResolvedValue({
      id: 'app-3',
      applicationNumber: 'APP-2026-000003',
      status: 'APPROVED',
      updatedAt: new Date().toISOString(),
    });

    const p2002 = Object.assign(
      new Error('Unique constraint failed on the fields: (`sequenceNumber`)'),
      { code: 'P2002', meta: { target: ['sequenceNumber'] } },
    );
    auditLogger.logWithin.mockRejectedValue(p2002);

    const response = await request(app)
      .patch('/api/admin/applications/app-3/status')
      .send({
        status: 'APPROVED',
        reasonCode: 'DATA_CORRECTION',
        comment: 'Retry exhaustion path',
      });

    expect(response.status).toBe(500);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});
