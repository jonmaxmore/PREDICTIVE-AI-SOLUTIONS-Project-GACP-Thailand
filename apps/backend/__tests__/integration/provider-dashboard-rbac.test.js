const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth-middleware', () => ({
  authenticateProvider: (req, _res, next) => {
    req.user = {
      id: req.headers['x-test-user-id'] || 'provider-1',
      role: req.headers['x-test-role'] || 'admin',
      canonicalRole: req.headers['x-test-role'] || 'admin',
    };
    next();
  },
  authenticate: (_req, _res, next) => next(),
  authenticateHealth: (_req, _res, next) => next(),
  authenticateAny: (_req, _res, next) => next(),
  requireRole: (allowedRoles = []) => (req, res, next) => {
    const role = String(req.user?.role || '').toLowerCase();
    const allowed = allowedRoles.map((item) => String(item).toLowerCase());
    if (!allowed.includes(role)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
      });
    }
    return next();
  },
}));

jest.mock('../../services/prisma-database', () => ({
  prisma: {
    application: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    user: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    certificate: {
      count: jest.fn(),
    },
    invoice: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    },
    revisionDeadline: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

jest.mock('../../shared/logger', () => {
  const mockLog = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
  mockLog.createLogger = jest.fn(() => ({ ...mockLog }));
  mockLog.stream = { write: jest.fn() };
  return mockLog;
});

jest.mock('../../middleware/audit-logger', () => ({
  auditLogger: {
    log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  },
  AuditCategory: { APPLICATION: 'APPLICATION' },
  AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
  ResourceType: { APPLICATION: 'APPLICATION' },
}));

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
const providerRouter = require('../../routes/api/provider/index');

describe('Provider canonical RBAC guard', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/provider', providerRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.application.count.mockResolvedValue(0);
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.certificate.count.mockResolvedValue(0);
    prisma.invoice.count.mockResolvedValue(0);
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.revisionDeadline.findUnique.mockResolvedValue(null);
    prisma.revisionDeadline.upsert.mockResolvedValue({ applicationId: 'app-1' });
    prisma.revisionDeadline.updateMany.mockResolvedValue({ count: 1 });
  });

  it('rejects non-provider role on reviewer dashboard endpoint', async () => {
    const response = await request(app)
      .get('/api/provider/reviewer/dashboard')
      .set('x-test-role', 'health');

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it('rejects non-admin role for provider admin revision reminder run', async () => {
    const response = await request(app)
      .post('/api/provider/admin/revision-reminder-runs')
      .set('x-test-role', 'health')
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it('returns 404 for removed legacy provider stats endpoint', async () => {
    const response = await request(app)
      .get('/api/provider/stats')
      .set('x-test-role', 'admin');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/Legacy provider route is disabled/i);
  });
});

