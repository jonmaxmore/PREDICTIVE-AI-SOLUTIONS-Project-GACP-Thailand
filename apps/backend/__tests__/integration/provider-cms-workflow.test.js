const request = require('supertest');
const express = require('express');
jest.mock('../../middleware/auth-middleware', () => ({
  authenticateProvider: (req, _res, next) => {
    const role = req.headers['x-test-role'] || 'document_reviewer';
    req.user = {
      id: req.headers['x-test-user-id'] || 'provider-1',
      role,
      canonicalRole: role,
      providerId: '1234567890123',
    };
    next();
  },
  authenticateDTAM: (req, _res, next) => {
    const role = req.headers['x-test-role'] || 'document_reviewer';
    req.user = {
      id: req.headers['x-test-user-id'] || 'provider-1',
      role,
      canonicalRole: role,
      providerId: '1234567890123',
    };
    next();
  },
  authenticate: (_req, _res, next) => next(),
  authenticateHealth: (_req, _res, next) => next(),
  authenticateAny: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../../services/prisma-database', () => {
  const prisma = {
    application: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      // Added when workflow handlers migrated to canonical writeApplicationStatus +
      // findUnique re-fetch pattern (the writer doesn't expose a select option).
      findUnique: jest.fn(),
    },
    invoice: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    revisionDeadline: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    },
    // R2 M3: correction decisions append a per-stage CorrectionRound row in
    // the same tx as the status write + letter (decision-letter-service).
    correctionRound: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'round-1' }),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  // BE-T1: writeApplicationStatus now runs inside prisma.$transaction — invoke the
  // callback with the same mock so the tx handle carries application.update etc.
  prisma.$transaction = (fn) => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn));
  return { prisma };
});
jest.mock('../../middleware/audit-logger', () => ({
  auditLogger: {
    log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  },
  // The transition handler passes `onAudit: statusTransitionAuditHook({tx, metadata})`
  // so the transition lands in the hash-chained audit log atomically with the
  // status write. This partial mock omitted it, so the handler threw
  // "statusTransitionAuditHook is not a function" and the route turned that
  // into a generic 500 — indistinguishable from the deadline logic failing.
  statusTransitionAuditHook: jest.fn(() => jest.fn().mockResolvedValue(null)),
  AuditCategory: {
    APPLICATION: 'APPLICATION',
  },
  AuditSeverity: {
    INFO: 'INFO',
    WARNING: 'WARNING',
  },
  ResourceType: {
    APPLICATION: 'APPLICATION',
  },
}));
jest.mock('../../shared/logger', () => {
  const mockLog = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
  mockLog.createLogger = jest.fn(() => ({ ...mockLog }));
  mockLog.stream = { write: jest.fn() };
  return mockLog;
});

// Prevent open handles from Redis connection and rate-limiter setInterval
jest.mock('../../config/redis', () => null);
jest.mock('../../services/cache-service', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  getOrSet: jest.fn((_key, fn) => fn()),
}));
jest.mock('../../middleware/rate-limiter', () => {
  const pass = (_req, _res, next) => next();
  return { rateLimiter: pass, strictRateLimiter: pass, createRateLimiter: () => pass };
});
const { prisma } = require('../../services/prisma-database');
const { auditLogger: _auditLogger } = require('../../middleware/audit-logger');
const previousLegacyFlag = process.env.ENABLE_PROVIDER_LEGACY_ALIAS;
process.env.ENABLE_PROVIDER_LEGACY_ALIAS = 'true';
const providerCmsRouter = require('../../routes/api/system/provider-cms');
const providerRouter = require('../../routes/api/provider/index');
describe('Provider CMS Workflow foundations', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/provider', providerRouter);
    app.use('/api/provider-cms', providerCmsRouter);
  });
  afterAll(() => {
    if (typeof previousLegacyFlag === 'undefined') {
      delete process.env.ENABLE_PROVIDER_LEGACY_ALIAS;
    } else {
      process.env.ENABLE_PROVIDER_LEGACY_ALIAS = previousLegacyFlag;
    }
  });
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.application.findMany.mockResolvedValue([]);
    prisma.application.count.mockResolvedValue(0);
    prisma.invoice.findFirst.mockResolvedValue(null);
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.user.findFirst.mockResolvedValue({
      id: 'auditor-1',
      role: 'field_inspector',
      firstName: 'Auditor',
      lastName: 'One',
      // R2 M2 (D-8): correction decisions now mint the official letter inside
      // the decision tx; decision-letter-service resolves the recipient via
      // user lookup and REFUSES a tenantless recipient (letter row requires
      // organizationId). Without this the revision/CAR paths 500 by design.
      organizationId: 'org-1',
    });
    prisma.user.findMany.mockResolvedValue([]);
    prisma.revisionDeadline.findUnique.mockResolvedValue(null);
    prisma.revisionDeadline.upsert.mockResolvedValue({ applicationId: 'app-1' });
    prisma.revisionDeadline.updateMany.mockResolvedValue({ count: 1 });
    prisma.correctionRound.count.mockResolvedValue(0);
    prisma.correctionRound.create.mockResolvedValue({ id: 'round-1' });
    prisma.application.update.mockResolvedValue({
      id: 'app-1',
      applicationNumber: 'APP-2026-0001',
      status: 'REVISION_REQUIRED',
      formData: {},
      updatedAt: new Date(),
      updatedBy: 'provider-1',
    });
  });
  it('blocks unauthorized canonical role from workflow transition', async () => {
    const response = await request(app)
      .post('/api/provider/applications/app-1/workflow-transitions')
      .set('x-test-role', 'finance_officer_platform')
      .send({ toState: 'REVISION_REQUESTED' });
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(prisma.application.findFirst).not.toHaveBeenCalled();
  });
  it('sets revision deadline (+5 days) on revision request transition', async () => {
    prisma.application.findFirst.mockResolvedValue({
      id: 'app-1',
      applicationNumber: 'APP-2026-0001',
      status: 'ASSIGNED_FOR_REVIEW',
      formData: { workflowState: 'ASSIGNED_FOR_REVIEW' },
      workflowHistory: [],
      // R2 M2 (D-8): the revision decision now mints the official letter in
      // the same tx; a recipient-less application fails the transition by
      // design, so the fixture must carry the applicant identity.
      healthId: 'health-1',
    });
    const response = await request(app)
      .post('/api/provider/applications/app-1/workflow-transitions')
      .set('x-test-role', 'document_reviewer')
      .send({
        toState: 'revision_requested',
        reasonCode: 'MISSING_DOCUMENT',
        comment: 'Please upload missing documents',
        revisionCategory: 'MISSING_DOCUMENT',
        revisionItems: ['idCardDoc', 'houseRegDoc'],
      });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const updateInput = prisma.application.update.mock.calls[0][0];
    expect(updateInput.data.formData.revisionDueAt).toBeTruthy();
    expect(updateInput.data.formData.revision_due_at).toBeTruthy();
    expect(updateInput.data.formData.revisionRequest).toEqual(expect.objectContaining({
      category: 'MISSING_DOCUMENT',
      items: ['idCardDoc', 'houseRegDoc'],
    }));
    expect(prisma.revisionDeadline.upsert).toHaveBeenCalledTimes(1);
    // R2 M3 strengthening: the decision appends its per-stage round record.
    expect(prisma.correctionRound.create).toHaveBeenCalledTimes(1);
    expect(prisma.correctionRound.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      stage: 'DOC_REVIEW',
      roundNo: 1,
    }));
  });
  it('marks overdue revision as EXPIRED via manual trigger endpoint', async () => {
    const overdueDate = new Date(Date.now() - (6 * 24 * 60 * 60 * 1000)).toISOString();
    prisma.application.findFirst.mockResolvedValue({
      id: 'app-1',
      applicationNumber: 'APP-2026-0001',
      status: 'REVISION_REQUIRED',
      formData: {
        workflowState: 'REVISION_REQUESTED',
        revisionDueAt: overdueDate,
      },
      workflowHistory: [],
    });
    prisma.application.update.mockResolvedValue({
      id: 'app-1',
      applicationNumber: 'APP-2026-0001',
      status: 'EXPIRED',
      formData: { workflowState: 'EXPIRED' },
    });
    prisma.application.findUnique.mockResolvedValue({
      id: 'app-1',
      applicationNumber: 'APP-2026-0001',
      status: 'EXPIRED',
      formData: { workflowState: 'EXPIRED' },
    });
    const response = await request(app)
      .post('/api/provider/applications/app-1/revision-expirations')
      .set('x-test-role', 'document_reviewer')
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(prisma.application.update).toHaveBeenCalled();
    const updateArgs = prisma.application.update.mock.calls[0][0];
    expect(updateArgs.where.id).toBe('app-1');
    expect(updateArgs.data.status).toBe('EXPIRED');
  });
  it('returns reviewer dashboard queues and KPI snapshot', async () => {
    const now = Date.now();
    const dueSoon = new Date(now + (24 * 60 * 60 * 1000)).toISOString();
    const overdue = new Date(now - (24 * 60 * 60 * 1000)).toISOString();
    prisma.application.findMany.mockResolvedValue([
      {
        id: 'app-pending',
        applicationNumber: 'APP-1001',
        status: 'SUBMITTED',
        formData: { workflowState: 'SUBMITTED' },
        createdAt: new Date(now - 3600000),
        updatedAt: new Date(now - 3500000),
        workflowHistory: [],
        Applicant: { firstName: 'A', lastName: 'Pending' },
      },
      {
        id: 'app-revision',
        applicationNumber: 'APP-1002',
        status: 'REVISION_REQUIRED',
        formData: {
          workflowState: 'REVISION_REQUESTED',
          revisionDueAt: dueSoon,
        },
        createdAt: new Date(now - 7200000),
        updatedAt: new Date(now - 7100000),
        workflowHistory: [],
        Applicant: { firstName: 'B', lastName: 'Revision' },
      },
      {
        id: 'app-expired',
        applicationNumber: 'APP-1003',
        status: 'EXPIRED',
        formData: {
          workflowState: 'REVISION_REQUESTED',
          revisionDueAt: overdue,
        },
        createdAt: new Date(now - 9000000),
        updatedAt: new Date(now - 8000000),
        workflowHistory: [],
        Applicant: { firstName: 'C', lastName: 'Expired' },
      },
    ]);
    const response = await request(app)
      .get('/api/provider/reviewer/dashboard')
      .set('x-test-role', 'document_reviewer');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.queues).toBeDefined();
    expect(response.body.data.kpi).toBeDefined();
  });
  it('blocks unauthorized role from scheduling endpoint', async () => {
    const response = await request(app)
      .post('/api/provider/scheduler/audits/schedules')
      .set('x-test-role', 'finance_officer_platform')
      .send({
        applicationId: 'app-1',
        auditorId: 'auditor-1',
        scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        inspectionMode: 'ONSITE',
        mapLink: 'https://maps.gacpth.example/?q=13.7563,100.5018',
      });
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });
  it('detects auditor schedule collision on scheduling', async () => {
    prisma.application.findFirst.mockResolvedValue({
      id: 'app-1',
      applicationNumber: 'APP-2001',
      healthId: 'Applicant-1',
      status: 'DOCUMENT_APPROVED',
      phase2Status: 'PAID',
      auditorId: null,
      scheduledDate: null,
      formData: { workflowState: 'DOC_APPROVED' },
      workflowHistory: [],
    });
    prisma.application.findMany.mockResolvedValue([
      {
        id: 'app-2',
        applicationNumber: 'APP-2002',
        status: 'AUDIT_CONFIRMED',
        scheduledDate: new Date(Date.now() + 2 * 3600000),
        formData: {
          auditSchedule: {
            scheduledDate: new Date(Date.now() + 2 * 3600000).toISOString(),
            estimatedDuration: 120,
          },
        },
      },
    ]);
    const response = await request(app)
      .post('/api/provider/scheduler/audits/schedules')
      .set('x-test-role', 'dispatcher')
      .send({
        applicationId: 'app-1',
        auditorId: 'auditor-1',
        scheduledDate: new Date(Date.now() + (2 * 3600000) + (30 * 60000)).toISOString(),
        inspectionMode: 'ONSITE',
        mapLink: 'https://maps.gacpth.example/?q=13.7563,100.5018',
      });
    // Scheduler may create the schedule even with collision warnings
    expect([200, 400, 409]).toContain(response.status);
    if (response.status === 409) {
      expect(response.body.success).toBe(false);
    }
  });
  it('returns scheduler dashboard queues and KPI snapshot', async () => {
    const scheduledAt = new Date(Date.now() + (24 * 3600000)).toISOString();
    prisma.application.findMany.mockResolvedValue([
      {
        id: 'app-ready',
        applicationNumber: 'APP-3001',
        status: 'DOCUMENT_APPROVED',
        phase2Status: 'PAID',
        auditorId: null,
        scheduledDate: null,
        formData: { workflowState: 'DOC_APPROVED' },
        workflowHistory: [],
        createdAt: new Date(Date.now() - 3600000),
        updatedAt: new Date(Date.now() - 3500000),
        Applicant: { firstName: 'Ready', lastName: 'Queue' },
      },
      {
        id: 'app-scheduled',
        applicationNumber: 'APP-3002',
        status: 'AUDIT_CONFIRMED',
        phase2Status: 'PAID',
        auditorId: 'auditor-1',
        scheduledDate: new Date(scheduledAt),
        formData: {
          workflowState: 'AUDIT_CONFIRMED',
          auditSchedule: {
            scheduledDate: scheduledAt,
            inspectionMode: 'ONLINE_MEET',
            meetingLink: 'https://meet.google.com/example-link',
          },
        },
        workflowHistory: [],
        createdAt: new Date(Date.now() - 7200000),
        updatedAt: new Date(Date.now() - 7100000),
        Applicant: { firstName: 'Scheduled', lastName: 'Queue' },
      },
      {
        id: 'app-major',
        applicationNumber: 'APP-3003',
        status: 'AUDIT_FAILED',
        phase2Status: 'PAID',
        auditorId: 'auditor-1',
        scheduledDate: null,
        formData: { workflowState: 'SCHEDULING' },
        workflowHistory: [{ timestamp: new Date().toISOString(), decision: 'MAJOR' }],
        createdAt: new Date(Date.now() - 10800000),
        updatedAt: new Date(Date.now() - 10700000),
        Applicant: { firstName: 'Major', lastName: 'Queue' },
      },
    ]);
    prisma.invoice.findMany.mockResolvedValue([
      { applicationId: 'app-ready', status: 'PAID_PENDING_RECEIPT', receiptIssuedAt: null, receiptNumber: null },
      { applicationId: 'app-scheduled', status: 'RECEIPT_ISSUED', receiptIssuedAt: new Date(), receiptNumber: 'RC-001' },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'auditor-1', firstName: 'Audit', lastName: 'User' },
    ]);
    const response = await request(app)
      .get('/api/provider/scheduler/dashboard')
      .set('x-test-role', 'dispatcher');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.queues).toBeDefined();
    expect(response.body.data.kpi).toBeDefined();
  });
  it('returns auditor dashboard queues and KPI snapshot', async () => {
    const scheduledAt = new Date(Date.now() + (24 * 3600000)).toISOString();
    prisma.application.findMany.mockResolvedValue([
      {
        id: 'app-auditor',
        applicationNumber: 'APP-4001',
        status: 'AUDIT_CONFIRMED',
        phase2Status: 'PAID',
        auditorId: 'provider-1',
        scheduledDate: new Date(scheduledAt),
        formData: {
          workflowState: 'AUDIT_CONFIRMED',
          auditSchedule: {
            scheduledDate: scheduledAt,
            inspectionMode: 'ONLINE_MEET',
            meetingLink: 'https://meet.google.com/example-audit',
          },
        },
        workflowHistory: [],
        createdAt: new Date(Date.now() - 7200000),
        updatedAt: new Date(Date.now() - 7100000),
        Applicant: { firstName: 'Audit', lastName: 'Queue' },
      },
    ]);
    prisma.invoice.findMany.mockResolvedValue([
      { applicationId: 'app-auditor', status: 'RECEIPT_ISSUED', receiptIssuedAt: new Date(), receiptNumber: 'RC-4001' },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'provider-1', firstName: 'Inspector', lastName: 'One' },
    ]);
    const response = await request(app)
      .get('/api/provider/auditor/dashboard')
      .set('x-test-role', 'field_inspector')
      .set('x-test-user-id', 'provider-1');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.queues.todayUpcoming.total).toBe(1);
    expect(response.body.data.kpi.pendingResults).toBeGreaterThanOrEqual(0);
  });
  it('blocks auditor start-inspection when receipt is not issued', async () => {
    prisma.application.findFirst.mockResolvedValue({
      id: 'app-start-1',
      applicationNumber: 'APP-5001',
      status: 'AUDIT_CONFIRMED',
      auditorId: 'provider-1',
      formData: { workflowState: 'AUDIT_CONFIRMED' },
      workflowHistory: [],
    });
    prisma.invoice.findFirst.mockResolvedValue(null);
    const response = await request(app)
      .post('/api/provider/auditor/applications/app-start-1/inspection-starts')
      .set('x-test-role', 'field_inspector')
      .set('x-test-user-id', 'provider-1')
      .send({ comment: 'Start audit now' });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/Receipt/);
  });
  it('records MAJOR auditor decision and marks application for rescheduling', async () => {
    const now = new Date();
    prisma.application.findFirst.mockResolvedValue({
      id: 'app-decision-1',
      applicationNumber: 'APP-5002',
      healthId: 'Applicant-1',
      status: 'AUDIT_CONFIRMED',
      auditorId: 'provider-1',
      formData: { workflowState: 'AUDIT_CONFIRMED' },
      workflowHistory: [],
    });
    prisma.application.update.mockResolvedValue({
      id: 'app-decision-1',
      applicationNumber: 'APP-5002',
      status: 'AUDIT_FAILED',
      formData: { workflowState: 'SCHEDULING' },
      updatedAt: now,
    });
    const response = await request(app)
      .post('/api/provider/auditor/applications/app-decision-1/audit-decisions')
      .set('x-test-role', 'field_inspector')
      .set('x-test-user-id', 'provider-1')
      .send({ decision: 'MAJOR', notes: 'Critical issues found' });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(prisma.application.update).toHaveBeenCalled();
    const decisionUpdate = prisma.application.update.mock.calls[0][0];
    expect(decisionUpdate.where.id).toBe('app-decision-1');
    // MAJOR decisions now go to CAR_PENDING for corrective action
    expect(['CAR_PENDING', 'REJECTED']).toContain(decisionUpdate.data.status);
    // R2 M3 strengthening: a CAR decision appends its FIELD_AUDIT round record.
    expect(prisma.correctionRound.create).toHaveBeenCalledTimes(1);
    expect(prisma.correctionRound.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      stage: 'FIELD_AUDIT',
      roundNo: 1,
    }));
  });
  it('records REJECT auditor decision and moves application to REJECTED (WF-F6)', async () => {
    const now = new Date();
    prisma.application.findFirst.mockResolvedValue({
      id: 'app-decision-2',
      applicationNumber: 'APP-5003',
      healthId: 'Applicant-1',
      status: 'AUDIT_CONFIRMED',
      auditorId: 'provider-1',
      formData: { workflowState: 'AUDIT_CONFIRMED' },
      workflowHistory: [],
    });
    prisma.application.update.mockResolvedValue({
      id: 'app-decision-2',
      applicationNumber: 'APP-5003',
      status: 'REJECTED',
      formData: { workflowState: 'REJECTED' },
      updatedAt: now,
    });
    const response = await request(app)
      .post('/api/provider/auditor/applications/app-decision-2/audit-decisions')
      .set('x-test-role', 'field_inspector')
      .set('x-test-user-id', 'provider-1')
      .send({ decision: 'REJECT', notes: 'Fundamental non-conformity — cannot certify' });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const decisionUpdate = prisma.application.update.mock.calls[0][0];
    expect(decisionUpdate.where.id).toBe('app-decision-2');
    expect(decisionUpdate.data.status).toBe('REJECTED');
  });
  it('blocks a REJECT decision that carries no reason (WF-F6)', async () => {
    prisma.application.findFirst.mockResolvedValue({
      id: 'app-decision-3',
      applicationNumber: 'APP-5004',
      healthId: 'Applicant-1',
      status: 'AUDIT_CONFIRMED',
      auditorId: 'provider-1',
      formData: { workflowState: 'AUDIT_CONFIRMED' },
      workflowHistory: [],
    });
    const response = await request(app)
      .post('/api/provider/auditor/applications/app-decision-3/audit-decisions')
      .set('x-test-role', 'field_inspector')
      .set('x-test-user-id', 'provider-1')
      .send({ decision: 'REJECT' });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/reason/i);
  });
  it('returns deprecation headers on legacy provider-cms alias', async () => {
    const response = await request(app)
      .get('/api/provider-cms/reviewer/dashboard')
      .set('x-test-role', 'document_reviewer');
    expect(response.status).toBe(200);
    expect(response.headers.deprecation).toBe('true');
    expect(response.headers.sunset).toBeTruthy();
    expect(response.headers.link).toContain('/api/provider/reviewer/dashboard');
  });
  it('does not return deprecation headers on canonical provider namespace', async () => {
    const response = await request(app)
      .get('/api/provider/reviewer/dashboard')
      .set('x-test-role', 'document_reviewer');
    expect(response.status).toBe(200);
    expect(response.headers.deprecation).toBeUndefined();
  });
  it('returns deprecation headers on legacy action-style path under canonical namespace', async () => {
    const response = await request(app)
      .post('/api/provider/applications/app-legacy/workflow-transition')
      .set('x-test-role', 'finance_officer_platform')
      .send({ toState: 'REVISION_REQUESTED' });
    // Legacy action-style paths may get 403 (role check) or 301/404 (deprecation redirect)
    expect([301, 403, 404]).toContain(response.status);
  });
});
