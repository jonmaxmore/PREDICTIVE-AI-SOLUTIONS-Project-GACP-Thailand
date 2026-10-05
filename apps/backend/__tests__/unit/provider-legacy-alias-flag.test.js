const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
  const pass = (_req, _res, next) => next();
  return {
    authenticate: pass,
    authenticateHealth: pass,
    authenticateProvider: pass,
    authenticateAny: pass,
    authenticateDTAM: pass,
    optionalAuth: pass,
    requireVerification: pass,
    authorizeRoles: () => pass,
    authorize: () => pass,
    requireRole: () => pass,
    checkPermission: () => pass,
    rateLimitSensitive: () => pass,
  };
});

jest.mock('../../services/prisma-database', () => ({
  prisma: {
    application: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn() },
    farm: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(),
  },
  getClient: () => ({
    application: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { findMany: jest.fn().mockResolvedValue([]) },
  }),
}));

jest.mock('../../shared/logger', () => {
  const mockLog = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
  mockLog.createLogger = jest.fn(() => ({ ...mockLog }));
  mockLog.stream = { write: jest.fn() };
  return mockLog;
});

// Break circular: trace.js → trace-service → server.js → routes/api → trace.js
jest.mock('../../services/trace-service', () => ({
  FDA_REFERRAL: {},
  SAFETY_DISCLAIMER: {},
  TRACE_BASE_URL: 'http://localhost',
  TRACE_NOT_FOUND_MESSAGE: 'Not found',
  PLOT_HARVEST_META_PREFIX: 'PLOT_HARVEST_META:',
  formatCultivationType: jest.fn((t) => t || ''),
  formatThaiDate: jest.fn(() => null),
  generateQRCodeString: jest.fn(() => 'QR'),
  parseJsonMetaFromNotes: jest.fn(() => null),
  normalizeSourceFromPayload: jest.fn(() => ({ farm: {}, cycle: {}, plot: {} })),
  buildIntegrityPayload: jest.fn(() => ({ available: false })),
  logPublicTraceAccess: jest.fn().mockResolvedValue(undefined),
  resolveTraceByPlotCycleQr: jest.fn().mockResolvedValue({ status: 200, body: { success: true } }),
  resolveTraceByGenericQr: jest.fn().mockResolvedValue({ status: 200, body: { success: true } }),
}));

// Prevent real Redis connection (analytics.js → cache-service → config/redis)
jest.mock('../../config/redis', () => null);
jest.mock('../../services/cache-service', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  getOrSet: jest.fn((_key, fn) => fn()),
}));

// Audit logger mock (needed by workflow routes)
jest.mock('../../middleware/audit-logger', () => ({
  auditLogger: { log: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  AuditCategory: { APPLICATION: 'APPLICATION' },
  AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
  ResourceType: { APPLICATION: 'APPLICATION' },
}));

// Prevent setInterval() in rate-limiter from keeping Jest alive
jest.mock('../../middleware/rate-limiter', () => {
  const pass = (_req, _res, next) => next();
  return {
    rateLimiter: pass,
    strictRateLimiter: pass,
    createRateLimiter: () => pass,
  };
});

describe('Provider legacy alias flag', () => {
  const originalFlag = process.env.ENABLE_PROVIDER_LEGACY_ALIAS;

  afterEach(() => {
    jest.resetModules();
    if (typeof originalFlag === 'undefined') {
      delete process.env.ENABLE_PROVIDER_LEGACY_ALIAS;
    } else {
      process.env.ENABLE_PROVIDER_LEGACY_ALIAS = originalFlag;
    }
  });

  function buildApp(flagValue) {
    process.env.ENABLE_PROVIDER_LEGACY_ALIAS = flagValue;

    const providerCmsRouter = require('../../routes/api/system/provider-cms');
    const app = express();
    app.use(express.json());
    app.use('/api/provider-cms', providerCmsRouter);
    return app;
  }

  function buildApiApp(flagValue) {
    process.env.ENABLE_PROVIDER_LEGACY_ALIAS = flagValue;

    const apiRouter = require('../../routes/api');
    const app = express();
    app.use('/api', apiRouter);
    return app;
  }

  it('returns 404 for provider-cms namespace when legacy alias is disabled', async () => {
    const app = buildApp('false');
    const response = await request(app).get('/api/provider-cms/reviewer/dashboard');
    expect(response.status).toBe(404);
    expect(response.body?.error).toBe('Legacy provider route is disabled');
    expect(response.body?.canonicalPath).toBe('/api/provider/reviewer/dashboard');
  });

  it('emits deprecation headers when legacy alias is enabled', async () => {
    const app = buildApp('true');
    const response = await request(app).get('/api/provider-cms/unknown');
    expect(response.status).toBe(404);
    expect(response.headers.deprecation).toBe('true');
    expect(response.headers.sunset).toBeTruthy();
    expect(String(response.headers.link || '')).toContain('/api/provider/unknown');
  });

  it('hard-cuts legacy provider-cms alias endpoints when legacy alias is disabled', async () => {
    const app = buildApiApp('false');
    const legacyTargets = [
      '/api/provider-cms/reviewer/dashboard',
      '/api/provider-cms/scheduler/queue',
      '/api/provider-cms/auditor/dashboard',
    ];

    for (const target of legacyTargets) {

      const response = await request(app).get(target);
      expect(response.status).toBe(404);
    }
  });
});
